/**
 * Glue between orders, autopilot and the simulation. One call to `step()`
 * advances the whole system by one fixed time step:
 *   drain order queue → update setpoints/manual commands → autopilot →
 *   write plant commands → sim.step() → the crew's trim assistant and safety net
 */
import type { Simulation } from '../sim/simulation';
import { DT } from '../sim/simulation';
import { pressureAt } from '../sim/environment';
import { Autopilot, type AutopilotInput } from './autopilot';
import { CREW_SYSTEMS, EXPERT_TEXT, LOCK_TEXT, MANOEUVRE_SYSTEMS, isAxis, type CrewDuties, type CrewLocks, type CrewSystem } from './crew';
import { OrderQueue } from './orderQueue';
import { acknowledgement, type Order, type OrderSource } from './orders';
import { BRIDGE_FREEBOARD, ORDERS, type Kinematics, type OrderRule } from './orderRegistry';
import { CHARGE_STOP, PlantWatch } from './plantWatch';
import { CONN, Conn } from './conn';
import { TrimAssist } from './trimAssist';
import { Radar } from './radar';
import { Lookouts } from './lookouts';
import { Ascent } from './ascent';
import { WireGuidance } from './wire';
import { Sonar } from './sonar';
import { FireControl } from './fireControl';
import { Hunter } from './hunter';
import { ACOUSTICS } from '../sim/config/acoustics';
import { WEAPONS } from '../sim/config/weapons';
import { World } from '../sim/world';

const DEG = Math.PI / 180;
/** Depth targets from this depth [m] need flooded main ballast. */
const DIVE_TARGET_DEPTH = CONN.diveTargetDepth;
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
 * A normal ascent to the surface: deeper than this [m] the boat comes up on the
 * planes with the main ballast flooded, and the crew blows it only here (a blow
 * from depth is an emergency blow, the order "ytläge").
 */
export const SURFACE_BLOW_DEPTH = 15;
/**
 * Awash: a boat that stays shallower than this [m] for `AWASH_TIME` s with way on and the planes
 * (or the depth target) for diving, the main ballast mostly flooded and its vents shut, has air left
 * in the tanks. The player handling the ballast is reminded (every `AWASH_HINT_EVERY` s).
 */
const AWASH_DEPTH = 5;
const AWASH_TIME = 60;
const AWASH_HINT_EVERY = 120;
/** Seconds without a new "Grundstötning!" line after one. */
const GROUNDING_LOG_QUIET = 20;
/** Surface hold applies above this CO depth [m] (a surfaced boat floats at ~1.8 m). */
const SURFACE_HOLD_DEPTH = CONN.surfaceHoldDepth;
const KNOT = 1852 / 3600;
/** Stopp backs full until the speed through the water is below this [m/s] (~1 knot). */
/** A blow deeper than this [m] is heard by the corvettes (the high-pressure air roaring into the tanks). */
const BLOW_HEARD_DEPTH = 20;
/**
 * An emergency blow is spent when the bottles hold less than this times the sea pressure at the boat
 * (the air hardly flows into the tanks any longer) and the boat rises slower than `BLOW_SPENT_RISE` [m/s]:
 * a boat the expanding air already lifts goes on up. The crew then goes up on the planes instead.
 */
const BLOW_SPENT_RATIO = 1.15;
const BLOW_SPENT_RISE = 0.3;
/** Speed [knots] the crew runs for the planes when the air does not suffice for an emergency blow. */
const BLOW_SPENT_SPEED = 8;
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

/** Logged when an ordinary order shifts the speed: [to the crew, to the player]. */
export const SPEED_DUTY: [string, string] = [
  'Besättningen sköter farten nu: maskinen följer telegrafen.',
  'Du sköter farten nu: du styr propellervarvet. Telegrafen lämnar farten till besättningen.',
];

