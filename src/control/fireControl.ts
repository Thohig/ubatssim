/**
 * Fire control: targets and target motion analysis. The tubes are in the
 * torpedo room (torpedoRoom.ts).
 *
 * A target (M1, M2 …) is a vessel the player has marked: through the
 * periscope or from the bridge (a precise bearing, ±0.3°) or from a sonar
 * contact (bearings every 10 s, ±1°). Ranges come from the stadimeter in the
 * periscope (error 8 % at 1.5×, 3 % at 6×) or are typed in.
 *
 * The solution — the target's position and velocity — is a weighted least
 * squares fit of a straight course to all observations (the pseudo-linear
 * estimator): a bearing b says (n − n_own)·sin b − (e − e_own)·cos b = 0,
 * linear in the unknowns. Bearings alone give the range only after the boat
 * has changed course (a second leg); a weak prior on the speed and range
 * keeps the fit solvable before that, with a poor quality. The quality
 * comes from the fit's covariance.
 *
 * Firing aims at the intercept point of the solution; the torpedo's seeker
 * wakes `seekBefore` metres short of it. Deterministic: measurement errors
 * are fixed functions of time.
 */
import { WEAPONS } from '../sim/config/weapons';
import { interceptTime } from '../sim/torpedo';
import type { Vessel } from '../sim/vessel';
import type { Controller } from './controller';
import { TorpedoRoom, type Tube } from './torpedoRoom';

export type { Tube } from './torpedoRoom';

const DEG = Math.PI / 180;
/** Seconds between sonar bearings added to a target. */
const SONAR_EVERY = 10;
/** Bearing errors [rad]: periscope or bridge, and sonar. */
const SIGMA_PERISCOPE = 0.3 * DEG;
const SIGMA_SONAR = 1 * DEG;
/** Stadimeter error (fraction of the range) at each periscope magnification, and by eye from the bridge. */
export const STADIMETER_ERROR = [0.08, 0.03] as const;
const EYE_ERROR = 0.12;
/** The crew's fire controller ranges a target in sight this often [s]. */
const CREW_RANGE_EVERY = 30;
/**
 * Observations kept per target. When there are more, the most crowded
 * bearing (the one closest in time to both its neighbours) goes, not the
 * oldest: the first leg of a bearings-only analysis must stay, or the
 * range is lost again ten minutes after the course change.
 */
const MAX_OBS = 60;
/** Own course change [rad] that gives a second leg for bearings-only ranging. */
const LEG_CHANGE = 25 * DEG;
/** Least distance [m] between two own positions for their direction to count as a course. */
const LEG_MIN_RUN = 100;
/** Vessels in sight within this range [m] (as the chart). */
export const SIGHT_RANGE = 8000;

export interface Observation {
  t: number;
  own: [number, number];
  /** True bearing [rad]. */
  bearing: number;
  sigma: number;
  /** Measured range [m] and its error (fraction), if ranged. */
  range?: number;
  rangeError?: number;
}

export type Quality = 'dålig' | 'ok' | 'bra';

export interface Solution {
  /** Position [north, east] at time `t`, velocity [m/s] (north, east). */
  t: number;
  position: [number, number];
  velocity: [number, number];
  /** Standard deviations of the position [m] and speed [m/s]. */
  positionError: number;
  speedError: number;
  quality: Quality;
}

export interface Target {
  label: string;
  vesselId: string;
  name: string;
  obs: Observation[];
  solution: Solution | null;
}

/**
 * Index of the observation to drop from a full list: the unranged one with
 * the least time between its neighbours (never the first or the last).
 */
export function crowdedObservation(obs: readonly Observation[]): number {
  let best = 1;
  let gap = Infinity;
  for (let i = 1; i < obs.length - 1; i++) {
    if (obs[i]!.range !== undefined) continue;
    const g = obs[i + 1]!.t - obs[i - 1]!.t;
    if (g < gap) {
      gap = g;
      best = i;
    }
  }
  return best;
}

/** True when the own track during the observations has two legs (a course change of `LEG_CHANGE` or more). */
export function hasSecondLeg(obs: readonly Observation[]): boolean {
  const courses: number[] = [];
  let from = obs[0]?.own;
  for (const o of obs) {
    if (!from) break;
    const dn = o.own[0] - from[0];
    const de = o.own[1] - from[1];
    if (Math.hypot(dn, de) < LEG_MIN_RUN) continue;
    courses.push(Math.atan2(de, dn));
    from = o.own;
  }
  const diff = (a: number, b: number) => Math.abs(((a - b + 3 * Math.PI) % (2 * Math.PI)) - Math.PI);
  return courses.some((a) => courses.some((b) => diff(a, b) >= LEG_CHANGE));
}

