import { ENVIRONMENT as E } from './config/environment';

const smoothstep = (x: number): number => {
  const t = Math.min(1, Math.max(0, x));
  return t * t * (3 - 2 * t);
};

/** Sea water density at depth z [m, positive down] in kg/m^3. */
export function waterDensity(z: number): number {
  const d = Math.max(0, z);
  const compression = 1 + E.waterCompressibility * E.rhoSurface * E.g * d;
  const thermo = E.thermoclineDeltaRho * smoothstep((d - E.thermoclineTop) / (E.thermoclineBottom - E.thermoclineTop));
  return E.rhoSurface * compression + thermo;
}

/** Absolute pressure at depth z [Pa]; atmospheric above the surface. */
export function pressureAt(z: number): number {
  if (z <= 0) return E.pAtm;
  // Trapezoidal mean density; the profile is smooth so this is accurate to <0.01 %.
  return E.pAtm + 0.5 * (E.rhoSurface + waterDensity(z)) * E.g * z;
}

/**
 * Deterministic sea bed depth [m] at world position (north, east), built
 * from a few fixed sinusoids. Used by the renderer now and by grounding
 * detection later.
 */
export function seabedDepth(north: number, east: number): number {
  const x = north / 1000;
  const y = east / 1000;
  const h =
    0.5 * Math.sin(0.9 * x + 0.3) * Math.cos(0.7 * y - 0.5) +
    0.3 * Math.sin(2.3 * x + 1.7 * y + 1.1) +
    0.15 * Math.cos(4.1 * x - 3.3 * y + 0.4) +
    0.05 * Math.sin(9.7 * x + 7.9 * y);
  return E.seabedMeanDepth + E.seabedRelief * h;
}
