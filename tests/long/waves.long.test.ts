import { describe, expect, it } from 'vitest';
import { Controller } from '../../src/control/controller';
import { Simulation } from '../../src/sim/simulation';

describe('low-pressure blower', () => {
  it('keeps the main ballast dry on the surface in a rough sea while the bridge is manned', () => {
    // Mean water in the main ballast over the last minute of five (it sloshes in and out with the heave).
    const fill = (manned: boolean) => {
      const c = new Controller(new Simulation({ sea: 'rough' }));
      if (!manned) c.submit({ kind: 'bridge', manned: false }, 'console');
      let sum = 0;
      let n = 0;
      for (let i = 0; i < 300 * 100; i++) {
        c.step();
        if (i >= 240 * 100 && i % 50 === 0) {
          sum += c.sim.tanks.reduce((s, t, k) => s + (c.sim.tankDefs[k]!.kind === 'mainBallast' ? t.water : 0), 0);
          n++;
        }
      }
      return sum / n / 220;
    };
    const withBlower = fill(true);
    const without = fill(false);
    // ~0.095 with the pitch moment ∝ u·w (0.079 with U·w; the boat pitches about as much either way).
    expect(withBlower).toBeLessThan(0.11);
    expect(without).toBeGreaterThan(1.6 * withBlower); // without it the waves pump the air out (~0.18)
  });
});
