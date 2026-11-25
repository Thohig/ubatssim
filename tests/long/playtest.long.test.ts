import { describe, expect, it } from 'vitest';
import { start } from './attackGame';

/** Fixes from the playtest (November 2026) that need minutes of game time. */
describe('playtest fixes', () => {
  it('Kanjonen without orders: the crew no longer backs into the canyon wall it drifts away from', () => {
    const s = start('canyon', 'crew');
    s.run(700);
    expect(s.runner.status).not.toBe('failed');
    expect(s.c.log.some((e) => /driver mot grundet/.test(e.text))).toBe(true);
  });

  it('after a salvo at 3 knots the crew holds periscope depth: it compensates for the torpedoes at once', () => {
    const s = start('convoy', 'crew');
    const { c, send, run, bearingTo } = s;
    send({ kind: 'periscope', up: true });
    run(12);
    for (let i = 0; i < 8 && !['ok', 'bra'].includes(c.fire.target?.solution?.quality ?? ''); i++) {
      send({ kind: 'markTarget', bearing: bearingTo('lastaren') });
      run(30);
    }
    send({ kind: 'setSpread', count: 3 });
    send({ kind: 'fireTorpedo' });
    run(2);
    expect(c.log.some((e) => /^Kompensera in \d+ liter, ja/.test(e.text))).toBe(true);
    let shallowest = Infinity;
    for (let i = 0; i < 200; i++) {
      run(1);
      shallowest = Math.min(shallowest, c.sim.y[2]!);
    }
    // It rose to 8.2 m (the scenario fails above 8 m); now it stays near 10 m and comes back.
    expect(shallowest).toBeGreaterThan(9);
  });

  it('a bearings-only solution along the own track is never ok (it put the target 13–60 m away)', () => {
    const s = start('night-attack', 'crew');
    const { c, send, run } = s;
    run(25);
    const label = c.sonar.contacts.find((k) => !k.bio)!.label;
    send({ kind: 'markTarget', label });
    run(100);
    send({ kind: 'adjustHeading', deltaDegrees: 60 });
    for (let i = 0; i < 40; i++) {
      run(10);
      const sol = c.fire.target?.solution;
      if (sol && sol.quality !== 'dålig') expect(Math.hypot(sol.position[0] - c.sim.y[0]!, sol.position[1] - c.sim.y[1]!)).toBeGreaterThan(1000);
    }
  });
});
