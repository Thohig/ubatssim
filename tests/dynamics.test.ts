import { describe, expect, it } from 'vitest';
import { ENVIRONMENT } from '../src/sim/config/environment';
import { SUBMARINE } from '../src/sim/config/submarine';
import { lambFactors } from '../src/sim/hydrodynamics';
import { Simulation } from '../src/sim/simulation';
import { IDX } from '../src/sim/rigidBody';

const DEG = Math.PI / 180;
const KN = 1852 / 3600;
const run = (s: Simulation, seconds: number) => {
  for (let i = 0; i < Math.round(seconds / 0.01); i++) s.step();
  return s.telemetry();
};

describe('hydrodynamic coefficients', () => {
  const h = SUBMARINE.hydro;
  const L = SUBMARINE.hull.length;
  const rho = ENVIRONMENT.rhoSurface;
  // Nondimensional mass m' = m / (½ρL³) at neutral buoyancy.
  const sim = new Simulation({ depth: 25, designTrim: true });
  const mPrime = sim.massProperties.mass / (0.5 * rho * L ** 3);

  it('is straight-line stable in the horizontal plane', () => {
    // C_H = Y'v N'r − N'v (Y'r − m') > 0
    expect(h.Yv * h.Nr - h.Nv * (h.Yr - mPrime)).toBeGreaterThan(0);
  });

  it('is straight-line stable in the vertical plane (no hydrostatics)', () => {
    // C_V = Z'w M'q − M'w (Z'q + m') > 0
    expect(h.Zw * h.Mq - h.Mw * (h.Zq + mPrime)).toBeGreaterThan(0);
  });

  it('linear damping is passive (symmetric part positive definite)', () => {
    const pd = (a: number, b: number, c: number) => a > 0 && a * c - b * b > 0;
    expect(pd(-h.Yv, -(h.Yr + h.Nv) / 2, -h.Nr)).toBe(true);
    expect(pd(-h.Zw, -(h.Zq + h.Mw) / 2, -h.Mq)).toBe(true);
  });

  it("Lamb's k-factors match tabulated values for L/D = 10", () => {
    const k = lambFactors(10, 1);
    expect(k.k1).toBeCloseTo(0.021, 3);
    expect(k.k2).toBeCloseTo(0.960, 2);
    expect(k.kRot).toBeCloseTo(0.86, 1);
  });
});

describe('dynamics', () => {
  it('mechanical energy does not grow without propulsion', () => {
    const s = new Simulation({ depth: 25, designTrim: true });
    s.y.set([3, 0.5, 0.3, 0.02, 0.01, 0.02], IDX.NU);
    const BG = SUBMARINE.design.bg;
    const energy = () => {
      const t = s.telemetry();
      const W = t.mass * ENVIRONMENT.g;
      return s.kineticEnergy() + W * BG * (1 - Math.cos(t.roll) * Math.cos(t.pitch));
    };
    let prev = energy();
    const e0 = prev;
    for (let k = 0; k < 120; k++) {
      run(s, 1);
      const e = energy();
      expect(e).toBeLessThanOrEqual(prev + 1e-4 * e0);
      prev = e;
    }
    expect(prev).toBeLessThan(0.5 * e0);
  });

  it('reaches a steady speed at constant shaft speed', () => {
    const s = new Simulation({ depth: 100, designTrim: true });
    s.commands.rps = 2;
    run(s, 400);
    const u1 = s.telemetry().u;
    const u2 = run(s, 20).u;
    expect(Math.abs(u2 - u1)).toBeLessThan(0.01);
    expect(u2).toBeCloseTo(s.rpsForSpeed(u2) > 0 ? u2 : 0, 5);
    expect(s.rpsForSpeed(u2)).toBeCloseTo(2, 1);
  });

  it('has a top speed of about 19 knots', () => {
    const s = new Simulation({ depth: 100, designTrim: true });
    s.commands.rps = SUBMARINE.propulsion.maxRps;
    const t = run(s, 300);
    expect(t.u / KN).toBeGreaterThan(17);
    expect(t.u / KN).toBeLessThan(21);
    expect(t.shaftPower).toBeLessThanOrEqual(SUBMARINE.propulsion.maxPower * 1.001);
  });

  it('turns to starboard with starboard rudder and to port with port rudder', () => {
    for (const sign of [1, -1]) {
      const s = new Simulation({ depth: 100, designTrim: true, speed: 8 * KN });
      s.commands.rudder = sign * 20 * DEG;
      const t = run(s, 60);
      expect(Math.sign(t.r)).toBe(sign);
      const turned = sign > 0 ? t.heading : 2 * Math.PI - t.heading;
      expect(turned).toBeGreaterThan(30 * DEG);
    }
  });

  it('rolls into the turn (sail effect)', () => {
    const s = new Simulation({ depth: 100, designTrim: true, speed: 8 * KN });
    s.commands.rudder = 20 * DEG;
    const t = run(s, 60);
    expect(t.roll).toBeGreaterThan(0.5 * DEG);
  });

  it('pitches bow down and goes deeper with dive planes', () => {
    const s = new Simulation({ depth: 100, designTrim: true, speed: 8 * KN });
    s.commands.sternPlanes = 10 * DEG;
    const t = run(s, 30);
    expect(t.pitch).toBeLessThan(-5 * DEG);
    expect(t.depth).toBeGreaterThan(102);
  });

  it('moves the rudder at the limited slew rate', () => {
    const s = new Simulation({ depth: 50, designTrim: true, speed: 5 });
    s.commands.rudder = 30 * DEG;
    run(s, 1);
    expect(s.actuators.rudder).toBeCloseTo(SUBMARINE.actuators.slewRate, 6);
    run(s, 10);
    expect(s.actuators.rudder).toBeCloseTo(SUBMARINE.actuators.rudderMax, 6);
    s.commands.rudder = 90 * DEG;
    run(s, 2);
    expect(s.actuators.rudder).toBeCloseTo(SUBMARINE.actuators.rudderMax, 6);
  });

  it('slows down when the propeller stops', () => {
    const s = new Simulation({ depth: 100, designTrim: true, speed: 10 });
    s.commands.rps = 0;
    const t = run(s, 100);
    expect(t.u).toBeLessThan(5);
    expect(t.u).toBeGreaterThan(2);
  });
});
