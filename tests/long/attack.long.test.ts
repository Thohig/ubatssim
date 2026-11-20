import { describe, expect, it } from 'vitest';
import { Controller } from '../../src/control/controller';
import type { Order } from '../../src/control/orders';
import { SCENARIOS, ScenarioRunner } from '../../src/control/scenarios';
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
  /** True bearing [deg] to a vessel (what the cross hair shows when it is on it). */
  const bearingTo = (id: string) => {
    const k = c.world.contacts().find((x) => x.vessel.def.id === id)!;
    return (k.bearing * 180) / Math.PI;
  };
  return { c, runner, send, run, bearingTo };
}

/** Periscope attack: mark and range (the player every 30 s; the crew ranges itself), then fire. */
function periscopeAttack(s: ReturnType<typeof start>, who: Who, id: string) {
  const { runner, send, run, bearingTo } = s;
  send({ kind: 'periscope', up: true });
  run(12);
  const good = () => ['ok', 'bra'].includes(s.c.fire.target?.solution?.quality ?? '');
  for (let i = 0; i < 8 && !good(); i++) {
    send({ kind: 'markTarget', bearing: bearingTo(id) });
    if (who === 'player') send({ kind: 'rangeTarget', bearing: bearingTo(id), magnification: 1 });
    run(30);
  }
  const q = s.c.fire.target?.solution?.quality;
  expect(q === 'ok' || q === 'bra').toBe(true);
  send({ kind: 'fireTorpedo' });
  run(1);
  expect(runner.status).toBe('running');
}

describe('"Övningsskott"', () => {
  it.each(['crew', 'player'] as const)('mark, range, fire and hit (%s)', (who) => {
    const s = start('practice-shot', who);
    periscopeAttack(s, who, 'ovning');
    s.run(400);
    expect(s.runner.status).toBe('completed');
    expect(s.c.hits).toBe(1);
  });

  it.each(['crew', 'player'] as const)('fails when time runs out without a shot (%s)', (who) => {
    const s = start('practice-shot', who);
    s.run(1600);
    expect(s.runner.status).toBe('failed');
    expect(s.runner.message).toBe('Tiden tog slut.');
  });
});

describe('"Nattanfall"', () => {
  it.each(['crew', 'player'] as const)('sonar bearings from two legs give a solution; a spread of two hits (%s)', (who) => {
    const { c, runner, send, run } = start('night-attack', who);
    send({ kind: 'setDepth', depth: 40 });
    send({ kind: 'setSpeed', knots: 5 });
    run(5);
    send({ kind: 'markTarget', label: 'S1' });
    run(240);
    send({ kind: 'setHeading', heading: 300 });
    run(420, () => runner.progress.index >= 2);
    expect(runner.progress.index).toBe(2);
    send({ kind: 'setSpread', count: 2 });
    send({ kind: 'fireTorpedo' });
    run(700);
    expect(runner.status).toBe('completed');
    expect(c.hits).toBeGreaterThanOrEqual(1);
  });
});

describe('breaking the surface', () => {
  it.each([
    ['night-attack', 'crew'],
    ['night-attack', 'player'],
    ['convoy', 'crew'],
    ['convoy', 'player'],
  ] as const)('%s fails when the boat surfaces (%s)', (id, who) => {
    const { runner, send, run } = start(id, who);
    send({ kind: 'surface' });
    run(600);
    expect(runner.status).toBe('failed');
    expect(runner.message).toMatch(/bröt ytan/);
  });
});

describe('"Jagad"', () => {
  it.each(['crew', 'player'] as const)('deep, slow and away: the corvette gives up (%s)', (who) => {
    const { c, runner, send, run } = start('hunted', who);
    // Down through the layer at 8 knots, then slow, quiet and turned away.
    send({ kind: 'setDepth', depth: 200 });
    send({ kind: 'setSpeed', knots: 8 });
    send({ kind: 'setHeading', heading: 180 });
    run(240);
    send({ kind: 'setSpeed', knots: 4 });
    send({ kind: 'setHeading', heading: 270 });
    run(1300);
    expect(runner.status).toBe('completed');
    expect(c.sim.systems.flooding.water).toBeLessThan(120);
  });

  it.each(['crew', 'player'] as const)('fails when the boat stays shallow and fast (%s)', (who) => {
    const { runner, send, run } = start('hunted', who);
    send({ kind: 'setDepth', depth: 30 });
    send({ kind: 'setSpeed', knots: 12 });
    run(1520);
    // Sunk, rammed after blowing to the surface, or still hunted when time runs out.
    expect(runner.status).toBe('failed');
  });
});

describe('"Konvojen"', () => {
  it.each(['crew', 'player'] as const)('sink the freighter, then go deep and slip away (%s)', (who) => {
    const s = start('convoy', who);
    periscopeAttack(s, who, 'lastaren');
    s.send({ kind: 'periscope', up: false });
    s.send({ kind: 'setDepth', depth: 200 });
    s.send({ kind: 'setSpeed', knots: 8 });
    s.send({ kind: 'setHeading', heading: 180 });
    s.run(240);
    s.send({ kind: 'setSpeed', knots: 4 });
    s.send({ kind: 'setHeading', heading: 270 });
    s.run(2500);
    expect(s.runner.status).toBe('completed');
  });
});
