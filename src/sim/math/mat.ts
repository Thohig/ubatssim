import type { Vec3 } from './vec3';

/** Row-major 3x3 matrix. */
export type Mat3 = [number, number, number, number, number, number, number, number, number];

export const mat3Diag = (a: number, b: number, c: number): Mat3 => [a, 0, 0, 0, b, 0, 0, 0, c];

export function mat3MulVec(m: Mat3, v: Vec3): Vec3 {
  return [
    m[0] * v[0] + m[1] * v[1] + m[2] * v[2],
    m[3] * v[0] + m[4] * v[1] + m[5] * v[2],
    m[6] * v[0] + m[7] * v[1] + m[8] * v[2],
  ];
}

export function mat3TransposeMulVec(m: Mat3, v: Vec3): Vec3 {
  return [
    m[0] * v[0] + m[3] * v[1] + m[6] * v[2],
    m[1] * v[0] + m[4] * v[1] + m[7] * v[2],
    m[2] * v[0] + m[5] * v[1] + m[8] * v[2],
  ];
}

/** Skew-symmetric cross-product matrix S(a) so that S(a) b = a × b. */
export const skew = (a: Vec3): Mat3 => [0, -a[2], a[1], a[2], 0, -a[0], -a[1], a[0], 0];

/** Dense square matrix (row-major) of size n, stored in a Float64Array. */
export class MatN {
  readonly data: Float64Array;
  constructor(readonly n: number, data?: ArrayLike<number>) {
    this.data = new Float64Array(n * n);
    if (data) this.data.set(data);
  }
  get(r: number, c: number): number {
    return this.data[r * this.n + c]!;
  }
  set(r: number, c: number, v: number): void {
    this.data[r * this.n + c] = v;
  }
  addAt(r: number, c: number, v: number): void {
    this.data[r * this.n + c]! += v;
  }
  mulVec(v: ArrayLike<number>): Float64Array {
    const out = new Float64Array(this.n);
    for (let r = 0; r < this.n; r++) {
      let s = 0;
      for (let c = 0; c < this.n; c++) s += this.data[r * this.n + c]! * v[c]!;
      out[r] = s;
    }
    return out;
  }
  plus(o: MatN): MatN {
    const m = new MatN(this.n, this.data);
    for (let i = 0; i < m.data.length; i++) m.data[i]! += o.data[i]!;
    return m;
  }
}

/** LU factorisation with partial pivoting, reusable for many right-hand sides. */
export class LU {
  private readonly lu: Float64Array;
  private readonly piv: Int32Array;
  readonly n: number;

  constructor(m: MatN) {
    const n = m.n;
    this.n = n;
    const a = new Float64Array(m.data);
    const piv = new Int32Array(n);
    for (let i = 0; i < n; i++) piv[i] = i;
    for (let k = 0; k < n; k++) {
      let p = k;
      let max = Math.abs(a[k * n + k]!);
      for (let i = k + 1; i < n; i++) {
        const v = Math.abs(a[i * n + k]!);
        if (v > max) {
          max = v;
          p = i;
        }
      }
      if (max === 0) throw new Error('Singular matrix');
      if (p !== k) {
        for (let j = 0; j < n; j++) {
          const t = a[k * n + j]!;
          a[k * n + j] = a[p * n + j]!;
          a[p * n + j] = t;
        }
        const t = piv[k]!;
        piv[k] = piv[p]!;
        piv[p] = t;
      }
      const d = a[k * n + k]!;
      for (let i = k + 1; i < n; i++) {
        const f = (a[i * n + k]! /= d);
        for (let j = k + 1; j < n; j++) a[i * n + j]! -= f * a[k * n + j]!;
      }
    }
    this.lu = a;
    this.piv = piv;
  }

  solve(b: ArrayLike<number>): Float64Array {
    const n = this.n;
    const a = this.lu;
    const x = new Float64Array(n);
    for (let i = 0; i < n; i++) x[i] = b[this.piv[i]!]!;
    for (let i = 0; i < n; i++) for (let j = 0; j < i; j++) x[i]! -= a[i * n + j]! * x[j]!;
    for (let i = n - 1; i >= 0; i--) {
      for (let j = i + 1; j < n; j++) x[i]! -= a[i * n + j]! * x[j]!;
      x[i]! /= a[i * n + i]!;
    }
    return x;
  }
}