/** A bearings-only solution closer than this [m] is the degenerate one along the boat's own track. */
const BEARINGS_MIN_RANGE = 500;
/** Two legs (`twoLegs`): each at least this long [s], courses this far apart [rad]. */
const LEG_TIME = 120;
const LEG_TURN = 30 * DEG;
/** …and the farthest range searched [m] (beyond what a sonar hears a ship). */
const BEARINGS_MAX_RANGE = 30000;

/** A fixed pseudo-random value in −1…1 from a time and a key (deterministic measurement noise). */
const noise = (t: number, key: number) => Math.sin(t * 1.31 + key * 2.17) * Math.cos(t * 0.53 + key);

const wrapPi = (a: number) => {
  let x = (a + Math.PI) % (2 * Math.PI);
  if (x < 0) x += 2 * Math.PI;
  return x - Math.PI;
};

/** Solves A·x = b for a small dense system (Gaussian elimination with pivoting); returns null if singular. */
function solve(A: number[][], b: number[]): number[] | null {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]!]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r]![c]!) > Math.abs(M[p]![c]!)) p = r;
    if (Math.abs(M[p]![c]!) < 1e-12) return null;
    [M[c], M[p]] = [M[p]!, M[c]!];
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = M[r]![c]! / M[c]![c]!;
      for (let k = c; k <= n; k++) M[r]![k]! -= f * M[c]![k]!;
    }
  }
  return M.map((row, i) => row[n]! / row[i]!);
}

/**
 * The least-squares course of a target from its observations, referred to
 * the time of the latest one. `rangeGuess` [m] scales the bearing errors to
 * metres (iterated by the caller).
 */
export function fitSolution(obs: readonly Observation[], rangeGuess: number): Solution | null {
  if (obs.length === 0) return null;
  const tr = obs[obs.length - 1]!.t;
  const N: number[][] = [0, 1, 2, 3].map(() => [0, 0, 0, 0]);
  const y = [0, 0, 0, 0];
  const add = (row: number[], value: number, sigma: number) => {
    const w = 1 / (sigma * sigma);
    for (let i = 0; i < 4; i++) {
      y[i]! += w * row[i]! * value;
      for (let j = 0; j < 4; j++) N[i]![j]! += w * row[i]! * row[j]!;
    }
  };
  for (const o of obs) {
    const dt = o.t - tr;
    const s = Math.sin(o.bearing);
    const c = Math.cos(o.bearing);
    // The target lies on the bearing line: perpendicular offset 0 (in metres at the guessed range).
    add([s, -c, s * dt, -c * dt], o.own[0] * s - o.own[1] * c, Math.max(5, rangeGuess * o.sigma));
    if (o.range !== undefined) {
      const sr = Math.max(10, o.range * (o.rangeError ?? 0.05));
      add([1, 0, dt, 0], o.own[0] + o.range * c, sr);
      add([0, 1, 0, dt], o.own[1] + o.range * s, sr);
    }
  }
  // Weak priors: ships go at most ~10 m/s, and with bearings alone the target is somewhere near 5 km out.
  add([0, 0, 1, 0], 0, 8);
  add([0, 0, 0, 1], 0, 8);
  const last = obs[obs.length - 1]!;
  const ranged = obs.some((o) => o.range !== undefined);
  if (!ranged) {
    add([1, 0, 0, 0], last.own[0] + 5000 * Math.cos(last.bearing), 6000);
    add([0, 1, 0, 0], last.own[1] + 5000 * Math.sin(last.bearing), 6000);
  }
  const bo = ranged ? null : alongBearing(obs, tr);
  const x = ranged ? solve(N, y) : bo;
  if (!x) return null;
  // The covariance's diagonal: solve N·c = e_i for each axis.
  const cov = [0, 1, 2, 3].map((i) => solve(N, [0, 1, 2, 3].map((j) => (i === j ? 1 : 0)))?.[i] ?? Infinity);
  const positionError = Math.sqrt(cov[0]! + cov[1]!);
  const speedError = Math.sqrt(cov[2]! + cov[3]!);
  const range = Math.hypot(x[0]! - last.own[0], x[1]! - last.own[1]);
  // Bearings alone are also met by a target that follows the boat's own track: after a turn the fit put it
  // 13–60 m away (true 4–7 km) and called that ok, with a running time of 1 s. No such solution is usable.
  const collapsed = !ranged && range < BEARINGS_MIN_RANGE * 1.1;
  const quality: Quality = collapsed
    ? 'dålig'
    : positionError < Math.max(150, 0.1 * range) && speedError < 1 ? 'bra' : positionError < Math.max(400, 0.25 * range) && speedError < 2.5 ? 'ok' : 'dålig';
  return { t: tr, position: [x[0]!, x[1]!], velocity: [x[2]!, x[3]!], positionError, speedError, quality };
}

