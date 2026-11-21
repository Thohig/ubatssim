import { describe, expect, it } from 'vitest';
import { Controller } from '../../src/control/controller';
import { PERISCOPE_DEPTH } from '../../src/control/crew';
import type { Order } from '../../src/control/orders';
import { ASSIST } from '../../src/control/trimAssist';
import { Simulation, type InitialConditions } from '../../src/sim/simulation';

const G = 9.80665;
const DEG = 180 / Math.PI;

/** The crew handles everything (as every game starts), or the player does (a new Controller). */
type Who = 'crew' | 'player';

function game(initial: InitialConditions, who: Who) {
  const c = new Controller(new Simulation(initial));
  if (who === 'crew') c.crewTakesAll();
  const run = (seconds: number, each?: () => void) => {
    for (let i = 0; i < seconds * 100; i++) {
      c.step();
      each?.();
    }
  };
  const send = (o: Order) => c.submit(o, 'keyboard');
  return { c, sim: c.sim, run, send };
}

/** The "D" key: dive and, without a deeper target, periscope depth. */
const dive = (c: Controller) => {
  c.submit({ kind: 'dive' }, 'keyboard');
  if (!c.ap.depth || c.setpoints.depth < PERISCOPE_DEPTH) c.submit({ kind: 'setDepth', depth: PERISCOPE_DEPTH }, 'keyboard');
};

describe('trim assistant', () => {
  it('dives to 50 m and trims neutral without help from the player', () => {
    const { c, sim, run, send } = game({}, 'crew');
    dive(c);
    send({ kind: 'setSpeed', knots: 6 });
    run(120);
    send({ kind: 'setDepth', depth: 50 });
    run(720);
    let worst = 0;
    run(180, () => (worst = Math.max(worst, Math.abs(sim.y[2]! - 50))));
    expect(worst).toBeLessThan(1);
    expect(Math.abs(sim.telemetry().netBuoyancy / G)).toBeLessThan(150);
    expect(c.log.some((e) => e.source === 'assist' && /Kompensera/.test(e.text))).toBe(true);
  });

  it('does nothing when the player handles the trim', () => {
    const { c, run, send } = game({}, 'player');
    send({ kind: 'bridge', manned: false });
    send({ kind: 'dive' });
    send({ kind: 'setDepth', depth: 50 });
    send({ kind: 'setSpeed', knots: 6 });
    run(600);
    expect(c.log.some((e) => e.source === 'assist')).toBe(false);
    expect(c.sim.telemetry().netBuoyancy / G).toBeLessThan(-150); // still heavy: nobody trimmed
  });

  it('is deterministic', () => {
    const play = () => {
      const { c, sim, run, send } = game({}, 'crew');
      dive(c);
      send({ kind: 'setSpeed', knots: 6 });
      run(60);
      send({ kind: 'setDepth', depth: 40 });
      send({ kind: 'adjustHeading', deltaDegrees: 40 });
      run(300);
      return Array.from(sim.y);
    };
    expect(play()).toEqual(play());
  });
});

describe('safety net', () => {
  it('blows the main ballast before crush depth', () => {
    const { c, sim, run } = game({ depth: 200, speed: 4 * 0.5144, tankFills: { comp: 1 }, east: -3000 }, 'crew');
    let deepest = 0;
    run(600, () => (deepest = Math.max(deepest, sim.y[2]!)));
    expect(c.log.some((e) => e.source === 'assist' && /nödblåsning/.test(e.text))).toBe(true);
    expect(deepest).toBeLessThan(ASSIST.crushDepth);
  });

  it('keeps the depth target off the sea bed', () => {
    // Heading east towards the archipelago, where the sea bed rises.
    const { c, sim, run, send } = game({ east: 1500, depth: 30, speed: 3, designTrim: true, heading: 90 / DEG }, 'crew');
    for (let i = 0; i < 40; i++) send({ kind: 'adjustDepth', deltaMetres: 5 });
    run(0.02);
    const limit = c.assist.depthLimit();
    expect(c.setpoints.depth).toBeLessThanOrEqual(Math.max(30, limit));
    let minKeel = Infinity;
    run(300, () => {
      const under = sim.ground(sim.y[0]!, sim.y[1]!) - (sim.y[2]! + sim.cfg.hull.radius);
      minKeel = Math.min(minKeel, under);
    });
    expect(c.setpoints.depth).toBeLessThanOrEqual(c.assist.depthLimit() + 1);
    expect(minKeel).toBeGreaterThan(0);
  });
});

