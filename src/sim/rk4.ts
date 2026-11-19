/** Derivative function dy/dt = f(t, y). Must not mutate `y`. */
export type Derivative = (t: number, y: Float64Array) => Float64Array;

/** One classical fourth-order Runge–Kutta step. Returns a new state array. */
export function rk4Step(f: Derivative, t: number, y: Float64Array, dt: number): Float64Array {
  const n = y.length;
  const tmp = new Float64Array(n);
  const k1 = f(t, y);
  for (let i = 0; i < n; i++) tmp[i] = y[i]! + 0.5 * dt * k1[i]!;
  const k2 = f(t + 0.5 * dt, tmp);
  for (let i = 0; i < n; i++) tmp[i] = y[i]! + 0.5 * dt * k2[i]!;
  const k3 = f(t + 0.5 * dt, tmp);
  for (let i = 0; i < n; i++) tmp[i] = y[i]! + dt * k3[i]!;
  const k4 = f(t + dt, tmp);
  const out = new Float64Array(n);
  for (let i = 0; i < n; i++) out[i] = y[i]! + (dt / 6) * (k1[i]! + 2 * k2[i]! + 2 * k3[i]! + k4[i]!);
  return out;
}