/** The bearings-only fit with the target at range `r` [m] on the latest bearing: its state and its cost. */
function bearingFit(obs: readonly Observation[], tr: number, r: number): { x: number[]; J: number } | null {
  const last = obs[obs.length - 1]!;
  const c = Math.cos(last.bearing);
  const s = Math.sin(last.bearing);
  const p = [last.own[0] + r * c, last.own[1] + r * s];
  let v = [0, 0];
  // The velocity from the rows across the bearing lines, each weighted by the candidate's range there
  // (so that they are angles), twice: the ranges depend on the velocity.
  for (let pass = 0; pass < 3; pass++) {
    const A = [
      [1 / (8 * 8), 0],
      [0, 1 / (8 * 8)],
    ]; // weak prior: ships go at most ~10 m/s
    const b = [0, 0];
    for (const o of obs) {
      const dt = o.t - tr;
      const sb = Math.sin(o.bearing);
      const cb = Math.cos(o.bearing);
      const rn = p[0]! + v[0]! * dt - o.own[0];
      const re = p[1]! + v[1]! * dt - o.own[1];
      const range = Math.max(50, Math.hypot(rn, re));
      const w = 1 / (range * o.sigma) ** 2;
      // Offset across the bearing line: sb·(n) − cb·(e) with n = p + v·dt − own.
      const row = [sb * dt, -cb * dt];
      const rhs = -(sb * (p[0]! - o.own[0]) - cb * (p[1]! - o.own[1]));
      for (let i = 0; i < 2; i++) {
        b[i]! += w * row[i]! * rhs;
        for (let j = 0; j < 2; j++) A[i]![j]! += w * row[i]! * row[j]!;
      }
    }
    const nv = solve(A, b);
    if (!nv) return null;
    v = nv;
  }
  let J = (v[0]! * v[0]! + v[1]! * v[1]!) / 64;
  for (const o of obs) {
    const dt = o.t - tr;
    const pred = Math.atan2(p[1]! + v[1]! * dt - o.own[1], p[0]! + v[0]! * dt - o.own[0]);
    J += (wrapPi(pred - o.bearing) / o.sigma) ** 2;
  }
  return { x: [p[0]!, p[1]!, v[0]!, v[1]!], J };
}

/**
 * Bearings alone: the target on the latest bearing line at a range searched from `BEARINGS_MIN_RANGE` out
 * (geometric steps, then refined), with the best velocity for each range, judged by the bearing errors as
 * angles. Solved freely in metres across the bearing lines, the fit favours near ranges (the same angle is
 * fewer metres there) and is met by a target that follows the boat's own track, 13–60 m away.
 */
function alongBearing(obs: readonly Observation[], tr: number): number[] | null {
  const at = (r: number) => bearingFit(obs, tr, r);
  let best: { r: number; x: number[]; J: number } | null = null;
  for (let r = BEARINGS_MIN_RANGE; r <= BEARINGS_MAX_RANGE; r *= 1.06) {
    const f = at(r);
    if (f && (!best || f.J < best.J)) best = { r, ...f };
  }
  if (!best) return null;
  // Refine between the neighbouring steps (golden section).
  let lo = Math.max(BEARINGS_MIN_RANGE, best.r / 1.06);
  let hi = best.r * 1.06;
  for (let i = 0; i < 25; i++) {
    const m1 = hi - (hi - lo) * 0.618;
    const m2 = lo + (hi - lo) * 0.618;
    if ((at(m1)?.J ?? Infinity) < (at(m2)?.J ?? Infinity)) hi = m2;
    else lo = m1;
  }
  return at((lo + hi) / 2)?.x ?? best.x;
}

