import { describe, expect, it } from 'vitest';
import { Controller } from '../../src/control/controller';
import type { Order } from '../../src/control/orders';
import { SCENARIOS, ScenarioRunner } from '../../src/control/scenarios';
import { AREAS } from '../../src/sim/config/areas';
import { Simulation } from '../../src/sim/simulation';
import { canyonAt } from '../../src/sim/terrain';

type Who = 'crew' | 'player';

const S = AREAS.shelf.terrain.params;

function start(who: Who) {
  const sc = SCENARIOS.find((s) => s.id === 'canyon')!;
  const c = new Controller(new Simulation(sc.initial));
  const runner = new ScenarioRunner(sc, c);
  c.crewTakesAll();
  if (who === 'player') c.submit({ kind: 'crew', system: 'all', crew: false }, 'keyboard');
  const send = (o: Order) => c.submit(o, 'keyboard');
  const run = (seconds: number, each?: (i: number) => void, until?: () => boolean) => {
    for (let i = 0; i < seconds * 100; i++) {
      each?.(i);
      c.step();
      runner.update();
      if (runner.status !== 'running' || until?.()) return;
    }
  };
  return { c, runner, send, run };
}

/** Steers for the canyon's centre line `ahead` metres further east, every two seconds. */
const follow = (c: Controller, send: (o: Order) => void, offset = 0, ahead = 160) => (i: number) => {
  if (i % 200 !== 0) return;
  const east = Math.min(4300, c.sim.y[1]! + ahead);
  const aim = canyonAt(east, S)!.centre + offset;
  const b = (Math.atan2(east - c.sim.y[1]!, aim - c.sim.y[0]!) * 180) / Math.PI;
  send({ kind: 'setHeading', heading: Math.round((b + 360) % 360) % 360 });
};

describe.each(['crew', 'player'] as const)('"Kanjonen" (%s)', (who) => {
  it('following the canyon deep and quietly reaches the buoy unseen', () => {
    const { c, runner, send, run } = start(who);
    send({ kind: 'setDepth', depth: 215 });
    send({ kind: 'setSpeed', knots: 6 });
    run(2400, follow(c, send));
    expect(runner.message).toMatch(/slutfört/);
    expect(c.sonar.detectedBy).toBeNull();
    expect(c.sim.telemetry().grounded).toBe(false);
  });

  it('the short way over the shelf, the corvettes’ pings find the boat', () => {
    const { c, runner, send, run } = start(who);
    send({ kind: 'setDepth', depth: 110 });
    send({ kind: 'setSpeed', knots: 6 });
    // Up out of the canyon first, then along the shelf beside it.
    run(600, follow(c, send), () => c.sim.y[2]! < 120);
    run(2400, follow(c, send, 600));
    expect(runner.status).toBe('failed');
    expect(runner.message).toMatch(/upptäckt/);
  });
});
