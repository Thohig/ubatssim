/**
 * Terrain patch data (heights, normals and vertex colours) as plain
 * arrays, so it can be built in a Web Worker (terrainWorker.ts) or, as a
 * fallback and for the first patch of a session, on the main thread. No
 * Three.js here.
 *
 * Grid layout matches a PlaneGeometry(size, size, seg, seg) rotated −90°
 * about X: vertex k = iy·(seg+1) + ix at local x = −size/2 + ix·cell (east)
 * and z = −size/2 + iy·cell (−north).
 */
import type { TerrainSpec } from '../sim/config/terrain';
import { bottomType } from '../sim/seabed';
import { fbm, type HeightFn } from '../sim/terrain';

type Kind = TerrainSpec['kind'];

export interface PatchRequest {
  size: number;
  segments: number;
  /** Drop applied inside the near patch (far patch only), half width [m]. */
  holeHalf: number;
  /** Centre [north, east] [m]. */
  cn: number;
  ce: number;
  /** The kind of terrain (colours and what grows on it). Default: archipelago. */
  kind?: Kind;
  /** Also place trees and houses on the land (the near patch). */
  scatter?: boolean;
}

export interface PatchData {
  heights: Float32Array;
  normals: Float32Array;
  colors: Float32Array;
  /** Trees: x, y, z (patch-local, Three.js axes) and scale, four numbers each. */
  trees: Float32Array;
  /** Houses: x, y, z, rotation [rad], style (0 cottage, 1 boathouse, 2 white house), five numbers each. */
  houses: Float32Array;
}

/** sRGB hex → linear RGB (as THREE.Color does with colour management on). */
function lin(hex: number): [number, number, number] {
  const f = (c: number) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
  return [f(((hex >> 16) & 255) / 255), f(((hex >> 8) & 255) / 255), f((hex & 255) / 255)];
}

const C = {
  deepMud: lin(0x29332f),
  silt: lin(0x4f5a45),
  sand: lin(0x857a5c),
  wetRock: lin(0x2e2a28),
  lichen: lin(0x1d1b1a),
  granite: lin(0xa38e84),
  graniteLight: lin(0xc0aaa0),
  heather: lin(0x5b6143),
  rockUnder: lin(0x5e5650),
  gravel: lin(0x6b665c),
  pine: lin(0x26341f),
  grass: lin(0x55703c),
  birch: lin(0x667a3f),
  bareRock: lin(0x7e7c77),
  snow: lin(0xe9eef0),
};

type RGB = [number, number, number];
const mix = (a: RGB, b: RGB, t: number, out: RGB): RGB => {
  out[0] = a[0] + (b[0] - a[0]) * t;
  out[1] = a[1] + (b[1] - a[1]) * t;
  out[2] = a[2] + (b[2] - a[2]) * t;
  return out;
};

/**
 * Forest on the land: pine on the larger islands' hollows (archipelago),
 * birch and pine up the slopes of the Norwegian coast (fjord, shelf) below
 * the tree line. The same rule colours the ground and places the trees.
 */
export function forestAt(kind: Kind, h: number, slope: number, n: number, e: number): number {
  if (h < 3 || slope > 0.45) return 0;
  const patch = fbm(n / 220, e / 220, 3, 777);
  if (kind === 'archipelago') return h > 4 && slope < 0.32 ? Math.max(0, Math.min(1, (patch + 0.12) * 2.5)) : 0;
  if (kind === 'fjord' || kind === 'shelf') {
    const line = 180 + 40 * patch;
    if (h > line) return 0;
    return Math.max(0, Math.min(1, (patch + 0.25) * 2)) * Math.min(1, (line - h) / 30);
  }
  return 0;
}

/**
 * Colour by height, slope and the kind of terrain. Under water by the
 * bottom type (sim/seabed.ts): sand and gravel in the shallows and on the
 * shelf, silt and dark mud in the deep, rock where steep. At the water line
 * the black lichen band; above it pink-grey granite with heather and pine
 * (the Swedish archipelagos), or grass, birch and pine, bare rock above the
 * tree line and snow on the tops (the Norwegian coast).
 */
