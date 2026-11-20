/**
 * PID autopilots for depth, heading and speed. Deterministic; called once
 * per simulation step with the fixed dt.
 *
 * Depth is a cascade: an outer depth loop commands a pitch angle and an
 * inner pitch loop moves the stern planes. Plane and rudder gains are
 * scheduled with 1/U² because fin lift grows with U².
 *
 * Astern the water meets the fins from behind, so a rudder or plane angle
 * turns the boat the other way, and a bow-down boat rises instead of
 * diving. The depth and heading loops then flip the sign of their output
 * and of the pitch reference. The direction switches with hysteresis
 * around zero speed, and the loops are reset when it does.
 */
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
/** Depth rate [m/s] below which the depth counts as standing still (the depth integral works outside its zone). */
const DEPTH_STEADY_RATE = 0.02;

export class PID {
  private integral = 0;
  /**
   * @param integralZone integrate only while |error| is below this value, so
   *   long transients (e.g. a 100 m depth change) do not wind up the integral.
   */
  constructor(
    public kp: number,
    public ki: number,
    public kd: number,
    public outMin: number,
    public outMax: number,
    public integralZone = Infinity,
  ) {}

  /**
   * @param error     setpoint − measurement
   * @param rate      time derivative of the measurement (derivative on measurement)
   * @param integrate override the integral zone: true integrates outside it too, false not at all
   */
  update(error: number, rate: number, dt: number, feedForward = 0, gainScale = 1, integrate?: boolean): number {
    const unsat = feedForward + gainScale * (this.kp * error + this.ki * this.integral - this.kd * rate);
    const out = clamp(unsat, this.outMin, this.outMax);
    // Conditional integration (anti-windup): only integrate when not pushing further into saturation.
    const saturatedHigh = unsat > this.outMax && error > 0;
    const saturatedLow = unsat < this.outMin && error < 0;
    if (!saturatedHigh && !saturatedLow && (integrate ?? Math.abs(error) < this.integralZone)) this.integral += error * dt;
    return out;
  }

  reset(): void {
    this.integral = 0;
  }
}

export const wrapAngle = (a: number): number => {
  let x = (a + Math.PI) % (2 * Math.PI);
  if (x < 0) x += 2 * Math.PI;
  return x - Math.PI;
};

const DEG = Math.PI / 180;

export const AUTOPILOT_TUNING = {
  /**
   * Depth → pitch reference [rad per m], [rad per m·s], [rad per m/s]. The
   * integral works only within 1.5 m of the target: integrating through the
   * approach wound up a bow-up reference, and a climb to periscope depth at
   * 4 knots overshot by ~6 m and broke the surface.
   */
  depth: { kp: 0.012, ki: 0.0004, kd: 0.45, maxPitch: 12 * DEG, integralZone: 1.5 },
  /** Pitch → stern planes [rad/rad], [rad/(rad s)], [rad/(rad/s)]. */
  pitch: { kp: 1.6, ki: 0.06, kd: 5.0, maxPlanes: 25 * DEG, integralZone: 5 * DEG },
  /** Heading → rudder. */
  heading: { kp: 1.2, ki: 0.01, kd: 18, maxRudder: 25 * DEG, integralZone: 10 * DEG },
  /**
   * Speed → shaft speed correction [rev/s per m/s], around the steady shaft
   * speed. The correction may reach full shaft speed, so that stopping or
   * going from ahead to astern uses the propeller as a brake. The command is
   * limited to the shaft's limits (see `rps`), and the integral stops there.
   */
  speed: { kp: 1.0, ki: 0.03, integralZone: 0.5 },
  /** Largest pitch reference astern [rad]: depth changes stern first are kept gentle. */
  maxPitchAstern: 5 * DEG,
  /** Speed through the water [m/s] beyond which the loops switch to astern (−) or ahead (+). */
  directionHysteresis: 0.2,
  /** Reference speed for gain scheduling [m/s] and maximum gain multiplier. */
  scheduleSpeed: 4,
  maxGainScale: 3,
  /** Shaft speed command slew rate [rev/s per s]. */
  rpsSlew: 0.15,
} as const;

export interface AutopilotInput {
  depth: number;
  depthRate: number;
  pitch: number;
  pitchRate: number;
  heading: number;
  yawRate: number;
  speed: number;
}