describe('depth target with empty main ballast', () => {
  it('the crew starts the dive and reaches the depth', () => {
    const { c, sim, run, send } = game({ area: 'atlantic', sea: 'moderate' }, 'crew');
    send({ kind: 'setSpeed', knots: 10 });
    send({ kind: 'setDepth', depth: 32 });
    run(1);
    expect(c.bridgeManned).toBe(false);
    expect(c.log.some((e) => /fylls för dykning/.test(e.text))).toBe(true);
    run(300);
    expect(Math.abs(sim.y[2]! - 32)).toBeLessThan(3);
  });

  it('the crew does not flood for a target near the surface', () => {
    const { sim, run, send } = game({}, 'crew');
    send({ kind: 'adjustDepth', deltaMetres: 2 });
    run(1);
    expect(sim.tanks.some((t) => t.ventOpen)).toBe(false);
  });

  it('a player handling the ballast is reminded instead', () => {
    const { c, sim, run, send } = game({}, 'player');
    send({ kind: 'setDepth', depth: 32 });
    run(1);
    expect(sim.tanks.some((t) => t.ventOpen)).toBe(false);
    expect(c.log.some((e) => e.kind === 'error' && /Huvudballasten är tom/.test(e.text))).toBe(true);
  });
});

describe('surface hold', () => {
  it('on the surface the depth autopilot leaves the planes at zero and the boat floats', () => {
    const { c, sim, run, send } = game({}, 'crew');
    send({ kind: 'setSpeed', knots: 5 });
    let maxPlanes = 0;
    run(180, () => (maxPlanes = Math.max(maxPlanes, Math.abs(sim.actuators.sternPlanes))));
    expect(c.surfaceHold).toBe(true);
    expect(maxPlanes).toBeLessThan(0.01);
    expect(Math.abs(sim.y[2]! - 1.75)).toBeLessThan(0.3);
  });

  it('a depth target ends the surface hold and the boat dives', () => {
    const { c, sim, run, send } = game({}, 'crew');
    send({ kind: 'setSpeed', knots: 6 });
    run(10);
    send({ kind: 'setDepth', depth: 25 });
    run(420);
    expect(c.surfaceHold).toBe(false);
    expect(Math.abs(sim.y[2]! - 25)).toBeLessThan(3);
  });
});

describe('depth target near the surface with flooded main ballast', () => {
  it('the crew blows the tanks for ↑ to the surface, and the boat floats on the surface', () => {
    const { c, sim, run, send } = game({ depth: 13, speed: 5 * 0.5144, neutral: true }, 'crew');
    send({ kind: 'adjustDepth', deltaMetres: -5 });
    send({ kind: 'adjustDepth', deltaMetres: -5 });
    run(1);
    expect(c.setpoints.depth).toBe(3);
    expect(c.log.some((e) => /blåses för ytläge/.test(e.text))).toBe(true);
    run(240);
    const mbt = sim.telemetry().tanks.filter((t) => t.kind === 'mainBallast');
    expect(mbt.every((t) => t.fill < 0.4)).toBe(true);
    expect(sim.y[2]!).toBeLessThan(3);
    expect(c.surfaceHold).toBe(true);
  });

  it('Yta from depth is a normal ascent: up on the planes, the main ballast blown at 15 m', () => {
    const { c, sim, run, send } = game({ depth: 60, speed: 6 * 0.5144, neutral: true }, 'crew');
    send({ kind: 'setDepth', depth: 0 });
    run(1);
    expect(sim.tanks.some((t) => t.blowOpen)).toBe(false);
    expect(c.log.some((e) => /Stigning till ytan/.test(e.text))).toBe(true);
    let blownAt = Infinity;
    run(600, () => {
      if (blownAt === Infinity && sim.tanks.some((t) => t.blowOpen)) blownAt = sim.kinematics().depth;
    });
    expect(blownAt).toBeLessThanOrEqual(15);
    expect(blownAt).toBeGreaterThan(8);
    expect(sim.y[2]!).toBeLessThan(3);
    expect(c.surfaceHold).toBe(true);
  });

  it('periscope depth does not blow', () => {
    const { sim, run, send } = game({ depth: 30, speed: 5 * 0.5144, neutral: true }, 'crew');
    send({ kind: 'setDepth', depth: 13 });
    run(1);
    expect(sim.tanks.some((t) => t.blowOpen)).toBe(false);
  });

  it('a player handling the ballast is reminded instead', () => {
    const { c, sim, run, send } = game({ depth: 13, speed: 5 * 0.5144, neutral: true }, 'player');
    send({ kind: 'setDepth', depth: 2 });
    run(1);
    expect(sim.tanks.some((t) => t.blowOpen)).toBe(false);
    expect(c.log.some((e) => e.kind === 'error' && /Huvudballasten är full/.test(e.text))).toBe(true);
  });
});
