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
import { DESIGN_WATER, type WaterProfile } from './config/waters';
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
  water: WaterProfile = DESIGN_WATER,
  /** Wave elevation [m, up] at (north, east); the water line follows it slice by slice. */
  surface?: (north: number, east: number) => number,
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
    // Depth of the slice centre below the local water surface.
    let zc = pos[2] + R[6] * sl.x;
    if (surface) zc += surface(pos[0] + R[0] * sl.x, pos[1] + R[3] * sl.x);
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
    const p = pressureAt(zCentroid, water);
    const v = area * sl.dx * (1 - hullCompressibility * (p - E.pAtm));
    const b = waterDensity(zCentroid, water) * E.g * v;
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

/**
 * Wave-radiation damping of the hull where it cuts the water line (surfaced
 * or awash): a vertical force −c·b·dx·w per slice, with b the water-plane
 * width of the slice and w its vertical speed relative to the water. Gives
 * heave and pitch damping ratios of ~0.2 for the surfaced hull, typical of
 * slender hulls at zero speed. Deep down the hull does not cut the surface
 * and the term vanishes.
 *
 * @param nuR body velocities relative to the water
 * @param c   damping per unit water-plane area [N s/m^3]
 */
export function surfaceDamping(
  hull: HullGeometry,
  pos: Vec3,
  R: Mat3,
  nuR: ArrayLike<number>,
  c: number,
  surface?: (north: number, east: number) => number,
): Float64Array {
  const tau = new Float64Array(6);
  const [u, v, w, , q, r] = [nuR[0]!, nuR[1]!, nuR[2]!, nuR[3]!, nuR[4]!, nuR[5]!];
  for (const sl of hull.slices) {
    let h = pos[2] + R[6] * sl.x;
    if (surface) h += surface(pos[0] + R[0] * sl.x, pos[1] + R[3] * sl.x);
    if (Math.abs(h) >= sl.r) continue;
    const b = 2 * Math.sqrt(sl.r * sl.r - h * h);
    // Vertical (world) speed of the slice centre: body velocity (u, v + r·x, w − q·x).
    const vz = R[6] * u + R[7] * (v + r * sl.x) + R[8] * (w - q * sl.x);
    const fz = -c * b * sl.dx * vz;
    const f: Vec3 = [R[6] * fz, R[7] * fz, R[8] * fz];
    addWrench(tau, f, cross([sl.x, 0, 0], f));
  }
  return tau;
}
