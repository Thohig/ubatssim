/**
 * Glue between orders, autopilot and the simulation. One call to `step()`
 * advances the whole system by one fixed time step:
 *   drain order queue → update setpoints/manual commands → autopilot →
 *   write plant commands → sim.step() → (simplified mode) trim assistant
 */
import type { Simulation } from '../sim/simulation';
import { DT } from '../sim/simulation';
import { Autopilot, type AutopilotInput } from './autopilot';
import type { GameMode } from './gameMode';
import { OrderQueue } from './orderQueue';
import { acknowledgement, type Order, type OrderSource, type TankGroup } from './orders';
import { LIMITS } from './parser';
import { TrimAssist } from './trimAssist';

const DEG = Math.PI / 180;
/** The bridge deck must be at least this far above the water to man it [m]. */
const BRIDGE_FREEBOARD = 0.5;
/** Depth targets from this depth [m] need flooded main ballast. */
const DIVE_TARGET_DEPTH = 5;
/** Surface hold applies above this CO depth [m] (a surfaced boat floats at ~1.8 m). */
const SURFACE_HOLD_DEPTH = 6;
const KNOT = 1852 / 3600;

export type LogKind = 'ack' | 'error' | 'info';

export interface LogEntry {
  /** Simulation time [s]. */
  t: number;
  text: string;
  kind: LogKind;
  source?: OrderSource;
}

/** Formats simulation time as [hh:mm:ss]. */
export function formatSimTime(t: number): string {
  const s = Math.floor(t);
  const hh = String(Math.floor(s / 3600)).padStart(2, '0');
  const mm = String(Math.floor((s % 3600) / 60)).padStart(2, '0');
  const ss = String(s % 60).padStart(2, '0');
  return `${hh}:${mm}:${ss}`;
}

export interface AutopilotState {
  depth: boolean;
  heading: boolean;
  speed: boolean;
}

export class Controller {
  readonly queue = new OrderQueue();
  readonly autopilot = new Autopilot();
  readonly assist: TrimAssist = new TrimAssist(this);
  readonly log: LogEntry[] = [];
  private listeners: ((e: LogEntry) => void)[] = [];

  /** Setpoints in operator units: m, degrees, knots. */
  setpoints = { depth: 0, heading: 0, speed: 0 };
  ap: AutopilotState = { depth: false, heading: false, speed: false };
  /** Manual commands in operator units: degrees and rpm. */
  manual = { rudder: 0, planes: 0, rpm: 0 };
  private rpsCmd = 0;

  constructor(readonly sim: Simulation) {
    const tel = sim.telemetry();
    this.setpoints = { depth: Math.round(tel.depth), heading: Math.round(tel.heading / DEG) % 360, speed: 0 };
    this.manual.rpm = (sim.commands.rps * 60);
    this.rpsCmd = sim.commands.rps;
    this.bridgeManned = sim.bodyPointDepth(sim.cfg.bridge.deck) < -BRIDGE_FREEBOARD;
  }

  /** Why an order cannot be carried out now, or null. */
  private refusal(o: Order): string | null {
    const allowed = this.options.autopilotAllowed || this.options.mode === 'simplified';
    if (!allowed && this.engagesSteeringAutopilot(o)) return 'Autopilot för djup och kurs är inte tillåten här. Styr med roder och djuproder.';
    const floods = o.kind === 'dive' || (o.kind === 'mainBallast' && o.action === 'flood');
    if (floods && this.bridgeManned) {
      if (this.options.mode === 'simplified') {
        this.bridgeManned = false;
        this.addLog('Klart bryggan. Bryggan är utrymd inför dykningen.', 'info');
        return null;
      }
      return 'Bryggan är bemannad. Ge order "klart bryggan" innan ubåten dyker.';
    }
    if (o.kind === 'bridge' && o.manned && this.sim.bodyPointDepth(this.sim.cfg.bridge.deck) > -BRIDGE_FREEBOARD) {
      return 'Bryggan är under vatten. Gå till ytläge först.';
    }
    if (o.kind === 'bridge' && o.manned && this.sim.tanks.some((t) => t.ventOpen)) {
      return 'Ubåten dyker: ventilerna till huvudballasten är öppna.';
    }
    return null;
  }