/** Awareness every corvette gains when the boat catches a trawl (the trawler radios it in). */
const TRAWL_ALERT = 0.4;

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
  /** Wire guidance of the torpedoes in the water. */
  readonly wire: WireGuidance = new WireGuidance(this);
  /** The radar and the radar warning receiver on the radar mast. */
  readonly radar: Radar = new Radar(this);
  /** Coming up from the deep in steps: rise, level off and listen, go up (ascent.ts). */
  readonly ascent: Ascent = new Ascent(this);
  /** The officer of the watch: turns speed, course and depth into planes, rudder and shaft (conn.ts). */
  readonly conn: Conn = new Conn(this);
  /** Patrol aircraft and coastal radar stations looking for the boat (lookouts.ts). */
  readonly lookouts: Lookouts = new Lookouts(this);
  /** Logs what the plant does on its own (plantWatch.ts). */
  readonly plant: PlantWatch = new PlantWatch(this);
  /** Torpedoes fired and hits this game (for the result). */
  torpedoesFired = 0;
  /** Decoys left (WEAPONS.decoy.count at the start). */
  decoys: number = WEAPONS.decoy.count;
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
        if (!crew && !this.options.expert && MANOEUVRE_SYSTEMS.includes(s)) return EXPERT_TEXT;
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
  options: {
    crew: { ballast: boolean; trim: boolean; charging: boolean; fireControl: boolean; torpedoRoom: boolean; safetyNet: boolean };
    locks: CrewLocks;
    /**
     * Expert mode: the player may take the manoeuvre (`MANOEUVRE_SYSTEMS`: planes, rudder, shaft, ballast,
     * trim, safety net) over by hand. Without it the crew always manoeuvres and the player gives only speed,
     * course and depth; orders that would take it over are refused. A new Controller is in expert mode (as
     * tests expect); a game follows the player's setting (`GameSession`).
     */
    expert: boolean;
  } = {
    crew: { ballast: false, trim: false, charging: false, fireControl: false, torpedoRoom: false, safetyNet: false },
    locks: {},
    expert: true,
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
      const crewSpeed = this.ap.speed;
      this.apply(order);
      this.addLog(acknowledgement(order), 'ack', source);
      for (const line of this.afterAck.splice(0)) this.addLog(line, 'info');
      // The telegraph hands the speed to the crew and the shaft orders take it: said, as it is easy to miss.
      if (source !== 'assist' && order.kind !== 'crew' && this.ap.speed !== crewSpeed) this.addLog(SPEED_DUTY[this.ap.speed ? 0 : 1], 'info');
      if (source !== 'assist') this.applyEffects(order);
    }
    const sim = this.sim;
    this.ascent.update();
    this.watchBlowing();
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

    this.conn.steer(tel, input);
    this.conn.watchDepthStall(tel, this.lastGroundedAt);
    this.watchAwash(tel);
    this.watchAscent(tel);
    this.conn.watchHeld();
    const target = this.conn.drive(tel, input);
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
    this.radar.update(DT);
    this.lookouts.update();
    this.wire.update(DT);

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

  /** The speed target when the boat caught a trawl, to go back to once free (the crew backing out). */
  private speedBeforeSnag: number | null = null;

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
      else if (e.kind === 'snagged') {
        this.addLog(`Vi har fastnat i trålen efter ${e.vessel}! Back i 12 s för att komma loss.`, 'error');
        // The trawler feels the pull and calls it in on the radio: every corvette about hears of it.
        for (const v of this.world.vessels) if (v.def.kind === 'patrol' && !v.state.sinking) this.sonar.alert(v.def.id, TRAWL_ALERT);
        // The crew backs out of it when it handles the speed.
        if (this.ap.speed) {
          this.speedBeforeSnag = this.setpoints.speed;
          this.addLog('Maskin back för att komma loss.', 'info');
          this.submit({ kind: 'setSpeed', knots: -3 }, 'assist');
        }
      } else if (e.kind === 'freed') {
        this.addLog('Trålen har släppt. Vi är loss.', 'info');
        if (this.speedBeforeSnag !== null && this.ap.speed && this.setpoints.speed === -3) this.submit({ kind: 'setSpeed', knots: Math.max(0, this.speedBeforeSnag) }, 'assist');
        this.speedBeforeSnag = null;
      }
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
  /** Main ballast blowing at the last step (a new blow from the deep is heard far). */
  private wasBlowing = false;

  /** A blow from the deep is heard by the corvettes; an emergency blow ends on the surface. */
  private watchBlowing(): void {
    const sim = this.sim;
    const depth = sim.y[2]!;
    const blowing = sim.tanks.some((t) => t.blowOpen);
    if (blowing && !this.wasBlowing && depth > BLOW_HEARD_DEPTH) this.hunter.heard(ACOUSTICS.blowLevel, 0.5, 0.6, true);
    this.wasBlowing = blowing;
    if (this.blowCommitted && depth < SURFACE_HOLD_DEPTH) this.blowCommitted = false;
    if (
      this.blowCommitted &&
      sim.air.bottlePV / sim.cfg.air.bottleVolume < BLOW_SPENT_RATIO * pressureAt(depth, sim.water) &&
      sim.kinematics().depthRate > -BLOW_SPENT_RISE
    ) {
      this.blowSpent(depth);
    }
  }

  /**
   * The air does not suffice to blow at this depth (an earlier blow emptied the bottles): the emergency
   * blow is called off, so that depth orders work again, and the crew goes up on the planes with way on
   * (the ascent, which blows at 15 m with the air that is left). Without the depth on the crew, the
   * player is told.
   */
  private blowSpent(depth: number): void {
    const sim = this.sim;
    this.blowCommitted = false;
    this.aftBlowAt = null;
    sim.setBlow(false);
    const bar = Math.round(sim.air.bottlePV / sim.cfg.air.bottleVolume / 1e5);
    const head = `Tryckluften räcker inte för att blåsa på ${Math.round(depth)} m (${bar} bar).`;
    if (!this.ap.depth) {
      this.addLog(`${head} Gå upp på djuprodren med fart.`, 'error');
      return;
    }
    this.addLog(`${head} Besättningen går upp på djuprodren.`, 'error', 'assist');
    if (this.ap.speed && this.setpoints.speed < BLOW_SPENT_SPEED) this.submit({ kind: 'setSpeed', knots: BLOW_SPENT_SPEED }, 'assist');
    this.submit({ kind: 'setDepth', depth: 0 }, 'assist');
  }

  /** The speed the crew runs for a while instead of the ordered one, and why (conn.ts), or null. */
  crewSpeed(): { knots: number; reason: string } | null {
    return this.conn.crewSpeed();
  }

  /** The depth the depth autopilot steers for now [m] (conn.ts). */
  get depthGoal(): number {
    return this.conn.depthGoal;
  }

  get hovering(): boolean {
    return this.conn.hovering;
  }

  /** True while the depth autopilot holds the boat on the surface (conn.ts; "→ yta" on the instruments). */
  get surfaceHold(): boolean {
    return this.conn.surfaceHold;
  }

  /** The engine runs at least 4 knots for the planes (conn.ts). */
  get depthBoost(): boolean {
    return this.conn.depthBoost;
  }

  /** True while a normal ascent to the surface waits to blow the main ballast at 15 m. */
  get blowingOnRise(): boolean {
    return this.blowOnRise;
  }

  /** Main ballast (mostly) empty, with vents and blows shut: the boat floats on the surface. */
  /** @internal For conn.ts. */
  mainBallastEmpty(): boolean {
    const sim = this.sim;
    return sim.tankDefs.every((d, i) => {
      const s = sim.tanks[i]!;
      return d.kind !== 'mainBallast' || (s.water / d.volume <= 0.5 && !s.ventOpen && !s.blowOpen);
    });
  }

  /** Sim time of the last "the main ballast is empty" reminder (player handling the ballast). */
  private lastBallastHint = -Infinity;
  /** A shallow target was set below `SURFACE_BLOW_DEPTH`: blow (or remind) once the boat is up there. */
  private blowOnRise = false;

  /** The normal ascent: once the boat has come up to `SURFACE_BLOW_DEPTH` on the planes, the main ballast is blown. */
  private watchAscent(k: Kinematics): void {
    if (this.blowOnRise) {
      if (!this.ap.depth || this.setpoints.depth >= DIVE_TARGET_DEPTH) this.blowOnRise = false;
      else if (k.depth <= SURFACE_BLOW_DEPTH && !this.conn.surfaceHeld) this.checkBallastForSurface();
    }
  }
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
    if (!this.mainBallastEmpty()) {
      this.ventForDepth();
      return;
    }
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
   * A target under water while there is air in the main ballast from a
   * shallow blow (Yta at 15 m, ytläge): the crew stops the blow and opens the
   * vents, as for a dive. After an emergency blow from the deep the order is
   * refused instead (`refuseUnderBlow`): that goes to the surface.
   */
  private ventForDepth(): void {
    const sim = this.sim;
    const air = sim.tankDefs.some((d, i) => {
      const s = sim.tanks[i]!;
      return d.kind === 'mainBallast' && (s.blowOpen || (s.water / d.volume < 0.98 && !s.ventOpen));
    });
    if (!air) return;
    this.blowOnRise = false;
    this.aftBlowAt = null;
    if (this.options.crew.ballast) {
      sim.setBlow(false);
      sim.setVents(true);
      this.shutVentsWhenFull = true;
      this.afterAck.push('Blåsningen stoppas. Huvudballasten ventileras och fylls igen.');
    } else if (sim.t - this.lastBallastHint > 10) {
      this.lastBallastHint = sim.t;
      this.addLog('Luft i huvudballasten: stoppa blåsningen och ventilera i panelen Ballast, annars stiger ubåten.', 'error');
    }
  }

  /**
   * An emergency blow (from deeper than `STAGED_BLOW_DEPTH`) is carried
   * through to the surface: the reason for it is usually still there, and a
   * boat rising fast with expanding air cannot be caught with the vents.
   */
  blowCommitted = false;

  /** @internal For the order registry: a dive or depth order refused while an emergency blow goes to the surface. */
  refuseUnderBlow(depth: number): string | null {
    return this.blowCommitted && depth >= DIVE_TARGET_DEPTH ? 'Nödblåsning pågår, ubåten går till ytan. Dyk igen därifrån.' : null;
  }

  /**
   * The mirror image: a target near the surface with flooded main ballast.
   * The boat is then neutral and the planes can only bring it up awash.
   * The crew blows the tanks (as "ytläge" does); a player handling the
   * ballast is reminded. From deeper than `SURFACE_BLOW_DEPTH` the boat first
   * comes up on the planes (`watchAscent`).
   */
  private checkBallastForSurface(): void {
    const sim = this.sim;
    const flooded = sim.tankDefs.some((d, i) => {
      const s = sim.tanks[i]!;
      return d.kind === 'mainBallast' && s.water / d.volume > 0.5 && !s.blowOpen;
    });
    if (!flooded || sim.tanks.some((t) => t.blowOpen)) {
      this.blowOnRise = false;
      return;
    }
    // A corvette is on to the boat: it waits at periscope depth and blows once nobody hunts (conn.ts).
    if (this.conn.surfaceHeld) {
      this.blowOnRise = true;
      return;
    }
    if (sim.kinematics().depth > SURFACE_BLOW_DEPTH) {
      if (!this.blowOnRise && this.options.crew.ballast) {
        this.afterAck.push(`Stigning till ytan på djuprodren. Huvudballasten blåses på ${SURFACE_BLOW_DEPTH} m.`);
      }
      this.blowOnRise = true;
      return;
    }
    this.blowOnRise = false;
    if (this.options.crew.ballast) {
      this.addLog(this.blowMainBallast() ? 'Huvudballasten blåses för ytläge, för först.' : 'Huvudballasten blåses för ytläge.', 'info');
    } else if (sim.t - this.lastBallastHint > 10) {
      this.lastBallastHint = sim.t;
      this.addLog('Huvudballasten är full, så ubåten kommer inte upp i ytläge. Tryck Blås i panelen Ballast.', 'error');
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
      this.blowCommitted = true;
      this.ascent.cancel();
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

