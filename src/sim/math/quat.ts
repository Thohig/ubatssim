import type { Mat3 } from './mat';
import type { Vec3 } from './vec3';

/**
 * Unit quaternion [w, x, y, z] rotating body (FRD) vectors into the world
 * (NED) frame, as in Fossen (2021) ch. 2.
 */
export type Quat = [number, number, number, number];

export const quatIdentity = (): Quat => [1, 0, 0, 0];

export function quatNormalize(q: Quat): Quat {
  const n = Math.hypot(q[0], q[1], q[2], q[3]);
  return [q[0] / n, q[1] / n, q[2] / n, q[3] / n];
}

/** Rotation matrix R(q): body → world. */
export function quatToMat3(q: Quat): Mat3 {
  const [w, x, y, z] = q;
  return [
    1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w),
    2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w),
    2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y),
  ];
}

/** Quaternion from ZYX Euler angles (roll φ, pitch θ, yaw ψ) [rad]. */
export function quatFromEuler(phi: number, theta: number, psi: number): Quat {
  const cr = Math.cos(phi / 2), sr = Math.sin(phi / 2);
  const cp = Math.cos(theta / 2), sp = Math.sin(theta / 2);
  const cy = Math.cos(psi / 2), sy = Math.sin(psi / 2);
  return [
    cr * cp * cy + sr * sp * sy,
    sr * cp * cy - cr * sp * sy,
    cr * sp * cy + sr * cp * sy,
    cr * cp * sy - sr * sp * cy,
  ];
}

/** ZYX Euler angles [φ, θ, ψ] in radians; ψ in (-π, π]. */
export function quatToEuler(q: Quat): Vec3 {
  const [w, x, y, z] = q;
  const phi = Math.atan2(2 * (w * x + y * z), 1 - 2 * (x * x + y * y));
  const s = Math.max(-1, Math.min(1, 2 * (w * y - x * z)));
  const theta = Math.asin(s);
  const psi = Math.atan2(2 * (w * z + x * y), 1 - 2 * (y * y + z * z));
  return [phi, theta, psi];
}

/** Quaternion time derivative q̇ = ½ q ⊗ (0, ω) for body angular rate ω. */
export function quatDerivative(q: Quat, w: Vec3): Quat {
  const [q0, q1, q2, q3] = q;
  const [p, qq, r] = w;
  return [
    0.5 * (-q1 * p - q2 * qq - q3 * r),
    0.5 * (q0 * p - q3 * qq + q2 * r),
    0.5 * (q3 * p + q0 * qq - q1 * r),
    0.5 * (-q2 * p + q1 * qq + q0 * r),
  ];
}
