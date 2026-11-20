import { describe, expect, it } from 'vitest';
import { Controller } from '../../src/control/controller';
import { AREAS } from '../../src/sim/config/areas';
import { Simulation } from '../../src/sim/simulation';

const KN = 1852 / 3600;

describe('current', () => {
  it('a stopped boat drifts with the current and stays at rest relative to the water', () => {
    const sim = new Simulation({ depth: 30, designTrim: true }); // west coast: 0.25 m/s north, decaying over 20 m
    const c = AREAS.westCoast.current.speed * Math.exp(-30 / AREAS.westCoast.current.decay);
    const n0 = sim.y[0]!;
    for (let i = 0; i < 300 * 100; i++) sim.step();
    const t = sim.telemetry();
    expect(Math.abs(t.u)).toBeLessThan(0.01);
    expect(sim.y[0]! - n0).toBeGreaterThan(0.8 * c * 300);
    expect(t.speedOverGround).toBeGreaterThan(0.8 * c);
    expect(t.speedOverGround).toBeLessThan(1.2 * c);
    expect(Math.cos(t.courseOverGround)).toBeGreaterThan(0.95); // drifting north
  });

  it('the log shows speed through the water; over the ground the current adds', () => {
    const run = (area: 'westCoast' | 'fjord', heading: number) => {
      const c = new Controller(new Simulation({ area, heading, speed: 4 * KN, north: area === 'fjord' ? 2000 : 0, east: area === 'fjord' ? 320 : 0 }));
      c.submit({ kind: 'setSpeed', knots: 4 }, 'console');
      c.submit({ kind: 'setHeading', heading: (heading * 180) / Math.PI }, 'console');
      for (let i = 0; i < 300 * 100; i++) c.step();
      return c.sim.telemetry();
    };
    // Fjord: 0.4 m/s outflow to the south at the surface.
    const north = run('fjord', 0);
    expect(north.u / KN).toBeCloseTo(4, 0);
    expect(north.speedOverGround).toBeLessThan(north.u - 0.25);
    const south = run('fjord', Math.PI);
    expect(south.speedOverGround).toBeGreaterThan(south.u + 0.25);
  });

  it('decays with depth', () => {
    const sim = new Simulation({ area: 'fjord', north: 2000, east: 320 });
    const at = (d: number) => Math.hypot(...sim.currentAt([0, 0, d]));
    expect(at(0)).toBeCloseTo(0.4);
    expect(at(30)).toBeLessThan(0.01);
  });

  it('can be switched off', () => {
    const sim = new Simulation({ depth: 30, designTrim: true, current: { speed: 0, toward: 0, decay: 1 } });
    for (let i = 0; i < 100 * 100; i++) sim.step();
    expect(sim.telemetry().speedOverGround).toBeLessThan(0.01);
  });
});
