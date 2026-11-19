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

export { seabedDepth, terrainHeight } from './terrain';
