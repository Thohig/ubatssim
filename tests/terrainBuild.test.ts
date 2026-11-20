import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { buildPatch, colourFor } from '../src/render/terrainBuild';
import { AREAS } from '../src/sim/config/areas';
import { heightFunction } from '../src/sim/terrain';

describe('terrain patch data (worker and main thread)', () => {
  const h = heightFunction(AREAS.westCoast.terrain);
  const req = { size: 400, segments: 50, holeHalf: 0, cn: 120, ce: 2600 };
  const d = buildPatch(h, req);

  it('heights are the physics\' terrain at the vertices', () => {
    const n1 = req.segments + 1;
    const cell = req.size / req.segments;
    for (const [ix, iy] of [[0, 0], [25, 10], [50, 50], [7, 33]] as const) {
      const x = -req.size / 2 + ix * cell;
      const z = -req.size / 2 + iy * cell;
      expect(d.heights[iy * n1 + ix]).toBeCloseTo(h(req.cn - z, req.ce + x), 3);
    }
  });

  it('normals have unit length and point up', () => {
    for (let k = 0; k < d.heights.length; k += 37) {
      const [x, y, z] = [d.normals[k * 3]!, d.normals[k * 3 + 1]!, d.normals[k * 3 + 2]!];
      expect(Math.hypot(x, y, z)).toBeCloseTo(1, 5);
      expect(y).toBeGreaterThan(0);
    }
  });

  it('colours are in the same (linear) space as THREE.Color', () => {
    // Deep, flat sea bed far from the slope rule gives the pure mud colour.
    const rgb = colourFor(-200, 0, 0, 0, [0, 0, 0]);
    const mud = new THREE.Color(0x29332f);
    expect(rgb[0]).toBeCloseTo(mud.r, 5);
    expect(rgb[1]).toBeCloseTo(mud.g, 5);
    expect(rgb[2]).toBeCloseTo(mud.b, 5);
  });
});
