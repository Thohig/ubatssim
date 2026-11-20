import { describe, expect, it } from 'vitest';
import { AREA_INFO, AREA_ORDER } from '../src/control/areas';
import { Controller } from '../src/control/controller';
import { AREAS } from '../src/sim/config/areas';
import { Simulation } from '../src/sim/simulation';
import { heightFunction } from '../src/sim/terrain';
import { Vessel, type VesselDef } from '../src/sim/vessel';

const ship = (over: Partial<VesselDef> = {}): VesselDef => ({
  id: 'x', name: 'testfartyget', kind: 'freighter', length: 120, beam: 18, draft: 7, speed: 5, turnRate: 0.02,
  route: [[-2000, 0], [2000, 0]], repeat: 'shuttle', propellerRps: 2, blades: 4, ...over,
});

describe('vessels', () => {
  it('follow the route, turn at a limited rate and shuttle back', () => {
    const v = new Vessel(ship());
    for (let i = 0; i < 20 * 60 * 100; i++) v.step(0.01); // 20 minutes at 5 m/s: 6 km, past the end (4 km) and back
    expect(v.state.north).toBeLessThan(2000);
    expect(Math.cos(v.state.heading)).toBeLessThan(-0.9); // heading south again
    expect(Math.abs(v.state.east)).toBeLessThan(600); // turning radius 5 m/s ÷ 0.02 rad/s = 250 m
  });

  it('every area\'s traffic keeps to water deep enough for its draft', () => {
    for (const area of AREA_ORDER) {
      const h = heightFunction(AREAS[area].terrain);
      for (const def of AREA_INFO[area].traffic) {
        const v = new Vessel(def);
        let shallowest = Infinity;
        for (let i = 0; i < 40 * 60 * 10; i++) {
          v.step(0.1);
          if (i % 10 === 0) shallowest = Math.min(shallowest, -h(v.state.north, v.state.east));
        }
        expect(shallowest, `${area}/${def.id}`).toBeGreaterThan(def.draft + 3);
      }
    }
  });
});

describe('world', () => {
  it('is deterministic and gives range and bearing to the vessels', () => {
    const run = () => {
      const c = new Controller(new Simulation({ depth: 30, designTrim: true }));
      c.world.add([ship({ route: [[-1000, 500], [1000, 500]] })]);
      for (let i = 0; i < 3000; i++) c.step();
      const k = c.world.contacts()[0]!;
      return [k.range, k.bearing, k.vessel.state.north];
    };
    const a = run();
    expect(a).toEqual(run());
    expect(a[0]!).toBeGreaterThan(400);
    expect(a[1]!).toBeGreaterThan(0); // to the east
    expect(a[1]!).toBeLessThan(Math.PI);
  });

  it('a ship running over a boat at periscope depth collides; deep down it passes over', () => {
    const at = (depth: number) => {
      const c = new Controller(new Simulation({ depth, neutral: true, current: { speed: 0, toward: 0, decay: 1 } }));
      c.submit({ kind: 'setDepth', depth }, 'console');
      c.world.add([ship({ route: [[-800, 0], [800, 0]] })]);
      for (let i = 0; i < 300 * 100 && !c.collidedWith; i++) c.step();
      return c;
    };
    const shallow = at(10);
    expect(shallow.collidedWith).toBe('testfartyget');
    expect(shallow.log.some((e) => /Kollision med testfartyget/.test(e.text))).toBe(true);
    expect(at(40).collidedWith).toBeNull();
  });
});
