import { describe, expect, it } from 'vitest';
import { ENVIRONMENT as E } from '../src/sim/config/environment';
import { pressureAt, waterDensity } from '../src/sim/environment';
import { Simulation } from '../src/sim/simulation';
import { World } from '../src/sim/world';

const KN = 1852 / 3600;
const run = (s: Simulation, seconds: number) => {
  for (let i = 0; i < seconds * 100; i++) s.step();
};
const engine = (s: Simulation) => s.systems.flooding.compartments.find((c) => c.id === 'engine')!;

describe('flooding', () => {
  it('a hole lets in Cd·A·√(2Δp/ρ), more the deeper', () => {
    const area = 5e-4;
    const at = (depth: number) => {
      const s = new Simulation({ depth, designTrim: true, leaks: { engine: area } });
      s.step();
      return engine(s).inflow;
    };
    const d = 150;
    const s = new Simulation({ depth: d, designTrim: true });
    const expected = s.cfg.damage.holeCd * area * Math.sqrt((2 * (pressureAt(d, s.water) - E.pAtm)) / waterDensity(d, s.water));
    expect(at(d)).toBeCloseTo(expected, 4);
    expect(at(150)).toBeGreaterThan(at(40));
    expect(at(150) / at(40)).toBeCloseTo(Math.sqrt(150 / 40), 0);
  });

  it('the water makes the boat heavier, at the compartment', () => {
    const s = new Simulation({ depth: 200, designTrim: true, area: 'atlantic', leaks: { engine: 3e-3 } });
    const m0 = s.massProperties.mass;
    const x0 = s.massProperties.cg[0];
    run(s, 20);
    const water = s.systems.flooding.water;
    expect(water).toBeGreaterThan(1);
    expect(s.massProperties.mass - m0).toBeCloseTo(water * s.water.rhoSurface, -1);
    expect(s.massProperties.cg[0]).toBeLessThan(x0); // the engine room is aft
  });

  it('shallow, the drain pump wins and the crew seals the hole; deep, the pump cannot keep up', () => {
    const shallow = new Simulation({ depth: 20, designTrim: true, leaks: { engine: 3e-4 } });
    run(shallow, 60);
    expect(shallow.systems.flooding.water).toBeLessThan(0.01);
    expect(shallow.telemetry().drainPumpRunning).toBe(true);
    const deep = new Simulation({ depth: 220, designTrim: true, area: 'atlantic', leaks: { engine: 3e-4 } });
    run(deep, 60);
    expect(deep.systems.flooding.water).toBeGreaterThan(0.3);
    // Damage control: the hole shrinks with the seal time and is gone in the end.
    const h = engine(deep).holeArea;
    expect(h).toBeCloseTo(3e-4 * Math.exp(-60 / deep.cfg.damage.sealTime), 6);
    const events = [];
    for (let i = 0; i < 1200; i++) {
      run(shallow, 1);
      events.push(...shallow.systems.flooding.drainEvents());
    }
    expect(engine(shallow).holeArea).toBe(0);
    expect(events.map((e) => e.kind)).toContain('sealed');
  });

  it('a hard grounding holes the bow; a soft one does not', () => {
    const hit = (kn: number) => {
      const ground = (_n: number, e: number) => (e > 30 ? 20 : 400); // a wall ahead, east
      const s = new Simulation({ depth: 17, designTrim: true, heading: Math.PI / 2, speed: kn * KN, ground });
      s.commands.rps = s.rpsForSpeed(kn * KN);
      run(s, 20);
      return s.systems.flooding.compartments.find((c) => c.id === 'torpedo')!.holeArea;
    };
    expect(hit(1)).toBe(0);
    expect(hit(6)).toBeGreaterThan(0);
  });

  it('a collision with a ship holes the control room', () => {
    const s = new Simulation({ depth: 5, designTrim: true, mainBallastFill: 1 });
    const w = new World(s);
    w.add([{ id: 'x', name: 'X', kind: 'freighter', length: 100, beam: 15, draft: 8, speed: 0, turnRate: 0, route: [[0, 0]], repeat: 'loop', propellerRps: 1, blades: 4 }]);
    w.step();
    expect(w.collision).not.toBeNull();
    expect(s.systems.flooding.compartments.find((c) => c.id === 'control')!.holeArea).toBe(s.cfg.damage.collisionHole);
  });

  it('below crush depth the hull leaks; at collapse depth it fails', () => {
    const s = new Simulation({ depth: 320, designTrim: true, area: 'atlantic' });
    run(s, 2);
    expect(engine(s).holeArea).toBeGreaterThan(0);
    expect(s.systems.flooding.collapsed).toBe(false);
    const c = new Simulation({ depth: 365, designTrim: true, area: 'atlantic' });
    c.step();
    expect(c.systems.flooding.collapsed).toBe(true);
    expect(c.telemetry().hullCollapsed).toBe(true);
  });

  it('a flooded engine room stops the diesels, a flooded motor room the motor', () => {
    const s = new Simulation({ battery: 0.5 });
    s.commands.diesel = true;
    const fl = s.systems.flooding;
    const eng = fl.compartments.find((c) => c.id === 'engine')!;
    eng.water = eng.volume * 0.5;
    run(s, 2);
    expect(s.telemetry().dieselRunning).toBe(false);
    const mot = fl.compartments.find((c) => c.id === 'motor')!;
    mot.water = mot.volume * 0.5;
    s.step();
    expect(s.telemetry().motorPowerLimit).toBe(0);
  });
});
