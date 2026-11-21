import { describe, expect, it } from 'vitest';
import { freighter } from '../../src/control/areas';
import { Controller } from '../../src/control/controller';
import type { Order } from '../../src/control/orders';
import { SCENARIOS, ScenarioRunner } from '../../src/control/scenarios';
import { Simulation } from '../../src/sim/simulation';

type Who = 'crew' | 'player';
const KN = 1852 / 3600;

/** `timeLimit` [s] shortens the scenario's: the rule that fails it is the same, the test far shorter. */
function start(id: string, who: Who, timeLimit?: number) {
  const found = SCENARIOS.find((s) => s.id === id)!;
  const sc = timeLimit === undefined ? found : { ...found, timeLimit };
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

/** The player makes all four tubes ready (the torpedo room does it once a target is marked). */
function readyTubes(send: (o: Order) => void, who: Who) {
  if (who === 'player') for (let tube = 1; tube <= 4; tube++) send({ kind: 'tube', tube, action: 'ready' });
}

/** Periscope attack: mark and range (the player every 30 s; the crew ranges itself), then fire. */
function periscopeAttack(s: ReturnType<typeof start>, who: Who, id: string) {
  const { runner, send, run, bearingTo } = s;
  send({ kind: 'periscope', up: true });
  readyTubes(send, who);
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
    const s = start('practice-shot', who, 60);
    s.run(70);
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
    readyTubes(send, who);
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

  it('riding out every depth charge counts: the spent corvette is shaken off', () => {
    // The briefing says "until it loses you or runs out of depth charges"; the check used to want the first only.
    const { c, runner, send, run } = start('hunted', 'crew');
    send({ kind: 'setDepth', depth: 200 });
    send({ kind: 'setSpeed', knots: 8 });
    run(400, () => runner.progress.index >= 1);
    expect(runner.progress.index).toBe(1);
    // Spent (as after its last pattern), while it still hears the boat.
    (c.hunter as unknown as { hunt(id: string): { charges: number } }).hunt('jagaren').charges = 0;
    run(120);
    expect(c.hunter.spent('jagaren')).toBe(true);
    expect(runner.status).toBe('completed');
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

  it('staying above the layer at 8 knots after the attack brings the escort and its depth charges', () => {
    // The escort used to give up on its way to the heard launch (5–6 km off) before it got there.
    const s = start('convoy', 'crew');
    periscopeAttack(s, 'crew', 'lastaren');
    s.send({ kind: 'periscope', up: false });
    s.send({ kind: 'setDepth', depth: 60 });
    s.send({ kind: 'setSpeed', knots: 8 });
    s.run(700, () => s.c.log.some((e) => e.text.startsWith('Sjunkbomber i vattnet från korvetten Eskort')));
    expect(s.c.hunter.state('eskorten')).toBe('attack');
    expect(s.c.log.some((e) => e.text.startsWith('Sjunkbomber i vattnet från korvetten Eskort'))).toBe(true);
  });
});

describe('bearings-only analysis over a long attack', () => {
  it('the first leg stays when the list is full: the range is kept after ten minutes on the second leg', () => {
    // Sonar bearings every 10 s; 60 kept. The oldest went first, and 10 minutes after the course change
    // only the second leg was left and the solution was poor again ("Nattanfall").
    const c = new Controller(new Simulation({ area: 'atlantic', depth: 40, speed: 5 * KN, neutral: true, heading: 0 }));
    c.world.add([{ ...freighter('n', 'M/S Nord', [[6000, 5000], [6000, -9000]]), speed: 9 * KN }]);
    c.crewTakesAll();
    const run = (seconds: number) => {
      for (let i = 0; i < seconds * 100; i++) c.step();
    };
    run(25);
    c.submit({ kind: 'markTarget', label: c.sonar.contacts[0]!.label }, 'keyboard');
    run(35);
    c.submit({ kind: 'setHeading', heading: 60 }, 'keyboard');
    run(900);
    expect(c.fire.target!.obs.length).toBeLessThanOrEqual(61);
    expect(c.fire.target!.obs[0]!.t).toBeLessThan(60);
    expect(c.fire.target!.solution!.quality).not.toBe('dålig');
    // The fire controller does not ask for a course change that has been made.
    expect(c.log.filter((e) => e.t > 120 && /byt kurs minst 30/.test(e.text))).toHaveLength(0);
  });
});
