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
import { fbm, type HeightFn } from '../sim/terrain';

export interface PatchRequest {
  size: number;
  segments: number;
  /** Drop applied inside the near patch (far patch only), half width [m]. */
  holeHalf: number;
  /** Centre [north, east] [m]. */
  cn: number;
  ce: number;
}

export interface PatchData {
  heights: Float32Array;
  normals: Float32Array;
  colors: Float32Array;
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
};

type RGB = [number, number, number];
const mix = (a: RGB, b: RGB, t: number, out: RGB): RGB => {
  out[0] = a[0] + (b[0] - a[0]) * t;
  out[1] = a[1] + (b[1] - a[1]) * t;
  out[2] = a[2] + (b[2] - a[2]) * t;
  return out;
};

/**
 * Colour by height and slope: dark mud in deep water, silt and sand in the
 * shallows, the black lichen band at the water line, pink-grey granite
 * above it and heather in hollows on the higher islands.
 */
export function colourFor(h: number, slope: number, n: number, e: number, out: RGB): RGB {
  const vary = fbm(n / 60, e / 60, 2, 991);
  if (h > 1.2) {
    mix(C.granite, C.graniteLight, 0.5 + 0.5 * vary, out);
    if (h > 8 && slope < 0.5 && vary < -0.05) mix(out, C.heather, Math.min(1, (-vary - 0.05) * 4), out);
    return out;
  }
  if (h > -0.6) return mix(C.lichen, C.wetRock, (h + 0.6) / 1.8, out);
  const d = -h;
  if (d < 15) mix(C.sand, C.silt, d / 15, out);
  else mix(C.silt, C.deepMud, Math.min(1, (d - 15) / 60), out);
  if (slope > 0.35) mix(out, C.rockUnder, Math.min(1, (slope - 0.35) * 2.5), out);
  return out;
}

export function buildPatch(height: HeightFn, r: PatchRequest): PatchData {
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
      colourFor(heights[k]!, slope, r.cn - (-half + iy * cell), r.ce + (-half + ix * cell), rgb);
      colors[k * 3] = rgb[0];
      colors[k * 3 + 1] = rgb[1];
      colors[k * 3 + 2] = rgb[2];
    }
  }
  return { heights, normals, colors };
}
