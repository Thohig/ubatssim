import { describe, expect, it } from 'vitest';
import { Controller } from '../src/control/controller';
import { Simulation } from '../src/sim/simulation';

const KN = 1852 / 3600;

/** A boat at 50 m going `kn` knots on the speed autopilot, then a new speed; time to |u| < 0.1 m/s, distance, and the most astern speed in the minute after. */
function stopFrom(kn: number, order: number) {
  const c = new Controller(new Simulation({ area: 'atlantic', depth: 50, designTrim: true, speed: kn * KN }));
  c.crewTakesAll();
  c.submit({ kind: 'setSpeed', knots: kn }, 'keyboard');
  for (let i = 0; i < 500; i++) c.step();
  c.submit({ kind: 'setSpeed', knots: order }, 'keyboard');
  const n0 = c.sim.y[0]!;
  let t = -1;
  let rpsMin = 0;
  for (let i = 0; i < 30000 && t < 0; i++) {
    c.step();
    rpsMin = Math.min(rpsMin, c.sim.commands.rps);
    if (Math.abs(c.sim.kinematics().u) < 0.1) t = i / 100;
  }
  const distance = c.sim.y[0]! - n0;
  let uMin = Infinity;
  for (let i = 0; i < 6000; i++) {
    c.step();
    uMin = Math.min(uMin, c.sim.kinematics().u);
  }
  return { t, distance, uMin, rpsMin, c };
}

describe('Stopp', () => {
  it('backs full as a crew does: from 8 knots stopped within 70 s and 200 m (it took 205 s)', () => {
    const r = stopFrom(8, 0);
    expect(r.t).toBeGreaterThan(0);
    expect(r.t).toBeLessThan(70);
    expect(r.distance).toBeLessThan(200);
    // It does not go on astern: the shaft comes back to zero.
    expect(r.uMin).toBeGreaterThan(-0.3);
  });

  it('while the boat goes ahead the drive may run harder astern than going stern first', () => {
    const r = stopFrom(8, 0);
    const p = r.c.sim.cfg.propulsion;
    expect(r.rpsMin).toBeLessThan(-p.maxRpsAstern - 0.5);
    expect(r.rpsMin).toBeGreaterThanOrEqual(-p.maxRpsBrake - 1e-9);
  });

  it('full speed astern is still limited to the stern-first shaft speed', () => {
    const c = new Controller(new Simulation({ area: 'atlantic', depth: 50, designTrim: true }));
    c.crewTakesAll();
    c.submit({ kind: 'setSpeed', knots: -7 }, 'keyboard');
    for (let i = 0; i < 40000; i++) c.step();
    expect(c.sim.commands.rps).toBeGreaterThanOrEqual(-c.sim.cfg.propulsion.maxRpsAstern - 1e-9);
    expect(c.sim.kinematics().u / KN).toBeGreaterThan(-7.2);
  });
});
