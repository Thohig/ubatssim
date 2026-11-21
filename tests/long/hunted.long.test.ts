import { describe, expect, it } from 'vitest';
import { start } from './attackGame';

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