  onLog(fn: (e: LogEntry) => void): void {
    this.listeners.push(fn);
  }

  addLog(text: string, kind: LogKind, source?: OrderSource): void {
    const e: LogEntry = { t: this.sim.t, text, kind, source };
    this.log.push(e);
    if (this.log.length > 500) this.log.shift();
    for (const fn of this.listeners) fn(e);
  }

  /** Game rules set by the menu/scenario. */
  options: { autopilotAllowed: boolean; mode: GameMode; safetyNet: boolean } = {
    /**
     * Realistic mode only: when false, depth and heading autopilots cannot be
     * engaged (speed control stays available). The simplified mode is built
     * on the autopilots and ignores it.
     */
    autopilotAllowed: true,
    /** Change with `setMode()`. */
    mode: 'realistic',
    /** Simplified mode: emergency blow, shallow-water limit and keel warning. */
    safetyNet: true,
  };

  /** Switches game mode without a jump in the commands. */
  setMode(mode: GameMode): void {
    if (mode === this.options.mode) return;
    this.options.mode = mode;
    if (mode === 'simplified') {
      // Hold the present depth and heading; the player then moves the targets.
      this.apply({ kind: 'autopilot', axis: 'depth', on: true });
      this.apply({ kind: 'autopilot', axis: 'heading', on: true });
      this.addLog('Förenklad simulering: ↑/↓ ändrar djupet, ←/→ ändrar kursen. Assistenten trimmar ubåten.', 'info');
    } else {
      // Hand over with the last automatic rudder and plane angles, as "autopilot av" does.
      this.apply({ kind: 'autopilot', axis: 'depth', on: false });
      this.apply({ kind: 'autopilot', axis: 'heading', on: false });
      this.addLog('Realistisk simulering: du styr roder och djuproder och trimmar själv.', 'info');
    }
  }

  /**
   * Someone is on the open bridge. The boat must not dive with the bridge
   * manned: the realistic mode refuses to flood, the simplified mode clears
   * the bridge itself. Starts manned when the bridge is above the water.
   */
  bridgeManned: boolean;

  /** Seconds the periscope head has been above the water without a break (0 when housed or under). */
  periscopeExposure = 0;

  /** The last reported bearing: where the boat was and whether anything could be seen. */
  lastBearing: { bearing: number; t: number; position: [number, number]; lookout: boolean } | null = null;

  /** Main ballast vents shut automatically once the tanks are full (after "dyk"). */
  private shutVentsWhenFull = false;

  submit(order: Order, source: OrderSource): void {
    this.queue.push(order, source);
  }

  /** True if the order would engage a depth or heading autopilot. */
  private engagesSteeringAutopilot(o: Order): boolean {
    return (
      o.kind === 'setDepth' ||
      o.kind === 'setHeading' ||
      o.kind === 'adjustDepth' ||
      o.kind === 'adjustHeading' ||
      o.kind === 'holdCourse' ||
      (o.kind === 'autopilot' && o.on && o.axis !== 'speed')
    );
  }

