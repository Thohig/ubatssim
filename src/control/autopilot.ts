/**
 * PID autopilots for depth, heading and speed. Deterministic; called once
 * per simulation step with the fixed dt.
 *
 * Depth is a cascade: an outer depth loop commands a pitch angle and an
 * inner pitch loop moves the stern planes. Plane and rudder gains are
 * scheduled with 1/U² because fin lift grows with U².
 */
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

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
   */
  update(error: number, rate: number, dt: number, feedForward = 0, gainScale = 1): number {
    const unsat = feedForward + gainScale * (this.kp * error + this.ki * this.integral - this.kd * rate);
    const out = clamp(unsat, this.outMin, this.outMax);
    // Conditional integration (anti-windup): only integrate when not pushing further into saturation.
    const saturatedHigh = unsat > this.outMax && error > 0;
    const saturatedLow = unsat < this.outMin && error < 0;
    if (!saturatedHigh && !saturatedLow && Math.abs(error) < this.integralZone) this.integral += error * dt;
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
  /** Depth → pitch reference [rad per m], [rad per m·s], [rad per m/s]. */
  depth: { kp: 0.012, ki: 0.0004, kd: 0.45, maxPitch: 12 * DEG, integralZone: 8 },
  /** Pitch → stern planes [rad/rad], [rad/(rad s)], [rad/(rad/s)]. */
  pitch: { kp: 1.6, ki: 0.06, kd: 5.0, maxPlanes: 25 * DEG, integralZone: 5 * DEG },
  /** Heading → rudder. */
  heading: { kp: 1.2, ki: 0.01, kd: 18, maxRudder: 25 * DEG, integralZone: 10 * DEG },
  /** Speed → shaft speed correction [rev/s per m/s]. */
  speed: { kp: 0.4, ki: 0.03, integralZone: 0.5 },
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

  constructor(readonly tuning = AUTOPILOT_TUNING) {
    const t = tuning;
    this.depthPid = new PID(t.depth.kp, t.depth.ki, t.depth.kd, -t.depth.maxPitch, t.depth.maxPitch, t.depth.integralZone);
    this.pitchPid = new PID(t.pitch.kp, t.pitch.ki, t.pitch.kd, -t.pitch.maxPlanes, t.pitch.maxPlanes, t.pitch.integralZone);
    this.headingPid = new PID(t.heading.kp, t.heading.ki, t.heading.kd, -t.heading.maxRudder, t.heading.maxRudder, t.heading.integralZone);
    this.speedPid = new PID(t.speed.kp, t.speed.ki, 0, -2, 2, t.speed.integralZone);
  }

  private gainScale(speed: number): number {
    const u = Math.max(0.5, Math.abs(speed));
    return Math.min(this.tuning.maxGainScale, (this.tuning.scheduleSpeed / u) ** 2);
  }

  /** Stern planes command [rad], positive = dive. */
  planes(targetDepth: number, s: AutopilotInput, dt: number): number {
    // Deeper target → positive error → bow down → negative pitch reference.
    const pitchRef = -this.depthPid.update(targetDepth - s.depth, s.depthRate, dt);
    // Pitch above reference → planes dive (positive).
    return this.pitchPid.update(s.pitch - pitchRef, -s.pitchRate, dt, 0, this.gainScale(s.speed));
  }

  /** Rudder command [rad], positive = starboard. */
  rudder(targetHeading: number, s: AutopilotInput, dt: number): number {
    return this.headingPid.update(wrapAngle(targetHeading - s.heading), s.yawRate, dt, 0, this.gainScale(s.speed));
  }

  /** Shaft speed command [rev/s] around a feed-forward value. */
  rps(targetSpeed: number, feedForward: number, s: AutopilotInput, dt: number): number {
    return feedForward + this.speedPid.update(targetSpeed - s.speed, 0, dt);
  }
}
