/**
 * Restoring forces g(η): gravity at the CG and buoyancy from a strip model.
 *
 * Each hull slice is a circular section. Its submerged area and the
 * centroid of that area are computed exactly for a straight water line in
 * the section plane, so the same code covers surfaced, awash and fully
 * submerged conditions and gives the righting moments in roll and pitch.
 * Water density varies with depth and the hull volume shrinks with pressure.
 */
import { ENVIRONMENT as E } from './config/environment';
import { pressureAt, waterDensity } from './environment';
import type { HullGeometry } from './hull';
import type { Mat3 } from './math/mat';
import { cross, type Vec3 } from './math/vec3';

export interface HydrostaticResult {
  /** Generalized restoring force in body frame (gravity + buoyancy) [N, Nm]. */
  tau: Float64Array;
  /** Buoyant force magnitude [N]. */
  buoyancy: number;
  /** Displaced volume (after compression) [m^3]. */
  displacedVolume: number;
  /** Fraction of the hull volume that is submerged (0..1). */
  submergedFraction: number;
  /** Centre of buoyancy in body frame [m] (meaningful when buoyancy > 0). */
  cb: Vec3;
}

/**
 * Submerged area of a circle (radius r) whose centre lies a signed
 * distance h below a straight water line, and the distance from the centre
 * to the centroid of that submerged area, measured along the downward
 * direction.
 */
export function submergedCircle(r: number, h: number): { area: number; offset: number } {
  const full = Math.PI * r * r;
  if (h >= r) return { area: full, offset: 0 };
  if (h <= -r) return { area: 0, offset: 0 };
  const c = Math.sqrt(r * r - h * h);
  // Dry cap above the water line, at distance h above the centre.
  const capArea = r * r * Math.acos(h / r) - h * c;
  const area = full - capArea;
  // First moment of the cap about the centre is (2/3)c^3 upwards, so the
  // submerged part's centroid sits that much (divided by its area) below.
  const offset = area > 1e-12 ? ((2 / 3) * c * c * c) / area : 0;
  return { area, offset };
}

function addWrench(tau: Float64Array, f: Vec3, m: Vec3): void {
  tau[0]! += f[0];
  tau[1]! += f[1];
  tau[2]! += f[2];
  tau[3]! += m[0];
  tau[4]! += m[1];
  tau[5]! += m[2];
}

/**
 * @param pos  CO position in NED [m]
 * @param R    rotation body→NED (row-major)
 * @param mass total mass [kg]
 * @param cg   CG in body frame [m]
 * @param hullCompressibility [1/Pa]
 */
export function restoringForces(
  hull: HullGeometry,
  pos: Vec3,
  R: Mat3,
  mass: number,
  cg: Vec3,
  hullCompressibility: number,
): HydrostaticResult {
  // World "down" expressed in body axes = third row of R.
  const gb: Vec3 = [R[6], R[7], R[8]];
  const tau = new Float64Array(6);

  // Gravity at CG.
  const W = mass * E.g;
  const fw: Vec3 = [W * gb[0], W * gb[1], W * gb[2]];
  addWrench(tau, fw, cross(cg, fw));

  // Buoyancy, slice by slice.
  const s = Math.hypot(gb[1], gb[2]);
  const uy = s > 1e-9 ? gb[1] / s : 0;
  const uz = s > 1e-9 ? gb[2] / s : 1;
  let B = 0;
  let vol = 0;
  let vol0 = 0;
  const mB: Vec3 = [0, 0, 0];
  for (const sl of hull.slices) {
    const zc = pos[2] + R[6] * sl.x; // depth of the slice centre
    vol0 += Math.PI * sl.r * sl.r * sl.dx;
    let area: number;
    let offset: number;
    if (s > 1e-9) {
      ({ area, offset } = submergedCircle(sl.r, zc / s));
    } else {
      area = zc > 0 ? Math.PI * sl.r * sl.r : 0;
      offset = 0;
    }
    if (area <= 0) continue;
    const ry = offset * uy;
    const rz = offset * uz;
    // Depth of the submerged centroid.
    const zCentroid = zc + gb[1] * ry + gb[2] * rz;
    const p = pressureAt(zCentroid);
    const v = area * sl.dx * (1 - hullCompressibility * (p - E.pAtm));
    const b = waterDensity(zCentroid) * E.g * v;
    vol += v;
    B += b;
    // Buoyancy acts along world up = -gb.
    const f: Vec3 = [-b * gb[0], -b * gb[1], -b * gb[2]];
    addWrench(tau, f, cross([sl.x, ry, rz], f));
    mB[0] += b * sl.x;
    mB[1] += b * ry;
    mB[2] += b * rz;
  }
  const cb: Vec3 = B > 0 ? [mB[0] / B, mB[1] / B, mB[2] / B] : [0, 0, 0];
  return { tau, buoyancy: B, displacedVolume: vol, submergedFraction: vol0 > 0 ? Math.min(1, vol / vol0) : 0, cb };
}
