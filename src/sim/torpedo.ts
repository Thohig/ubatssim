/**
 * Torpedoes: kinematic and deterministic, like the vessels. A torpedo turns
 * from the boat's heading to its gyro course, runs straight to the
 * computed intercept point and then listens ahead (passive homing): a
 * vessel whose noise reaches the seeker within the cone is homed on (pure
 * pursuit). It hits a vessel when inside its hull and shallower than its
 * keel, and is spent after its range. The world (world.ts) steps it.
 */
import { transmissionLoss, vesselSourceLevel } from './acoustics';
import { WEAPONS } from './config/weapons';
import type { WaterProfile } from './config/waters';
import type { Vessel } from './vessel';

const T = WEAPONS.torpedo;

export type TorpedoPhase = 'run' | 'seek' | 'home' | 'done';

export interface TorpedoState {
  id: number;
  north: number;
  east: number;
  depth: number;
  /** Heading [rad, 0..2π]. */
  heading: number;
  speed: number;
  /** Distance run [m]. */
  run: number;
  phase: TorpedoPhase;
  /** The vessel homed on (id), if any. */
  homing: string | null;
  /** How it ended. */
  result: 'hit' | 'miss' | null;
}

export interface TorpedoOrders {
  /** Gyro course [rad] and running depth [m]. */
  course: number;
  depth: number;
  /** Distance [m] after which the seeker listens (the intercept point minus `seekBefore`). */
  seekAfter: number;
}

const wrap = (a: number) => {
  let x = (a + Math.PI) % (2 * Math.PI);
  if (x < 0) x += 2 * Math.PI;
  return x - Math.PI;
};

export class Torpedo {
  readonly state: TorpedoState;

  constructor(
    id: number,
    at: { north: number; east: number; depth: number; heading: number },
    readonly orders: TorpedoOrders,
  ) {
    this.state = { id, ...at, speed: T.speed, run: 0, phase: 'run', homing: null, result: null };
  }

  get armed(): boolean {
    return this.state.run >= T.arming;
  }

  step(dt: number, vessels: readonly Vessel[], water: WaterProfile): void {
    const s = this.state;
    if (s.phase === 'done') return;
    // The seeker: listen ahead once past the point it was told to.
    if (s.phase !== 'run' || s.run >= this.orders.seekAfter) {
      if (s.phase === 'run') s.phase = 'seek';
      const heard = this.listen(vessels, water);
      s.homing = heard ? heard.def.id : null;
      s.phase = heard ? 'home' : 'seek';
    }
    let want = this.orders.course;
    if (s.phase === 'home' && s.homing) {
      const v = vessels.find((x) => x.def.id === s.homing)!;
      want = Math.atan2(v.state.east - s.east, v.state.north - s.north);
    }
    const turn = Math.max(-T.turnRate * dt, Math.min(T.turnRate * dt, wrap(want - s.heading)));
    s.heading = (s.heading + turn + 2 * Math.PI) % (2 * Math.PI);
    s.depth += Math.max(-T.depthRate * dt, Math.min(T.depthRate * dt, this.orders.depth - s.depth));
    s.north += s.speed * Math.cos(s.heading) * dt;
    s.east += s.speed * Math.sin(s.heading) * dt;
    s.run += s.speed * dt;
    if (s.run >= T.range) {
      s.phase = 'done';
      s.result = 'miss';
    }
  }

  /** The loudest vessel in the seeker's cone that it can hear, or null. */
  private listen(vessels: readonly Vessel[], water: WaterProfile): Vessel | null {
    const s = this.state;
    let best: Vessel | null = null;
    let bestExcess = 0;
    for (const v of vessels) {
      if (v.state.sunk >= 1) continue;
      const dn = v.state.north - s.north;
      const de = v.state.east - s.east;
      const range = Math.hypot(dn, de);
      if (Math.abs(wrap(Math.atan2(de, dn) - s.heading)) > T.seekerCone) continue;
      const excess = vesselSourceLevel(v.def, v.state.speed) - transmissionLoss(range, s.depth, 0, water) - T.seekerNoise + T.seekerGain - T.seekerThreshold;
      if (excess > bestExcess) {
        bestExcess = excess;
        best = v;
      }
    }
    return best;
  }

  /** True if the torpedo is inside a vessel's hull below its waterline (and armed). */
  hits(v: Vessel): boolean {
    const s = this.state;
    if (!this.armed || v.state.sunk >= 1) return false;
    if (s.depth > v.def.draft + 0.5) return false; // runs under the keel
    const dn = s.north - v.state.north;
    const de = s.east - v.state.east;
    const along = dn * Math.cos(v.state.heading) + de * Math.sin(v.state.heading);
    const across = -dn * Math.sin(v.state.heading) + de * Math.cos(v.state.heading);
    return Math.abs(along) < v.def.length / 2 && Math.abs(across) < v.def.beam / 2 + 1;
  }
}

/**
 * The intercept: the time [s] when a torpedo from `from` at `speed` meets a
 * target at `p` moving with velocity `v` (north, east), or null if it
 * cannot catch it. Smallest positive root of |p + v·t − from| = speed·t.
 */
export function interceptTime(from: [number, number], p: [number, number], v: [number, number], speed: number): number | null {
  const dx = p[0] - from[0];
  const dy = p[1] - from[1];
  const a = v[0] * v[0] + v[1] * v[1] - speed * speed;
  const b = 2 * (dx * v[0] + dy * v[1]);
  const c = dx * dx + dy * dy;
  if (Math.abs(a) < 1e-9) return b < 0 ? -c / b : null;
  const disc = b * b - 4 * a * c;
  if (disc < 0) return null;
  const r = Math.sqrt(disc);
  const t1 = (-b - r) / (2 * a);
  const t2 = (-b + r) / (2 * a);
  const ts = [t1, t2].filter((t) => t > 0);
  return ts.length ? Math.min(...ts) : null;
}
