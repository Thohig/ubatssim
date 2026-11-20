/**
 * Trim assistant and safety net for the simplified simulation.
 *
 * The assistant does what the crew could do and no more: it issues ordinary
 * orders (source 'assist') through the controller's queue, so every action
 * is acknowledged in the log and limited by the real pump rates and air
 * supply. It uses only simulation time and telemetry, so it is deterministic.
 *
 *  - Compensation: while submerged with full main ballast, the filtered net
 *    buoyancy is pumped away in portions of at most 200 l.
 *  - Trim: a persistent stern-plane angle while the depth autopilot holds
 *    depth means a pitch-moment imbalance; water is moved between the trim
 *    tanks to remove it.
 *  - Safety net (unless a scenario turns it off): emergency blow near crush
 *    depth, a shallow-water limit on the depth setpoint and a keel warning.
 */
import { ENVIRONMENT } from '../sim/config/environment';
import { DT } from '../sim/simulation';
import type { Controller } from './controller';

const DEG = Math.PI / 180;

export const ASSIST = {
  /** Time between evaluations [s]. */
  interval: 1,
  /** Net buoyancy filter time constant [s]. */
  filterTau: 10,
  /** Compensation dead band [kg]. */
  deadbandKg: 50,
  /** Largest single compensation or trim order [l]. */
  maxPortionLitres: 200,
  /** Wait after a pump stops before the next order [s]. */
  settleTime: 10,
  /** Only compensate below this depth, fully submerged [m]. */
  minDepth: 8,
  /**
   * Only compensate when the depth is steady: vertical speed below this
   * [m/s] for `steadyTime` [s]. While the boat changes depth the air left in
   * the main ballast and the hull compress, so the net buoyancy is still
   * moving. A boat that hangs still short of its target (too light or too
   * heavy for the planes) counts as steady: that is when it needs water.
   */
  steadyRate: 0.15,
  steadyTime: 15,
  /** Averaging window for the stern-plane angle [s]. */
  trimWindow: 20,
  /** Mean stern-plane angle that triggers a trim transfer [rad]. */
  trimDeadband: 1.5 * DEG,
  /** Fraction of the estimated trim transfer that is ordered (avoids overshoot). */
  trimGain: 0.5,
  /** Crush depth [m] (as in the "Nödblåsning" scenario). */
  crushDepth: 300,
  /** Emergency blow when deeper than this fraction of crush depth. */
  blowFraction: 0.85,
  /** …or when sinking faster than this [m/s] below `sinkDepth` [m]. */
  sinkRate: 2,
  sinkDepth: 250,
  /** Re-arm the emergency blow above this depth [m]. */
  blowRearmDepth: 180,
  /** Least water under the keel the depth autopilot may aim for [m]. */
  keelMargin: 10,
  /** Look-ahead distances for the sea bed check [m], astern when the boat goes astern. */
  lookAhead: [0, 50, 100, 150],
  /** Keel warning below this [m], re-armed above `keelRearm` [m]. */
  keelWarn: 10,
  keelRearm: 15,
} as const;

const STEPS_PER_EVAL = Math.round(ASSIST.interval / DT);

export class TrimAssist {
  private tick = 0;
  private netFiltered: number | null = null;
  private compIdleSince = 0;
  private unsteadySince = 0;
  private trimIdleSince = 0;
  private planesSum = 0;
  private planesSamples = 0;
  private blowArmed = true;
  private keelArmed = true;
  private limiting = false;

  constructor(private readonly ctrl: Controller) {}

  /** Call once per simulation step, after `sim.step()`. */
  step(): void {
    const ctrl = this.ctrl;
    const sim = ctrl.sim;
    // Pump timers and the stern-plane average are sampled every step (cheap).
    if (sim.compRemaining !== 0) this.compIdleSince = sim.t;
    if (sim.trimRemaining !== 0) this.trimIdleSince = sim.t;
    const k = sim.kinematics();
    const steady = Math.abs(k.depthRate) < ASSIST.steadyRate;
    if (!steady) this.unsteadySince = sim.t;
    if (ctrl.ap.depth && Math.abs(k.depth - ctrl.setpoints.depth) < 2 && Math.abs(k.depthRate) < 0.2 && k.u > 2 && k.depth > ASSIST.minDepth) {
      this.planesSum += sim.actuators.sternPlanes;
      this.planesSamples++;
    } else {
      this.planesSum = 0;
      this.planesSamples = 0;
    }

    if (this.tick++ % STEPS_PER_EVAL !== 0) return;
    if (ctrl.options.safetyNet) this.safetyNet(k.depth, k.depthRate);
    this.compensate();
    this.trim(k.u);
  }

  /**
   * Deepest depth setpoint that keeps `keelMargin` under the keel here and
   * ahead [m]. "Ahead" is where the boat is going: astern when it backs.
   */
  depthLimit(): number {
    const sim = this.ctrl.sim;
    const k = sim.kinematics();
    const n = sim.y[0]!;
    const e = sim.y[1]!;
    const dir = k.u < -0.2 ? -1 : 1;
    let seabed = Infinity;
    for (const d of ASSIST.lookAhead) seabed = Math.min(seabed, sim.ground(n + dir * d * Math.cos(k.heading), e + dir * d * Math.sin(k.heading)));
    return Math.max(0, Math.floor(seabed - sim.cfg.hull.radius - ASSIST.keelMargin));
  }

