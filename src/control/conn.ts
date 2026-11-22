/**
 * The officer of the watch ("conn"): the one place that turns what the player
 * wants – a speed on the telegraph, a course and a depth (the surface,
 * periscope depth or any depth) – into the commands for the planes, the
 * rudder and the shaft, and chooses how. Before this, each special case
 * (the crash stop, the engine helping the planes, the ascent, hovering, the
 * surface hold) wrote the commands itself, and they fought each other.
 *
 * Every step the conn decides, in this order:
 *  - the depth goal: the player's target, the ascent's levelling depth, or
 *    periscope depth when a corvette is on to the boat and the surface was
 *    asked for (`surfaceHeld`);
 *  - whether the planes rest (surfaced and floating, or hovering);
 *  - the course goal and the largest rudder (gentler at periscope depth, so
 *    the sail does not break the surface in a turn);
 *  - the speed: Stopp backs full until the way is off; a lower bell lets the
 *    way run off by itself (quiet, saves the battery) unless the ground rises
 *    ahead; the crew runs its own speed for a while (the planes, the ascent,
 *    near periscope depth) and says so on the telegraph.
 *
 * It also knows what the boat is doing (`plan()`: the manoeuvre, a line for
 * the helm and the reasons), which the interface shows instead of a set of
 * Auto/Hand switches. Deterministic: simulation time and telemetry only.
 */
import { DT } from '../sim/simulation';
import type { AutopilotInput } from './autopilot';
import type { Controller } from './controller';
import { PERISCOPE_DEPTH, TELEGRAPH } from './crew';
import { HOVER } from './hover';
import { HUNT_NAME, type HuntState } from './hunter';
import type { Kinematics } from './orderRegistry';

const DEG = Math.PI / 180;
const KNOT = 1852 / 3600;
const FULL_AHEAD = TELEGRAPH[TELEGRAPH.length - 1]!.knots;

export const CONN = {
  /** Depth targets from this depth [m] need flooded main ballast. */
  diveTargetDepth: 5,
  /** Surface hold applies above this CO depth [m] (a surfaced boat floats at ~1.8 m). */
  surfaceHoldDepth: 6,
  /** Stopp backs full until the speed through the water is below this [m/s] (~1 knot). */
  crashStopUntil: 0.5,
  /** Speed [knots] at which the planes can change the depth. */
  planesSpeed: 4,
  /** Seconds stalled before the crew says so (or runs the engine up). */
  stallTime: 30,
  /** Fraction of full stern planes that counts as hard over for the stall watch. */
  stallPlanes: 0.85,
  stallHintEvery: 120,
  /** Off the depth target by more than this [m], hard-over planes count as stalled (1 m matters at periscope depth). */
  stallMinError: 1,
  /** The boost ends when the depth has been within this of the target [m] for `depthSettle` seconds. */
  depthReached: 0.5,
  depthSettle: 30,
  /** Seconds after touching the bottom during which the stall watch does not run the engine up. */
  groundedQuiet: 120,
  /** Water under the keel [m] below which the stall watch does not run the engine up either. */
  nearBottom: 10,
  /**
   * A lower speed is reached by letting the way run off (the shaft no slower than stopped) while the boat
   * goes more than this much faster than wanted [m/s]; with ground rising ahead the shaft brakes astern.
   */
  coastMargin: 0.5,
  /**
   * Near periscope depth the crew keeps the speed down [knots]: coming up the last `approachBand` metres
   * (a fast boat overshoots and broaches), and with the periscope raised (its feather and wake are seen).
   * Not at full ahead.
   */
  periscopeSpeed: 6,
  approachBand: 25,
  /** Periscope depth counts as the target up to this much below `PERISCOPE_DEPTH` [m]. */
  periscopeBand: 3,
  /**
   * Bow-down limit going ahead: the crew dives at most `diveRate` [m/s] (pitch asin(diveRate / u),
   * between `minDivePitch` and the autopilot's 12°), full ahead excepted. Close to the bottom (less than
   * `bottomClearance` m under the keel, or less than `bottomTime` s of sinking) or deeper than `deepDive` m
   * (the hull collapses at 360 m) at most `minDivePitch`, full ahead too.
   */
  diveRate: 1.0,
  minDivePitch: 5 * DEG,
  bottomClearance: 30,
  bottomTime: 30,
  deepDive: 250,
  /** Largest rudder near the surface [rad], shallower than `gentleDepth` [m]: a hard turn rolls the sail out. */
  gentleRudder: 15 * DEG,
  gentleDepth: 20,
} as const;

