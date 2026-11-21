/**
 * Hydrodynamic added mass and damping [F21 ch. 6–7].
 */
import type { SubmarineConfig } from './config/submarine';
import type { HullGeometry } from './hull';
import { MatN } from './math/mat';

/**
 * Lamb's k-factors for a prolate spheroid with semi-axes a > b [F21 §6.3.2].
 */
export function lambFactors(a: number, b: number): { k1: number; k2: number; kRot: number } {
  const e = Math.sqrt(1 - (b / a) ** 2);
  const l = Math.log((1 + e) / (1 - e));
  const alpha0 = ((2 * (1 - e * e)) / e ** 3) * (0.5 * l - e);
  const beta0 = 1 / (e * e) - ((1 - e * e) / (2 * e ** 3)) * l;
  const k1 = alpha0 / (2 - alpha0);
  const k2 = beta0 / (2 - beta0);
  const kRot = (e ** 4 * (beta0 - alpha0)) / ((2 - e * e) * (2 * e * e - (2 - e * e) * (beta0 - alpha0)));
  return { k1, k2, kRot };
}

/**
 * Diagonal added-mass matrix M_A (positive entries, added to M_RB).
 * The hull is approximated by a prolate spheroid of the same length and
 * beam, scaled to the actual displaced mass.
 */
export function addedMassMatrix(cfg: SubmarineConfig, hull: HullGeometry, rho: number, dryRollInertia: number): MatN {
  const a = cfg.hull.length / 2;
  const b = cfg.hull.radius;
  const { k1, k2, kRot } = lambFactors(a, b);
  const mf = rho * hull.volume;
  const If = (mf * (a * a + b * b)) / 5;
  const M = new MatN(6);
  M.set(0, 0, k1 * mf);
  M.set(1, 1, k2 * mf);
  M.set(2, 2, k2 * mf);
  M.set(3, 3, cfg.hydro.rollAddedInertiaFraction * dryRollInertia);
  M.set(4, 4, kRot * If);
  M.set(5, 5, kRot * If);
  return M;
}

/**
 * Hull damping forces (linear + quadratic + cross-flow) in body frame.
 * Returned as a generalized force (negative = opposing motion).
 */
export function hullDamping(cfg: SubmarineConfig, hull: HullGeometry, nu: ArrayLike<number>, rho: number): Float64Array {
  const h = cfg.hydro;
  const L = cfg.hull.length;
  const [u, v, w, p, q, r] = [nu[0]!, nu[1]!, nu[2]!, nu[3]!, nu[4]!, nu[5]!];
  const U = Math.hypot(u, v, w);
  const k = 0.5 * rho;
  const L2 = L * L;
  const L3 = L2 * L;
  const L4 = L3 * L;
  const ls = h.lowSpeed;
  // The extra sway and heave damping with way on (config hydro.way): in full from way.speed ahead or astern.
  const wayFade = Math.min(1, (u / h.way.speed) ** 2);
  const Yv = ls.Yv + wayFade * h.way.Yv;
  const Zw = ls.Zw + wayFade * h.way.Zw;
  const tau = new Float64Array(6);

  tau[0] = k * L2 * h.Xuu * u * Math.abs(u) + ls.Xu * u;
  tau[1] = k * L2 * h.Yv * U * v + k * L3 * h.Yr * U * r + Yv * v;
  tau[2] = k * L2 * h.Zw * U * w + k * L3 * h.Zq * U * q + Zw * w;
  tau[3] = k * L4 * h.Kp * U * p + ls.Kp * p + h.Kpp * p * Math.abs(p);
  // The pitch moment from the angle of attack (mostly the Munk moment) goes with u·w, not U·w: it vanishes
  // for a boat rising straight up without way, and changes sign astern. With U·w a boat blowing its
  // ballast with little way pitched bow down however it moved.
  tau[4] = k * L3 * h.Mw * u * w + k * L4 * h.Mq * U * q + ls.Mq * q;
  tau[5] = k * L3 * h.Nv * U * v + k * L4 * h.Nr * U * r + ls.Nr * r;

  // Cross-flow drag integrated along the hull [F21 §6.4].
  for (const sl of hull.slices) {
    const vl = v + sl.x * r;
    const wl = w - sl.x * q;
    const vc = Math.hypot(vl, wl);
    if (vc === 0) continue;
    const c = -k * h.crossFlowCd * 2 * sl.r * sl.dx * vc;
    const dY = c * vl;
    const dZ = c * wl;
    tau[1] += dY;
    tau[2] += dZ;
    tau[4] += -sl.x * dZ;
    tau[5] += sl.x * dY;
  }
  return tau;
}
