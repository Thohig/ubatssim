import { describe, expect, it } from 'vitest';
import { Controller } from '../../src/control/controller';
import type { Order } from '../../src/control/orders';
import { SCENARIOS, ScenarioRunner } from '../../src/control/scenarios';
import { Simulation } from '../../src/sim/simulation';

type Who = 'crew' | 'player';

function start(who: Who) {
  const sc = SCENARIOS.find((s) => s.id === 'stealth')!;
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

describe('"Smyg förbi"', () => {
  it.each(['crew', 'player'] as const)('hear the corvette, go under the layer at 4 knots and reach the buoy unseen (%s)', (who) => {
    const { c, runner, send, run } = start(who);
    send({ kind: 'setSpeed', knots: 4 });
    send({ kind: 'setHeading', heading: 0 });
    run(60, () => runner.progress.index >= 1);
    expect(runner.progress.index).toBe(1);
    send({ kind: 'setDepth', depth: 200 });
    run(2400);
    expect(runner.status).toBe('completed');
    expect(c.sonar.detectedBy).toBeNull();
  });

  it.each(['crew', 'player'] as const)('fails when the boat races over shallow (%s)', (who) => {
    const { runner, send, run } = start(who);
    send({ kind: 'setSpeed', knots: 14 });
    send({ kind: 'setHeading', heading: 0 });
    send({ kind: 'setDepth', depth: 30 });
    run(900);
    expect(runner.status).toBe('failed');
    expect(runner.message).toBe('Ubåten upptäcktes av korvetten Väktaren.');
  });
});
