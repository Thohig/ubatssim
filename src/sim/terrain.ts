/**
 * Deterministic terrain height field. `terrainHeight` is the height of the
 * ground relative to sea level (positive up); the sea bed depth is its
 * negative. Pure functions only, so the simulation stays deterministic.
 */
import { TERRAIN as T } from './config/terrain';

/** Integer hash → [0, 1). */
function hash(ix: number, iy: number, seed: number): number {
  let h = (ix * 374761393 + iy * 668265263 + seed * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

const fade = (t: number) => t * t * t * (t * (t * 6 - 15) + 10);

/** 2D gradient noise in roughly [-1, 1]. */
export function noise2(x: number, y: number, seed: number = T.seed): number {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = x - x0;
  const fy = y - y0;
  const grad = (ix: number, iy: number, dx: number, dy: number) => {
    const a = hash(ix, iy, seed) * Math.PI * 2;
    return Math.cos(a) * dx + Math.sin(a) * dy;
  };
  const n00 = grad(x0, y0, fx, fy);
  const n10 = grad(x0 + 1, y0, fx - 1, fy);
  const n01 = grad(x0, y0 + 1, fx, fy - 1);
  const n11 = grad(x0 + 1, y0 + 1, fx - 1, fy - 1);
  const u = fade(fx);
  const v = fade(fy);
  return 1.4 * ((n00 * (1 - u) + n10 * u) * (1 - v) + (n01 * (1 - u) + n11 * u) * v);
}

/** Fractal noise: `octaves` layers, each double frequency and half amplitude. Range ≈ [-1, 1]. */
export function fbm(x: number, y: number, octaves: number, seed: number = T.seed): number {
  let sum = 0;
  let amp = 0.5;
  let freq = 1;
  let norm = 0;
  for (let i = 0; i < octaves; i++) {
    sum += amp * noise2(x * freq, y * freq, seed + i * 101);
    norm += amp;
    amp *= 0.5;
    freq *= 2.03;
  }
  return sum / norm;
}

const smoothstep = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** Ground height relative to sea level [m], positive up, at (north, east) [m]. */
export function terrainHeight(north: number, east: number): number {
  // Large-scale shelf: deep in the west, shallow in the archipelago.
  const shelf = smoothstep(T.offshoreEast, T.archipelagoEast, east + 250 * fbm(north / 3000, east / 3000, 2, T.seed + 7));
  let depth = T.offshoreDepth + Math.max(0, T.offshoreEast - east) * T.offshoreSlope;
  depth = depth * (1 - shelf) + T.archipelagoDepth * shelf;
  // Gentle undulation of the open sea bed.
  depth += 12 * fbm(north / 900, east / 900, 3, T.seed + 3) * (1 - 0.5 * shelf);

  // Islands: rounded granite domes. Squaring a positive noise lobe gives
  // the smooth, whaleback shapes of glacially polished rock.
  const islands = smoothstep(T.islandsStart, T.islandsFull, east);
  let h = -depth;
  if (islands > 0) {
    const s = T.islandScale;
    const n = fbm(north / s, east / s, 5, T.seed + 11);
    const dome = Math.max(0, n + T.islandBias);
    h += islands * T.islandAmplitude * dome * dome * 2.2;
    // Small skerries scattered between the islands.
    const sk = Math.max(0, fbm(north / T.skerryScale, east / T.skerryScale, 3, T.seed + 17) - 0.18);
    h += islands * T.skerryHeight * sk * 4;

    // Fracture-valley sounds running roughly north–south.
    const c = Math.cos(T.soundStrike);
    const sn = Math.sin(T.soundStrike);
    const u = east * c - north * sn + T.soundWarp * fbm(north / 1500, east / 1500, 3, T.seed + 23);
    const k = Math.sin((Math.PI * u) / T.soundSpacing);
    // Sounds vary in depth along their length, so they do not read as stripes.
    const along = 0.8 + 0.2 * fbm(north / 600, east / 600, 2, T.seed + 29);
    h -= islands * T.soundDepth * along * Math.exp(-(k * k) / T.soundWidth);
  }

  // Rock and sea bed roughness.
  h += T.roughness * fbm(north / 35, east / 35, 2, T.seed + 31);
  // Keep the hills modest: compress heights above the knee.
  if (h > T.peakKnee) h = T.peakKnee + (h - T.peakKnee) * T.peakCompression;
  return h;
}

/** Sea bed depth [m], positive down; negative where there is land. */
export const seabedDepth = (north: number, east: number): number => -terrainHeight(north, east);
