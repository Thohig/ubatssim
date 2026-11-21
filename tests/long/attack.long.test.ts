import { describe, expect, it } from 'vitest';
import { freighter } from '../../src/control/areas';
import { Controller } from '../../src/control/controller';
import { Simulation } from '../../src/sim/simulation';
import { KN, periscopeAttack, readyTubes, start } from './attackGame';

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
