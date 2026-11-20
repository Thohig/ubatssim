/**
 * Hovering: the crew changes and holds the depth without speed, with the
 * compensating tank alone. At (almost) no speed the planes do nothing; a
 * boat a few hundred kilograms heavy sinks slowly (500 kg ≈ 0,06 m/s, the
 * cross-flow drag of the hull is large) and one as light rises.
 *
 * Two loops, evaluated once a second by the trim assistant (trimAssist.ts):
 *  - outer: the depth error gives a wanted vertical speed, at most
 *    `maxRate` and smaller over the last metres;
 *  - inner: the wanted speed gives the wanted heaviness (drag ∝ w·|w|, plus a
 *    correction for the speed error), and the difference from the present
 *    net buoyancy is pumped in or out.
 * The pump moves only 6 l/s, so the boat must be made neutral well before
 * the target: the outer loop asks for less speed in time and the inner loop
 * pumps out while the boat still sinks. The water's layers (denser below
 * a thermocline) and the hull's compression (heavier deeper) change the
 * buoyancy on the way; both loops work on the measured net buoyancy and
 * vertical speed, so they need no model of them.
 *
 * Orders are ordinary `compensate` orders from 'assist' (acknowledged in
 * the log), few and large: a new one only when the wanted amount differs
 * from the one under way. Deterministic: simulation time and telemetry only.
 */
import { ENVIRONMENT } from '../sim/config/environment';
import type { Controller } from './controller';

const KNOT = 1852 / 3600;

export const HOVER = {
  /** The crew hovers when the speed order is at most this [knots]… */
  maxOrderedSpeed: 1,
  /** …and the speed through the water is below this [m/s] (stops above `endSpeed`). */
  startSpeed: 0.8,
  endSpeed: 1.0,
  /** Only fully submerged, below this depth [m], with the target below it too. */
  minDepth: 8,
  /** Wanted vertical speed: depth error / `rateTime` [s], at most `maxRate` [m/s]. */
  rateTime: 100,
  maxRate: 0.07,
  /** Heaviness [kg] for a steady vertical speed w [m/s]: `drag`·w·|w| (measured: 500 kg ≈ 0,06–0,07 m/s). */
  drag: 1.0e5,
  /** Extra heaviness [kg] per m/s of vertical speed short of the wanted one. */
  rateGain: 6000,
  /** Most heaviness or lightness the crew pumps for [kg]. */
  maxHeavy: 700,
  /** A new order only when the wanted amount differs by more than this [l] from the one under way… */
  orderDeadband: 90,
  /** …and at least this long [s] after the last one. */
  orderInterval: 15,
  /** "Neutral på X m" once the depth has been within `reached` [m] for `settle` [s]. */
  reached: 0.5,
  settle: 30,
} as const;

export class Hover {
  /** True while the crew hovers (the depth autopilot then holds the planes at zero). */
  active = false;
  private lastOrder = -Infinity;
  private settledFor = 0;
  /** The depth target the crew last said it hovers for, and whether it has said it is there. */
  private target: number | null = null;
  private arrived = false;

  constructor(private readonly ctrl: Controller) {}

  /** Whether the crew should hover now (the crew handles depth, speed and trim; no speed; submerged). */
  wanted(): boolean {
    const c = this.ctrl;
    if (!c.options.crew.trim || !c.ap.depth || !c.ap.speed || c.surfaceHold) return false;
    if (c.setpoints.speed > HOVER.maxOrderedSpeed || c.setpoints.speed < 0) return false;
    if (c.setpoints.depth < HOVER.minDepth) return false;
    const t = c.sim.telemetry();
    if (t.grounded || t.submergedFraction < 0.999 || t.depth < HOVER.minDepth) return false;
    if (!t.tanks.every((x) => x.kind !== 'mainBallast' || (x.fill > 0.98 && !x.blowOpen))) return false;
    return Math.abs(t.u) < (this.active ? HOVER.endSpeed : HOVER.startSpeed);
  }

  /** Call once a second while the crew handles the trim; returns whether it hovers (and so compensates itself). */
  update(dt: number): boolean {
    const c = this.ctrl;
    const sim = c.sim;
    const want = this.wanted();
    if (want !== this.active) {
      this.active = want;
      this.settledFor = 0;
      this.lastOrder = -Infinity;
      this.target = null;
    }
    if (!this.active) return false;

    const t = sim.telemetry();
    const k = sim.kinematics();
    const err = c.setpoints.depth - k.depth; // positive: go down
    // A new target: said once, unless the boat is already there (stopped where it was).
    if (c.setpoints.depth !== this.target) {
      this.target = c.setpoints.depth;
      this.arrived = Math.abs(err) <= 1;
      if (!this.arrived) c.addLog(`Ingen fart: besättningen svävar mot ${this.target} m med kompenseringen.`, 'info', 'assist');
    }
    const w = k.depthRate; // positive: sinking
    const wWanted = Math.max(-HOVER.maxRate, Math.min(HOVER.maxRate, err / HOVER.rateTime));
    const heavyWanted = Math.max(
      -HOVER.maxHeavy,
      Math.min(HOVER.maxHeavy, HOVER.drag * wWanted * Math.abs(wWanted) + HOVER.rateGain * (wWanted - w)),
    );
    const heavy = -t.netBuoyancy / ENVIRONMENT.g;
    // Compensating water has surface density: kg → litres.
    const litresPerKg = 1000 / sim.water.rhoSurface;
    const wantedLitres = (heavyWanted - heavy) * litresPerKg;
    const pending = sim.compRemaining * 1000;
    if (Math.abs(wantedLitres - pending) > HOVER.orderDeadband && sim.t - this.lastOrder >= HOVER.orderInterval) {
      const litres = Math.round(wantedLitres / 10) * 10;
      if (litres !== 0) {
        c.submit({ kind: 'compensate', litres }, 'assist');
        this.lastOrder = sim.t;
      }
    }

    // Said once when the boat hangs still at the target.
    this.settledFor = Math.abs(err) < HOVER.reached && Math.abs(w) < 0.02 ? this.settledFor + dt : 0;
    if (this.settledFor >= HOVER.settle && !this.arrived) {
      this.arrived = true;
      c.addLog(`Svävar på ${this.target} m.`, 'info', 'assist');
    }
    return true;
  }
}

/** Speed [m/s] below which the planes cannot hold the boat (for hints). */
export const HOVER_SPEED = HOVER.maxOrderedSpeed * KNOT;
