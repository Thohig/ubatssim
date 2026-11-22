/**
 * Coming up from the deep, as a crew does it (the crew handles depth and
 * speed). A target shallower than `LEVEL_DEPTH` (periscope depth, or the
 * surface) ordered from deeper than `LEVEL_DEPTH` + 5 m goes in steps:
 *
 *  - rise:   at least `RISE_SPEED` (8 knots) on the planes, at most
 *            `RISE_PITCH` bow up, to `LEVEL_DEPTH` (35 m: below the keels of
 *            the largest ships, ~20 m);
 *  - listen: level off there at `LISTEN_SPEED` and turn `LISTEN_TURN` off the
 *            course for `LISTEN_TIME`, so the sonar hears astern too
 *            (clearing the baffles);
 *  - hold:   a strong contact (a ship close by): stay at `LEVEL_DEPTH` and
 *            say so; a new depth order goes on up;
 *  - final:  the last part at `LISTEN_SPEED`, then the player's speed again.
 *            For the surface the main ballast is blown at 15 m as before.
 *
 * Main ballast is not used to rise: speed and planes are. A new speed ahead
 * (above hovering, below full ahead) keeps the steps: it is a floor while
 * rising and the player's speed once up. Stopp, astern, full ahead, the
 * player taking over depth or speed, or a deeper target end it; a new depth
 * order during the listening goes straight up without it.
 * Deterministic: simulation time and telemetry only.
 */
import { DT } from '../sim/simulation';
import type { Controller } from './controller';
import { TELEGRAPH } from './crew';
import { HOVER } from './hover';

const DEG = Math.PI / 180;
const KNOT = 1852 / 3600;
const FULL_AHEAD = TELEGRAPH[TELEGRAPH.length - 1]!.knots;
const kn = (v: number) => v.toString().replace('.', ',');

export const ASCENT = {
  levelDepth: 35,
  /** Starts only from deeper than this (else the boat simply goes up). */
  startBelow: 40,
  riseSpeed: 8,
  listenSpeed: 4,
  risePitch: 10 * DEG,
  listenTurn: 60,
  listenTime: 60,
  /** Within this of the levelling depth [m] the listening starts. */
  levelled: 2,
  /** A contact this strong [dB of signal excess] is close: the crew holds at the levelling depth. */
  closeExcess: 25,
  /** The final part is done when the depth has been within 1 m of the target this long [s]. */
  settle: 20,
} as const;

/** Logged when a shallow target is ordered deep down without way on and the player handling the speed. */
export const STILL_HINT = `Du sköter farten, och utan fart lyfter djuprodren inte ubåten. Tryck på telegrafen, så tar besättningen farten, och ge djupmålet igen: då stiger den i ${ASCENT.riseSpeed} knop.`;

/** Logged when the ascent is cut short. */
export const CANCELLED = 'Stigningen avbruten.';

export type AscentPhase ='rise' | 'listen' | 'hold' | 'final';

export class Ascent {
  phase: AscentPhase | null = null;
  /** The depth target it is going for [m] (the player's). */
  private target = 0;
  private listenUntil = 0;
  private listenHeading = 0;
  private settled = 0;

  constructor(private readonly ctrl: Controller) {}

  get active(): boolean {
    return this.phase !== null;
  }

  /** The depth the autopilot steers for now [m]. */
  depthGoal(setpoint: number): number {
    return this.phase === 'rise' || this.phase === 'listen' || this.phase === 'hold' ? ASCENT.levelDepth : setpoint;
  }

  /** The heading the autopilot steers for [deg], or null for the player's. */
  headingGoal(): number | null {
    return this.phase === 'listen' && this.ctrl.ap.heading ? this.listenHeading : null;
  }

  /** The speed the crew runs at [knots] (at least the player's while rising), or null for the player's. */
  speedGoal(setpoint: number): number | null {
    // A corvette on to the boat: the crew rises slowly and quietly (conn.ts).
    if (this.phase === 'rise') return Math.max(setpoint, this.ctrl.conn.quiet ? ASCENT.listenSpeed : ASCENT.riseSpeed);
    if (this.phase) return ASCENT.listenSpeed;
    return null;
  }

  /** Largest bow-up angle for the depth autopilot [rad], or null for its own. */
  maxPitch(): number | null {
    return this.phase === 'rise' ? ASCENT.risePitch : null;
  }

