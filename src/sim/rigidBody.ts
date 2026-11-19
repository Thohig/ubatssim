/**
 * 6-DOF rigid-body dynamics in Fossen's vectorial form
 *
 *   M ν̇ + C(ν) ν = τ
 *
 * where M = M_RB + M_A and τ collects all external forces (damping,
 * restoring, control). Reference: T. I. Fossen, "Handbook of Marine Craft
 * Hydrodynamics and Motion Control", 2nd ed., Wiley 2021, ch. 2–3 and 6.
 *
 * Frames: world = NED (x north, y east, z down), body = FRD (x forward,
 * y starboard, z down). The body origin CO is on the hull centre line at
 * midships; the centre of gravity CG is given relative to CO.
 */
import { LU, MatN, type Mat3 } from './math/mat';
import { quatDerivative, quatToMat3, type Quat } from './math/quat';
import { cross, type Vec3 } from './math/vec3';
import { mat3MulVec } from './math/mat';

/** Layout of the rigid-body part of the state vector. */
export const IDX = {
  POS: 0, // x, y, z in NED [m]
  QUAT: 3, // w, x, y, z
  NU: 7, // u, v, w [m/s], p, q, r [rad/s] in body frame
} as const;
export const RIGID_STATE_SIZE = 13;

export interface MassProperties {
  /** Total mass [kg]. */
  mass: number;
  /** CG relative to CO in body frame [m]. */
  cg: Vec3;
  /** Inertia tensor about CG in body axes [kg m^2] (row-major 3x3). */
  inertiaCg: Mat3;
}

/** Rigid-body mass matrix M_RB about CO (Fossen eq. 3.44). */
export function rigidBodyMassMatrix(mp: MassProperties): MatN {
  const m = mp.mass;
  const [xg, yg, zg] = mp.cg;
  const M = new MatN(6);
  M.set(0, 0, m);
  M.set(1, 1, m);
  M.set(2, 2, m);
  // Off-diagonal blocks: -m S(r_g) (upper right), m S(r_g) (lower left).
  const S = [0, -zg, yg, zg, 0, -xg, -yg, xg, 0];
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) {
      M.set(r, 3 + c, -m * S[r * 3 + c]!);
      M.set(3 + r, c, m * S[r * 3 + c]!);
    }
  }
  // I_o = I_g - m S(r_g)^2 (parallel-axis theorem).
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) {
      let s2 = 0;
      for (let k = 0; k < 3; k++) s2 += S[r * 3 + k]! * S[k * 3 + c]!;
      M.set(3 + r, 3 + c, mp.inertiaCg[r * 3 + c]! - m * s2);
    }
  }
  return M;
}

/**
 * C(ν)ν for any symmetric positive definite 6x6 M, using the Kirchhoff
 * parametrisation (Fossen Thm. 3.2):
 *
 *   C(ν)ν = [ ν2 × (M11 ν1 + M12 ν2) ;
 *             ν2 × (M21 ν1 + M22 ν2) + ν1 × (M11 ν1 + M12 ν2) ]
 *
 * C is skew-symmetric, so νᵀ C ν = 0: it never adds or removes energy.
 * Applied to M_RB + M_A it yields both C_RB and C_A (incl. the Munk moment).
 */
export function coriolisTimesNu(M: MatN, nu: ArrayLike<number>): Float64Array {
  const Mnu = M.mulVec(nu);
  const nu1: Vec3 = [nu[0]!, nu[1]!, nu[2]!];
  const nu2: Vec3 = [nu[3]!, nu[4]!, nu[5]!];
  const a: Vec3 = [Mnu[0]!, Mnu[1]!, Mnu[2]!];
  const b: Vec3 = [Mnu[3]!, Mnu[4]!, Mnu[5]!];
  const f = cross(nu2, a);
  const m = cross(nu2, b);
  const m2 = cross(nu1, a);
  return new Float64Array([f[0], f[1], f[2], m[0] + m2[0], m[1] + m2[1], m[2] + m2[2]]);
}

/** Read helpers for a state vector. */
export const getPos = (y: ArrayLike<number>): Vec3 => [y[0]!, y[1]!, y[2]!];
export const getQuat = (y: ArrayLike<number>): Quat => [y[3]!, y[4]!, y[5]!, y[6]!];
export const getNu = (y: ArrayLike<number>): Float64Array =>
  Float64Array.from({ length: 6 }, (_, i) => y[IDX.NU + i]!);

/** External generalized force in the body frame (6-vector) at state y. */
export type BodyForce = (t: number, y: Float64Array) => ArrayLike<number>;

/**
 * Builds the rigid-body part of the derivative. M is factorised once and
 * reused, because mass properties are frozen during an integration step.
 */
export class RigidBody {
  private readonly lu: LU;
  constructor(readonly M: MatN) {
    this.lu = new LU(M);
  }

  /** Writes d/dt of the 13 rigid-body states into `out`. */
  derivative(y: Float64Array, tau: ArrayLike<number>, out: Float64Array): void {
    const q = getQuat(y);
    const nu = getNu(y);
    const R = quatToMat3(q);
    const vWorld = mat3MulVec(R, [nu[0]!, nu[1]!, nu[2]!]);
    out[0] = vWorld[0];
    out[1] = vWorld[1];
    out[2] = vWorld[2];
    const qd = quatDerivative(q, [nu[3]!, nu[4]!, nu[5]!]);
    out[3] = qd[0];
    out[4] = qd[1];
    out[5] = qd[2];
    out[6] = qd[3];
    const Cnu = coriolisTimesNu(this.M, nu);
    const rhs = new Float64Array(6);
    for (let i = 0; i < 6; i++) rhs[i] = tau[i]! - Cnu[i]!;
    const nuDot = this.lu.solve(rhs);
    for (let i = 0; i < 6; i++) out[IDX.NU + i] = nuDot[i]!;
  }

  /** Kinetic energy ½ νᵀ M ν [J]. */
  kineticEnergy(nu: ArrayLike<number>): number {
    const Mnu = this.M.mulVec(nu);
    let e = 0;
    for (let i = 0; i < 6; i++) e += nu[i]! * Mnu[i]!;
    return 0.5 * e;
  }
}

/** Renormalises the quaternion part of a state vector in place. */
export function normalizeQuatInState(y: Float64Array): void {
  const n = Math.hypot(y[3]!, y[4]!, y[5]!, y[6]!);
  y[3]! /= n;
  y[4]! /= n;
  y[5]! /= n;
  y[6]! /= n;
}