  step(): void {
    for (const { order, source } of this.queue.drain()) {
      const refused = this.refusal(order);
      if (refused) {
        this.addLog(refused, 'error', source);
        continue;
      }
      this.apply(order);
      this.addLog(acknowledgement(order), 'ack', source);
    }
    const sim = this.sim;
    // On the surface with the bridge manned the low-pressure blower keeps the main ballast dry.
    sim.commands.lpBlower = this.bridgeManned;
    const tel = sim.kinematics();
    const input: AutopilotInput = {
      depth: tel.depth,
      depthRate: tel.depthRate,
      pitch: tel.pitch,
      pitchRate: tel.q,
      heading: tel.heading,
      yawRate: tel.r,
      speed: tel.u,
    };

    // Surfaced with empty main ballast and a shallow target, the boat simply floats:
    // the depth autopilot keeps the planes at zero instead of fighting ~200 t of buoyancy.
    this.surfaceHold = this.ap.depth && this.setpoints.depth < DIVE_TARGET_DEPTH && tel.depth < SURFACE_HOLD_DEPTH && this.mainBallastEmpty();
    if (this.surfaceHold) this.resetDepthLoops();
    sim.commands.sternPlanes = this.surfaceHold
      ? 0
      : this.ap.depth
        ? this.autopilot.planes(this.setpoints.depth, input, DT)
        : this.manual.planes * DEG;
    sim.commands.rudder = this.ap.heading ? this.autopilot.rudder(this.setpoints.heading * DEG, input, DT) : this.manual.rudder * DEG;

    const maxRps = sim.cfg.propulsion.maxRps;
    let target: number;
    if (this.ap.speed) {
      const v = this.setpoints.speed * KNOT;
      const ff = Math.sign(v) * sim.rpsForSpeed(Math.abs(v));
      target = this.autopilot.rps(v, ff, input, DT);
    } else {
      target = this.manual.rpm / 60;
    }
    target = Math.max(-maxRps, Math.min(maxRps, target));
    const slew = this.autopilot.tuning.rpsSlew * DT;
    this.rpsCmd += Math.max(-slew, Math.min(slew, target - this.rpsCmd));
    sim.commands.rps = this.rpsCmd;

    sim.step();

    if (this.shutVentsWhenFull) {
      // Air can stay trapped at the top of a tank at the surface; it vents once the boat is under way down.
      const fills = sim.tankDefs.flatMap((d, i) => (d.kind === 'mainBallast' ? [sim.tanks[i]!.water / d.volume] : []));
      const least = Math.min(...fills);
      if (least > 0.999 || (least > 0.98 && sim.y[2]! > 15)) {
        sim.setVents(false);
        this.shutVentsWhenFull = false;
        this.addLog('Huvudballasten är full. Ventilerna stängda.', 'info');
      }
    }
    if (this.bridgeManned && sim.bodyPointDepth(sim.cfg.bridge.deck) > sim.cfg.bridge.coaming) {
      this.bridgeManned = false;
      this.addLog('Vatten över bryggan! Bryggan är utrymd.', 'error');
    }
    const headUp = sim.actuators.periscope > 0.99 && sim.bodyPointDepth(sim.periscopeHead()) < 0;
    this.periscopeExposure = headUp ? this.periscopeExposure + DT : 0;
    if (this.options.mode === 'simplified') this.assist.step();

    const grounded = sim.groundContacts > 0;
    if (grounded && !this.grounded) {
      this.addLog(`Grundstötning! Fart ${(Math.abs(sim.y[7]!) / KNOT).toFixed(1).replace('.', ',')} knop.`, 'error');
    }
    this.grounded = grounded;
  }

  private grounded = false;