export function colourFor(h: number, slope: number, n: number, e: number, out: RGB, kind: Kind = 'archipelago'): RGB {
  const vary = fbm(n / 60, e / 60, 2, 991);
  if (h > 1.2) {
    if (kind === 'fjord' || kind === 'shelf') {
      if (h > 260 + 30 * vary && slope < 0.5) return mix(C.bareRock, C.snow, Math.min(1, (h - 260 - 30 * vary) / 25), out);
      mix(C.grass, C.bareRock, Math.min(1, Math.max(0, (h - 120) / 140 + slope * 1.2)), out);
    } else {
      mix(C.granite, C.graniteLight, 0.5 + 0.5 * vary, out);
      if (h > 8 && slope < 0.5 && vary < -0.05) mix(out, C.heather, Math.min(1, (-vary - 0.05) * 4), out);
    }
    const f = forestAt(kind, h, slope, n, e);
    if (f > 0) mix(out, kind === 'archipelago' ? C.pine : vary > 0 ? C.birch : C.pine, f * 0.85, out);
    return out;
  }
  if (h > -0.6) return mix(C.lichen, C.wetRock, (h + 0.6) / 1.8, out);
  const d = -h;
  const type = bottomType(kind, h, slope, n, e);
  if (type === 'rock') return mix(C.rockUnder, C.wetRock, Math.min(1, d / 400) * 0.5, out);
  if (type === 'gravel') return mix(C.gravel, C.silt, Math.min(1, d / 200), out);
  if (type === 'sand') return mix(C.sand, C.silt, Math.min(1, d / (kind === 'shelf' ? 400 : 30)), out);
  if (d < 15) mix(C.sand, C.silt, d / 15, out);
  else mix(C.silt, C.deepMud, Math.min(1, (d - 15) / 60), out);
  return out;
}