/** What the boat is doing, for the helm's plan line. */
export type Manoeuvre =
  | 'hand'
  | 'surfaced'
  | 'diving'
  | 'surfacing'
  | 'emergency'
  | 'waiting'
  | 'ascent'
  | 'hovering'
  | 'stopping'
  | 'coasting'
  | 'astern'
  | 'boost'
  | 'changeDepth'
  | 'periscope'
  | 'holding';

export const MANOEUVRE_NAME: Record<Manoeuvre, string> = {
  hand: 'Handstyrning',
  surfaced: 'Ytläge',
  diving: 'Dykning',
  surfacing: 'Upp till ytan',
  emergency: 'Nödblåsning',
  waiting: 'Väntar',
  ascent: 'Stigning',
  hovering: 'Svävar',
  stopping: 'Stopp',
  coasting: 'Saktar in',
  astern: 'Back',
  boost: 'Fart för rodren',
  changeDepth: 'Djupbyte',
  periscope: 'Periskopdjup',
  holding: 'Håller',
};

export interface Plan {
  mode: Manoeuvre;
  /** One line for the helm, e.g. "Stiger mot 35 m i 8 knop." */
  text: string;
  /** Why, and what comes next (the expanded helm). */
  details: string[];
  /** A corvette is on to the boat: the crew chooses quietly. */
  quiet: boolean;
}

const kn = (v: number): string => (Math.round(v * 10) / 10).toString().replace('.', ',');
const deg3 = (d: number): string => String(Math.round(((d % 360) + 360) % 360) % 360).padStart(3, '0');

export class Conn {
  /** True while the depth autopilot holds the boat on the surface: planes at zero, the boat floats. */
  surfaceHold = false;
  /** The engine runs at least `planesSpeed` until the depth target is reached (the crew handles the speed). */
  depthBoost = false;
  /** True while Stopp runs the shaft full astern to take the way off. */
  crashStopping = false;
  /** True while a lower speed is reached by letting the way run off. */
  coasting = false;
  /**
   * The surface was asked for while a corvette is on to the boat: the crew waits at periscope depth
   * instead of blowing (heard far) and goes on up once nobody hunts, or when the surface is asked for again.
   */
  surfaceHeld = false;

  private boostSettled = 0;
  /** The ordered speed a boost started at: a new speed order ends it (full ahead, then Stopp, is a full stop). */
  private boostSpeed = 0;
  /** Depth target and speed a boost last ended at; a second stall there keeps the boost (`boostHeld`). */
  private boostEndedAt: { depth: number; speed: number } | null = null;
  /** The boost stays until the depth target or the speed is changed (the planes stalled twice at them). */
  private boostHeld = false;
  /** Seconds the depth autopilot has had the planes hard over without the depth changing. */
  private stalled = 0;
  private lastStallHint = -Infinity;

  constructor(private readonly ctrl: Controller) {}

  // ------------------------------------------------------------- the goals

  /** The depth the depth autopilot steers for now [m]. */
  get depthGoal(): number {
    const goal = this.ctrl.ascent.depthGoal(this.ctrl.setpoints.depth);
    return this.surfaceHeld ? Math.max(goal, PERISCOPE_DEPTH) : goal;
  }

  get hovering(): boolean {
    const c = this.ctrl;
    return c.assist.hover.active && c.options.crew.trim && c.ap.depth;
  }

