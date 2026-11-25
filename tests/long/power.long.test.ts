import { describe, expect, it } from 'vitest';
import { Controller } from '../../src/control/controller';
import type { Order } from '../../src/control/orders';
import { SCENARIOS, ScenarioRunner } from '../scenarios';
import { Simulation } from '../../src/sim/simulation';

type Who = 'crew' | 'player';

function start(id: string, who: Who) {
  const sc = SCENARIOS.find((s) => s.id === id)!;
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

describe('"Snorkling"', () => {
  it.each(['crew', 'player'] as const)('periscope depth, snorkel up, charge to 28 %, snorkel down (%s)', (who) => {
    const { c, runner, send, run } = start('snorkel', who);
    send({ kind: 'setDepth', depth: 13 });
    // 4 knots: enough for the planes to lift the boat, and no overshoot towards the surface.
    send({ kind: 'setSpeed', knots: 4 });
    run(500, () => runner.progress.index >= 1);
    expect(runner.progress.index).toBe(1);
    send({ kind: 'snorkel', up: true });
    if (who === 'player') send({ kind: 'diesel', on: true });
    run(2000, () => runner.progress.index >= 3);
    expect(runner.progress.index).toBe(3);
    expect(c.sim.telemetry().dieselRunning).toBe(true);
    send({ kind: 'snorkel', up: false });
    run(30);
    expect(runner.status).toBe('completed');
  });

  it.each(['crew', 'player'] as const)('fails when the boat breaks the surface (%s)', (who) => {
    const { runner, send, run } = start('snorkel', who);
    send({ kind: 'surface' });
    run(400);
    expect(runner.status).toBe('failed');
    expect(runner.message).toMatch(/bröt ytan/);
  });
});

describe('"Läckan"', () => {
  it.each(['crew', 'player'] as const)('up to 30 m: the leak is sealed and the engine room pumped out (%s)', (who) => {
    const { c, runner, send, run } = start('leak', who);
    send({ kind: 'setDepth', depth: 30 });
    send({ kind: 'setSpeed', knots: 8 });
    run(1400);
    expect(runner.status).toBe('completed');
    expect(c.log.some((e) => e.text === 'Läckan i maskinrum är tätad.')).toBe(true);
  });

  it.each(['crew', 'player'] as const)('fails at crush depth when the boat goes down instead (%s)', (who) => {
    const { c, runner, send, run } = start('leak', who);
    if (who === 'crew') send({ kind: 'crew', system: 'safetyNet', crew: false });
    send({ kind: 'setDepth', depth: 400 });
    send({ kind: 'setSpeed', knots: 19 });
    run(600);
    expect(runner.status).toBe('failed');
    expect(runner.message).toMatch(/krossdjupet/);
    expect(c.sim.telemetry().depth).toBeGreaterThan(299);
  });
});
