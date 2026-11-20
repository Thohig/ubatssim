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
import { acknowledgement, type Order, type OrderKind, type OrderOf, type OrderSource, type TankGroup } from './orders';
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

type Kinematics = ReturnType<Simulation['kinematics']>;

/** How one kind of order is handled (see `Controller.ORDERS`). */
interface OrderRule<O extends Order> {
  apply(c: Controller, o: O, k: Kinematics): void;
  /** True if the order engages the depth or heading autopilot. */
  steering?: (o: O) => boolean;
  /** A message if the order cannot be carried out now. */
  refuse?: (c: Controller, o: O) => string | null;
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
    const rule = Controller.ORDERS[o.kind] as OrderRule<Order>;
    const allowed = this.options.autopilotAllowed || this.options.mode === 'simplified';
    if (!allowed && rule.steering?.(o)) return 'Autopilot för djup och kurs är inte tillåten här. Styr med roder och djuproder.';
    return rule.refuse?.(this, o) ?? null;
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

  /**
   * The order registry: for every kind of order, what it does (`apply`),
   * when it is refused (`refuse`, a message) and whether it engages the depth
   * or heading autopilot (`steering`, refused where those are not allowed).
   * TypeScript refuses to compile if an order kind is missing. The
   * acknowledgement texts are in orders.ts.
   */
  private static readonly ORDERS: { [K in OrderKind]: OrderRule<OrderOf<K>> } = {
    setDepth: {
      steering: () => true,
      apply: (c, o) => {
        if (!c.ap.depth) c.resetDepthLoops();
        c.setpoints.depth = o.depth;
        c.ap.depth = true;
        c.checkBallastForDepth();
      },
    },
    setHeading: {
      steering: () => true,
      apply: (c, o) => {
        if (!c.ap.heading) c.autopilot.headingPid.reset();
        c.setpoints.heading = o.heading;
        c.ap.heading = true;
      },
    },
    setSpeed: {
      apply: (c, o) => {
        c.setpoints.speed = o.knots;
        c.ap.speed = true;
      },
    },
    adjustSpeed: {
      apply: (c, o, k) => {
        const base = c.ap.speed ? c.setpoints.speed : Math.round(k.u / KNOT);
        c.setpoints.speed = Math.max(-6, Math.min(20, base + o.deltaKnots));
        c.ap.speed = true;
      },
    },
    setRpm: {
      apply: (c, o) => {
        c.manual.rpm = o.rpm;
        c.ap.speed = false;
      },
    },
    rudder: {
      apply: (c, o) => {
        const sim = c.sim;
        const current = c.ap.heading ? sim.commands.rudder / DEG : c.manual.rudder;
        const max = sim.cfg.actuators.rudderMax / DEG;
        c.manual.rudder = Math.max(-max, Math.min(max, o.relative ? Math.round(current + o.angle) : o.angle));
        c.ap.heading = false;
      },
    },
    planes: {
      apply: (c, o) => {
        const sim = c.sim;
        const current = c.ap.depth ? sim.commands.sternPlanes / DEG : c.manual.planes;
        const max = sim.cfg.actuators.planesMax / DEG;
        c.manual.planes = Math.max(-max, Math.min(max, o.relative ? Math.round(current + o.angle) : o.angle));
        c.ap.depth = false;
      },
    },
    mainBallast: {
      refuse: (c, o) => (o.action === 'flood' ? c.refuseDiveWithBridgeManned() : null),
      apply: (c, o) => {
        const sim = c.sim;
        c.shutVentsWhenFull = false;
        const ids = groupIds(o.group);
        if (o.action === 'flood') sim.setVents(true, ids);
        else if (o.action === 'blow') sim.setBlow(true, ids);
        else {
          sim.setVents(false, ids);
          sim.setBlow(false, ids);
        }
      },
    },
    trim: {
      apply: (c, o) => {
        c.sim.requestTrimTransfer(o.litres / 1000);
      },
    },
    compensate: {
      apply: (c, o) => {
        c.sim.requestCompensation(o.litres / 1000);
      },
    },
    autopilot: {
      steering: (o) => o.on && o.axis !== 'speed',
      apply: (c, o, k) => {
        const sim = c.sim;
        const axes = o.axis === 'all' ? (['depth', 'heading', 'speed'] as const) : ([o.axis] as const);
        for (const axis of axes) {
          if (o.on && !c.ap[axis]) {
            if (axis === 'depth') {
              c.setpoints.depth = Math.round(k.depth);
              c.resetDepthLoops();
            } else if (axis === 'heading') {
              c.setpoints.heading = Math.round(k.heading / DEG) % 360;
              c.autopilot.headingPid.reset();
            } else {
              c.setpoints.speed = Math.round(k.u / KNOT);
              c.autopilot.speedPid.reset();
            }
          }
          if (!o.on) {
            // Hand over without a jump: keep the last automatic command.
            if (axis === 'depth' && c.ap.depth) c.manual.planes = Math.round(sim.commands.sternPlanes / DEG);
            if (axis === 'heading' && c.ap.heading) c.manual.rudder = Math.round(sim.commands.rudder / DEG);
            if (axis === 'speed' && c.ap.speed) c.manual.rpm = Math.round(c.rpsCmd * 60);
          }
          c.ap[axis] = o.on;
        }
      },
    },
    adjustDepth: {
      steering: () => true,
      apply: (c, o, k) => {
        const base = c.ap.depth ? c.setpoints.depth : Math.round(k.depth);
        if (!c.ap.depth) c.resetDepthLoops();
        let depth = Math.max(0, Math.min(LIMITS.maxDepth, base + o.deltaMetres));
        if (c.options.mode === 'simplified' && c.options.safetyNet && o.deltaMetres > 0) {
          // Shallow water: never deeper than the safety limit (or the present target, if already below it).
          depth = Math.min(depth, Math.max(base, c.assist.depthLimit()));
        }
        c.setpoints.depth = depth;
        c.ap.depth = true;
        c.checkBallastForDepth();
      },
    },
    adjustHeading: {
      steering: () => true,
      apply: (c, o, k) => {
        const base = c.ap.heading ? c.setpoints.heading : Math.round(k.heading / DEG);
        if (!c.ap.heading) c.autopilot.headingPid.reset();
        c.setpoints.heading = (((base + o.deltaDegrees) % 360) + 360) % 360;
        c.ap.heading = true;
      },
    },
    holdCourse: {
      steering: () => true,
      apply: (c, _o, k) => {
        c.setpoints.depth = Math.round(k.depth);
        c.setpoints.heading = Math.round(k.heading / DEG) % 360;
        c.resetDepthLoops();
        c.autopilot.headingPid.reset();
        c.ap.depth = true;
        c.ap.heading = true;
      },
    },
    dive: {
      refuse: (c) => c.refuseDiveWithBridgeManned(),
      apply: (c) => {
        c.sim.setVents(true);
        c.shutVentsWhenFull = true;
      },
    },
    surface: {
      apply: (c) => {
        c.sim.setBlow(true);
        c.shutVentsWhenFull = false;
        if (c.ap.depth) c.setpoints.depth = 0;
      },
    },
    periscope: {
      apply: (c, o) => {
        c.sim.commands.periscopeUp = o.up;
      },
    },
    bridge: {
      refuse: (c, o) => {
        if (!o.manned) return null;
        if (c.sim.bodyPointDepth(c.sim.cfg.bridge.deck) > -BRIDGE_FREEBOARD) return 'Bryggan är under vatten. Gå till ytläge först.';
        if (c.sim.tanks.some((t) => t.ventOpen)) return 'Ubåten dyker: ventilerna till huvudballasten är öppna.';
        return null;
      },
      apply: (c, o) => {
        c.bridgeManned = o.manned;
      },
    },
    reportBearing: {
      apply: (c, o) => {
        const sim = c.sim;
        // Something can be seen from a raised periscope above the water or from the bridge.
        const lookout = c.bridgeManned || (sim.actuators.periscope > 0.99 && sim.bodyPointDepth(sim.periscopeHead()) < 0);
        c.lastBearing = { bearing: o.bearing, t: sim.t, position: [sim.y[0]!, sim.y[1]!], lookout };
        if (!lookout) c.addLog('Ingen utkik: hissa periskopet eller bemanna bryggan för att se något.', 'error');
      },
    },
  };

  /** Applies an order (already checked by `refusal`). */
  private apply(o: Order): void {
    const rule = Controller.ORDERS[o.kind] as OrderRule<Order>;
    rule.apply(this, o, this.sim.kinematics());
  }

  /** Flooding with the bridge manned: refused in the realistic mode, the bridge is cleared in the simplified mode. */
  private refuseDiveWithBridgeManned(): string | null {
    if (!this.bridgeManned) return null;
    if (this.options.mode === 'simplified') {
      this.bridgeManned = false;
      this.addLog('Klart bryggan. Bryggan är utrymd inför dykningen.', 'info');
      return null;
    }
    return 'Bryggan är bemannad. Ge order "klart bryggan" innan ubåten dyker.';
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
