import { describe, expect, it } from 'vitest';
import { Controller } from '../../src/control/controller';
import type { Order } from '../../src/control/orders';
import { SCENARIOS, ScenarioRunner } from '../../src/control/scenarios';
import { Simulation } from '../../src/sim/simulation';

const DEG = 180 / Math.PI;
const KN = 1852 / 3600;

/** Who handles the boat: the crew (as every game starts), or the player, who has taken over all the scenario allows. */
type Who = 'crew' | 'player';

function start(who: Who) {
  const sc = SCENARIOS.find((s) => s.id === 'astern')!;
  const c = new Controller(new Simulation(sc.initial));
  const runner = new ScenarioRunner(sc, c);
  c.crewTakesAll();
  if (who === 'player') c.submit({ kind: 'crew', system: 'all', crew: false }, 'keyboard');
  const send = (o: Order) => c.submit(o, 'keyboard');
  const run = (seconds: number, until?: () => boolean) => {
    for (let i = 0; i < seconds * 100; i++) {
      c.step();
      runner.update();
      if (runner.status !== 'running' || until?.()) return;
    }
  };
  return { c, runner, send, run };
}

describe('"Back"', () => {
  it('player: back with the autopilots holding course and depth, stop at the buoy', () => {
    const { c, runner, send, run } = start('player');
    send({ kind: 'setHeading', heading: 0 });
    send({ kind: 'setDepth', depth: 30 });
    send({ kind: 'setSpeed', knots: -4 });
    run(900, () => runner.progress.index >= 2);
    expect(runner.progress.index).toBe(2);
    send({ kind: 'setSpeed', knots: 0 });
    run(300);
    expect(runner.status).toBe('completed');
    expect(Math.abs(c.sim.telemetry().depth - 30)).toBeLessThan(5);
  });

  it('crew: Shift+↓ past zero to BACK 4, then Shift+↑ back to 0', () => {
    const { c, runner, send, run } = start('crew');
    for (let i = 0; i < 7; i++) send({ kind: 'adjustSpeed', deltaKnots: -1 });
    run(1);
    expect(c.setpoints.speed).toBe(-4);
    run(900, () => runner.progress.index >= 2);
    expect(runner.progress.index).toBe(2);
    for (let i = 0; i < 4; i++) send({ kind: 'adjustSpeed', deltaKnots: 1 });
    run(300);
    expect(runner.status).toBe('completed');
  });

  it.each(['player', 'crew'] as const)('fails when the boat turns round instead (%s)', (who) => {
    const { c, runner, send, run } = start(who);
    send({ kind: 'setHeading', heading: 90 });
    send({ kind: 'setSpeed', knots: 6 });
    run(600);
    expect(runner.status).toBe('failed');
    expect(runner.message).toMatch(/vände/);
    expect(c.sim.telemetry().heading * DEG).toBeGreaterThan(40);
  });
});

describe('autopilot astern', () => {
  it('holds depth and heading at 5 knots astern and turns 30° without large overshoot', () => {
    const c = new Controller(new Simulation({ depth: 50, designTrim: true }));
    c.submit({ kind: 'setDepth', depth: 50 }, 'console');
    c.submit({ kind: 'setHeading', heading: 0 }, 'console');
    c.submit({ kind: 'setSpeed', knots: -5 }, 'console');
    for (let i = 0; i < 300 * 100; i++) c.step();
    let t = c.sim.telemetry();
    expect(t.u / KN).toBeLessThan(-4.5);
    expect(Math.abs(t.depth - 50)).toBeLessThan(2);
    c.submit({ kind: 'setHeading', heading: 30 }, 'console');
    let maxHeading = 0;
    for (let i = 0; i < 200 * 100; i++) {
      c.step();
      if (i % 100 === 0) maxHeading = Math.max(maxHeading, c.sim.kinematics().heading * DEG);
    }
    t = c.sim.telemetry();
    expect(Math.abs(t.heading * DEG - 30)).toBeLessThan(1.5);
    expect(maxHeading - 30).toBeLessThan(4);
    expect(Math.abs(t.depth - 50)).toBeLessThan(2);
  });

  it('changes depth astern (50 → 70 m) and goes from ahead to astern and back without losing depth', () => {
    const c = new Controller(new Simulation({ depth: 50, designTrim: true, speed: 8 * KN }));
    c.submit({ kind: 'setDepth', depth: 50 }, 'console');
    c.submit({ kind: 'setHeading', heading: 0 }, 'console');
    c.submit({ kind: 'setSpeed', knots: -5 }, 'console');
    let maxDev = 0;
    for (let i = 0; i < 300 * 100; i++) {
      c.step();
      maxDev = Math.max(maxDev, Math.abs(c.sim.kinematics().depth - 50));
    }
    expect(c.sim.telemetry().u / KN).toBeLessThan(-4);
    expect(maxDev).toBeLessThan(5);
    c.submit({ kind: 'setDepth', depth: 70 }, 'console');
    let maxDepth = 0;
    for (let i = 0; i < 250 * 100; i++) {
      c.step();
      maxDepth = Math.max(maxDepth, c.sim.kinematics().depth);
    }
    expect(Math.abs(c.sim.telemetry().depth - 70)).toBeLessThan(2);
    expect(maxDepth).toBeLessThan(76);
    c.submit({ kind: 'setSpeed', knots: 6 }, 'console');
    for (let i = 0; i < 200 * 100; i++) c.step();
    const t = c.sim.telemetry();
    expect(t.u / KN).toBeGreaterThan(5);
    expect(Math.abs(t.depth - 70)).toBeLessThan(2);
    expect(Math.abs(((t.heading * DEG + 540) % 360) - 180)).toBeLessThan(2);
  });
});