  /** The corvette that is on to the boat (suspects, searches or attacks it), or null. */
  hunter(): { name: string; state: HuntState } | null {
    const c = this.ctrl;
    for (const v of c.world.vessels) {
      if (v.def.kind !== 'patrol' || v.state.sinking) continue;
      const state = c.hunter.state(v.def.id);
      if (state !== 'patrol' && !c.hunter.spent(v.def.id)) return { name: v.def.name, state };
    }
    return null;
  }

  /** True while a corvette is on to the boat: the crew does nothing loud of its own accord. */
  get quiet(): boolean {
    return this.hunter() !== null;
  }

  /** The speed the speed autopilot runs at [knots]: the ordered one, or the crew's own for a while. */
  runSpeed(): number {
    const c = this.ctrl;
    let v = c.ascent.speedGoal(c.setpoints.speed) ?? c.setpoints.speed;
    if (this.depthBoost) v = Math.max(v, CONN.planesSpeed);
    const cap = this.speedCap();
    return cap !== null && v > cap ? cap : v;
  }

  /** The crew's speed limit near periscope depth [knots], or null. */
  private speedCap(): number | null {
    const c = this.ctrl;
    // Full ahead is an order to go now, whatever is seen: no limit then.
    if (!c.ap.depth || !c.ap.speed || c.setpoints.speed <= 0 || c.setpoints.speed >= FULL_AHEAD) return null;
    const sim = c.sim;
    const depth = sim.y[2]!;
    if (depth < CONN.diveTargetDepth) return null;
    const goal = this.depthGoal;
    const periscopeTarget = goal >= CONN.diveTargetDepth && goal <= PERISCOPE_DEPTH + CONN.periscopeBand;
    if (!periscopeTarget) return null;
    const raised = sim.actuators.periscope > 0.5;
    const approaching = depth > goal + 3 && depth < goal + CONN.approachBand;
    return raised || approaching ? CONN.periscopeSpeed : null;
  }

  /**
   * The speed the crew runs for a while instead of the ordered one [knots], and why (the telegraph's Auto lamp),
   * or null. The ordered speed is unchanged, so the telegraph goes back to it when this ends.
   */
  crewSpeed(): { knots: number; reason: string } | null {
    const c = this.ctrl;
    if (!c.ap.speed) return null;
    const v = this.runSpeed();
    if (v === c.setpoints.speed) return null;
    const phase = c.ascent.phase;
    const reason =
      phase === 'listen' ? 'lyssnar' : phase === 'hold' ? 'håller djupet' : phase ? 'stiger' : this.depthBoost && v >= CONN.planesSpeed ? 'för djuprodren' : 'periskopdjup';
    return { knots: v, reason };
  }

  // ------------------------------------------------------------- orders

  /** A depth order from the player has set the target (before the ballast is checked). */
  onDepthOrder(): void {
    const c = this.ctrl;
    const target = c.setpoints.depth;
    const depth = c.sim.y[2]!;
    if (target >= CONN.diveTargetDepth || depth < CONN.surfaceHoldDepth || !c.options.crew.ballast) {
      this.surfaceHeld = false;
    } else if (this.surfaceHeld) {
      // Asked again: up anyway.
      this.surfaceHeld = false;
      c.afterAck.push('Upp till ytan ändå.');
    } else {
      const h = this.hunter();
      if (h) {
        this.surfaceHeld = true;
        c.afterAck.push(
          `${h.name[0]!.toUpperCase()}${h.name.slice(1)} ${HUNT_NAME[h.state]}: besättningen stannar på periskopdjup i stället för att blåsa, som hörs långt. Tryck Yta igen för att gå upp ändå.`,
        );
      }
    }
    if (target >= CONN.diveTargetDepth && depth > 8) c.assist.anticipate(depth, target);
  }

  // ------------------------------------------------------------- each step

