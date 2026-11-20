import { describe, expect, it } from 'vitest';
import { seabedDepth, terrainHeight } from '../src/sim/terrain';
import { TerrainGrid } from '../src/sim/terrainGrid';

describe('terrain', () => {
  it('is deterministic', () => {
    expect(terrainHeight(123.4, 2890.1)).toBe(terrainHeight(123.4, 2890.1));
  });

  it('is deep open sea in the west and shallower towards the archipelago', () => {
    expect(seabedDepth(0, 0)).toBeGreaterThan(250);
    expect(seabedDepth(0, -3000)).toBeGreaterThan(seabedDepth(0, 0));
    expect(seabedDepth(0, 1500)).toBeLessThan(seabedDepth(0, 0));
  });

  it('has an archipelago with skerries and modest hills in the east', () => {
    let land = 0;
    let total = 0;
    let maxH = -Infinity;
    for (let n = -2000; n <= 2000; n += 25) {
      for (let e = 2600; e <= 4500; e += 25) {
        const h = terrainHeight(n, e);
        total++;
        if (h > 0) land++;
        maxH = Math.max(maxH, h);
      }
    }
    expect(land / total).toBeGreaterThan(0.12);
    expect(land / total).toBeLessThan(0.4);
    expect(maxH).toBeGreaterThan(25);
    expect(maxH).toBeLessThan(60);
  });

  it('the cached grid matches the exact terrain closely', () => {
    const grid = new TerrainGrid(seabedDepth);
    let err = 0;
    let k = 0;
    for (let n = -300; n < 300; n += 7.3) {
      for (let e = 2700; e < 3300; e += 11.1) {
        err += Math.abs(grid.depth(n, e) - seabedDepth(n, e));
        k++;
      }
    }
    expect(err / k).toBeLessThan(0.5);
  });
});

describe('contact quick exit', () => {
  it('gives exactly the same forces as checking every point', async () => {
    const { contactForces, hullContactPoints } = await import('../src/sim/contact');
    const { SUBMARINE } = await import('../src/sim/config/submarine');
    const { quatFromEuler, quatToMat3 } = await import('../src/sim/math/quat');
    const grid = new TerrainGrid(seabedDepth);
    const plain = (n: number, e: number) => grid.depth(n, e); // the same depths, without shallowestIn
    const points = hullContactPoints(SUBMARINE);
    let compared = 0;
    let touching = 0;
    for (let i = 0; i < 400; i++) {
      // Positions over the archipelago and the sounds, at depths around the sea bed.
      const n = -800 + ((i * 97) % 1600);
      const e = 2200 + ((i * 53) % 900);
      const depth = seabedDepth(n, e) - 6 + ((i * 7) % 12);
      const R = quatToMat3(quatFromEuler(0.05 * Math.sin(i), 0.1 * Math.cos(i), i));
      const nu = [1, 0.1, 0.05, 0, 0.01, 0.02];
      const a = contactForces(points, [n, e, depth], R, nu, grid.depth, SUBMARINE.contact);
      const b = contactForces(points, [n, e, depth], R, nu, plain, SUBMARINE.contact);
      expect(Array.from(a.tau)).toEqual(Array.from(b.tau));
      compared++;
      if (b.points > 0) touching++;
    }
    expect(compared).toBe(400);
    expect(touching).toBeGreaterThan(50); // the comparison covers real contacts too
  });
});
