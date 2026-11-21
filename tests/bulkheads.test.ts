import { describe, expect, it } from 'vitest';
import { Controller } from '../src/control/controller';
import { Simulation } from '../src/sim/simulation';

const steps = (sim: Simulation, seconds: number) => {
  for (let i = 0; i < seconds * 100; i++) sim.step();
};
const comp = (sim: Simulation, id: string) => sim.systems.flooding.compartments.find((x) => x.id === id)!;

describe('watertight doors and the water between the compartments', () => {
  it('through open doors water runs from a flooded compartment to its dry neighbours; shut, it stays', () => {
    for (const shut of [false, true]) {
      const sim = new Simulation({ depth: 50, neutral: true });
      sim.commands.doorsShut = shut;
      steps(sim, sim.cfg.damage.doorTime + 1);
      comp(sim, 'living').water = 30;
      steps(sim, 10); // before the 30 t make the boat sink and pitch

      const fl = sim.systems.flooding;
      const neighbours = comp(sim, 'control').water + comp(sim, 'engine').water;
      if (shut) expect(neighbours).toBe(0);
      else expect(neighbours).toBeGreaterThan(5);
      // Nothing is lost or made: the water only moves (the drain pump takes a little at 50 m).
      expect(fl.water).toBeLessThanOrEqual(30);
      expect(fl.water).toBeGreaterThan(29.8);
    }
  });

  it('bow down, the water runs forward to the torpedo room', () => {
    const sim = new Simulation({ depth: 80, neutral: true, speed: 4 });
    comp(sim, 'control').water = 25;
    sim.commands.sternPlanes = 0.35; // dive: bow down
    sim.commands.rps = 2;
    steps(sim, 60);
    expect(sim.kinematics().pitch).toBeLessThan(-0.05);
    expect(comp(sim, 'torpedo').water).toBeGreaterThan(comp(sim, 'living').water);
  });

  it('heavy with water and the doors open, the water runs to the low end and makes it worse: all aft', () => {
    const sim = new Simulation({ depth: 50, neutral: true });
    comp(sim, 'living').water = 30;
    steps(sim, 60);
    expect(sim.kinematics().pitch).toBeGreaterThan(0.2); // stern down
    expect(comp(sim, 'motor').water).toBeGreaterThan(25);
  });

  it('without water inside the doors change nothing (the same state, open or shut)', () => {
    const a = new Simulation({ depth: 50, neutral: true, speed: 3 });
    const b = new Simulation({ depth: 50, neutral: true, speed: 3 });
    b.commands.doorsShut = true;
    for (const s of [a, b]) s.commands.rps = 1.5;
    steps(a, 30);
    steps(b, 30);
    expect([...b.y]).toEqual([...a.y]);
  });

  it('the crew shuts the doors at a leak, and opens them again once all is sealed and dry', () => {
    const c = new Controller(new Simulation({ depth: 30, neutral: true, leaks: { engine: 3e-4 } }));
    c.crewTakesAll();
    for (let i = 0; i < 100; i++) c.step();
    expect(c.sim.commands.doorsShut).toBe(true);
    expect(c.log.some((e) => e.text === 'Vattentäta dörrar stängs.')).toBe(true);
    for (let i = 0; i < 2000 * 100 && c.sim.commands.doorsShut; i++) c.step();
    expect(c.sim.commands.doorsShut).toBe(false);
    expect(c.log.some((e) => e.text === 'Alla avdelningar är länsade. Dörrarna öppnas.')).toBe(true);
  });

  it('the drain pump takes the compartment it is told to first', () => {
    const c = new Controller(new Simulation({ depth: 20, neutral: true }));
    c.sim.commands.doorsShut = true;
    for (let i = 0; i < 1100; i++) c.step();
    comp(c.sim, 'engine').water = 6;
    comp(c.sim, 'torpedo').water = 0.5;
    c.submit({ kind: 'drain', compartment: 'torpedo' }, 'touch');
    for (let i = 0; i < 6000; i++) c.step();
    expect(comp(c.sim, 'torpedo').water).toBe(0);
    expect(comp(c.sim, 'engine').water).toBeGreaterThan(5);
    expect(c.log.some((e) => e.text === 'Länsa torpedrum först, ja')).toBe(true);
  });
});
