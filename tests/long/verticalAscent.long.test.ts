/**
 * Depth changes found wrong in a play-through of every start position (also vertical.long.test.ts): the
 * ascent's hold for ships and the log after a leak.
 */
import { describe, expect, it } from 'vitest';
import { ASCENT } from '../../src/control/ascent';
import { Controller } from '../../src/control/controller';
import type { Order } from '../../src/control/orders';
import { GameSession, freePlaySpec } from '../../src/game/session';
import type { AreaId } from '../../src/sim/config/areas';
import { Simulation } from '../../src/sim/simulation';
import type { VesselDef } from '../../src/sim/vessel';

/** A free-play start without corvettes, five seconds in, as the player finds it. */
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

describe('the ascent holds at 35 m only for a ship close by', () => {
  // The signal excess alone said "strong contact" for freighters 6–12 km off: every ascent in free play
  // stayed at 35 m for good.
  it.each([
    ['atlantic', 'deep'],
    ['westCoast', 'deep'],
  ] as const)('%s, %s: distant traffic, straight up to periscope depth', (area, start) => {
    const { c, send, run } = play(area, start);
    send({ kind: 'setDepth', depth: 13 });
    run(900, () => !c.ascent.active);
    expect(logged(c, /stark kontakt/)).toBe(false);
    expect(Math.abs(c.sim.y[2]! - 13)).toBeLessThan(1);
  });

  it('a ship passing close: the crew waits at 35 m and goes on up by itself once it has passed', () => {
    const c = new Controller(new Simulation({ area: 'atlantic', current: { speed: 0, toward: 0, decay: 1 }, depth: 120, neutral: true, heading: 0 }));
    c.crewTakesAll();
    const ship: VesselDef = {
      id: 'forbi', name: 'M/S Förbi', kind: 'freighter', length: 130, beam: 20, draft: 8, speed: 6,
      turnRate: 0.01, route: [[700, -3500], [700, 30000]], repeat: 'shuttle', propellerRps: 2, blades: 4,
    };
    c.world.add([ship]);
    c.submit({ kind: 'setDepth', depth: 13 }, 'touch');
    let held = false;
    for (let i = 0; i < 1500 * 100 && (c.ascent.active || !held); i++) {
      c.step();
      if (c.ascent.phase === 'hold') {
        held = true;
        expect(Math.abs(c.sim.y[2]! - ASCENT.levelDepth)).toBeLessThan(3);
      }
    }
    expect(held).toBe(true);
    expect(logged(c, /ingen kontakt nära längre/)).toBe(true);
    expect(Math.abs(c.sim.y[2]! - 13)).toBeLessThan(1);
  });
});

describe('a leak after a grounding', () => {
  // Water trickling through the closing doors was pumped out of the next compartment every step, and each
  // time was logged: hundreds of "… är länsat." a second, which pushed the grounding out of the log.
  it('each compartment is reported pumped out once', () => {
    const { c, send, run } = play('fjord', 'sea');
    // Without the safety net, which now stops short of the fjord's side (vertical.long.test.ts).
    send({ kind: 'crew', system: 'safetyNet', crew: false });
    send({ kind: 'setSpeed', knots: 12 });
    send({ kind: 'setDepth', depth: 13 });
    run(700);
    expect(logged(c, /Grundstötning/)).toBe(true);
    const dry = c.log.filter((e) => / är länsat\.$/.test(e.text)).map((e) => e.text);
    expect(dry.length).toBe(new Set(dry).size);
  });
});