  private apply(o: Order): void {
    const sim = this.sim;
    const tel = sim.telemetry();
    switch (o.kind) {
      case 'setDepth':
        if (!this.ap.depth) this.resetDepthLoops();
        this.setpoints.depth = o.depth;
        this.ap.depth = true;
        this.checkBallastForDepth();
        break;
      case 'setHeading':
        if (!this.ap.heading) this.autopilot.headingPid.reset();
        this.setpoints.heading = o.heading;
        this.ap.heading = true;
        break;
      case 'setSpeed':
        this.setpoints.speed = o.knots;
        this.ap.speed = true;
        break;
      case 'adjustSpeed': {
        const base = this.ap.speed ? this.setpoints.speed : Math.round(tel.u / KNOT);
        this.setpoints.speed = Math.max(-6, Math.min(20, base + o.deltaKnots));
        this.ap.speed = true;
        break;
      }
      case 'setRpm':
        this.manual.rpm = o.rpm;
        this.ap.speed = false;
        break;
      case 'rudder': {
        const current = this.ap.heading ? sim.commands.rudder / DEG : this.manual.rudder;
        const max = sim.cfg.actuators.rudderMax / DEG;
        this.manual.rudder = Math.max(-max, Math.min(max, o.relative ? Math.round(current + o.angle) : o.angle));
        this.ap.heading = false;
        break;
      }
      case 'planes': {
        const current = this.ap.depth ? sim.commands.sternPlanes / DEG : this.manual.planes;
        const max = sim.cfg.actuators.planesMax / DEG;
        this.manual.planes = Math.max(-max, Math.min(max, o.relative ? Math.round(current + o.angle) : o.angle));
        this.ap.depth = false;
        break;
      }
      case 'mainBallast': {
        this.shutVentsWhenFull = false;
        const ids = groupIds(o.group);
        if (o.action === 'flood') sim.setVents(true, ids);
        else if (o.action === 'blow') sim.setBlow(true, ids);
        else {
          sim.setVents(false, ids);
          sim.setBlow(false, ids);
        }
        break;
      }
      case 'trim':
        sim.requestTrimTransfer(o.litres / 1000);
        break;
      case 'compensate':
        sim.requestCompensation(o.litres / 1000);
        break;
      case 'autopilot': {
        const axes = o.axis === 'all' ? (['depth', 'heading', 'speed'] as const) : ([o.axis] as const);
        for (const axis of axes) {
          if (o.on && !this.ap[axis]) {
            if (axis === 'depth') {
              this.setpoints.depth = Math.round(tel.depth);
              this.resetDepthLoops();
            } else if (axis === 'heading') {
              this.setpoints.heading = Math.round(tel.heading / DEG) % 360;
              this.autopilot.headingPid.reset();
            } else {
              this.setpoints.speed = Math.round(tel.u / KNOT);
              this.autopilot.speedPid.reset();
            }
          }
          if (!o.on) {
            // Hand over without a jump: keep the last automatic command.
            if (axis === 'depth' && this.ap.depth) this.manual.planes = Math.round(sim.commands.sternPlanes / DEG);
            if (axis === 'heading' && this.ap.heading) this.manual.rudder = Math.round(sim.commands.rudder / DEG);
            if (axis === 'speed' && this.ap.speed) this.manual.rpm = Math.round(this.rpsCmd * 60);
          }
          this.ap[axis] = o.on;
        }
        break;
      }
      case 'adjustDepth': {
        const base = this.ap.depth ? this.setpoints.depth : Math.round(tel.depth);
        if (!this.ap.depth) this.resetDepthLoops();
        let depth = Math.max(0, Math.min(LIMITS.maxDepth, base + o.deltaMetres));
        if (this.options.mode === 'simplified' && this.options.safetyNet && o.deltaMetres > 0) {
          // Shallow water: never deeper than the safety limit (or the present target, if already below it).
          depth = Math.min(depth, Math.max(base, this.assist.depthLimit()));
        }
        this.setpoints.depth = depth;
        this.ap.depth = true;
        this.checkBallastForDepth();
        break;
      }
      case 'adjustHeading': {
        const base = this.ap.heading ? this.setpoints.heading : Math.round(tel.heading / DEG);
        if (!this.ap.heading) this.autopilot.headingPid.reset();
        this.setpoints.heading = (((base + o.deltaDegrees) % 360) + 360) % 360;
        this.ap.heading = true;
        break;
      }
      case 'holdCourse':
        this.setpoints.depth = Math.round(tel.depth);
        this.setpoints.heading = Math.round(tel.heading / DEG) % 360;
        this.resetDepthLoops();
        this.autopilot.headingPid.reset();
        this.ap.depth = true;
        this.ap.heading = true;
        break;
      case 'dive':
        sim.setVents(true);
        this.shutVentsWhenFull = true;
        break;
      case 'surface':
        sim.setBlow(true);
        this.shutVentsWhenFull = false;
        if (this.ap.depth) this.setpoints.depth = 0;
        break;
      case 'periscope':
        sim.commands.periscopeUp = o.up;
        break;
      case 'bridge':
        this.bridgeManned = o.manned;
        break;
      case 'reportBearing': {
        // Something can be seen from a raised periscope above the water or from the bridge.
        const lookout = this.bridgeManned || (sim.actuators.periscope > 0.99 && sim.bodyPointDepth(sim.periscopeHead()) < 0);
        this.lastBearing = { bearing: o.bearing, t: sim.t, position: [sim.y[0]!, sim.y[1]!], lookout };
        if (!lookout) this.addLog('Ingen utkik: hissa periskopet eller bemanna bryggan för att se något.', 'error');
        break;
      }
    }
  }

