import { describe, expect, it } from 'vitest';
import { SUBMARINE } from '../src/sim/config/submarine';
import { equilibriumFill } from '../src/sim/airSystem';
import { pressureAt } from '../src/sim/environment';
import { submergedCircle } from '../src/sim/hydrostatics';
import { Controller } from '../src/control/controller';
import { Simulation } from '../src/sim/simulation';

const run = (s: Simulation, seconds: number) => {
  for (let i = 0; i < Math.round(seconds / 0.01); i++) s.step();
  return s.telemetry();
};

describe('hydrostatics', () => {
  it('submerged circle area and centroid are exact at the limits and half-way', () => {
    expect(submergedCircle(2, 3).area).toBeCloseTo(Math.PI * 4, 12);
    expect(submergedCircle(2, -3).area).toBe(0);
    const half = submergedCircle(2, 0);
    expect(half.area).toBeCloseTo(Math.PI * 2, 12);
    expect(half.offset).toBeCloseTo((4 * 2) / (3 * Math.PI), 12); // semicircle centroid 4r/3π
  });

  it('water density and pressure increase with depth', () => {
    expect(pressureAt(100) - pressureAt(0)).toBeGreaterThan(1.0e6);
    expect(pressureAt(100) - pressureAt(0)).toBeLessThan(1.02e6);
  });

  it('a deep boat is fully submerged although the hull is compressed', () => {
    // Below ~166 m the compression alone took the old fraction under 0.999 ("Ytläge" on the trim instrument).
    const t = new Simulation({ depth: 250, designTrim: true }).telemetry();
    expect(t.submergedFraction).toBe(1);
  });
});

describe('mass properties from tanks', () => {
  it('total mass is dry mass plus tank water', () => {
    const s = new Simulation();
    const water = s.tanks.reduce((a, t) => a + t.water, 0);
    const mp = s.massProperties;
    expect(mp.mass).toBeGreaterThan(s.dry.mass + water * 1024);
    expect(mp.mass).toBeLessThan(s.dry.mass + water * 1026);
  });

  it('moving trim water forward shifts the CG forward', () => {
    const s = new Simulation({ depth: 25, designTrim: true });
    const x0 = s.massProperties.cg[0];
    s.requestTrimTransfer(0.5);
    run(s, 120);
    expect(s.trimRemaining).toBe(0);
    expect(s.massProperties.cg[0]).toBeGreaterThan(x0 + 0.005);
  });

  it('dry CG lies below the centre of buoyancy (positive BG)', () => {
    const s = new Simulation({ depth: 25, designTrim: true });
    expect(s.massProperties.cg[2]).toBeCloseTo(SUBMARINE.design.bg, 6);
  });
});