  /** The planes and the rudder (call once per step, before the watches). */
  steer(tel: Kinematics, input: AutopilotInput): void {
    const c = this.ctrl;
    const sim = c.sim;
    // Surfaced with empty main ballast and a shallow target, the boat simply floats:
    // the depth autopilot keeps the planes at zero instead of fighting ~200 t of buoyancy.
    this.surfaceHold = c.ap.depth && c.setpoints.depth < CONN.diveTargetDepth && tel.depth < CONN.surfaceHoldDepth && c.mainBallastEmpty();
    // Hovering (hover.ts): without speed the planes do nothing, so they rest at zero and the loops do not wind up.
    const planesRest = this.surfaceHold || this.hovering;
    if (planesRest) c.resetDepthLoops();
    sim.commands.sternPlanes = planesRest
      ? 0
      : c.ap.depth
        ? c.autopilot.planes(this.depthGoal, input, DT, c.ascent.maxPitch() ?? undefined, this.diveLimit(tel))
        : c.manual.planes * DEG;
    // Near the surface, submerged, the rudder is gentler: a hard turn heels the boat and the sail breaks the surface.
    const gentle = !this.surfaceHold && tel.depth > CONN.diveTargetDepth && tel.depth < CONN.gentleDepth;
    sim.commands.rudder = c.ap.heading
      ? c.autopilot.rudder((c.ascent.headingGoal() ?? c.setpoints.heading) * DEG, input, DT, gentle ? CONN.gentleRudder : undefined)
      : c.manual.rudder * DEG;
  }

  /** The largest bow-down pitch for the depth autopilot going ahead [rad] (see `CONN.diveRate`). */
  diveLimit(tel: Kinematics): number {
    const sim = this.ctrl.sim;
    const underKeel = sim.ground(sim.y[0]!, sim.y[1]!) - (tel.depth + sim.cfg.hull.radius);
    const near = Math.max(CONN.bottomClearance, CONN.bottomTime * Math.max(0, tel.depthRate));
    if (tel.depth > CONN.deepDive || underKeel < near) return CONN.minDivePitch;
    const c = this.ctrl;
    if (c.ap.speed && c.setpoints.speed >= FULL_AHEAD) return Infinity;
    if (tel.u <= CONN.diveRate) return Infinity;
    return Math.max(CONN.minDivePitch, Math.asin(CONN.diveRate / tel.u));
  }

  /** The shaft speed command [rev/s] (call once per step, after the watches). */
  drive(tel: Kinematics, input: AutopilotInput): number {
    const c = this.ctrl;
    const sim = c.sim;
    const { maxRps, maxRpsAstern, maxRpsBrake, brakeSpeed } = sim.cfg.propulsion;
    // Still going ahead the drive may brake harder astern than it may run stern first.
    const astern = tel.u > brakeSpeed ? maxRpsBrake : maxRpsAstern;
    // Stopp, as a crew does it: full astern until the way is almost off, then the shaft to zero.
    // Not while the engine gives the planes speed (`depthBoost`) or the boat rises: the two fought.
    const crashStop = c.ap.speed && c.setpoints.speed === 0 && !this.depthBoost && !c.ascent.active && tel.u > CONN.crashStopUntil;
    if (this.crashStopping && !crashStop) c.autopilot.speedPid.reset();
    this.crashStopping = crashStop;
    let target: number;
    this.coasting = false;
    if (crashStop) {
      target = -astern;
    } else if (c.ap.speed) {
      const v = this.runSpeed() * KNOT;
      // A lower bell ahead: the way runs off by itself, quietly, unless the ground rises ahead.
      this.coasting = v >= 0 && tel.u > v + CONN.coastMargin && !c.assist.shoalDanger;
      target = c.autopilot.rps(v, sim.rpsForSpeed(v), input, DT, this.coasting ? 0 : -astern, maxRps);
    } else {
      target = c.manual.rpm / 60;
    }
    return Math.max(-astern, Math.min(maxRps, target));
  }

