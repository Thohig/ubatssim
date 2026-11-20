import { describe, expect, it } from 'vitest';
import { Controller } from '../src/control/controller';
import { Simulation } from '../src/sim/simulation';

describe('telemetry cache', () => {
  it('gives exactly the same forces as a fresh evaluation, and follows every change', () => {
    const c = new Controller(new Simulation({ sea: 'moderate', depth: 13, speed: 3, neutral: true }));
    c.submit({ kind: 'periscope', up: true }, 'console');
    c.submit({ kind: 'rudder', angle: 10 }, 'console');
    for (let i = 0; i < 400; i++) {
      c.step();
      if (i % 37 !== 0) continue;
      const a = c.sim.telemetry();
      const b = c.sim.telemetry(); // cached
      const fresh = c.sim.externalForces(c.sim.y);
      expect(b).toEqual(a);
      expect(a.buoyancy).toBe(fresh.hydrostatics.buoyancy);
      expect(a.thrust).toBe(fresh.propThrust);
    }
  });

  it('is refreshed when only the actuators or the time change', () => {
    const sim = new Simulation({ depth: 13, speed: 3, neutral: true, sea: 'rough' });
    const before = sim.telemetry();
    sim.actuators.periscope = 1;
    expect(sim.telemetry().periscope).toBe(1);
    sim.t += 3; // the waves move on
    expect(sim.telemetry().buoyancy).not.toBe(before.buoyancy);
  });
});