describe('ballast', () => {
  it('floats on the surface with the upper hull dry and stays there', () => {
    const s = new Simulation();
    const t0 = s.telemetry();
    expect(t0.depth).toBeGreaterThan(0.5);
    expect(t0.depth).toBeLessThan(SUBMARINE.hull.radius);
    expect(t0.submergedFraction).toBeGreaterThan(0.8);
    expect(t0.submergedFraction).toBeLessThan(0.92);
    const t1 = run(s, 60);
    expect(Math.abs(t1.depth - t0.depth)).toBeLessThan(0.15);
    expect(Math.abs(t1.pitch)).toBeLessThan(0.03);
  });

  it('dives when the main ballast vents are opened', () => {
    const s = new Simulation();
    s.setVents(true);
    const t = run(s, 300);
    expect(t.tanks.filter((x) => x.kind === 'mainBallast').every((x) => x.fill > 0.99)).toBe(true);
    expect(t.depth).toBeGreaterThan(10);
  });

  it('rises to the surface with empty main ballast', () => {
    const s = new Simulation({ depth: 50, mainBallastFill: 0 });
    const t1 = run(s, 20);
    expect(t1.depth).toBeLessThan(45);
    const t2 = run(s, 180);
    expect(t2.depth).toBeLessThan(SUBMARINE.hull.radius);
  });

  it('holds depth when neutrally trimmed', () => {
    const s = new Simulation({ depth: 25, designTrim: true });
    expect(Math.abs(s.telemetry().netBuoyancy)).toBeLessThan(1);
    const t = run(s, 60);
    expect(Math.abs(t.depth - 25)).toBeLessThan(0.5);
  });

  it('blowing obeys Boyle: air leaving the bottles ends up in the tanks', () => {
    const s = new Simulation({ depth: 100, designTrim: true });
    const total = () => s.air.bottlePV + s.tanks.reduce((a, t) => a + t.airPV, 0);
    const before = total();
    const p0 = s.telemetry().airPressure;
    s.setBlow(true, ['mbt_fwd']);
    for (let i = 0; i < 300; i++) s.step(); // 3 s: tank still far from empty
    const after = total();
    expect(after / before).toBeCloseTo(1, 9);
    const dPV = s.tanks[0]!.airPV;
    expect(p0 - s.telemetry().airPressure).toBeCloseTo(dPV / SUBMARINE.air.bottleVolume, 0);
    expect(s.tanks[0]!.water).toBeLessThan(SUBMARINE.tanks[0]!.volume);
  });

  it('air in a main ballast tank expands as the boat rises', () => {
    const V = 100;
    const pv = pressureAt(100) * 0.3 * V; // 30 % air at 100 m (ignoring tank height)
    const fDeep = equilibriumFill(pv, V, pressureAt(100), 0);
    const fShallow = equilibriumFill(pv, V, pressureAt(50), 0);
    expect(fDeep).toBeCloseTo(0.7, 9);
    expect(fShallow).toBeLessThan(fDeep - 0.2);
  });

  it('blowing main ballast at depth makes the boat surface', () => {
    const s = new Simulation({ depth: 80 });
    s.setBlow(true);
    const t = run(s, 240);
    expect(t.depth).toBeLessThan(SUBMARINE.hull.radius);
    expect(t.airPressure).toBeLessThan(SUBMARINE.air.bottlePressure);
  });
});

describe('surfacing from depth (the crew blows forward first)', () => {
  const KN = 1852 / 3600;
  for (const knots of [4, 19]) {
    it(`from 100 m at ${knots} knots the bow comes up and the boat surfaces bow first`, () => {
      // Blowing both groups at once pitched the boat bow down to 40–60° and it came up stern first.
      const c = new Controller(new Simulation({ area: 'atlantic', depth: 100, speed: knots * KN, neutral: true }));
      c.crewTakesAll();
      c.submit({ kind: 'setSpeed', knots }, 'keyboard');
      c.submit({ kind: 'surface' }, 'keyboard');
      let lowestPitch = 0;
      let slowest = Infinity;
      for (let i = 0; i < 120 * 100; i++) {
        c.step();
        const k = c.sim.kinematics();
        lowestPitch = Math.min(lowestPitch, k.pitch);
        slowest = Math.min(slowest, k.u);
      }
      expect(c.log.some((e) => /för blåses först/.test(e.text))).toBe(true);
      expect(c.log.some((e) => /akter blåses/.test(e.text))).toBe(true);
      expect(lowestPitch).toBeGreaterThan((-20 * Math.PI) / 180);
      expect(slowest).toBeGreaterThan(0);
      expect(c.sim.kinematics().depth).toBeLessThan(3);
    });
  }

  it('near the surface all main ballast is blown at once', () => {
    const c = new Controller(new Simulation({ depth: 13, speed: 4 * KN, neutral: true }));
    c.crewTakesAll();
    c.submit({ kind: 'surface' }, 'keyboard');
    c.step();
    expect(c.sim.tanks.filter((t) => t.blowOpen)).toHaveLength(2);
    expect(c.aftBlowAt).toBeNull();
  });

  it('a ballast order before the after tanks are blown cancels the staged blow', () => {
    const c = new Controller(new Simulation({ depth: 100, speed: 4 * KN, neutral: true }));
    c.crewTakesAll();
    c.submit({ kind: 'surface' }, 'keyboard');
    c.step();
    expect(c.aftBlowAt).not.toBeNull();
    c.submit({ kind: 'dive' }, 'keyboard');
    for (let i = 0; i < 20 * 100; i++) c.step();
    expect(c.aftBlowAt).toBeNull();
    expect(c.log.some((e) => /akter blåses/.test(e.text))).toBe(false);
  });
});
