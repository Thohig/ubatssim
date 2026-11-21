/**
 * What the sea bed is made of, and what it does to sound:
 *
 *  - `bottomType`: mud, sand, gravel or rock from the depth, the slope and
 *    the kind of terrain (deterministic). The graphics colour the bottom by
 *    it, and the active sonar's bottom reverberation depends on it: a boat
 *    close above rock is hidden in the bottom's echo, above soft mud hardly.
 *  - `terrainBlocks`: whether the sea bed or land rises between two points
 *    (a straight sound path), which casts an acoustic shadow: a boat deep in
 *    a canyon or behind a seamount is not heard on the other side.
 *
 * Pure functions of the height field.
 */
import { ACOUSTICS as A } from './config/acoustics';
import type { TerrainSpec } from './config/terrain';
import type { GroundDepth } from './contact';
import { fbm, type HeightFn } from './terrain';

export type BottomType = 'mud' | 'sand' | 'gravel' | 'rock';

export const BOTTOM_NAME: Record<BottomType, string> = { mud: 'lera', sand: 'sand', gravel: 'grus', rock: 'berg' };

/**
 * Bottom type at a point with ground height `h` [m, up] and slope (1 − n_up,
 * 0 = flat) on a terrain of a kind. Steep is always rock; then by kind:
 * archipelago and fjord: sand in the shallows, mud in the deep, gravel on
 * the sills; the shelf: sand waves and gravel on the shelf, mud down the
 * slope and in the basin; the open ocean: ooze (mud).
 */
export function bottomType(kind: TerrainSpec['kind'], h: number, slope: number, north: number, east: number): BottomType {
  if (h > -0.5 || slope > 0.3) return 'rock';
  const d = -h;
  const patch = fbm(north / 300, east / 300, 2, 4711);
  if (slope > 0.12) return patch > 0.15 ? 'rock' : 'gravel';
  switch (kind) {
    case 'archipelago':
      return d < 18 ? (patch > 0.3 ? 'gravel' : 'sand') : 'mud';
    case 'fjord':
      return d < 90 ? (patch > 0 ? 'gravel' : 'sand') : 'mud';
    case 'shelf':
      if (d < 260) return patch > 0.25 ? 'gravel' : 'sand';
      return 'mud';
    case 'ocean':
      return 'mud';
  }
}

/** Slope (1 − n_up) of a height field at a point, from central differences `step` metres apart. */
export function slopeAt(height: HeightFn, north: number, east: number, step = 8): number {
  const dn = (height(north + step, east) - height(north - step, east)) / (2 * step);
  const de = (height(north, east + step) - height(north, east - step)) / (2 * step);
  return 1 - 1 / Math.hypot(dn, de, 1);
}

/**
 * How much the bottom's reverberation masks an echo from a target
 * `above` metres over a bottom of a type [dB]: the bottom's backscatter
 * strength over a reference (−45 dB), fading out over `bottomReverbHeight`.
 * 0 higher up (exactly, so nothing changes away from the bottom).
 */
export function bottomMask(type: BottomType, above: number): number {
  if (above >= A.bottomReverbHeight) return 0;
  const k = 1 - Math.max(0, above) / A.bottomReverbHeight;
  return Math.max(0, (A.bottomBackscatter[type] ?? A.bottomReference) - A.bottomReference) * k;
}

/**
 * True if the ground rises above the straight line between two points
 * [north, east, depth] (depth positive down): the sound between them is in
 * the terrain's shadow. Samples every `step` metres; skips the search when
 * the shallowest ground in the box is deeper than both ends.
 */
export function terrainBlocks(ground: GroundDepth, a: readonly [number, number, number], b: readonly [number, number, number], step = 60): boolean {
  const deepest = Math.max(a[2], b[2]);
  if (ground.shallowestIn) {
    const top = ground.shallowestIn(Math.min(a[0], b[0]), Math.max(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[1], b[1]));
    if (top > deepest) return false;
  }
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const n = Math.floor(len / step);
  // The ends themselves are where the source and the receiver are: start and stop one step in.
  for (let i = 1; i < n; i++) {
    const f = i / n;
    const depth = a[2] + (b[2] - a[2]) * f;
    if (ground(a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f) < depth - A.shadowClearance) return true;
  }
  return false;
}