/**
 * Bearings from two legs: the boat's own track over the observations has two stretches of at least
 * `LEG_TIME` s whose courses differ by at least `LEG_TURN`, which is what gives bearings alone a range at all.
 */
export function twoLegs(obs: readonly Observation[]): boolean {
  const course = (a: Observation, b: Observation) => Math.atan2(b.own[1] - a.own[1], b.own[0] - a.own[0]);
  const legs: number[] = [];
  for (let i = 0, j = 0; i < obs.length; i++) {
    while (j < obs.length && obs[j]!.t - obs[i]!.t < LEG_TIME) j++;
    if (j >= obs.length) break;
    if (Math.hypot(obs[j]!.own[0] - obs[i]!.own[0], obs[j]!.own[1] - obs[i]!.own[1]) < 50) continue;
    legs.push(course(obs[i]!, obs[j]!));
  }
  return legs.some((a) => legs.some((b) => Math.abs(wrapPi(a - b)) >= LEG_TURN));
}

/** A solution moved on to time `t`. */
export function solutionAt(s: Solution, t: number): [number, number] {
  return [s.position[0] + s.velocity[0] * (t - s.t), s.position[1] + s.velocity[1] * (t - s.t)];
}

export class FireControl {
  targets: Target[] = [];
  /** The target the tubes are aimed at (label), or null. */
  current: string | null = null;
  /** The torpedo room: the tubes and the racks. */
  readonly room: TorpedoRoom;
  /** Torpedoes per salvo (1–3). */
  spread = 1;
  private steps = 0;
  private nextLabel = 1;
  private lastCrewRange = -Infinity;
  private lastAdvice = -Infinity;

  constructor(private readonly ctrl: Controller) {
    this.room = new TorpedoRoom(ctrl);
  }

  get tubes(): Tube[] {
    return this.room.tubes;
  }

  /** Torpedoes left in the racks. */
  get reserve(): number {
    return this.room.reserve;
  }

  get target(): Target | null {
    return this.targets.find((x) => x.label === this.current) ?? null;
  }

  /** The vessel behind a target. */
  vessel(t: Target): Vessel | undefined {
    return this.ctrl.world.vessels.find((v) => v.def.id === t.vesselId);
  }

  /** Vessels in sight now (raised periscope above the water or the bridge manned), afloat. */
  inSight(): { vessel: Vessel; bearing: number; range: number }[] {
    const c = this.ctrl;
    const sim = c.sim;
    const lookout = c.bridgeManned || (sim.actuators.periscope > 0.99 && sim.bodyPointDepth(sim.periscopeHead()) < 0);
    if (!lookout) return [];
    return c.world
      .contacts()
      .filter((k) => k.range < SIGHT_RANGE && !k.vessel.state.sinking)
      .map((k) => ({ vessel: k.vessel, bearing: k.bearing, range: k.range }));
  }

  /** Creates (or returns) the target for a vessel and makes it current. */
  targetFor(v: Vessel): Target {
    let t = this.targets.find((x) => x.vesselId === v.def.id);
    if (!t) {
      t = { label: `M${this.nextLabel++}`, vesselId: v.def.id, name: v.def.name, obs: [], solution: null };
      this.targets.push(t);
    }
    this.current = t.label;
    return t;
  }

  private own(): [number, number] {
    return [this.ctrl.sim.y[0]!, this.ctrl.sim.y[1]!];
  }

  /** Adds an observation and solves again. */
  observe(t: Target, o: Omit<Observation, 'own' | 't'>): void {
    t.obs.push({ ...o, t: this.ctrl.sim.t, own: this.own() });
    if (t.obs.length > MAX_OBS) t.obs.splice(crowdedObservation(t.obs), 1);
    this.resolve(t);
  }

  private resolve(t: Target): void {
    let guess = t.solution ? Math.hypot(t.solution.position[0] - this.own()[0], t.solution.position[1] - this.own()[1]) : 3000;
    for (let i = 0; i < 3; i++) {
      const s = fitSolution(t.obs, Math.max(200, guess));
      if (!s) return;
      t.solution = s;
      guess = Math.hypot(s.position[0] - this.own()[0], s.position[1] - this.own()[1]);
    }
  }