  /**
   * True while the depth autopilot holds the boat on the surface: planes at
   * zero, the boat floats (shown as "→ yta" on the instruments).
   */
  surfaceHold = false;

  /** Main ballast (mostly) empty, with vents and blows shut: the boat floats on the surface. */
  private mainBallastEmpty(): boolean {
    const sim = this.sim;
    return sim.tankDefs.every((d, i) => {
      const s = sim.tanks[i]!;
      return d.kind !== 'mainBallast' || (s.water / d.volume <= 0.5 && !s.ventOpen && !s.blowOpen);
    });
  }

  /** Sim time of the last "the main ballast is empty" reminder (realistic mode). */
  private lastBallastHint = -Infinity;

  /**
   * A depth target below the surface while the main ballast is empty cannot
   * be reached: the boat has ~200 t of reserve buoyancy and the planes give
   * a few tonnes. The simplified mode starts the dive (as "dyk" does); the
   * realistic mode reminds the player.
   */
  private checkBallastForDepth(): void {
    const sim = this.sim;
    if (this.setpoints.depth < DIVE_TARGET_DEPTH) {
      this.checkBallastForSurface();
      return;
    }
    if (!this.mainBallastEmpty()) return;
    if (this.options.mode === 'simplified') {
      if (this.bridgeManned) {
        this.bridgeManned = false;
        this.addLog('Klart bryggan. Bryggan är utrymd inför dykningen.', 'info');
      }
      sim.setVents(true);
      this.shutVentsWhenFull = true;
      this.addLog('Huvudballasten fylls för dykning.', 'info');
    } else if (sim.t - this.lastBallastHint > 10) {
      this.lastBallastHint = sim.t;
      this.addLog('Huvudballasten är tom, så ubåten kan inte dyka. Ge order "dyk" eller "klart bryggan" och "fyll huvudballast".', 'error');
    }
  }

  /**
   * The mirror image: a target near the surface with flooded main ballast.
   * The boat is then neutral and the planes can only bring it up awash.
   * The simplified mode blows the tanks (as "ytläge" does); the realistic
   * mode reminds the player.
   */
  private checkBallastForSurface(): void {
    const sim = this.sim;
    const flooded = sim.tankDefs.some((d, i) => {
      const s = sim.tanks[i]!;
      return d.kind === 'mainBallast' && s.water / d.volume > 0.5 && !s.blowOpen;
    });
    if (!flooded || sim.tanks.some((t) => t.blowOpen)) return;
    if (this.options.mode === 'simplified') {
      sim.setBlow(true);
      this.shutVentsWhenFull = false;
      this.addLog('Huvudballasten blåses för ytläge.', 'info');
    } else if (sim.t - this.lastBallastHint > 10) {
      this.lastBallastHint = sim.t;
      this.addLog('Huvudballasten är full, så ubåten kommer inte upp i ytläge. Ge order "ytläge" eller "blås huvudballast".', 'error');
    }
  }

  private resetDepthLoops(): void {
    this.autopilot.depthPid.reset();
    this.autopilot.pitchPid.reset();
  }
}

function groupIds(g: TankGroup): string[] | undefined {
  return g === 'fwd' ? ['mbt_fwd'] : g === 'aft' ? ['mbt_aft'] : undefined;
}