export class Autopilot {
  readonly depthPid: PID;
  readonly pitchPid: PID;
  readonly headingPid: PID;
  readonly speedPid: PID;
  /** +1 ahead, −1 astern (see `direction()`). */
  private dir: 1 | -1 = 1;
  /** The planes were (nearly) hard over at the last step: the depth loop's pitch reference is out of reach. */
  private planesHardOver = false;

  constructor(readonly tuning = AUTOPILOT_TUNING) {
    const t = tuning;
    this.depthPid = new PID(t.depth.kp, t.depth.ki, t.depth.kd, -t.depth.maxPitch, t.depth.maxPitch, t.depth.integralZone);
    this.pitchPid = new PID(t.pitch.kp, t.pitch.ki, t.pitch.kd, -t.pitch.maxPlanes, t.pitch.maxPlanes, t.pitch.integralZone);
    this.headingPid = new PID(t.heading.kp, t.heading.ki, t.heading.kd, -t.heading.maxRudder, t.heading.maxRudder, t.heading.integralZone);
    this.speedPid = new PID(t.speed.kp, t.speed.ki, 0, -Infinity, Infinity, t.speed.integralZone);
  }

  private gainScale(speed: number): number {
    const u = Math.max(0.5, Math.abs(speed));
    return Math.min(this.tuning.maxGainScale, (this.tuning.scheduleSpeed / u) ** 2);
  }

  /**
   * +1 ahead, −1 astern. Switches only when the speed through the water has
   * passed ±`directionHysteresis`; on a switch the depth, pitch and heading
   * loops are reset, since their integrals hold fin angles for the old
   * direction. Deterministic: depends only on the speeds passed in.
   */
  direction(speed: number): 1 | -1 {
    const h = this.tuning.directionHysteresis;
    const next = this.dir === 1 ? (speed < -h ? -1 : 1) : speed > h ? 1 : -1;
    if (next !== this.dir) {
      this.dir = next;
      this.depthPid.reset();
      this.pitchPid.reset();
      this.headingPid.reset();
    }
    return this.dir;
  }

  /** Stern planes command [rad], positive = dive. */
  planes(targetDepth: number, s: AutopilotInput, dt: number): number {
    const dir = this.direction(s.speed);
    // Deeper target → positive error → negative pitch reference ahead (bow down),
    // positive astern (stern down, the end the boat is moving towards).
    const maxPitch = dir === 1 ? this.tuning.depth.maxPitch : this.tuning.maxPitchAstern;
    // The depth integral works within its zone, and also outside it once the depth stands still (a boat
    // resting 2 m off the target is not a transient), but never while the planes are hard over (wind-up).
    const err = targetDepth - s.depth;
    const zone = this.tuning.depth.integralZone;
    const integrate = !this.planesHardOver && (Math.abs(err) < zone || Math.abs(s.depthRate) < DEPTH_STEADY_RATE);
    const pitchRef = clamp(-dir * this.depthPid.update(err, s.depthRate, dt, 0, 1, integrate), -maxPitch, maxPitch);
    // Pitch above reference → bow down: planes dive (positive) ahead, rise astern.
    const planes = dir * this.pitchPid.update(s.pitch - pitchRef, -s.pitchRate, dt, 0, this.gainScale(s.speed));
    this.planesHardOver = Math.abs(planes) >= 0.9 * this.tuning.pitch.maxPlanes;
    return planes;
  }

  /** Rudder command [rad], positive = starboard. */
  rudder(targetHeading: number, s: AutopilotInput, dt: number): number {
    const dir = this.direction(s.speed);
    return dir * this.headingPid.update(wrapAngle(targetHeading - s.heading), s.yawRate, dt, 0, this.gainScale(s.speed));
  }

  /**
   * Shaft speed command [rev/s] around a feed-forward value, within the
   * shaft's limits [rev/s]. The limits are the PID's own, so it stops
   * integrating at them: a target out of reach (full ahead, 19 knots) then
   * winds nothing up that would spoil the next, lower target.
   */
  rps(targetSpeed: number, feedForward: number, s: AutopilotInput, dt: number, minRps = -Infinity, maxRps = Infinity): number {
    this.speedPid.outMin = minRps;
    this.speedPid.outMax = maxRps;
    return this.speedPid.update(targetSpeed - s.speed, 0, dt, feedForward);
  }
}
