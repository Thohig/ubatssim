/**
 * Deterministic terrain height field. `terrainHeight` is the height of the
 * ground relative to sea level (positive up); the sea bed depth is its
 * negative. Pure functions only, so the simulation stays deterministic.
 */
import { TERRAIN, type ArchipelagoParams, type FjordParams, type OceanParams, type ShelfParams, type TerrainSpec } from './config/terrain';

/** Integer hash → [0, 1). */
function hash(ix: number, iy: number, seed: number): number {
  let h = (ix * 374761393 + iy * 668265263 + seed * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

const fade = (t: number) => t * t * t * (t * (t * 6 - 15) + 10);

/** 2D gradient noise in roughly [-1, 1]. */
export function noise2(x: number, y: number, seed: number = TERRAIN.seed): number {
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
export function fbm(x: number, y: number, octaves: number, seed: number = TERRAIN.seed): number {
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

/** Height function: ground height relative to sea level [m], positive up, at (north, east) [m]. */
export type HeightFn = (north: number, east: number) => number;

/** Archipelago: open sea in the west, islands, skerries and sounds in the east. */
export function archipelagoHeight(north: number, east: number, T: ArchipelagoParams = TERRAIN): number {
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

/** The west coast archipelago (the original game area). */
export const terrainHeight: HeightFn = (north, east) => archipelagoHeight(north, east, TERRAIN);

/** Fjord running north from the coast, with a sill at the mouth (north = 0). */
export function fjordHeight(north: number, east: number, F: FjordParams): number {
  const centre = F.meanderAmplitude * Math.sin((2 * Math.PI * north) / F.meanderLength) * smoothstep(-500, 1500, north) + 120 * fbm(north / 2500, 0.5, 2, F.seed + 3);
  const x = Math.abs(east - centre);
  // Depth along the fjord: open sea → sill → basin.
  const s = F.sillLength;
  const depthAlong =
    north >= 0
      ? F.sillDepth + (F.basinDepth - F.sillDepth) * smoothstep(s, 4 * s, north)
      : F.sillDepth + (F.seaDepth - F.sillDepth) * smoothstep(s, 4 * s, -north);
  // Cross section: a U-shaped trough between steep mountain sides.
  const W = F.halfWidth * (1 + 0.15 * fbm(north / 900, 7.5, 2, F.seed + 5));
  let h: number;
  if (x < W) {
    const k = x / W;
    h = -depthAlong * Math.pow(1 - k * k, 0.45);
  } else {
    const rise = smoothstep(0, 1, (x - W) / F.mountainRise);
    h = F.mountainHeight * rise * (0.75 + 0.25 * fbm(north / 700, east / 700, 3, F.seed + 7)) + 2;
  }
  // South of the coast the mountains give way to the open sea.
  const land = smoothstep(F.coastNorth - 700, F.coastNorth, north);
  const sea = -F.seaDepth + 15 * fbm(north / 800, east / 800, 3, F.seed + 11);
  h = sea * (1 - land) + h * land;
  return h + 2 * fbm(north / 35, east / 35, 2, F.seed + 13);
}

/** Open ocean: deep and gently undulating. */
export function oceanHeight(north: number, east: number, O: OceanParams): number {
  return -O.depth + O.undulation * fbm(north / 4000, east / 4000, 3, O.seed);
}

/** Floor depth [m] and half width [m] of the shelf's canyon at an east coordinate, or null outside it. */
export function canyonAt(east: number, S: ShelfParams): { floor: number; halfWidth: number; centre: number; cut: number } | null {
  if (east > S.canyonHead + 400 || east < S.canyonMouth - 1500) return null;
  let floor: number;
  let halfWidth: number;
  // Down the slope the canyon keeps cutting into it, less and less towards the mouth.
  let cut = 0;
  if (east >= S.breakEast) {
    const u = Math.min(1, Math.max(0, (S.canyonHead - east) / (S.canyonHead - S.breakEast)));
    floor = S.canyonHeadDepth + (S.canyonBreakDepth - S.canyonHeadDepth) * Math.pow(u, 0.8);
    halfWidth = S.canyonHalfWidthShelf;
    // The head closes off.
    if (east > S.canyonHead) floor = S.canyonHeadDepth - (east - S.canyonHead) * 0.1;
  } else {
    const u = Math.min(1, (S.breakEast - east) / (S.breakEast - S.canyonMouth));
    floor = S.canyonBreakDepth + (S.canyonMouthDepth - S.canyonBreakDepth) * smoothstep(0, 1, u);
    halfWidth = S.canyonHalfWidthShelf + (S.canyonHalfWidthDeep - S.canyonHalfWidthShelf) * u;
    cut = (S.canyonBreakDepth - S.shelfDepth) * Math.pow(1 - u, 0.7);
  }
  const centre = S.canyonNorth + S.canyonMeander * Math.sin((2 * Math.PI * east) / S.canyonMeanderLength) + 200 * fbm(east / 2000, 3.3, 2, S.seed + 11);
  return { floor, halfWidth, centre, cut };
}

/**
 * The shelf edge: shelf, shelf break, slope and deep basin from east to
 * west, a canyon cut into them, seamounts, wrecks, sand waves on the shelf
 * and land far to the east.
 */
export function shelfHeight(north: number, east: number, S: ShelfParams): number {
  // Shelf → slope → basin, the break meandering.
  const warp = S.breakWarp * fbm(north / 6000, east / 6000, 2, S.seed + 3);
  const t = smoothstep(S.breakEast - S.slopeWidth, S.breakEast, east + warp);
  let depth = S.basinDepth + (S.shelfDepth - S.basinDepth) * t;
  depth += 40 * fbm(north / 2500, east / 2500, 3, S.seed + 5) * (1 - 0.7 * t);
  // Gullies down the slope: ridges across it.
  depth += 4 * t * (1 - t) * 70 * fbm(north / 700, east / 2400, 3, S.seed + 7);
  // The shelf rises towards the coast, and the land beyond it.
  const coast = east + 500 * fbm(north / 2200, 1.7, 2, S.seed + 13);
  const r = smoothstep(S.coastEast - 3500, S.coastEast, coast);
  const land = -8 + S.landHeight * smoothstep(S.coastEast, S.coastEast + S.landRise, coast) * (0.65 + 0.35 * fbm(north / 900, east / 900, 4, S.seed + 17));
  let h = -depth * (1 - r) + land * r;
  // Skerries off the coast.
  if (r > 0.3) {
    const sk = Math.max(0, fbm(north / 140, east / 140, 3, S.seed + 19) - 0.25);
    h += (r - 0.3) * 60 * sk;
  }
  // Sand waves on the open shelf.
  const sand = t * (1 - r) * (depth < 260 ? 1 : 0);
  if (sand > 0) {
    const ph = (north * 0.8 + east * 0.6 + 60 * fbm(north / 800, east / 800, 2, S.seed + 23)) / S.sandWaveLength;
    h += S.sandWaveHeight * sand * Math.sin(2 * Math.PI * ph);
  }
  // The canyon.
  const cy = canyonAt(east, S);
  if (cy) {
    const x = Math.abs(north - cy.centre) / cy.halfWidth;
    const shape = 1 - smoothstep(0.3, 1, x);
    const incision = Math.max(0, cy.floor + h, cy.cut);
    // Terraced, rocky walls.
    h -= incision * shape * (1 + 0.06 * fbm(north / 90, east / 90, 2, S.seed + 29));
  }
  // Seamounts.
  for (const m of S.seamounts) {
    const d = Math.hypot(north - m.at[0], east - m.at[1]);
    if (d >= m.radius) continue;
    const s = 1 - d / m.radius;
    const profile = m.flat ? Math.pow(Math.min(1, s * 1.5), 1.2) : Math.pow(s, 1.3);
    const base = -h;
    if (base <= m.top) continue;
    const spurs = 30 * fbm(north / 400, east / 400, 3, S.seed + 31) * profile * (1 - profile) * 4;
    h = Math.max(h, -(base - (base - m.top) * profile) + spurs);
  }
  // Wrecks on the bottom.
  for (const w of S.wrecks) {
    const dn = north - w.at[0];
    const de = east - w.at[1];
    const along = dn * Math.cos(w.heading) + de * Math.sin(w.heading);
    const across = -dn * Math.sin(w.heading) + de * Math.cos(w.heading);
    const a = Math.abs(along) / (w.length / 2);
    const b = Math.abs(across) / (w.beam / 2);
    if (a >= 1 || b >= 1) continue;
    h += w.height * (1 - Math.pow(a, 6)) * Math.sqrt(1 - b * b);
  }
  return h + 2 * fbm(north / 35, east / 35, 2, S.seed + 37);
}

/** The height function for a terrain description. */
export function heightFunction(spec: TerrainSpec): HeightFn {
  switch (spec.kind) {
    case 'shelf':
      return (n, e) => shelfHeight(n, e, spec.params);
    case 'archipelago':
      return spec.params === TERRAIN ? terrainHeight : (n, e) => archipelagoHeight(n, e, spec.params);
    case 'fjord':
      return (n, e) => fjordHeight(n, e, spec.params);
    case 'ocean':
      return (n, e) => oceanHeight(n, e, spec.params);
  }
}