/** A fixed pseudo-random number in [0, 1) for a world grid cell. */
function cellHash(ix: number, iy: number, salt: number): number {
  let h = (ix * 73856093) ^ (iy * 19349663) ^ (salt * 83492791);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/** Trees and houses this many vertices apart at most (on the world grid, so they stay put when the patch moves). */
const TREE_STRIDE = 3;
const HOUSE_STRIDE = 5;

/**
 * Trees on forest ground and houses on gentle land by the water, in
 * villages. On the world vertex grid with a hash, so a rebuilt patch puts
 * them in the same places.
 */
function scatter(heights: Float32Array, normals: Float32Array, r: PatchRequest, kind: Kind): { trees: Float32Array; houses: Float32Array } {
  const n1 = r.segments + 1;
  const cell = r.size / r.segments;
  const half = r.size / 2;
  const trees: number[] = [];
  const houses: number[] = [];
  const gx0 = Math.round((r.ce - half) / cell);
  const gz0 = Math.round((-r.cn - half) / cell);
  const near = (ix: number, iy: number, reach: number) => {
    for (let dy = -reach; dy <= reach; dy += reach) {
      for (let dx = -reach; dx <= reach; dx += reach) {
        const x = ix + dx;
        const y = iy + dy;
        if (x < 0 || y < 0 || x >= n1 || y >= n1) continue;
        if (heights[y * n1 + x]! < 0) return true;
      }
    }
    return false;
  };
  for (let iy = 1; iy < n1 - 1; iy++) {
    const wy = gz0 + iy;
    for (let ix = 1; ix < n1 - 1; ix++) {
      const wx = gx0 + ix;
      const k = iy * n1 + ix;
      const h = heights[k]!;
      if (h < 0.6) continue;
      const slope = 1 - normals[k * 3 + 1]!;
      const x = -half + ix * cell;
      const z = -half + iy * cell;
      const north = r.cn - z;
      const east = r.ce + x;
      if (wx % TREE_STRIDE === 0 && wy % TREE_STRIDE === 0) {
        const f = forestAt(kind, h, slope, north, east);
        if (f > 0 && cellHash(wx, wy, 1) < f * 0.9) {
          const jx = (cellHash(wx, wy, 2) - 0.5) * cell * 2;
          const jz = (cellHash(wx, wy, 3) - 0.5) * cell * 2;
          trees.push(x + jx, h - 0.3, z + jz, 0.7 + 0.6 * cellHash(wx, wy, 4));
        }
      }
      if (kind !== 'ocean' && wx % HOUSE_STRIDE === 0 && wy % HOUSE_STRIDE === 0 && h < 20 && slope < 0.16) {
        const village = fbm(north / 700, east / 700, 2, 4242);
        const shore = near(ix, iy, 5);
        if (!shore || village < -0.15) continue;
        const p = cellHash(wx, wy, 5);
        if (p > Math.min(0.6, (village + 0.15) * 2.5)) continue;
        // A boathouse right at the water, else a house; on the Norwegian coast some are white.
        const style = h < 3 ? 1 : (kind === 'fjord' || kind === 'shelf') && cellHash(wx, wy, 6) < 0.4 ? 2 : 0;
        houses.push(x, h - 0.2, z, cellHash(wx, wy, 7) * Math.PI, style);
      }
    }
  }
  return { trees: Float32Array.from(trees), houses: Float32Array.from(houses) };
}

export function buildPatch(height: HeightFn, r: PatchRequest): PatchData {
  const kind = r.kind ?? 'archipelago';
  const n1 = r.segments + 1;
  const cell = r.size / r.segments;
  const half = r.size / 2;
  const heights = new Float32Array(n1 * n1);
  for (let iy = 0; iy < n1; iy++) {
    const z = -half + iy * cell;
    for (let ix = 0; ix < n1; ix++) {
      const x = -half + ix * cell;
      let h = height(r.cn - z, r.ce + x);
      if (r.holeHalf > 0 && Math.abs(x) < r.holeHalf && Math.abs(z) < r.holeHalf) h -= 6;
      heights[iy * n1 + ix] = h;
    }
  }
  // Normals from the height grid: (−∂h/∂x, 1, −∂h/∂z), central differences inside, one-sided at the edges.
  const normals = new Float32Array(n1 * n1 * 3);
  const colors = new Float32Array(n1 * n1 * 3);
  const rgb: RGB = [0, 0, 0];
  for (let iy = 0; iy < n1; iy++) {
    for (let ix = 0; ix < n1; ix++) {
      const k = iy * n1 + ix;
      const x0 = Math.max(0, ix - 1);
      const x1 = Math.min(r.segments, ix + 1);
      const z0 = Math.max(0, iy - 1);
      const z1 = Math.min(r.segments, iy + 1);
      const dhdx = (heights[iy * n1 + x1]! - heights[iy * n1 + x0]!) / ((x1 - x0) * cell);
      const dhdz = (heights[z1 * n1 + ix]! - heights[z0 * n1 + ix]!) / ((z1 - z0) * cell);
      const len = Math.hypot(dhdx, 1, dhdz);
      normals[k * 3] = -dhdx / len;
      normals[k * 3 + 1] = 1 / len;
      normals[k * 3 + 2] = -dhdz / len;
      const slope = 1 - 1 / len;
      colourFor(heights[k]!, slope, r.cn - (-half + iy * cell), r.ce + (-half + ix * cell), rgb, kind);
      colors[k * 3] = rgb[0];
      colors[k * 3 + 1] = rgb[1];
      colors[k * 3 + 2] = rgb[2];
    }
  }
  const placed = r.scatter && kind !== 'ocean' ? scatter(heights, normals, r, kind) : { trees: new Float32Array(0), houses: new Float32Array(0) };
  return { heights, normals, colors, ...placed };
}
