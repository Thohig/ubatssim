/**
 * Glue between orders, autopilot and the simulation. One call to `step()`
 * advances the whole system by one fixed time step:
 *   drain order queue → update setpoints/manual commands → autopilot →
 *   write plant commands → sim.step() → the crew's trim assistant and safety net
 */
import type { Simulation } from '../sim/simulation';
import { DT } from '../sim/simulation';
import { Autopilot, type AutopilotInput } from './autopilot';
import { CREW_SYSTEMS, LOCK_TEXT, isAxis, type CrewDuties, type CrewLocks, type CrewSystem } from './crew';
import { OrderQueue } from './orderQueue';
import { acknowledgement, type Order, type OrderSource } from './orders';
import { BRIDGE_FREEBOARD, ORDERS, type Kinematics, type OrderRule } from './orderRegistry';
import { CHARGE_STOP, PlantWatch } from './plantWatch';
import { HOVER } from './hover';
import { TrimAssist } from './trimAssist';
import { Sonar } from './sonar';
import { FireControl } from './fireControl';
import { Hunter } from './hunter';
import { World } from '../sim/world';

const DEG = Math.PI / 180;
/** Depth targets from this depth [m] need flooded main ballast. */
const DIVE_TARGET_DEPTH = 5;
/**
 * Deeper than this [m] the crew blows the forward main ballast first and the
 * after tanks `STAGED_BLOW_DELAY` seconds later. Blown together, the after
 * tanks (shallower once the bow dips) emptied faster, and with the hull's
 * lift ahead of the centre the boat pitched bow down to 40–60° and came up
 * stern first. Forward first gives the bow-up angle of a real blow.
 */
const STAGED_BLOW_DEPTH = 20;
const STAGED_BLOW_DELAY = 15;
/**
 * Awash: a boat that stays shallower than this [m] for `AWASH_TIME` s with way on and the planes
 * (or the depth target) for diving, the main ballast mostly flooded and its vents shut, has air left
 * in the tanks. The player handling the ballast is reminded (every `AWASH_HINT_EVERY` s).
 */
const AWASH_DEPTH = 5;
const AWASH_TIME = 60;
const AWASH_HINT_EVERY = 120;
/** Seconds after touching the bottom during which the stall watch does not run the engine up. */
const GROUNDED_QUIET = 120;
/** Water under the keel [m] below which the stall watch does not run the engine up either. */
const NEAR_BOTTOM = 10;
/** Seconds without a new "Grundstötning!" line after one. */
const GROUNDING_LOG_QUIET = 20;
/** Surface hold applies above this CO depth [m] (a surfaced boat floats at ~1.8 m). */
const SURFACE_HOLD_DEPTH = 6;
const KNOT = 1852 / 3600;
/** Stopp backs full until the speed through the water is below this [m/s] (~1 knot). */
const CRASH_STOP_UNTIL = 0.5;
/** Speed [knots] at which the planes can change the depth, and seconds stalled before the crew says so. */
const PLANES_SPEED = 4;
const STALL_TIME = 30;
/** Fraction of full stern planes that counts as hard over for the stall watch. */
const STALL_PLANES = 0.85;
const STALL_HINT_EVERY = 120;
/** Off the depth target by more than this [m], hard-over planes count as stalled (1 m matters at periscope depth). */
const STALL_MIN_ERROR = 1;
/** The boost ends when the depth has been within this of the target [m] for `DEPTH_SETTLE` seconds (not just passed through it). */
const DEPTH_REACHED = 0.5;
const DEPTH_SETTLE = 30;
/** The crew starts the diesels below this state of charge (and stops them at `CHARGE_STOP`, plantWatch.ts). */
const CHARGE_START = 0.95;

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


/** Logged when a manual order takes a system over from the crew. */
const TAKEN_OVER: Partial<Record<CrewSystem, string>> = {
  ballast: 'Du sköter ballasten och bryggan nu.',
  charging: 'Du sköter laddningen nu: starta och stoppa dieslarna själv.',
  trim: 'Trimassistenten avlöst. Du sköter trimmet nu.',
};