  /** The stadimeter: a measured range [m] to a vessel with an error that shrinks with the magnification. */
  stadimeter(v: Vessel, trueRange: number, magnification: number | null): { range: number; error: number } {
    const error = magnification === null ? EYE_ERROR : STADIMETER_ERROR[magnification] ?? STADIMETER_ERROR[0];
    const key = v.def.id.length + v.def.id.charCodeAt(0);
    return { range: trueRange * (1 + error * noise(this.ctrl.sim.t, key)), error };
  }

  /** Where to aim a torpedo now at the current target: gyro course, run to the intercept and its time; null if none. */
  aim(): { course: number; distance: number; time: number; depth: number } | null {
    const t = this.target;
    const s = t?.solution;
    if (!t || !s) return null;
    const now = this.ctrl.sim.t;
    const p = solutionAt(s, now);
    const own = this.own();
    const time = interceptTime(own, p, s.velocity, WEAPONS.torpedo.speed);
    if (time === null) return null;
    const at: [number, number] = [p[0] + s.velocity[0] * time, p[1] + s.velocity[1] * time];
    const distance = Math.hypot(at[0] - own[0], at[1] - own[1]);
    const v = this.vessel(t);
    // Run under the waterline: a little above the keel of the target (or the default depth).
    const depth = v ? Math.max(1.5, Math.min(WEAPONS.torpedo.defaultDepth, v.def.draft * 0.6)) : WEAPONS.torpedo.defaultDepth;
    return { course: (Math.atan2(at[1] - own[1], at[0] - own[0]) + 2 * Math.PI) % (2 * Math.PI), distance, time, depth };
  }

  /** Call once per step: the torpedo room, sonar bearings to targets, the crew's ranging and advice. */
  update(dt: number): void {
    const c = this.ctrl;
    const now = c.sim.t;
    this.room.update(dt);

    if (this.steps++ % Math.round(SONAR_EVERY / dt) !== 0) return;
    for (const t of this.targets) {
      const k = c.sonar.contacts.find((x) => x.vesselId === t.vesselId);
      if (k) this.observe(t, { bearing: k.bearing * DEG, sigma: SIGMA_SONAR });
    }
    // The crew's fire controller ranges the current target through the raised periscope, and gives advice.
    if (c.options.crew.fireControl) {
      const t = this.target;
      const v = t ? this.vessel(t) : undefined;
      const seen = v ? this.inSight().find((x) => x.vessel === v) : undefined;
      if (t && seen && now - this.lastCrewRange >= CREW_RANGE_EVERY) {
        this.lastCrewRange = now;
        const m = this.stadimeter(seen.vessel, seen.range, 1);
        this.observe(t, { bearing: seen.bearing, sigma: SIGMA_PERISCOPE, range: m.range, rangeError: m.error });
      }
      if (t && t.solution && t.solution.quality === 'dålig' && !t.obs.some((o) => o.range !== undefined) && now - this.lastAdvice > 120 && t.obs.length >= 6) {
        this.lastAdvice = now;
        c.addLog(
          hasSecondLeg(t.obs)
            ? `Eldledning: håll kursen några minuter till, så blir lösningen på ${t.label} bättre.`
            : `Eldledning: byt kurs minst 30° och håll den några minuter, så får vi avstånd till ${t.label}.`,
          'info',
        );
      }
    }
  }

  /** The vessel in sight nearest a bearing [rad] (within 2°), or why there is none. */
  findInSight(bearing: number): Vessel | string {
    if (!this.lookout()) return 'Ingen utkik: hissa periskopet eller bemanna bryggan för att markera ett mål.';
    let best: { vessel: Vessel; off: number } | null = null;
    for (const s of this.inSight()) {
      const off = Math.abs(wrapPi(s.bearing - bearing));
      if (off < 2 * DEG && (!best || off < best.off)) best = { vessel: s.vessel, off };
    }
    return best ? best.vessel : 'Inget fartyg i hårkorset.';
  }

  /** Marks the vessel at a bearing seen through the periscope or from the bridge [rad] (check with `findInSight` first). */
  markInSight(bearing: number): Target | null {
    const v = this.findInSight(bearing);
    if (typeof v === 'string') return null;
    const t = this.targetFor(v);
    this.observe(t, { bearing, sigma: SIGMA_PERISCOPE });
    return t;
  }

  private lookout(): boolean {
    const c = this.ctrl;
    const sim = c.sim;
    return c.bridgeManned || (sim.actuators.periscope > 0.99 && sim.bodyPointDepth(sim.periscopeHead()) < 0);
  }
}