  /**
   * The planes' lift grows with the speed squared: at 3 knots they cannot
   * lift or push the boat far. When the depth autopilot has held the planes
   * hard over for `stallTime` seconds, more than `stallMinError` off the
   * target and without the depth changing, it says so; if the crew handles
   * the speed too, the engine goes up to `planesSpeed` until the depth has
   * been reached for `depthSettle` seconds and then back to the player's
   * speed. Should the planes stall again at the same depth target and speed
   * (a raised mast at periscope depth, say), the crew keeps `planesSpeed`
   * until the player changes either.
   */
  watchDepthStall(k: Kinematics, lastGroundedAt: number): void {
    const c = this.ctrl;
    const sim = c.sim;
    const sp = c.setpoints;
    const err = this.depthGoal - k.depth;
    this.boostSettled = this.depthBoost && Math.abs(err) < CONN.depthReached ? this.boostSettled + DT : 0;
    if (this.depthBoost) {
      const changed = this.boostHeld && (sp.depth !== this.boostEndedAt?.depth || sp.speed !== this.boostEndedAt?.speed);
      const reached = !this.boostHeld && this.boostSettled >= CONN.depthSettle;
      // A new speed order is the player's: the boost was for the old one. Should the planes stall again, it comes back.
      const newSpeed = sp.speed !== this.boostSpeed;
      if (!c.ap.depth || !c.ap.speed || changed || reached || newSpeed) {
        this.depthBoost = false;
        this.boostSettled = 0;
        this.boostHeld = false;
        this.boostEndedAt = reached ? { depth: sp.depth, speed: sp.speed } : null;
        // The depth and pitch integrals hold a bow angle for the old speed.
        c.resetDepthLoops();
        if (c.ap.speed && sp.speed < CONN.planesSpeed && !newSpeed) {
          c.addLog(`${reached ? 'Djupet nått. ' : ''}Maskinen går tillbaka till ${kn(sp.speed)} knop.`, 'info');
        }
      }
    }
    // Nearly hard over counts too: a boat stuck at 24° of 25° is just as stuck. The depth integral stops at 90 %
    // (autopilot.ts), so a stuck boat rests right there: the watch starts a little below.
    const hardOver = Math.abs(sim.commands.sternPlanes) >= CONN.stallPlanes * c.autopilot.tuning.pitch.maxPlanes;
    // Filling the main ballast (diving from the surface) the boat is held up by air, not short of speed.
    const filling = sim.tanks.some((t) => t.ventOpen);
    const stuck = c.ap.depth && !this.surfaceHold && !filling && Math.abs(err) > CONN.stallMinError && hardOver && Math.abs(k.depthRate) < 0.05 && k.u >= 0;
    // On or near the bottom the planes are not what holds the boat: no engine boost into the ground.
    const nearBottom = sim.t - lastGroundedAt < CONN.groundedQuiet || sim.ground(sim.y[0]!, sim.y[1]!) - (k.depth + sim.cfg.hull.radius) < CONN.nearBottom;
    this.stalled = stuck && !nearBottom ? this.stalled + DT : 0;
    if (this.stalled < CONN.stallTime || this.depthBoost || c.ascent.active || this.hovering) return;
    // Stopped on purpose (quiet): the crew hovers if it has the trim (returned above once it does); a player
    // handling the trim is told how. Where hovering is not possible (shallow, ballast not full) the engine helps.
    const stopped = c.ap.speed && sp.speed >= 0 && sp.speed <= HOVER.maxOrderedSpeed;
    if (stopped && !c.options.crew.trim) {
      if (sim.t - this.lastStallHint > CONN.stallHintEvery) {
        this.lastStallHint = sim.t;
        c.addLog('Ubåten har ingen fart, så djuprodren verkar inte. Ändra djupet med In och Ut i panelen Trim, eller öka farten.', 'error');
      }
    } else if (c.ap.speed && sp.speed >= 0 && sp.speed < CONN.planesSpeed) {
      this.depthBoost = true;
      this.boostSpeed = sp.speed;
      this.boostHeld = this.boostEndedAt !== null && this.boostEndedAt.depth === sp.depth && this.boostEndedAt.speed === sp.speed;
      this.boostEndedAt = this.boostHeld ? { depth: sp.depth, speed: sp.speed } : null;
      c.resetDepthLoops();
      c.addLog(
        this.boostHeld
          ? `Djuprodren orkar inte heller nu. Maskinen håller ${CONN.planesSpeed} knop tills djup eller fart ändras.`
          : `Djuprodren orkar inte vid den här farten. Maskinen ökar till ${CONN.planesSpeed} knop tills djupet är nått.`,
        'info',
      );
    } else if (sim.t - this.lastStallHint > CONN.stallHintEvery) {
      this.lastStallHint = sim.t;
      c.addLog(`Djuprodren orkar inte vid den här farten. Öka till minst ${CONN.planesSpeed} knop.`, 'error');
    }
  }

