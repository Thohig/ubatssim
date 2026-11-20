/**
 * Deterministic irregular sea: a sum of regular deep-water waves
 * (ω² = g·k) with amplitudes from a Pierson–Moskowitz spectrum, spread in
 * frequency and direction. Fixed phases, so the same sea state gives the
 * same sea every time. Elevation is positive up; the physics, the views
 * and the rendered surface all use these functions.
 */
import { ENVIRONMENT as E } from './config/environment';
import type { SeaState } from './config/seaStates';
import type { Vec3 } from './math/vec3';

export interface WaveComponent {
  /** Amplitude [m], wave number [1/m], angular frequency [rad/s]. */
  a: number;
  k: number;
  omega: number;
  /** Unit direction of travel (north, east). */
  dn: number;
  de: number;
  phase: number;
}

/** Frequencies relative to the peak and direction offsets [rad] of the components. */
const SPREAD: readonly [number, number][] = [
  [0.75, -0.35],
  [0.9, 0.2],
  [1.0, 0],
  [1.1, -0.15],
  [1.25, 0.4],
  [1.45, -0.5],
  [1.7, 0.3],
];

/** Pierson–Moskowitz spectral shape S(ω) ∝ ω⁻⁵ exp(−1.25 (ωp/ω)⁴). */
const pm = (w: number, wp: number) => Math.pow(w, -5) * Math.exp(-1.25 * Math.pow(wp / w, 4));

export function waveComponents(sea: SeaState): WaveComponent[] {
  if (sea.hs <= 0) return [];
  const wp = (2 * Math.PI) / sea.tp;
  const weights = SPREAD.map(([f]) => pm(f * wp, wp));
  const sum = weights.reduce((s, w) => s + w, 0);
  // Hs = 4·σ and σ² = Σ a²/2  →  Σ a² = Hs²/8.
  const total = (sea.hs * sea.hs) / 8;
  return SPREAD.map(([f, dTheta], i) => {
    const omega = f * wp;
    const theta = sea.toward + dTheta;
    return {
      a: Math.sqrt((total * weights[i]!) / sum),
      k: (omega * omega) / E.g,
      omega,
      dn: Math.cos(theta),
      de: Math.sin(theta),
      phase: (i * 2.399963) % (2 * Math.PI), // golden-angle phases: fixed and well spread
    };
  });
}

/** Surface elevation [m, up] at (north, east) and time t. */
export function waveElevation(comps: readonly WaveComponent[], n: number, e: number, t: number): number {
  let h = 0;
  for (const c of comps) h += c.a * Math.cos(c.k * (c.dn * n + c.de * e) - c.omega * t + c.phase);
  return h;
}

/** Orbital velocity of the water [m/s, NED] at (north, east, depth) and time t (linear theory, deep water). */
export function waveVelocity(comps: readonly WaveComponent[], n: number, e: number, depth: number, t: number): Vec3 {
  let vn = 0;
  let ve = 0;
  let vd = 0;
  const d = Math.max(0, depth);
  for (const c of comps) {
    const arg = c.k * (c.dn * n + c.de * e) - c.omega * t + c.phase;
    const amp = c.a * c.omega * Math.exp(-c.k * d);
    const horiz = amp * Math.cos(arg);
    vn += horiz * c.dn;
    ve += horiz * c.de;
    vd -= amp * Math.sin(arg); // up when the surface is rising (sin > 0 ahead of the crest) → negative down
  }
  return [vn, ve, vd];
}

/** Largest possible elevation (sum of amplitudes) [m]. */
export const maxElevation = (comps: readonly WaveComponent[]): number => comps.reduce((s, c) => s + c.a, 0);
