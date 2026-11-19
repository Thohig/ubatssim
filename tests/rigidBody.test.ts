import { describe, expect, it } from 'vitest';
import { mat3Diag, mat3MulVec } from '../src/sim/math/mat';
import { quatFromEuler, quatToEuler, quatToMat3, type Quat } from '../src/sim/math/quat';
import { rk4Step } from '../src/sim/rk4';
import {
  IDX,
  RIGID_STATE_SIZE,
  RigidBody,
  getNu,
  getQuat,
  normalizeQuatInState,
  rigidBodyMassMatrix,
} from '../src/sim/rigidBody';

describe('rk4', () => {
  it('is fourth-order accurate on y′ = -y', () => {
    const f = (_t: number, y: Float64Array) => Float64Array.of(-y[0]!);
    const err = (dt: number) => {
      let y: Float64Array = Float64Array.of(1);
      for (let t = 0; t < 1 - 1e-12; t += dt) y = rk4Step(f, t, y, dt);
      return Math.abs(y[0]! - Math.exp(-1));
    };
    const ratio = err(0.1) / err(0.05);
    expect(ratio).toBeGreaterThan(14);
    expect(ratio).toBeLessThan(18);
  });
});

describe('quaternion', () => {
  it('round-trips Euler angles', () => {
    const e = quatToEuler(quatFromEuler(0.1, -0.3, 2.5));
    expect(e[0]).toBeCloseTo(0.1, 12);
    expect(e[1]).toBeCloseTo(-0.3, 12);
    expect(e[2]).toBeCloseTo(2.5, 12);
  });
  it('yaw 90° maps body x to world east', () => {
    const v = mat3MulVec(quatToMat3(quatFromEuler(0, 0, Math.PI / 2)), [1, 0, 0]);
    expect(v[0]).toBeCloseTo(0, 12);
    expect(v[1]).toBeCloseTo(1, 12);
  });
});

function freeBody(cg: [number, number, number] = [0, 0, 0]) {
  const M = rigidBodyMassMatrix({ mass: 1000, cg, inertiaCg: mat3Diag(100, 400, 700) });
  return new RigidBody(M);
}

function simulateFree(body: RigidBody, y0: Float64Array, seconds: number, dt = 0.01) {
  const zero = new Float64Array(6);
  const f = (_t: number, y: Float64Array) => {
    const out = new Float64Array(RIGID_STATE_SIZE);
    body.derivative(y, zero, out);
    return out;
  };
  let y = y0;
  for (let i = 0; i < Math.round(seconds / dt); i++) {
    y = rk4Step(f, i * dt, y, dt);
    normalizeQuatInState(y);
  }
  return y;
}

function initialState(nu: number[]): Float64Array {
  const y = new Float64Array(RIGID_STATE_SIZE);
  y[IDX.QUAT] = 1;
  nu.forEach((v, i) => (y[IDX.NU + i] = v));
  return y;
}

describe('rigid body (torque-free)', () => {
  it('conserves kinetic energy and world angular momentum while tumbling', () => {
    const body = freeBody();
    const y0 = initialState([0, 0, 0, 0.3, 0.05, 0.2]);
    const angMomWorld = (y: Float64Array) => {
      const nu = getNu(y);
      const h = mat3MulVec(mat3Diag(100, 400, 700), [nu[3]!, nu[4]!, nu[5]!]);
      return mat3MulVec(quatToMat3(getQuat(y)), h);
    };
    const e0 = body.kineticEnergy(getNu(y0));
    const h0 = angMomWorld(y0);
    const y1 = simulateFree(body, y0, 60);
    expect(body.kineticEnergy(getNu(y1)) / e0).toBeCloseTo(1, 6);
    const h1 = angMomWorld(y1);
    for (let i = 0; i < 3; i++) expect(h1[i]).toBeCloseTo(h0[i]!, 4);
  });

  it('keeps the quaternion normalised', () => {
    const y = simulateFree(freeBody([0.5, 0, 0.3]), initialState([2, 0.1, 0, 0.2, 0.1, 0.3]), 30);
    const q: Quat = getQuat(y);
    expect(Math.hypot(...q)).toBeCloseTo(1, 12);
  });

  it('moves in a straight line at constant velocity without rotation', () => {
    const y = simulateFree(freeBody(), initialState([3, 0, 0, 0, 0, 0]), 10);
    expect(y[0]).toBeCloseTo(30, 9);
    expect(y[1]).toBeCloseTo(0, 9);
  });

  it('is deterministic', () => {
    const a = simulateFree(freeBody([0.2, 0, 0.4]), initialState([1, 0, 0.1, 0.1, 0.2, 0.3]), 20);
    const b = simulateFree(freeBody([0.2, 0, 0.4]), initialState([1, 0, 0.1, 0.1, 0.2, 0.3]), 20);
    expect(Array.from(a)).toEqual(Array.from(b));
  });
});
