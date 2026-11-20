import { describe, expect, it } from 'vitest';
import { createPacked, elevationFromPacked, packWaves } from '../src/render/waveShader';
import { SEA_STATES } from '../src/sim/config/seaStates';
import { waveComponents, waveElevation } from '../src/sim/waves';

describe('GPU waves', () => {
  it('the shader formula gives the physics\' surface, also far away and after a long time', () => {
    const comps = waveComponents(SEA_STATES.rough);
    const p = createPacked();
    for (const [n0, e0, t] of [[0, 0, 0], [4000, -2500, 1234.5], [-9000, 12000, 7200]] as const) {
      packWaves(comps, n0, e0, t, p);
      for (let i = 0; i < 50; i++) {
        const dn = ((i * 37) % 560) - 280;
        const de = ((i * 53) % 560) - 280;
        // Float32 parameters, as on the GPU: agreement to a few millimetres.
        expect(Math.abs(elevationFromPacked(p, dn, de) - waveElevation(comps, n0 + dn, e0 + de, t))).toBeLessThan(0.005);
      }
    }
  });

  it('a calm sea packs to nothing', () => {
    const p = packWaves([], 0, 0, 0, createPacked());
    expect(p.count).toBe(0);
    expect(elevationFromPacked(p, 10, 20)).toBe(0);
  });
});
