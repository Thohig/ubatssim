/**
 * Hull geometry as a body of revolution about body x, discretised into
 * slices for the hydrostatic strip model.
 */
import type { SubmarineConfig } from './config/submarine';

export interface HullSlice {
  /** Slice centre along body x [m]. */
  x: number;
  /** Slice length [m]. */
  dx: number;
  /** Hull radius at slice centre [m]. */
  r: number;
}

export interface HullGeometry {
  slices: HullSlice[];
  /** Enclosed (displaced when submerged) volume at the surface [m^3]. */
  volume: number;
  /** Longitudinal centre of buoyancy when fully submerged [m]. */
  xB: number;
}

/** Hull radius [m] at body x. Elliptic bow, parallel middle body, parabolic tail. */
export function hullRadius(hull: SubmarineConfig['hull'], x: number): number {
  const { length: L, radius: R, noseLength: Ln, tailLength: Lt } = hull;
  const bowStart = L / 2 - Ln;
  const tailStart = -L / 2 + Lt;
  if (x > L / 2 || x < -L / 2) return 0;
  if (x > bowStart) {
    const s = (x - bowStart) / Ln;
    return R * Math.sqrt(Math.max(0, 1 - s * s));
  }
  if (x < tailStart) {
    const s = (tailStart - x) / Lt;
    return R * (1 - s * s);
  }
  return R;
}

export function buildHull(hull: SubmarineConfig['hull']): HullGeometry {
  const n = hull.slices;
  const dx = hull.length / n;
  const slices: HullSlice[] = [];
  let volume = 0;
  let moment = 0;
  for (let i = 0; i < n; i++) {
    const x = -hull.length / 2 + (i + 0.5) * dx;
    const r = hullRadius(hull, x);
    slices.push({ x, dx, r });
    const v = Math.PI * r * r * dx;
    volume += v;
    moment += v * x;
  }
  return { slices, volume, xB: moment / volume };
}