  private safetyNet(depth: number, depthRate: number): void {
    const ctrl = this.ctrl;
    const sim = ctrl.sim;

    // Emergency blow.
    if (depth < ASSIST.blowRearmDepth) this.blowArmed = true;
    const tooDeep = depth > ASSIST.blowFraction * ASSIST.crushDepth;
    const sinking = depth > ASSIST.sinkDepth && depthRate > ASSIST.sinkRate;
    if (this.blowArmed && (tooDeep || sinking)) {
      this.blowArmed = false;
      ctrl.addLog('Assistent: nödblåsning! Ubåten närmar sig krossdjupet.', 'error', 'assist');
      ctrl.submit({ kind: 'surface' }, 'assist');
    }

    // Shallow water: keep the depth setpoint off the bottom.
    const limit = this.depthLimit();
    if (ctrl.ap.depth && ctrl.setpoints.depth > limit) {
      ctrl.setpoints.depth = limit;
      if (!this.limiting) ctrl.addLog(`Assistent: grunt vatten, djupet begränsas till ${limit} m.`, 'info', 'assist');
      this.limiting = true;
    } else if (!ctrl.ap.depth || ctrl.setpoints.depth < limit - 5) {
      this.limiting = false;
    }

    // Keel warning.
    const underKeel = sim.ground(sim.y[0]!, sim.y[1]!) - (depth + sim.cfg.hull.radius);
    if (this.keelArmed && underKeel < ASSIST.keelWarn) {
      this.keelArmed = false;
      ctrl.addLog(`Varning: ${Math.max(0, Math.round(underKeel))} m under köl.`, 'error', 'assist');
    } else if (underKeel > ASSIST.keelRearm) {
      this.keelArmed = true;
    }
  }

  private compensate(): void {
    const ctrl = this.ctrl;
    const sim = ctrl.sim;
    const t = sim.telemetry();
    const mbtFull = t.tanks.every((x) => x.kind !== 'mainBallast' || (x.fill > 0.98 && !x.blowOpen));
    if (t.submergedFraction < 0.999 || t.depth < ASSIST.minDepth || !mbtFull || t.grounded) {
      this.netFiltered = null;
      return;
    }
    const netKg = t.netBuoyancy / ENVIRONMENT.g;
    this.netFiltered = this.netFiltered === null ? netKg : this.netFiltered + (netKg - this.netFiltered) * (ASSIST.interval / ASSIST.filterTau);
    if (sim.t - this.unsteadySince < ASSIST.steadyTime) {
      this.netFiltered = null;
      return;
    }
    if (sim.compRemaining !== 0 || sim.t - this.compIdleSince < ASSIST.settleTime) return;
    if (Math.abs(this.netFiltered) < ASSIST.deadbandKg) return;
    // Light (positive) → take water in. Compensating water has surface density.
    const litres = this.netFiltered / (sim.water.rhoSurface / 1000);
    const portion = Math.sign(litres) * Math.min(ASSIST.maxPortionLitres, Math.round(Math.abs(litres) / 10) * 10);
    if (portion === 0) return;
    ctrl.submit({ kind: 'compensate', litres: portion }, 'assist');
    this.compIdleSince = sim.t;
  }

  private trim(speed: number): void {
    const ctrl = this.ctrl;
    const sim = ctrl.sim;
    if (this.planesSamples * DT < ASSIST.trimWindow) return;
    const mean = this.planesSum / this.planesSamples;
    this.planesSum = 0;
    this.planesSamples = 0;
    if (Math.abs(mean) < ASSIST.trimDeadband) return;
    if (sim.trimRemaining !== 0 || sim.t - this.trimIdleSince < ASSIST.settleTime) return;
    const fin = sim.cfg.fins.find((f) => f.actuator === 'sternPlanes');
    const fwd = sim.tankDefs.find((d) => d.id === 'trim_fwd');
    const aft = sim.tankDefs.find((d) => d.id === 'trim_aft');
    if (!fin || !fwd || !aft) return;
    // Pitch moment the planes supply on average, and the water transfer that gives the same moment.
    // Positive planes push the bow down: the boat is stern-heavy, so water goes forward.
    const rho = sim.water.rhoSurface;
    const planesMoment = 0.5 * rho * speed * speed * fin.area * fin.liftSlope * mean * Math.abs(fin.position[0]);
    const arm = fwd.position[0] - aft.position[0];
    const litres = (ASSIST.trimGain * planesMoment) / (rho * ENVIRONMENT.g * arm) * 1000;
    const portion = Math.sign(litres) * Math.min(ASSIST.maxPortionLitres, Math.max(10, Math.round(Math.abs(litres) / 10) * 10));
    ctrl.submit({ kind: 'trim', litres: portion }, 'assist');
    this.trimIdleSince = sim.t;
  }
}
