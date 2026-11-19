/**
 * Contact between the hull and the sea bed or land (grounding).
 *
 * The hull is sampled at points around a number of stations plus the sail
 * top, bow and stern. A point below the ground surface gets a penalty force
 * along the ground's outward normal (spring + damper) and Coulomb friction
 * against its sliding velocity. The ground is a height field given as sea
 * bed depth d(north, east), so the outward normal is ∝ (∂d/∂n, ∂d/∂e, −1).
 */
import type { SubmarineConfig } from './config/submarine';
import { hullRadius } from './hull';
import { mat3MulVec, mat3TransposeMulVec, type Mat3 } from './math/mat';
import { cross, type Vec3 } from './math/vec3';

export type GroundDepth = (north: number, east: number) => number;

export interface ContactResult {
  tau: Float64Array;
  /** Number of points in contact. */
  points: number;
  /** Largest penetration [m]. */
  penetration: number;
  /** Total normal force [N]. */
  normalForce: number;
}

export function hullContactPoints(cfg: SubmarineConfig): Vec3[] {
  const pts: Vec3[] = [];
  const L = cfg.hull.length;
  for (let i = 0; i <= 12; i++) {
    const x = -L / 2 + 1.5 + ((L - 3) * i) / 12;
    const r = hullRadius(cfg.hull, x);
    if (r < 0.2) continue;
    pts.push([x, 0, r], [x, 0, -r], [x, r, 0], [x, -r, 0], [x, 0.7 * r, 0.7 * r], [x, -0.7 * r, 0.7 * r]);
  }
  const s = cfg.hull.sail;
  const top = s.position[2] - s.height / 2;
  pts.push([s.position[0] + s.length / 2, 0, top], [s.position[0] - s.length / 2, 0, top]);
  pts.push([L / 2, 0, 0], [-L / 2, 0, 0]);
  return pts;
}

export function contactForces(
  points: readonly Vec3[],
  pos: Vec3,
  R: Mat3,
  nu: ArrayLike<number>,
  ground: GroundDepth,
  params: SubmarineConfig['contact'],
): ContactResult {
  const tau = new Float64Array(6);
  let count = 0;
  let maxPen = 0;
  let totalN = 0;
  const vLin: Vec3 = [nu[0]!, nu[1]!, nu[2]!];
  const omega: Vec3 = [nu[3]!, nu[4]!, nu[5]!];
  for (const pb of points) {
    const pw = mat3MulVec(R, pb);
    const n = pos[0] + pw[0];
    const e = pos[1] + pw[1];
    const z = pos[2] + pw[2];
    const d = ground(n, e);
    if (z <= d) continue;

    // Outward normal from the height-field gradient (central differences, 1 m).
    const dn = (ground(n + 1, e) - ground(n - 1, e)) / 2;
    const de = (ground(n, e + 1) - ground(n, e - 1)) / 2;
    const len = Math.hypot(dn, de, 1);
    const nw: Vec3 = [dn / len, de / len, -1 / len];
    const pen = (z - d) / len;

    // Velocity of the contact point in the world frame.
    const vb = cross(omega, pb);
    const vw = mat3MulVec(R, [vLin[0] + vb[0], vLin[1] + vb[1], vLin[2] + vb[2]]);
    const vn = vw[0] * nw[0] + vw[1] * nw[1] + vw[2] * nw[2];
    const fn = Math.max(0, params.stiffness * pen - params.damping * vn);
    if (fn <= 0) continue;
    const vt: Vec3 = [vw[0] - vn * nw[0], vw[1] - vn * nw[1], vw[2] - vn * nw[2]];
    const vtLen = Math.hypot(vt[0], vt[1], vt[2]);
    // Smoothed Coulomb friction (tanh avoids chatter at low sliding speed).
    const ff = vtLen > 1e-9 ? (params.friction * fn * Math.tanh(vtLen / params.frictionSmoothing)) / vtLen : 0;
    const fw: Vec3 = [fn * nw[0] - ff * vt[0], fn * nw[1] - ff * vt[1], fn * nw[2] - ff * vt[2]];
    const fb = mat3TransposeMulVec(R, fw);
    const m = cross(pb, fb);
    tau[0]! += fb[0];
    tau[1]! += fb[1];
    tau[2]! += fb[2];
    tau[3]! += m[0];
    tau[4]! += m[1];
    tau[5]! += m[2];
    count++;
    maxPen = Math.max(maxPen, pen);
    totalN += fn;
  }
  return { tau, points: count, penetration: maxPen, normalForce: totalN };
}
