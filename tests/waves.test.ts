import { describe, expect, it } from 'vitest';
import { Controller } from '../src/control/controller';
import { SEA_STATES } from '../src/sim/config/seaStates';
import { Simulation } from '../src/sim/simulation';
import { maxElevation, waveComponents, waveElevation } from '../src/sim/waves';

const KN = 1852 / 3600;

describe('waves', () => {
  it('have the significant wave height of the sea state', () => {
    for (const sea of [SEA_STATES.moderate, SEA_STATES.rough]) {
      const comps = waveComponents(sea);
      // Hs = 4σ from the time series at a point.
      let s2 = 0;
      const N = 20000;
      for (let i = 0; i < N; i++) s2 += waveElevation(comps, 0, 0, i * 0.2) ** 2;
      expect(4 * Math.sqrt(s2 / N)).toBeCloseTo(sea.hs, 0);
      expect(maxElevation(comps)).toBeGreaterThan(sea.hs / 2);
    }
    expect(waveComponents(SEA_STATES.calm)).toEqual([]);
  });

  it('a surfaced boat heaves and pitches in a rough sea, and lies still in a calm one', () => {
    const motion = (sea: 'calm' | 'rough') => {
      const sim = new Simulation({ sea, current: { speed: 0, toward: 0, decay: 1 } });
      let zMin = Infinity, zMax = -Infinity, pMax = 0;
      for (let i = 0; i < 120 * 100; i++) {
        sim.step();
        if (i > 3000) {
          zMin = Math.min(zMin, sim.y[2]!);
          zMax = Math.max(zMax, sim.y[2]!);
          pMax = Math.max(pMax, Math.abs(sim.kinematics().pitch));
        }
      }
      return { heave: zMax - zMin, pitch: (pMax * 180) / Math.PI };
    };
    const calm = motion('calm');
    const rough = motion('rough');
    expect(calm.heave).toBeLessThan(0.05);
    expect(rough.heave).toBeGreaterThan(0.5);
    expect(rough.pitch).toBeGreaterThan(1);
  });

  it('deep down the sea is not felt', () => {
    const depthSwing = (sea: 'calm' | 'rough') => {
      const c = new Controller(new Simulation({ sea, depth: 60, speed: 5 * KN, neutral: true }));
      c.submit({ kind: 'setDepth', depth: 60 }, 'console');
      c.submit({ kind: 'setSpeed', knots: 5 }, 'console');
      let lo = Infinity, hi = -Infinity;
      for (let i = 0; i < 120 * 100; i++) {
        c.step();
        if (i > 3000) {
          lo = Math.min(lo, c.sim.y[2]!);
          hi = Math.max(hi, c.sim.y[2]!);
        }
      }
      return hi - lo;
    };
    expect(depthSwing('rough')).toBeLessThan(0.3);
  });

  it('wave crests wash over a low periscope in a rough sea', () => {
    // At 14 m the raised head is 1.2 m above the mean water line; crests reach it now and then.
    const sim = new Simulation({ sea: 'rough', depth: 14, neutral: true });
    sim.actuators.periscope = 1;
    let wet = 0;
    let dry = 0;
    for (let i = 0; i < 600; i++) {
      sim.t = i * 0.1; // look at the sea passing the head (the boat held still)
      if (sim.bodyPointDepth(sim.periscopeHead()) > 0) wet++;
      else dry++;
    }
    expect(wet).toBeGreaterThan(0);
    expect(dry).toBeGreaterThan(wet);
  });

  it('is deterministic', () => {
    const run = () => {
      const sim = new Simulation({ sea: 'moderate' });
      for (let i = 0; i < 3000; i++) sim.step();
      return Array.from(sim.y);
    };
    expect(run()).toEqual(run());
  });
});