  /** A depth order has been applied (the crew handles the depth now). */
  onDepthOrder(): void {
    const c = this.ctrl;
    const target = c.setpoints.depth;
    if (!c.ap.speed || target >= ASCENT.levelDepth) {
      this.end(false);
      // The player handles the speed and the boat has little way on deep down: say at once why it does not
      // come up (a boat the crew hovers says so itself, hover.ts).
      if (!c.ap.speed && target < ASCENT.levelDepth && !c.assist.hover.wanted()) {
        const k = c.sim.kinematics();
        if (k.depth > ASCENT.startBelow && k.u < ASCENT.listenSpeed * KNOT) c.afterAck.push(STILL_HINT);
      }
      return;
    }
    // Already on the way: a new shallow target during the listening (or the hold) goes straight up.
    if (this.phase === 'listen' || this.phase === 'hold') {
      this.target = target;
      this.go(false);
      return;
    }
    if (this.phase) {
      this.target = target;
      return;
    }
    // An emergency blow from the deep is already on its way up: no levelling off or listening on top of it.
    if (c.blowCommitted) return;
    const depth = c.sim.kinematics().depth;
    if (depth <= ASCENT.startBelow) return;
    this.target = target;
    this.phase = 'rise';
    c.afterAck.push(`Stigning i ${this.speedGoal(c.setpoints.speed)!} knop${c.conn.quiet ? ' (tyst gång)' : ''}. Besättningen planar ut på ${ASCENT.levelDepth} m och lyssnar innan den går upp.`);
  }

  /**
   * A speed order from the player. Ahead, faster than hovering and slower than full ahead, the ascent goes
   * on (`speedGoal` takes the new speed as the floor while rising, and it is the engine's once up), said in
   * the log. Stopp, astern or full ahead (an order to go now) cut it short.
   */
  onSpeedOrder(): void {
    if (!this.phase) return;
    const c = this.ctrl;
    const v = c.setpoints.speed;
    if (v <= HOVER.maxOrderedSpeed || v >= FULL_AHEAD) {
      this.end(false);
      return;
    }
    const where = this.target < 5 ? 'uppe' : 'på målet';
    c.afterAck.push(`Stigningen fortsätter i ${kn(this.speedGoal(v)!)} knop. Maskinen går till ${kn(v)} knop ${where}.`);
  }

  /** Cuts the ascent short without a word (the main ballast blown: the blow says so). */
  cancel(): void {
    this.end(false, true);
  }

  onHeadingOrder(): void {
    // The turn is the listening's own: a new course cuts it short, and the boat goes on up.
    if (this.phase === 'listen') this.go(false);
  }

  /** Call once per step. */
  update(): void {
    const c = this.ctrl;
    if (!this.phase) return;
    if (!c.ap.depth || !c.ap.speed || c.setpoints.depth >= ASCENT.levelDepth) {
      this.end(false);
      return;
    }
    const sim = c.sim;
    const k = sim.kinematics();
    if (this.phase === 'rise' && k.depth <= ASCENT.levelDepth + ASCENT.levelled) {
      this.phase = 'listen';
      this.listenUntil = sim.t + ASCENT.listenTime;
      this.listenHeading = (Math.round(k.heading / DEG) + ASCENT.listenTurn) % 360;
      c.addLog(`Planar ut på ${ASCENT.levelDepth} m i ${ASCENT.listenSpeed} knop och lyssnar runt.`, 'info');
      return;
    }
    if (this.phase === 'listen' && sim.t >= this.listenUntil) {
      const near = c.sonar.contacts.filter((x) => !x.bio && x.excess > ASCENT.closeExcess);
      if (near.length) {
        this.phase = 'hold';
        const b = near.map((x) => `${x.label} i ${String(Math.round(x.bearing) % 360).padStart(3, '0')}°`).join(', ');
        c.addLog(`Sonar: stark kontakt ${b}. Besättningen stannar på ${ASCENT.levelDepth} m. Ge en djuporder för att gå upp ändå.`, 'error');
        return;
      }
      this.go(true);
      return;
    }
    if (this.phase === 'final') {
      // Waiting at periscope depth for the hunters to leave (conn.ts) ends the ascent there.
      const surface = this.target < 5 && !c.conn.surfaceHeld;
      const goal = c.conn.surfaceHeld ? c.conn.depthGoal : this.target;
      const there = surface ? k.depth < 4 && !sim.tanks.some((t) => t.blowOpen) : Math.abs(k.depth - goal) < 1;
      this.settled = there ? this.settled + DT : 0;
      if (this.settled >= (surface ? 5 : ASCENT.settle)) this.end(true);
    }
  }

  /** On up to the target. */
  private go(listened: boolean): void {
    this.phase = 'final';
    this.settled = 0;
    const where = this.target < 5 ? 'till ytan' : `till ${this.target} m`;
    this.ctrl.addLog(listened ? `Inga kontakter nära. Går upp ${where} i ${ASCENT.listenSpeed} knop.` : `Går upp ${where} i ${ASCENT.listenSpeed} knop.`, 'info');
  }

  /**
   * Ends it; `done` = arrived (the engine goes back to the player's speed, said in the log). Cut short, the
   * log says so, so that a boat that stops coming up does not look stuck (`quiet`: something else says it).
   */
  private end(done: boolean, quiet = false): void {
    if (!this.phase) return;
    const c = this.ctrl;
    this.phase = null;
    if (!done && !quiet) c.addLog(CANCELLED, 'info');
    if (done && c.ap.speed && c.setpoints.speed !== ASCENT.listenSpeed) {
      c.addLog(`Maskinen går tillbaka till ${kn(c.setpoints.speed)} knop.`, 'info');
    }
  }
}
