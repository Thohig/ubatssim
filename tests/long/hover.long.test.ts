import { describe, expect, it } from 'vitest';
import { Controller } from '../../src/control/controller';
import { SCENARIOS, ScenarioRunner } from '../../src/control/scenarios';
import { Simulation, type InitialConditions } from '../../src/sim/simulation';

/** The crew handles everything; stopped; a new depth target. */
function hover(initial: InitialConditions, target: number) {
  const c = new Controller(new Simulation(initial));
  c.crewTakesAll();
  c.submit({ kind: 'setSpeed', knots: 0 }, 'keyboard');
  c.submit({ kind: 'setDepth', depth: target }, 'keyboard');
  /** Runs up to `seconds`, calling `each` once a second; stops early when it returns true. */
  const run = (seconds: number, each?: () => boolean | void) => {
    for (let i = 0; i < seconds * 100; i++) {
      c.step();
      if (i % 100 === 0 && each?.() === true) return;
    }
  };
  return { c, run };
}

describe('hovering: depth without speed', () => {
  it.each([
    ['down through the thermocline, 50 → 80 m', { depth: 50, speed: 0, neutral: true }, 80],
    ['up, 80 → 40 m', { depth: 80, speed: 0, neutral: true }, 40],
    ['deep water, where the hull compresses: 150 → 200 m', { area: 'atlantic', depth: 150, speed: 0, neutral: true }, 200],
  ] as const)('%s: there within 18 minutes (the pump is slower deep down), little overshoot, held after', (_name, initial, target) => {
    const { c, run } = hover(initial as InitialConditions, target);
    let maxSpeed = 0;
    let reachedAt: number | null = null;
    let wasHovering = false;
    run(18 * 60, () => {
      const k = c.sim.kinematics();
      maxSpeed = Math.max(maxSpeed, Math.abs(k.u));
      if (reachedAt === null && Math.abs(k.depth - target) < 1) reachedAt = c.sim.t;
      // Planes rest at zero while hovering (from the step after it starts); no engine boost.
      expect(c.depthBoost).toBe(false);
      if (c.hovering && wasHovering) expect(c.sim.commands.sternPlanes).toBe(0);
      wasHovering = c.hovering;
      return reachedAt !== null && c.sim.t - reachedAt > 60;
    });
    expect(reachedAt).not.toBeNull();
    expect(c.hovering).toBe(true);
    // Held: within 1,5 m for the next three minutes.
    let worst = 0;
    run(180, () => {
      worst = Math.max(worst, Math.abs(c.sim.kinematics().depth - target));
    });
    expect(worst).toBeLessThan(1.5);
    expect(maxSpeed).toBeLessThan(0.3);
    expect(c.log.some((e) => e.text === `Ingen fart: besättningen svävar mot ${target} m med kompenseringen.`)).toBe(true);
    expect(c.log.some((e) => e.text === `Svävar på ${target} m.`)).toBe(true);
    // Few, large orders: not one a second.
    expect(c.log.filter((e) => e.source === 'assist' && /^Kompensera/.test(e.text)).length).toBeLessThan(30);
  });

  it('ends when the speed comes back: the planes take the depth over again', () => {
    const { c, run } = hover({ depth: 50, speed: 0, neutral: true }, 50);
    run(5);
    expect(c.hovering).toBe(true);
    c.submit({ kind: 'setSpeed', knots: 6 }, 'keyboard');
    c.submit({ kind: 'setDepth', depth: 60 }, 'keyboard');
    run(120);
    expect(c.hovering).toBe(false);
    expect(Math.abs(c.sim.kinematics().depth - 60)).toBeLessThan(3);
  });

  it('a player handling the trim is told to use In and Ut; the engine stays stopped', () => {
    const c = new Controller(new Simulation({ depth: 50, speed: 0, neutral: true }));
    c.crewTakesAll();
    c.submit({ kind: 'crew', system: 'trim', crew: false }, 'keyboard');
    c.submit({ kind: 'setSpeed', knots: 0 }, 'keyboard');
    c.submit({ kind: 'setDepth', depth: 80 }, 'keyboard');
    for (let i = 0; i < 90 * 100; i++) c.step();
    expect(c.hovering).toBe(false);
    expect(c.depthBoost).toBe(false);
    expect(Math.abs(c.sim.kinematics().u)).toBeLessThan(0.2);
    expect(c.log.some((e) => /ingen fart, så djuprodren verkar inte/.test(e.text))).toBe(true);
  });
});

describe('"Sväva"', () => {
  const sc = SCENARIOS.find((s) => s.id === 'hover')!;
  const start = () => {
    const c = new Controller(new Simulation(sc.initial));
    const runner = new ScenarioRunner(sc, c);
    c.crewTakesAll();
    const run = (seconds: number, each?: () => void) => {
      for (let i = 0; i < seconds * 100; i++) {
        c.step();
        runner.update();
        if (i % 100 === 0) each?.();
        if (runner.status !== 'running') return;
      }
    };
    return { c, runner, run };
  };

  it('the crew hovers down to 80 m and holds it', () => {
    const { c, runner, run } = start();
    c.submit({ kind: 'setDepth', depth: 80 }, 'touch');
    run(1800);
    expect(runner.status).toBe('completed');
  });

  it('the player compensates by hand: heavy, out in time, then small corrections', () => {
    const { c, runner, run } = start();
    c.submit({ kind: 'crew', system: 'all', crew: false }, 'keyboard');
    c.submit({ kind: 'compensate', litres: 500 }, 'keyboard');
    let phase = 0;
    let last = 0;
    run(1800, () => {
      const k = c.sim.kinematics();
      // Through the layer the boat gets lighter: more water in while it slows down.
      if (phase === 0 && k.depth <= 66 && k.depthRate < 0.04 && c.sim.compRemaining === 0) {
        c.submit({ kind: 'compensate', litres: 200 }, 'keyboard');
      } else if (phase === 0 && k.depth > 66) {
        c.submit({ kind: 'compensate', litres: -Math.round(-c.sim.telemetry().netBuoyancy / 9.81 / 10) * 10 - 100 }, 'keyboard');
        phase = 1;
        last = c.sim.t;
      } else if (phase === 1 && c.sim.t - last > 30) {
        // As a player would: a little out while sinking, a little in while rising.
        if (k.depthRate > 0.01 && k.depth > 79) c.submit({ kind: 'compensate', litres: -100 }, 'keyboard');
        else if (k.depthRate < -0.01 && k.depth < 81) c.submit({ kind: 'compensate', litres: 100 }, 'keyboard');
        else if (k.depth < 77 && k.depthRate < 0.02) c.submit({ kind: 'compensate', litres: 100 }, 'keyboard');
        else return;
        last = c.sim.t;
      }
    });
    expect(runner.status).toBe('completed');
  });

  it('fails when the propeller runs', () => {
    const { c, runner, run } = start();
    c.submit({ kind: 'setSpeed', knots: 4 }, 'touch');
    c.submit({ kind: 'setDepth', depth: 80 }, 'touch');
    run(300);
    expect(runner.status).toBe('failed');
    expect(runner.message).toBe('Farten gick över 1 knop. Propellern hördes.');
  });
});
