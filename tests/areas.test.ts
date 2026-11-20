import { describe, expect, it } from 'vitest';
import { Controller } from '../src/control/controller';
import { AREA_INFO, AREA_ORDER } from '../src/control/areas';
import { ENVIRONMENT as E } from '../src/sim/config/environment';
import { AREAS } from '../src/sim/config/areas';
import { WATERS } from '../src/sim/config/waters';
import { pressureAt, waterDensity } from '../src/sim/environment';
import { Simulation } from '../src/sim/simulation';
import { heightFunction } from '../src/sim/terrain';

const G = E.g;

describe('water profiles', () => {
  it('pressure is the integral of the density profile', () => {
    for (const w of Object.values(WATERS)) {
      for (const z of [5, 30, 75, 200]) {
        let p = E.pAtm;
        const n = 4000;
        for (let i = 0; i < n; i++) p += waterDensity(((i + 0.5) * z) / n, w) * G * (z / n);
        expect(Math.abs(pressureAt(z, w) - p)).toBeLessThan(1);
      }
    }
  });

  it('the Baltic is brackish with a halocline; the fjord has fresh water on top', () => {
    expect(waterDensity(0, WATERS.baltic)).toBeLessThan(1007);
    expect(waterDensity(90, WATERS.baltic) - waterDensity(50, WATERS.baltic)).toBeGreaterThan(2.3);
    expect(waterDensity(20, WATERS.fjord) - waterDensity(0, WATERS.fjord)).toBeGreaterThan(14);
  });
});

describe('sea areas', () => {
  it('the boat is ballasted for each area: neutral at the design depth with design fills', () => {
    for (const area of AREA_ORDER) {
      const sim = new Simulation({ area, depth: 25, designTrim: true });
      expect(Math.abs(sim.telemetry().netBuoyancy / G), area).toBeLessThan(5);
    }
  });

  it('in the Baltic the boat gets lighter below the halocline', () => {
    const at = (depth: number) => new Simulation({ area: 'baltic', depth, designTrim: true }).telemetry().netBuoyancy / G;
    expect(at(95) - at(45)).toBeGreaterThan(2500);
  });

  it('in the fjord the boat floats deeper in the fresh surface water', () => {
    const draft = (area: 'westCoast' | 'fjord') => new Simulation({ area }).y[2]!;
    // ~18 t more to carry in the 1012 kg/m³ surface water, over a ~300 m² water plane.
    expect(draft('fjord') - draft('westCoast')).toBeGreaterThan(0.04);
  });

  it('a neutral start is neutral where it starts', () => {
    for (const depth of [13, 60, 95]) {
      const sim = new Simulation({ area: 'baltic', depth, neutral: true });
      expect(Math.abs(sim.telemetry().netBuoyancy / G)).toBeLessThan(5);
    }
  });

  it('terrain: fjord sill, basin and mountains; deep ocean; Baltic shelf', () => {
    const f = heightFunction(AREAS.fjord.terrain);
    const deepest = (n: number) => Math.min(...Array.from({ length: 301 }, (_, i) => f(n, -1500 + i * 10)));
    expect(-deepest(0)).toBeGreaterThan(48);
    expect(-deepest(0)).toBeLessThan(62);
    expect(-deepest(2500)).toBeGreaterThan(350);
    expect(-deepest(-2500)).toBeGreaterThan(200);
    expect(f(2000, -1400)).toBeGreaterThan(100);
    expect(f(2000, 1800)).toBeGreaterThan(100);
    expect(-heightFunction(AREAS.atlantic.terrain)(0, 0)).toBeGreaterThan(1500);
    const b = heightFunction(AREAS.baltic.terrain);
    expect(-b(0, 0)).toBeGreaterThan(95);
    expect(-b(0, 0)).toBeLessThan(135);
  });

  it('every free start is afloat, clear of the bottom, and stays so for a minute', () => {
    for (const area of AREA_ORDER) {
      for (const st of AREA_INFO[area].starts) {
        const c = new Controller(new Simulation(st.initial));
        for (let i = 0; i < 60 * 100; i++) c.step();
        const t = c.sim.telemetry();
        expect(t.grounded, `${area}/${st.id}`).toBe(false);
        expect(t.depthUnderKeel, `${area}/${st.id}`).toBeGreaterThan(5);
      }
    }
  });

  it('lighthouses stand on land', () => {
    for (const area of AREA_ORDER) {
      const h = heightFunction(AREAS[area].terrain);
      for (const l of AREA_INFO[area].lighthouses) expect(h(l.position[0], l.position[1]), l.name).toBeGreaterThan(1);
    }
  });
});
