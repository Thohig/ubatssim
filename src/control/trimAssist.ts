/**
 * The crew's trim assistant and safety net (crew.ts): each runs while the
 * crew handles the trim or the safety net.
 *
 * The assistant does what the crew could do and no more: it issues ordinary
 * orders (source 'assist') through the controller's queue, so every action
 * is acknowledged in the log and limited by the real pump rates and air
 * supply. It uses only simulation time and telemetry, so it is deterministic.
 *
 *  - Compensation: while submerged with full main ballast, the filtered net
 *    buoyancy is pumped away in portions of at most 200 l.
 *  - Hovering (hover.ts): with no speed the crew changes and holds the depth
 *    with the compensating tank instead (and compensates no other way).
 *  - Trim: a persistent stern-plane angle while the depth autopilot holds
 *    depth means a pitch-moment imbalance; water is moved between the trim
 *    tanks to remove it.
 *  - Safety net (unless a scenario turns it off): emergency blow near crush
 *    depth, a shallow-water limit on the depth setpoint and a keel warning.
 */
import { ENVIRONMENT } from '../sim/config/environment';
import { DT } from '../sim/simulation';
import type { Controller } from './controller';
import { HOVER, Hover } from './hover';

const DEG = Math.PI / 180;

export const ASSIST = {
  /** Share of the expected change in heaviness pumped ahead of a depth change (the rest is measured). */
  anticipateFraction: 0.8,
  /** Smaller expected changes than this are left to the measured compensation [kg]. */
  anticipateMinKg: 150,
  /** Largest compensation ahead of a depth change [l]. */
  anticipateMaxLitres: 2000,
  /** Time between evaluations [s]. */
  interval: 1,
  /** Net buoyancy filter time constant [s]. */
  filterTau: 10,
  /** Compensation dead band [kg]. */
  deadbandKg: 50,
  /** Largest single compensation or trim order [l]. */
  maxPortionLitres: 200,
  /**
   * Largest compensation order [l] when the boat is more than `largeErrorKg` off: tonnes of error
   * (under the halocline, after a dive with air left) took many minutes in 200 l portions.
   */
  largePortionLitres: 500,
  largeErrorKg: 1000,
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
  /**
   * The plane angle is sampled for the trim only while the boat holds its
   * depth: within this distance of the target [m] and slower than this
   * vertical speed [m/s]. While the depth swings, the planes follow the
   * swing, not the trim, and water moved for it made the swing larger
   * (±2 m at periscope depth after a climb).
   */
  trimDepthBand: 1,
  trimSteadyRate: 0.05,
  /**
   * No trimming while the crew runs the engine up for the planes
   * (`Controller.depthBoost`), nor for this long [s] after it starts or
   * ends: the plane angle then comes from the speed, not from the trim, and
   * water moved for it sets the boat swinging at periscope depth.
   */
  boostQuiet: 120,
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
  /**
   * The sea bed check looks this far ahead [m] (astern when the boat backs), in steps of
   * `lookAheadStep`, and further at speed: as far as the boat goes in `lookAheadTime` s. With a fixed
   * 150 m a boat at 8 knots met a steep shore with the limit only 29 m above the bottom, and grounded.
   */
  lookAhead: 150,
  lookAheadTime: 60,
  lookAheadStep: 50,
  /**
   * Rising ground ahead is dangerous when the boat must climb faster than this [m/s] to keep
   * `keelMargin` (about what the planes manage at 4 knots). The crew then slows to `shoalSpeed`
   * knots if it handles the speed and goes faster.
   */
  climbRate: 0.12,
  shoalSpeed: 4,
  /** Seconds without danger before the shoal warning re-arms. */
  shoalRearm: 30,
  /** Keel warning below this [m], re-armed above `keelRearm` [m]. */
  keelWarn: 10,
  keelRearm: 15,
} as const;