export class Controller {
  readonly queue = new OrderQueue();
  readonly autopilot = new Autopilot();
  readonly assist: TrimAssist = new TrimAssist(this);
  /** The passive sonar, and the patrol vessels looking for the boat. */
  readonly sonar: Sonar = new Sonar(this);
  /** Targets, target motion analysis and the torpedo tubes. */
  readonly fire: FireControl = new FireControl(this);
  /** The corvettes' hunt for the boat. */
  readonly hunter: Hunter = new Hunter(this);
  /** Logs what the plant does on its own (plantWatch.ts). */
  readonly plant: PlantWatch = new PlantWatch(this);
  /** Torpedoes fired and hits this game (for the result). */
  torpedoesFired = 0;
  hits = 0;
  /** Recent explosions (torpedo hits, depth charges) for the graphics and the sound, newest last. */
  blasts: { id: number; kind: 'hit' | 'charge'; at: [number, number, number]; distance: number }[] = [];
  private nextBlast = 1;
  /** Lines logged right after the current order's acknowledgement. */
  /** @internal For the order registry (orderRegistry.ts). */
  afterAck: string[] = [];
  readonly log: LogEntry[] = [];
  private listeners: ((e: LogEntry) => void)[] = [];

  /** Setpoints in operator units: m, degrees, knots. */
  setpoints = { depth: 0, heading: 0, speed: 0 };
  ap: AutopilotState = { depth: false, heading: false, speed: false };
  /** Manual commands in operator units: degrees and rpm. */
  manual = { rudder: 0, planes: 0, rpm: 0 };
  /** @internal For the order registry (orderRegistry.ts). */
  rpsCmd = 0;

  /** The submarine and the other vessels; `step()` advances all of them. */
  readonly world: World;
  /** The vessel the submarine has collided with, if any (stays set). */
  collidedWith: string | null = null;

  constructor(readonly sim: Simulation) {
    this.world = new World(sim);
    const tel = sim.telemetry();
    this.setpoints = { depth: Math.round(tel.depth), heading: Math.round(tel.heading / DEG) % 360, speed: 0 };
    this.manual.rpm = (sim.commands.rps * 60);
    this.rpsCmd = sim.commands.rps;
    this.bridgeManned = sim.bodyPointDepth(sim.cfg.bridge.deck) < -BRIDGE_FREEBOARD;
  }

