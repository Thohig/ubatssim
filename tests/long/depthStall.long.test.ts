import { describe, expect, it } from 'vitest';
import { Controller } from '../../src/control/controller';
import { Simulation } from '../../src/sim/simulation';

const KN = 1852 / 3600;

describe('periscope depth at 3 knots with the mast up', () => {
  it('the crew notices the boat hanging 1–2 m off the target and holds the depth (weight or speed)', () => {
    // "Övningsskott": 13 m, 3 knots. With the periscope up the planes cannot hold 13 m at 3 knots;
    // the boat used to hang at 11.5 m with the planes hard down and nobody saying anything.
    const c = new Controller(new Simulation({ area: 'atlantic', depth: 13, speed: 3 * KN, neutral: true, heading: 0 }));
    c.crewTakesAll();
    c.submit({ kind: 'setSpeed', knots: 3 }, 'keyboard');
    c.submit({ kind: 'setDepth', depth: 13 }, 'keyboard');
    c.submit({ kind: 'periscope', up: true }, 'keyboard');
    let lo = Infinity;
    let hi = -Infinity;
    for (let s = 0; s < 1500; s++) {
      for (let i = 0; i < 100; i++) c.step();
      if (s >= 1200) {
        const d = c.sim.kinematics().depth;
        lo = Math.min(lo, d);
        hi = Math.max(hi, d);
      }
    }
    // Either the planes stall and the crew raises the speed, or (since the playtest of November 2026) the
    // compensation makes the boat a little heavy at low speed first (`TrimAssist.slowDepthBias`).
    const boosted = c.log.some((e) => e.text.startsWith('Djuprodren orkar inte vid den här farten. Maskinen ökar till 4 knop'));
    const weighted = c.log.some((e) => /^Kompensera in \d+ liter/.test(e.text));
    expect(boosted || weighted).toBe(true);
    expect(lo).toBeGreaterThan(12);
    expect(hi).toBeLessThan(14);
  });
});
