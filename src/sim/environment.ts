import { ENVIRONMENT as E } from './config/environment';
import { DESIGN_WATER, type WaterProfile } from './config/waters';

const smoothstep = (x: number): number => {
  const t = Math.min(1, Math.max(0, x));
  return t * t * (3 - 2 * t);
};

/** ∫₀ᵈ smoothstep((s − top)/(bottom − top)) ds, exact. */
function layerIntegral(d: number, top: number, bottom: number): number {
  if (d <= top) return 0;
  const h = bottom - top;
  if (d >= bottom) return h / 2 + (d - bottom);
  const t = (d - top) / h;
  return h * (t * t * t - (t * t * t * t) / 2);
}

/** Sea water density at depth z [m, positive down] in kg/m^3. */
export function waterDensity(z: number, w: WaterProfile = DESIGN_WATER): number {
  const d = Math.max(0, z);
  const compression = 1 + E.waterCompressibility * w.rhoSurface * E.g * d;
  let rho = w.rhoSurface * compression;
  for (const l of w.layers) rho += l.delta * smoothstep((d - l.top) / (l.bottom - l.top));
  return rho;
}

/** Absolute pressure at depth z [Pa]; atmospheric above the surface. Exact integral of `waterDensity`. */
export function pressureAt(z: number, w: WaterProfile = DESIGN_WATER): number {
  if (z <= 0) return E.pAtm;
  let mass = w.rhoSurface * z + (w.rhoSurface * w.rhoSurface * E.waterCompressibility * E.g * z * z) / 2;
  for (const l of w.layers) mass += l.delta * layerIntegral(z, l.top, l.bottom);
  return E.pAtm + mass * E.g;
}

export { seabedDepth, terrainHeight } from './terrain';
