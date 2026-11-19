/**
 * The only place that converts between the simulation's NED/FRD frames and
 * Three.js world coordinates (Y up).
 *
 *   NED north → three −Z,  east → three +X,  down → three −Y
 *
 * The submarine model is built in its own local frame with the same
 * mapping applied to body axes (forward → −Z, starboard → +X, down → −Y),
 * so the body→world rotation is C·R·Cᵀ.
 */
import * as THREE from 'three';
import type { Mat3 } from '../sim/math/mat';
import type { Vec3 } from '../sim/math/vec3';

export function nedToThree(p: Vec3, out = new THREE.Vector3()): THREE.Vector3 {
  return out.set(p[1], -p[2], -p[0]);
}

/** Body-frame (FRD) point → model-local Three coordinates. */
export function bodyToLocal(p: Vec3, out = new THREE.Vector3()): THREE.Vector3 {
  return out.set(p[1], -p[2], -p[0]);
}

const C = new THREE.Matrix3().set(0, 1, 0, 0, 0, -1, -1, 0, 0);
const Ct = C.clone().transpose();
const tmp3 = new THREE.Matrix3();
const tmp4 = new THREE.Matrix4();

/** Rotation body→NED (row-major) → Three quaternion for the model. */
export function rotationToThree(R: Mat3, out = new THREE.Quaternion()): THREE.Quaternion {
  tmp3.set(R[0], R[1], R[2], R[3], R[4], R[5], R[6], R[7], R[8]);
  const m = C.clone().multiply(tmp3).multiply(Ct);
  tmp4.setFromMatrix3(m);
  return out.setFromRotationMatrix(tmp4);
}
