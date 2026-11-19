/**
 * Lifting surfaces: rudder, stern planes and the sail [P01 §3.6].
 *
 * Lift ½ρU²·A·C_L(α) acts normal to the fin. For moving fins the hull
 * coefficients already contain the fixed-fin response to the local flow
 * angle, so only the increment due to the deflection is added:
 *   ΔC_L = C_L(δ + α_f) − C_L(α_f), with α_f clamped to the stall range.
 * The sail is not in the hull coefficients and contributes its full lift.
 * Induced drag C_L²/(π·AR) acts against the axial flow.
 *
 * Sign conventions: positive stern planes = trailing edge down = dive (bow
 * down). Positive rudder = turn to starboard (heading increases).
 */
import type { FinDef } from './config/submarine';
import { cross, type Vec3 } from './math/vec3';

/** Lift coefficient with linear range and a post-stall plateau at 70 % of peak. */
export function liftCoefficient(fin: FinDef, alpha: number): number {
  const a = Math.abs(alpha);
  const sign = Math.sign(alpha);
  if (a <= fin.stallAngle) return fin.liftSlope * alpha;
  const peak = fin.liftSlope * fin.stallAngle;
  // Smooth drop from peak to 70 % over 5° past stall.
  const t = Math.min(1, (a - fin.stallAngle) / 0.0873);
  return sign * peak * (1 - 0.3 * t);
}

export function finForce(fin: FinDef, nu: ArrayLike<number>, delta: number, rho: number): Float64Array {
  const r = fin.position;
  const omega: Vec3 = [nu[3]!, nu[4]!, nu[5]!];
  const rot = cross(omega, r);
  const vf: Vec3 = [nu[0]! + rot[0], nu[1]! + rot[1], nu[2]! + rot[2]];
  const axial = vf[0];
  const normal = fin.orientation === 'horizontal' ? vf[2] : vf[1];
  const U2 = axial * axial + normal * normal;
  const tau = new Float64Array(6);
  if (U2 < 1e-8) return tau;
  const q = 0.5 * rho * U2;
  const alphaFlow = Math.atan2(normal, Math.abs(axial));
  const dir = axial >= 0 ? 1 : -1;

  let cl: number;
  if (fin.actuator === null) {
    cl = liftCoefficient(fin, alphaFlow);
  } else {
    const af = Math.max(-fin.stallAngle, Math.min(fin.stallAngle, alphaFlow));
    cl = liftCoefficient(fin, dir * delta + af) - liftCoefficient(fin, af);
  }
  const normalForce = -q * fin.area * cl;
  const totalCl = fin.actuator === null ? cl : liftCoefficient(fin, dir * delta + alphaFlow);
  const drag = (q * fin.area * totalCl * totalCl) / (Math.PI * fin.aspectRatio);

  const f: Vec3 = fin.orientation === 'horizontal' ? [-dir * drag, 0, normalForce] : [-dir * drag, normalForce, 0];
  const m = cross(r, f);
  tau.set([f[0], f[1], f[2], m[0], m[1], m[2]]);
  return tau;
}
