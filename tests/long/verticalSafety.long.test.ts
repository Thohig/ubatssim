/**
 * The crew's answers to what went wrong in the play-through of depth changes (also vertical.long.test.ts):
 * land ahead, a boat sinking without way, a shallow emergency blow, full ahead from the deep and the
 * trim on the way through a large depth change.
 */
import { describe, expect, it } from 'vitest';
import { Controller } from '../../src/control/controller';
import type { Order } from '../../src/control/orders';
import { GameSession, freePlaySpec } from '../../src/game/session';
import type { AreaId } from '../../src/sim/config/areas';
import { Simulation } from '../../src/sim/simulation';

const DEG = Math.PI / 180;

function play(area: AreaId, start: string) {
  const s = new GameSession(freePlaySpec(area, start, 'day', 'calm', '', false)!);
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

describe('land ahead', () => {
  // At 12 knots towards the side of the fjord the depth limit took the boat to the surface (the sail out)
  // and the crew slowed only to 4 knots: it ran aground at 5,5 knots with a leak.
  it('submerged at 12 knots: full astern and a turn to the deeper side, no grounding, the depth kept', () => {
    const { c, send, run } = play('fjord', 'sea');
    send({ kind: 'setSpeed', knots: 12 });
    send({ kind: 'setDepth', depth: 13 });
    let shallowest = Infinity;
    run(700, () => {
      if (c.sim.t > 120) shallowest = Math.min(shallowest, c.sim.y[2]!);
    });
    expect(logged(c, /land förut! Besättningen slår full back\. Gir (babord|styrbord) mot djupare vatten/)).toBe(true);
    expect(logged(c, /Grundstötning/)).toBe(false);
    // Stopped, it drifts with the outflow towards shallower water and follows the limit, but stays under.
    expect(shallowest).toBeGreaterThan(7);
  });
});

describe('sinking without way', () => {
  // Stopped with a leak the boat sank from 13 m to the bottom at 165 m and nobody did anything.
  it('a leak at 30 m, stopped: the crew drives at 6 knots to hold the depth, and stops once it is dry', () => {
    const c = new Controller(new Simulation({ area: 'atlantic', depth: 30, neutral: true, leaks: { engine: 3e-3 } }));
    c.crewTakesAll();
    c.submit({ kind: 'setSpeed', knots: 0 }, 'touch');
    c.submit({ kind: 'setDepth', depth: 30 }, 'touch');
    let deepest = 0;
    for (let i = 0; i < 1200 * 100; i++) {
      c.step();
      deepest = Math.max(deepest, c.sim.y[2]!);
    }
    expect(logged(c, /Ubåten sjunker förbi 30 m utan fart\. Maskinen går 6 knop/)).toBe(true);
    expect(deepest).toBeLessThan(55);
    expect(Math.abs(c.sim.y[2]! - 30)).toBeLessThan(1.5);
    expect(c.depthBoost).toBe(false);
  });
});

describe('an emergency blow from 50 m', () => {
  // The after tanks 15 s after the forward ones: the bow came up 31–36° in the Baltic.
  it('the bow comes up, but less than 15°', () => {
    const { c, send, run } = play('baltic', 'halocline');
    send({ kind: 'surface' });
    send({ kind: 'setDepth', depth: 0 });
    let pitch = 0;
    run(60, () => {
      pitch = Math.max(pitch, c.sim.kinematics().pitch);
    });
    expect(logged(c, /Akter om 4 s\./)).toBe(true);
    expect(pitch).toBeGreaterThan(3 * DEG);
    expect(pitch).toBeLessThan(15 * DEG);
    expect(c.sim.y[2]!).toBeLessThan(3);
  });
});

describe('full ahead from the deep', () => {
  it('goes straight up without levelling off to listen', () => {
    const { c, send, run } = play('atlantic', 'deep');
    send({ kind: 'setSpeed', knots: 19 });
    send({ kind: 'setDepth', depth: 30 });
    run(300, () => Math.abs(c.sim.y[2]! - 30) < 1);
    expect(c.ascent.active).toBe(false);
    expect(logged(c, /Stigning i/)).toBe(false);
    expect(Math.abs(c.sim.y[2]! - 30)).toBeLessThan(1);
  });
});

describe('the trim on the way', () => {
  // The order's own preparation is at most 2 000 l; under the Baltic halocline the boat is ~2,5 t light.
  it('13 → 90 m in the Baltic: the crew orders the rest of the compensation on the way', () => {
    const { c, send, run } = play('baltic', 'periscope');
    send({ kind: 'setDepth', depth: 90 });
    run(60);
    const orders = c.log.filter((e) => e.source === 'assist' && /^Kompensera in \d+ liter/.test(e.text));
    expect(orders.length).toBe(2);
    expect(Number(/(\d+) liter/.exec(orders[1]!.text)![1])).toBeGreaterThan(2000);
  });
});