  /** Once per step: a held surface goes on up once nobody hunts the boat. */
  watchHeld(): void {
    if (!this.surfaceHeld) return;
    const c = this.ctrl;
    if (!c.ap.depth || c.setpoints.depth >= CONN.diveTargetDepth || !c.options.crew.ballast) {
      this.surfaceHeld = false;
      return;
    }
    // Checked once a second (the sonar's rate): the hunters change no faster.
    if (Math.round(c.sim.t / DT) % 100 !== 0) return;
    if (!this.quiet) {
      this.surfaceHeld = false;
      c.addLog('Ingen jagar oss längre. Besättningen går upp till ytan.', 'info');
    }
  }

  // ------------------------------------------------------------- the plan

  /** What the boat is doing now and why (the helm's plan line and its details). */
  plan(): Plan {
    const c = this.ctrl;
    const sim = c.sim;
    const k = sim.kinematics();
    const sp = c.setpoints;
    const h = this.hunter();
    const quiet = h !== null;
    const details: string[] = [];
    const hand = (['depth', 'heading', 'speed'] as const).filter((a) => !c.ap[a]);
    const goal = this.depthGoal;
    const target = sp.depth < CONN.diveTargetDepth ? 'ytan' : sp.depth <= PERISCOPE_DEPTH + CONN.periscopeBand && sp.depth >= CONN.diveTargetDepth ? 'periskopdjup' : `${Math.round(sp.depth)} m`;
    const speedNow = `${kn(Math.abs(k.u) / KNOT)} knop`;
    const turning = c.ap.heading && Math.abs((((c.ascent.headingGoal() ?? sp.heading) - k.heading / DEG + 540) % 360) - 180) > 5;
    const blowing = sim.tanks.some((t) => t.blowOpen);
    const venting = sim.tanks.some((t) => t.ventOpen);
    let mode: Manoeuvre;
    let text: string;
    const cs = this.crewSpeed();

    if (hand.length === 3) {
      mode = 'hand';
      text = 'Du styr roder, djuproder och varvtal själv.';
    } else if (c.blowCommitted) {
      mode = 'emergency';
      text = 'Nödblåsning: upp till ytan.';
    } else if (this.surfaceHeld) {
      mode = 'waiting';
      text = `Väntar på periskopdjup: ${h ? `${h.name} ${HUNT_NAME[h.state]}` : 'korvetten'}.`;
      details.push('Att blåsa huvudballasten hörs långt. Tryck Yta igen för att gå upp ändå.');
    } else if (blowing || c.blowingOnRise) {
      mode = 'surfacing';
      text = blowing ? 'Blåser huvudballasten för ytläge.' : `Stiger på djuprodren, blåser på ${15} m.`;
    } else if (c.ascent.phase) {
      mode = 'ascent';
      const p = c.ascent.phase;
      text =
        p === 'rise'
          ? `Stiger mot 35 m i ${kn(this.runSpeed())} knop.`
          : p === 'listen'
            ? 'Lyssnar på 35 m och girar för att höra akterut.'
            : p === 'hold'
              ? 'Stark kontakt: väntar på 35 m.'
              : `Går upp till ${target} i ${kn(this.runSpeed())} knop.`;
      details.push('Från djupet: upp till 35 m, under de största fartygens köl, lyssna runt och sedan upp.');
    } else if (venting && k.depth < 15 && sp.depth >= CONN.diveTargetDepth) {
      mode = 'diving';
      text = `Dyker: fyller huvudballasten, mot ${target}.`;
    } else if (this.surfaceHold) {
      mode = 'surfaced';
      text = c.ap.speed && sp.speed !== 0 ? `I ytläge, ${sp.speed < 0 ? 'back ' : ''}${kn(Math.abs(sp.speed))} knop.` : 'I ytläge.';
    } else if (this.hovering) {
      mode = 'hovering';
      text = Math.abs(goal - k.depth) > 1 ? `Svävar mot ${Math.round(Math.max(goal, HOVER.minDepth))} m med kompenseringen.` : `Svävar på ${Math.round(k.depth)} m.`;
      details.push('Utan fart verkar inte djuprodren: djupet ändras med vatten i kompenseringstanken.');
    } else if (this.crashStopping) {
      mode = 'stopping';
      text = `Stopp: full back tills farten är av (${speedNow}).`;
    } else if (this.coasting) {
      mode = 'coasting';
      text = `Låter farten avta mot ${kn(this.runSpeed())} knop.`;
      details.push('Propellern backar inte: det är tystare och sparar batteriet. Med grunt förut bromsar besättningen med back.');
    } else if (c.ap.speed && sp.speed < 0) {
      mode = 'astern';
      text = `Back ${kn(-sp.speed)} knop.`;
      details.push('Akterut verkar rodren omvänt, och djupbyten görs med liten vinkel.');
    } else if (this.depthBoost) {
      mode = 'boost';
      text = `Ökar till ${CONN.planesSpeed} knop så att djuprodren biter, mot ${target}.`;
    } else if (Math.abs(goal - k.depth) > 1.5 && c.ap.depth) {
      mode = 'changeDepth';
      text = `${goal > k.depth ? 'Går ned' : 'Går upp'} till ${target}.`;
    } else if (c.ap.depth && goal >= CONN.diveTargetDepth && goal <= PERISCOPE_DEPTH + CONN.periscopeBand) {
      mode = 'periscope';
      text = 'På periskopdjup.';
    } else {
      mode = 'holding';
      text = c.ap.depth ? `Håller ${Math.round(goal)} m.` : 'Håller.';
    }
    if (turning && mode !== 'hand' && !(mode === 'ascent' && c.ascent.phase === 'listen')) {
      text = `${text.replace(/\.$/, '')}, girar till ${deg3(c.ascent.headingGoal() ?? sp.heading)}°.`;
    }
    if (cs && mode !== 'boost' && mode !== 'ascent') details.push(`Maskinen går ${kn(cs.knots)} knop i stället för ${kn(sp.speed)} (${cs.reason}).`);
    if (cs?.reason === 'periskopdjup') details.push(`Nära periskopdjup hålls farten under ${CONN.periscopeSpeed} knop: en snabb ubåt skjuter över, och periskopet syns.`);
    if (k.depth > CONN.diveTargetDepth && k.depth < CONN.gentleDepth && !this.surfaceHold && turning) details.push('Nära ytan girar ubåten med högst 15° roder, så att tornet inte bryter ytan.');
    if (quiet && h) details.push(`Tyst gång: ${h.name} ${HUNT_NAME[h.state]}. Besättningen blåser inte och stiger långsamt.`);
    if (hand.length > 0 && hand.length < 3) details.push(`Du styr ${hand.map((a) => (a === 'depth' ? 'djuprodret' : a === 'heading' ? 'rodret' : 'varvtalet')).join(' och ')} själv.`);
    return { mode, text, details, quiet };
  }
}