  /** Why an order cannot be carried out now, or null. */
  private refusal(o: Order, source: OrderSource): string | null {
    const rule = ORDERS[o.kind] as OrderRule<Order>;
    if (source !== 'assist') {
      for (const [s, crew] of Object.entries(rule.effects?.(o, this) ?? {}) as [CrewSystem, boolean][]) {
        const lock = this.options.locks[s];
        if (lock !== undefined && lock !== crew) return LOCK_TEXT[s][lock ? 0 : 1];
      }
    }
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

  /**
   * Who handles ballast, trim and the safety net (true = the crew), and the
   * scenario's locks. Depth, heading and speed are the `ap` flags. A new
   * Controller has the player handling everything (as tests expect); a game
   * starts with `crewTakesAll()`.
   */
  options: { crew: { ballast: boolean; trim: boolean; charging: boolean; fireControl: boolean; safetyNet: boolean }; locks: CrewLocks } = {
    crew: { ballast: false, trim: false, charging: false, fireControl: false, safetyNet: false },
    locks: {},
  };

  /** True if the crew handles the system now. */
  duty(s: CrewSystem): boolean {
    return isAxis(s) ? this.ap[s] : this.options.crew[s];
  }

  duties(): CrewDuties {
    return Object.fromEntries(CREW_SYSTEMS.map((s) => [s, this.duty(s)])) as CrewDuties;
  }

  /**
   * The duties once the queued orders have been carried out (for menus shown
   * while the game is paused and the queue waits).
   */
  pendingDuties(): CrewDuties {
    const d = this.duties();
    for (const { order, source } of this.queue.peek()) {
      if (source === 'assist') continue;
      const rule = ORDERS[order.kind] as OrderRule<Order>;
      Object.assign(d, rule.effects?.(order, this) ?? {});
    }
    return d;
  }

  /** Systems the player has handled at some time this game (for the result). */
  readonly selfHandled = new Set<CrewSystem>();

  /** Hands every system to the crew at once (respecting the locks): how every game starts. */
  crewTakesAll(): void {
    for (const s of CREW_SYSTEMS) this.setDuty(s, this.options.locks[s] ?? true);
    this.selfHandled.clear();
  }

  /** Switches a system without a jump in the commands (an autopilot axis takes over or hands over as "autopilot på/av"). */
  /** @internal For the order registry (orderRegistry.ts). */
  setDuty(s: CrewSystem, crew: boolean): void {
    if (isAxis(s)) ORDERS.autopilot.apply(this, { kind: 'autopilot', axis: s, on: crew }, this.sim.kinematics());
    else this.options.crew[s] = crew;
  }

  /**
   * Someone is on the open bridge. The boat must not dive with the bridge
   * manned: a player handling the ballast is refused, the crew clears
   * the bridge itself. Starts manned when the bridge is above the water.
   */
  bridgeManned: boolean;

  /** Seconds the periscope head has been above the water without a break (0 when housed or under). */
  periscopeExposure = 0;

  /** The last reported bearing: where the boat was and whether anything could be seen. */
  lastBearing: {
    bearing: number;
    t: number;
    position: [number, number];
    lookout: boolean;
    /** True bearings [deg] to the other vessels at that moment, by vessel id. */
    contacts: Record<string, number>;
  } | null = null;

  /** Main ballast vents shut automatically once the tanks are full (after "dyk"). */
  /** @internal For the order registry (orderRegistry.ts). */
  shutVentsWhenFull = false;
  /** @internal Simulation time at which the after main ballast is blown (a staged blow), or null. */
  aftBlowAt: number | null = null;

  submit(order: Order, source: OrderSource): void {
    this.queue.push(order, source);
  }

  step(): void {
    for (const { order, source } of this.queue.drain()) {
      const refused = this.refusal(order, source);
      if (refused) {
        this.addLog(refused, 'error', source);
        continue;
      }
      this.apply(order);
      this.addLog(acknowledgement(order), 'ack', source);
      for (const line of this.afterAck.splice(0)) this.addLog(line, 'info');
      if (source !== 'assist') this.applyEffects(order);
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
    // Hovering (hover.ts): without speed the planes do nothing, so they rest at zero and the loops do not wind up.
    const planesRest = this.surfaceHold || this.hovering;
    if (planesRest) this.resetDepthLoops();
    sim.commands.sternPlanes = planesRest
      ? 0
      : this.ap.depth
        ? this.autopilot.planes(this.setpoints.depth, input, DT)
        : this.manual.planes * DEG;
    sim.commands.rudder = this.ap.heading ? this.autopilot.rudder(this.setpoints.heading * DEG, input, DT) : this.manual.rudder * DEG;

    const { maxRps, maxRpsAstern, maxRpsBrake, brakeSpeed } = sim.cfg.propulsion;
    // Still going ahead the drive may brake harder astern than it may run stern first.
    const astern = tel.u > brakeSpeed ? maxRpsBrake : maxRpsAstern;
    let target: number;
    this.watchDepthStall(tel);
    this.watchAwash(tel);
    // Stopp, as a crew does it: full astern until the way is almost off, then the shaft to zero.
    const crashStop = this.ap.speed && this.setpoints.speed === 0 && tel.u > CRASH_STOP_UNTIL;
    if (this.crashStopping && !crashStop) this.autopilot.speedPid.reset();
    this.crashStopping = crashStop;
    if (crashStop) {
      target = -astern;
    } else if (this.ap.speed) {
      // While the crew lifts the boat with too little speed for the planes, the engine gives at least `PLANES_SPEED`.
      const v = (this.depthBoost ? Math.max(this.setpoints.speed, PLANES_SPEED) : this.setpoints.speed) * KNOT;
      target = this.autopilot.rps(v, sim.rpsForSpeed(v), input, DT, -astern, maxRps);
    } else {
      target = this.manual.rpm / 60;
    }
    target = Math.max(-astern, Math.min(maxRps, target));
    const slew = this.autopilot.tuning.rpsSlew * DT;
    this.rpsCmd += Math.max(-slew, Math.min(slew, target - this.rpsCmd));
    sim.commands.rps = this.rpsCmd;

    // The crew charges whenever the diesels can get air and the battery needs it (with hysteresis).
    if (this.options.crew.charging) {
      const soc = sim.systems.electrics.soc;
      if (soc < CHARGE_START) sim.commands.diesel = true;
      else if (soc >= CHARGE_STOP) sim.commands.diesel = false;
    }

    if (this.aftBlowAt !== null && sim.t >= this.aftBlowAt) {
      this.aftBlowAt = null;
      sim.setBlow(true, this.mainBallastIds(false));
      this.addLog('Huvudballasten akter blåses.', 'info');
    }

    this.world.step();
    this.plant.update();
    this.watchWorld();
    this.sonar.update();
    this.hunter.update();
    this.fire.update(DT);

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
    if (this.options.crew.trim || this.options.crew.safetyNet) this.assist.step();
    for (const sys of CREW_SYSTEMS) if (!this.duty(sys)) this.selfHandled.add(sys);

    const hit = this.world.collision;
    if (hit && this.collidedWith === null) {
      this.collidedWith = hit.def.name;
      this.addLog(`Kollision med ${hit.def.name}!`, 'error');
    }

    const grounded = sim.groundContacts > 0;
    if (grounded) this.lastGroundedAt = sim.t;
    // A boat scraping along the bottom touches again and again: one line, then quiet for a while.
    if (grounded && !this.grounded && sim.t - this.lastGroundingLog >= GROUNDING_LOG_QUIET) {
      this.lastGroundingLog = sim.t;
      this.addLog(`Grundstötning! Fart ${(Math.abs(sim.y[7]!) / KNOT).toFixed(1).replace('.', ',')} knop.`, 'error');
      // The crew stops the engine instead of driving on into the land.
      if (this.ap.speed && this.setpoints.speed > 0) {
        this.addLog('Stopp i maskin efter grundstötningen.', 'info');
        this.submit({ kind: 'setSpeed', knots: 0 }, 'assist');
      }
    }
    this.grounded = grounded;
  }

  private grounded = false;
  private lastGroundingLog = -Infinity;
  private lastGroundedAt = -Infinity;

  /** True while Stopp runs the shaft full astern to take the way off. */
  private crashStopping = false;

  /** Seconds the depth autopilot has had the planes hard over without the depth changing. */
  private stalled = 0;
  private lastStallHint = -Infinity;
  /** The engine runs at least `PLANES_SPEED` until the depth target is reached (the crew handles the speed). */
  depthBoost = false;
  /** Seconds the boosted boat has been within `DEPTH_REACHED` of the target. */
  private boostSettled = 0;
  /** Depth target and speed a boost last ended at; a second stall there keeps the boost (`boostHeld`). */
  private boostEndedAt: { depth: number; speed: number } | null = null;
  /** The boost stays until the depth target or the speed is changed (the planes stalled twice at them). */
  private boostHeld = false;

  /**
   * The planes' lift grows with the speed squared: at 3 knots they cannot
   * lift or push the boat far. When the depth autopilot has held the planes
   * hard over for `STALL_TIME` seconds, more than `STALL_MIN_ERROR` off the
   * target and without the depth changing, it says so; if the crew handles
   * the speed too, the engine goes up to `PLANES_SPEED` until the depth has
   * been reached for `DEPTH_SETTLE` seconds and then back to the player's
   * speed. Should the planes stall again at the same depth target and speed
   * (a raised mast at periscope depth, say), the crew keeps `PLANES_SPEED`
   * until the player changes either.
   */
  private watchDepthStall(k: Kinematics): void {
    const sim = this.sim;
    const sp = this.setpoints;
    const err = sp.depth - k.depth;
    this.boostSettled = this.depthBoost && Math.abs(err) < DEPTH_REACHED ? this.boostSettled + DT : 0;
    if (this.depthBoost) {
      const changed = this.boostHeld && (sp.depth !== this.boostEndedAt?.depth || sp.speed !== this.boostEndedAt?.speed);
      const reached = !this.boostHeld && this.boostSettled >= DEPTH_SETTLE;
      if (!this.ap.depth || !this.ap.speed || changed || reached) {
        this.depthBoost = false;
        this.boostSettled = 0;
        this.boostHeld = false;
        this.boostEndedAt = reached ? { depth: sp.depth, speed: sp.speed } : null;
        // The depth and pitch integrals hold a bow angle for the old speed.
        this.resetDepthLoops();
        if (this.ap.speed && sp.speed < PLANES_SPEED) {
          this.addLog(`${reached ? 'Djupet nått. ' : ''}Maskinen går tillbaka till ${sp.speed.toString().replace('.', ',')} knop.`, 'info');
        }
      }
    }
    // Nearly hard over counts too: a boat stuck at 24° of 25° is just as stuck. The depth integral stops at 90 %
    // (autopilot.ts), so a stuck boat rests right there: the watch starts a little below.
    const hardOver = Math.abs(sim.commands.sternPlanes) >= STALL_PLANES * this.autopilot.tuning.pitch.maxPlanes;
    const stuck = this.ap.depth && !this.surfaceHold && Math.abs(err) > STALL_MIN_ERROR && hardOver && Math.abs(k.depthRate) < 0.05 && k.u >= 0;
    // On or near the bottom the planes are not what holds the boat: no engine boost into the ground.
    const nearBottom = sim.t - this.lastGroundedAt < GROUNDED_QUIET || sim.ground(sim.y[0]!, sim.y[1]!) - (k.depth + sim.cfg.hull.radius) < NEAR_BOTTOM;
    this.stalled = stuck && !nearBottom ? this.stalled + DT : 0;
    if (this.stalled < STALL_TIME || this.depthBoost || this.hovering) return;
    // Stopped on purpose (quiet): the crew hovers if it has the trim (returned above once it does); a player
    // handling the trim is told how. Where hovering is not possible (shallow, ballast not full) the engine helps.
    const stopped = this.ap.speed && sp.speed >= 0 && sp.speed <= HOVER.maxOrderedSpeed;
    if (stopped && !this.options.crew.trim) {
      if (sim.t - this.lastStallHint > STALL_HINT_EVERY) {
        this.lastStallHint = sim.t;
        this.addLog('Ubåten har ingen fart, så djuprodren verkar inte. Ändra djupet med In och Ut i panelen Trim, eller öka farten.', 'error');
      }
    } else if (this.ap.speed && sp.speed >= 0 && sp.speed < PLANES_SPEED) {
      this.depthBoost = true;
      this.boostHeld = this.boostEndedAt !== null && this.boostEndedAt.depth === sp.depth && this.boostEndedAt.speed === sp.speed;
      this.boostEndedAt = this.boostHeld ? { depth: sp.depth, speed: sp.speed } : null;
      this.resetDepthLoops();
      this.addLog(
        this.boostHeld
          ? `Djuprodren orkar inte heller nu. Maskinen håller ${PLANES_SPEED} knop tills djup eller fart ändras.`
          : `Djuprodren orkar inte vid den här farten. Maskinen ökar till ${PLANES_SPEED} knop tills djupet är nått.`,
        'info',
      );
    } else if (sim.t - this.lastStallHint > STALL_HINT_EVERY) {
      this.lastStallHint = sim.t;
      this.addLog(`Djuprodren orkar inte vid den här farten. Öka till minst ${PLANES_SPEED} knop.`, 'error');
    }
  }

  /** Torpedo hits, ships sinking and depth charges, for the log; a launch is heard by the corvettes. */
  private watchWorld(): void {
    for (const e of this.world.drainEvents()) {
      if (e.kind === 'launch') this.hunter.heardLaunch();
      else if (e.kind === 'hit') {
        this.hits++;
        this.addBlast('hit', e.at);
        this.addLog(`Träff! Torped ${e.torpedo} träffade ${e.vessel}.`, 'info');
      } else if (e.kind === 'miss') this.addLog(`Torped ${e.torpedo} missade och har gått ut sin räckvidd.`, 'info');
      else if (e.kind === 'sunk') this.addLog(`${e.vessel[0]!.toUpperCase()}${e.vessel.slice(1)} har sjunkit.`, 'info');
      else if (e.kind === 'drop') this.addLog(`Sjunkbomber i vattnet från ${e.by}!`, 'error');
      else if (this.addBlast('charge', e.at) && e.distance < 120) this.addLog(`Sjunkbomb ${Math.round(e.distance)} m från skrovet.`, e.hole > 0 ? 'error' : 'info');
    }
  }

  /**
   * Remembers an explosion (the last ten) for the graphics; returns true.
   * Also used by the demo behind the start page, for the depth charges in its music.
   */
  addBlast(kind: 'hit' | 'charge', at: [number, number, number]): boolean {
    const d = Math.hypot(at[0] - this.sim.y[0]!, at[1] - this.sim.y[1]!, at[2] - this.sim.y[2]!);
    this.blasts.push({ id: this.nextBlast++, kind, at, distance: d });
    if (this.blasts.length > 10) this.blasts.shift();
    return true;
  }



  /** Applies an order (already checked by `refusal`). */
  private apply(o: Order): void {
    const rule = ORDERS[o.kind] as OrderRule<Order>;
    rule.apply(this, o, this.sim.kinematics());
  }

  /** Switches ballast, trim and safety net as a player's order implies (the axes switch in `apply`). */
  private applyEffects(o: Order): void {
    if (o.kind === 'crew') return;
    const rule = ORDERS[o.kind] as OrderRule<Order>;
    for (const [s, crew] of Object.entries(rule.effects?.(o, this) ?? {}) as [CrewSystem, boolean][]) {
      if (isAxis(s) || this.options.crew[s] === crew) continue;
      this.options.crew[s] = crew;
      const text = TAKEN_OVER[s];
      if (!crew && text) this.addLog(text, 'info');
    }
  }

  /** Flooding with the bridge manned: the crew clears the bridge; a player handling the ballast is refused. */
  /** @internal For the order registry (orderRegistry.ts). */
  refuseDiveWithBridgeManned(): string | null {
    if (!this.bridgeManned) return null;
    if (this.options.crew.ballast) {
      this.bridgeManned = false;
      this.addLog('Klart bryggan. Bryggan är utrymd inför dykningen.', 'info');
      return null;
    }
    return 'Bryggan är bemannad. Tryck Klart bryggan i panelen Ballast (eller skriv "klart bryggan") innan ubåten dyker.';
  }

  /** True while the crew changes or holds the depth without speed, with the compensating tank (hover.ts). */
  get hovering(): boolean {
    return this.assist.hover.active && this.options.crew.trim && this.ap.depth && this.ap.speed;
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

  /** Sim time of the last "the main ballast is empty" reminder (player handling the ballast). */
  private lastBallastHint = -Infinity;
  /** Seconds the boat has hung awash although it should dive (see `AWASH_DEPTH`). */
  private awash = 0;
  private lastAwashHint = -Infinity;

  /** Reminds a player handling the ballast that air left in the main ballast keeps the boat awash. */
  private watchAwash(k: Kinematics): void {
    const sim = this.sim;
    const wantsDown = this.ap.depth ? this.setpoints.depth >= DIVE_TARGET_DEPTH : this.manual.planes > 0;
    const trapped = sim.tankDefs.every((d, i) => {
      const s = sim.tanks[i]!;
      return d.kind !== 'mainBallast' || (s.water / d.volume > 0.8 && !s.ventOpen && !s.blowOpen);
    });
    const stuck = !this.options.crew.ballast && wantsDown && trapped && k.depth < AWASH_DEPTH && k.u > 1 && Math.abs(k.depthRate) < 0.05;
    this.awash = stuck ? this.awash + DT : 0;
    if (this.awash >= AWASH_TIME && sim.t - this.lastAwashHint >= AWASH_HINT_EVERY) {
      this.lastAwashHint = sim.t;
      this.addLog('Ubåten ligger kvar i ytan: luft i huvudballasten. Tryck Fyll igen i panelen Ballast och stäng vid 100 %, eller mer djuproder.', 'error');
    }
  }

  /**
   * A depth target below the surface while the main ballast is empty cannot
   * be reached: the boat has ~200 t of reserve buoyancy and the planes give
   * a few tonnes. The crew starts the dive (as "dyk" does); a player handling
   * the ballast is reminded.
   */
  /** @internal For the order registry (orderRegistry.ts). */
  checkBallastForDepth(): void {
    const sim = this.sim;
    if (this.setpoints.depth < DIVE_TARGET_DEPTH) {
      this.checkBallastForSurface();
      return;
    }
    if (!this.mainBallastEmpty()) return;
    if (this.options.crew.ballast) {
      if (this.bridgeManned) {
        this.bridgeManned = false;
        this.addLog('Klart bryggan. Bryggan är utrymd inför dykningen.', 'info');
      }
      sim.setVents(true);
      this.shutVentsWhenFull = true;
      this.aftBlowAt = null;
      this.addLog('Huvudballasten fylls för dykning.', 'info');
    } else if (sim.t - this.lastBallastHint > 10) {
      this.lastBallastHint = sim.t;
      this.addLog('Huvudballasten är tom, så ubåten kan inte dyka. Tryck Dyk, eller Klart bryggan och Fyll i panelen Ballast.', 'error');
    }
  }

  /**
   * The mirror image: a target near the surface with flooded main ballast.
   * The boat is then neutral and the planes can only bring it up awash.
   * The crew blows the tanks (as "ytläge" does); a player handling the
   * ballast is reminded.
   */
  private checkBallastForSurface(): void {
    const sim = this.sim;
    const flooded = sim.tankDefs.some((d, i) => {
      const s = sim.tanks[i]!;
      return d.kind === 'mainBallast' && s.water / d.volume > 0.5 && !s.blowOpen;
    });
    if (!flooded || sim.tanks.some((t) => t.blowOpen)) return;
    if (this.options.crew.ballast) {
      this.addLog(this.blowMainBallast() ? 'Huvudballasten blåses för ytläge, för först.' : 'Huvudballasten blåses för ytläge.', 'info');
    } else if (sim.t - this.lastBallastHint > 10) {
      this.lastBallastHint = sim.t;
      this.addLog('Huvudballasten är full, så ubåten kommer inte upp i ytläge. Tryck Yta, eller Blås i panelen Ballast.', 'error');
    }
  }

  /** Ids of the forward (or after) main ballast tanks. */
  private mainBallastIds(forward: boolean): string[] {
    return this.sim.tankDefs.filter((d) => d.kind === 'mainBallast' && d.position[0] > 0 === forward).map((d) => d.id);
  }

  /**
   * @internal Blows the main ballast as a crew does: near the surface all
   * tanks at once, from depth the forward tanks first and the after tanks
   * `STAGED_BLOW_DELAY` s later (see `STAGED_BLOW_DEPTH`). Returns true for a
   * staged blow.
   */
  blowMainBallast(): boolean {
    const sim = this.sim;
    this.shutVentsWhenFull = false;
    if (sim.kinematics().depth > STAGED_BLOW_DEPTH) {
      sim.setBlow(true, this.mainBallastIds(true));
      this.aftBlowAt = sim.t + STAGED_BLOW_DELAY;
      return true;
    }
    sim.setBlow(true);
    this.aftBlowAt = null;
    return false;
  }

  /** @internal For the order registry (orderRegistry.ts). */
  resetDepthLoops(): void {
    this.autopilot.depthPid.reset();
    this.autopilot.pitchPid.reset();
  }
}