/** Shallower depth limits [m] are not logged: the boat is on the surface there anyway. */
const DIVE_LIMIT_NOTICE = 5;

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
  private shoalArmed = true;
  private shoalSince = -Infinity;
  private limiting = false;
  private lastBoost = false;
  private boostChangedAt = -Infinity;

  /** Depth without speed: the compensating tank instead of the planes. */
  readonly hover: Hover;
  /** Ground rises ahead faster than the boat can climb (the last safety-net check): the crew brakes astern. */
  shoalDanger = false;

  constructor(private readonly ctrl: Controller) {
    this.hover = new Hover(ctrl);
  }

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
    if (ctrl.depthBoost !== this.lastBoost) {
      this.lastBoost = ctrl.depthBoost;
      this.boostChangedAt = sim.t;
    }
    const boostQuiet = ctrl.depthBoost || sim.t - this.boostChangedAt < ASSIST.boostQuiet;
    if (!boostQuiet && ctrl.ap.depth && Math.abs(k.depth - ctrl.setpoints.depth) < ASSIST.trimDepthBand && Math.abs(k.depthRate) < ASSIST.trimSteadyRate && k.u > 2 && k.depth > ASSIST.minDepth) {
      this.planesSum += sim.actuators.sternPlanes;
      this.planesSamples++;
    } else {
      this.planesSum = 0;
      this.planesSamples = 0;
    }

    if (this.tick++ % STEPS_PER_EVAL !== 0) return;
    if (ctrl.options.crew.safetyNet) this.safetyNet(k.depth, k.depthRate);
    if (ctrl.options.crew.trim) {
      if (this.hover.update(ASSIST.interval)) this.netFiltered = null;
      else this.compensate();
      this.trim(k.u);
    } else if (this.hover.active) {
      this.hover.update(ASSIST.interval); // the player took the trim over: it stops
    }
  }

  /**
   * Deepest depth setpoint that keeps `keelMargin` under the keel here and
   * ahead [m]. "Ahead" is where the boat is going: astern when it backs.
   */
  depthLimit(): number {
    return this.limitsAhead().reduce((m, x) => Math.min(m, x.limit), Infinity);
  }

  /** The depth limit (see `depthLimit`) at each distance [m] ahead, from here to the look-ahead. */
  private limitsAhead(): { distance: number; limit: number }[] {
    const sim = this.ctrl.sim;
    const k = sim.kinematics();
    const n = sim.y[0]!;
    const e = sim.y[1]!;
    const dir = k.u < -0.2 ? -1 : 1;
    const range = Math.max(ASSIST.lookAhead, Math.abs(k.u) * ASSIST.lookAheadTime);
    const out: { distance: number; limit: number }[] = [];
    for (let d = 0; d <= range + 1e-9; d += ASSIST.lookAheadStep) {
      const seabed = sim.ground(n + dir * d * Math.cos(k.heading), e + dir * d * Math.sin(k.heading));
      out.push({ distance: d, limit: Math.max(0, Math.floor(seabed - sim.cfg.hull.radius - ASSIST.keelMargin)) });
    }
    return out;
  }

  /**
   * Ground rising ahead faster than the boat can climb (`climbRate`) at this speed: warns, and the
   * crew slows to `shoalSpeed` if it handles the speed. Not on the surface (the keel warning is there).
   */
  private watchShoal(limits: { distance: number; limit: number }[], depth: number): void {
    const ctrl = this.ctrl;
    const sim = ctrl.sim;
    const u = Math.abs(sim.kinematics().u);
    const danger =
      depth >= ASSIST.minDepth &&
      u > 1 &&
      limits.some((x) => x.distance > 0 && depth - x.limit > ASSIST.climbRate * (x.distance / u));
    this.shoalDanger = danger;
    if (!danger) {
      if (sim.t - this.shoalSince > ASSIST.shoalRearm) this.shoalArmed = true;
      return;
    }
    this.shoalSince = sim.t;
    if (!this.shoalArmed) return;
    this.shoalArmed = false;
    const slow = ctrl.ap.speed && ctrl.setpoints.speed > ASSIST.shoalSpeed;
    ctrl.addLog(`Varning: grunt förut!${slow ? ` Besättningen saktar in till ${ASSIST.shoalSpeed} knop.` : ' Sakta in eller gå upp.'}`, 'error', 'assist');
    if (slow) ctrl.submit({ kind: 'setSpeed', knots: ASSIST.shoalSpeed }, 'assist');
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

    // Shallow water: keep the depth setpoint off the bottom, and warn of ground rising ahead.
    const limits = this.limitsAhead();
    const limit = limits.reduce((m, x) => Math.min(m, x.limit), Infinity);
    this.watchShoal(limits, depth);
    if (ctrl.ap.depth && ctrl.setpoints.depth > limit) {
      ctrl.setpoints.depth = limit;
      // Surfaced (or aiming for the surface) the limit changes nothing worth a line.
      if (!this.limiting && limit >= DIVE_LIMIT_NOTICE) ctrl.addLog(`Assistent: grunt vatten, djupet begränsas till ${limit} m.`, 'info', 'assist');
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

  /**
   * Compensates ahead of a depth change, as a trimming officer does who knows the water: the hull is
   * squeezed deeper down (heavier) and the water is denser below a layer (lighter). The change from
   * `from` to `to` [m] is pumped at once (`ASSIST.anticipateFraction` of it), on top of any compensation
   * under way, so the boat arrives nearly neutral instead of hanging under or over the layer for minutes.
   * Only while the crew handles the trim, submerged with flooded main ballast and way on (hovering
   * compensates by itself).
   */
  anticipate(from: number, to: number): void {
    const ctrl = this.ctrl;
    const sim = ctrl.sim;
    if (!ctrl.options.crew.trim || this.hover.wanted() || (ctrl.ap.speed && ctrl.setpoints.speed <= HOVER.maxOrderedSpeed)) return;
    if (from < ASSIST.minDepth || to < ASSIST.minDepth) return;
    const t = sim.telemetry();
    if (t.submergedFraction < 0.999 || t.grounded || !t.tanks.every((x) => x.kind !== 'mainBallast' || (x.fill > 0.98 && !x.blowOpen))) return;
    const heavier = sim.heavinessChange(from, to) * ASSIST.anticipateFraction;
    if (Math.abs(heavier) < ASSIST.anticipateMinKg) return;
    // Heavier there → pump out now. Compensating water has surface density.
    const litres = Math.round((-heavier / (sim.water.rhoSurface / 1000) + sim.compRemaining * 1000) / 10) * 10;
    const most = ASSIST.anticipateMaxLitres;
    const portion = Math.max(-most, Math.min(most, litres));
    if (portion === 0) return;
    ctrl.addLog(`Trimmet förbereds för ${Math.round(to)} m: ${heavier > 0 ? 'tyngre' : 'lättare'} där.`, 'info', 'assist');
    ctrl.submit({ kind: 'compensate', litres: portion }, 'assist');
    this.compIdleSince = sim.t;
    this.netFiltered = null;
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
    const most = Math.abs(this.netFiltered) > ASSIST.largeErrorKg ? ASSIST.largePortionLitres : ASSIST.maxPortionLitres;
    const portion = Math.sign(litres) * Math.min(most, Math.round(Math.abs(litres) / 10) * 10);
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
