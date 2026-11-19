/**
 * Single propeller with shaft dynamics [P01 §3.7, WB].
 *
 *   2π J ṅ = Q_motor − Q_prop
 *   T = ρD⁴ K_T(J) n|n|,  Q = ρD⁵ K_Q(J) n|n|,  J = V_a/(nD), V_a = u(1−w)
 *
 * With linear K_T = a − bJ the products are written so they stay smooth
 * through n = 0: K_T n|n| = a n|n| − b V_a |n| / D.
 */
import type { SubmarineConfig } from './config/submarine';

export interface PropellerOutput {
  /** Thrust on the hull after thrust deduction [N]. */
  thrust: number;
  /** Hydrodynamic torque on the propeller [Nm]. */
  torque: number;
  /** Motor torque [Nm]. */
  motorTorque: number;
}

export function propellerForces(cfg: SubmarineConfig['propulsion'], n: number, u: number, nCmd: number, rho: number): PropellerOutput {
  const D = cfg.diameter;
  const va = u * (1 - cfg.wake);
  const an = Math.abs(n);
  const T = rho * D ** 4 * (cfg.kt0 * n * an - (cfg.kt1 * va * an) / D);
  const Q = rho * D ** 5 * (cfg.kq0 * n * an - (cfg.kq1 * va * an) / D);
  // Speed-controlled drive: torque feed-forward plus proportional speed loop.
  let Qm = Q + cfg.speedGain * (nCmd - n);
  Qm = Math.max(-cfg.maxTorque, Math.min(cfg.maxTorque, Qm));
  const omega = 2 * Math.PI * an;
  if (omega * Math.abs(Qm) > cfg.maxPower) Qm = (Math.sign(Qm) * cfg.maxPower) / omega;
  return { thrust: (1 - cfg.thrustDeduction) * T, torque: Q, motorTorque: Qm };
}
