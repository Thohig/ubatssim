/**
 * Depth changes found wrong in a play-through of every start position: a stop with a new depth target
 * and the safety net's limit in shallow water (the ascent and the log after a leak: verticalAscent.long.test.ts).
 */
import { describe, expect, it } from 'vitest';
import { Controller } from '../../src/control/controller';
import type { Order } from '../../src/control/orders';
import { GameSession, freePlaySpec } from '../../src/game/session';
import type { AreaId } from '../../src/sim/config/areas';

/** A free-play start without corvettes, five seconds in, as the player finds it. */
function play(area: AreaId, start: string) {
  const s = new GameSession(freePlaySpec(area, start, 'day', 'calm', '', 'peace')!);
  const c = s.ctrl;
  const run = (seconds: number, each?: () => boolean | void) => {
    for (let i = 0; i < seconds * 100; i++) {
      s.step();
      if (i % 100 === 0 && each?.()) return;
    }
  };
  run(5);
  const send = (o: Order) => c.submit(o, 'touch');
  return { c, send, run };
}

const logged = (c: Controller, re: RegExp) => c.log.some((e) => re.test(e.text));

describe('Stopp with a new depth target: the crew hovers there', () => {
  // The depth autopilot chased the target with hard-over planes while the way came off: below the planes'
  // reversal speed their lift moved the whole boat, 7 m up for a target 10 m down (from periscope depth up
  // to 7 m, the sail nearly out), and the hovering began 7° bow down.
  it.each([
    ['baltic', 'halocline', 60],
    ['atlantic', 'periscope', 30],
    ['westCoast', 'periscope', 20],
  ] as const)('%s, %s → %d m: no move the wrong way, no overshoot', (area, start, target) => {
    const { c, send, run } = play(area, start);
    const from = c.sim.y[2]!;
    const down = target > from;
    send({ kind: 'setSpeed', knots: 0 });
    send({ kind: 'setDepth', depth: target });
    let wrongWay = 0;
    let beyond = 0;
    let pitch = 0;
    let reachedAt: number | null = null;
    const t0 = c.sim.t;
    run(600, () => {
      const k = c.sim.kinematics();
      wrongWay = Math.max(wrongWay, down ? from - k.depth : k.depth - from);
      beyond = Math.max(beyond, down ? k.depth - target : target - k.depth);
      if (!c.hovering) pitch = Math.max(pitch, Math.abs(k.pitch));
      if (reachedAt === null && Math.abs(k.depth - target) < 1) reachedAt = c.sim.t - t0;
    });
    expect(wrongWay).toBeLessThan(1);
    expect(pitch).toBeLessThan(2 * (Math.PI / 180));
    expect(beyond).toBeLessThan(1.5);
    expect(reachedAt).not.toBeNull();
    expect(c.hovering).toBe(true);
  });
});

describe('the safety net gives a limited depth target back', () => {
  // 150 m ordered at the shelf edge was limited to 134 m over the shelf and stayed so over 1 000 m of water.
  it('150 m over the shelf: limited there, back to 150 m beyond the edge', () => {
    const { c, send, run } = play('shelf', 'periscope');
    send({ kind: 'setSpeed', knots: 12 });
    send({ kind: 'setDepth', depth: 150 });
    run(400, () => Math.abs(c.sim.y[2]! - 150) < 1);
    expect(logged(c, /djupet begränsas till 13\d m/)).toBe(true);
    expect(logged(c, /djupare vatten, tillbaka till 150 m/)).toBe(true);
    expect(c.setpoints.depth).toBe(150);
    expect(Math.abs(c.sim.y[2]! - 150)).toBeLessThan(1);
  });

  it('a new depth order replaces the limited one', () => {
    const { c, send, run } = play('shelf', 'periscope');
    send({ kind: 'setSpeed', knots: 12 });
    send({ kind: 'setDepth', depth: 150 });
    run(30);
    expect(c.setpoints.depth).toBeLessThan(150);
    send({ kind: 'setDepth', depth: 60 });
    run(300);
    expect(c.setpoints.depth).toBe(60);
    expect(logged(c, /tillbaka till/)).toBe(false);
  });
});
