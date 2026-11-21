import { describe, expect, it } from 'vitest';
import { freighter } from '../src/control/areas';
import { Controller } from '../src/control/controller';
import { WEAPONS } from '../src/sim/config/weapons';
import { Simulation } from '../src/sim/simulation';

const KN = 1852 / 3600;
const run = (c: Controller, seconds: number, until?: () => boolean) => {
  for (let i = 0; i < seconds * 100; i++) {
    c.step();
    if (until?.()) return;
  }
};

/** A target 6 knots east, 3 km north, marked and ranged through the periscope; tubes ready. */
function attack() {
  const s = freighter('m', 'målfartyget', [[3000, -3000], [3000, 6000]]);
  s.speed = 6 * KN;
  const c = new Controller(new Simulation({ area: 'atlantic', depth: 13, neutral: true, heading: 0 }));
  c.world.add([s]);
  c.crewTakesAll();
  c.submit({ kind: 'periscope', up: true }, 'keyboard');
  run(c, 10);
  const brg = () => (c.world.contacts()[0]!.bearing * 180) / Math.PI;
  c.submit({ kind: 'markTarget', bearing: brg() }, 'keyboard');
  c.submit({ kind: 'rangeTarget', bearing: brg(), magnification: 1 }, 'keyboard');
  run(c, 30);
  c.submit({ kind: 'markTarget', bearing: brg() }, 'keyboard');
  c.submit({ kind: 'rangeTarget', bearing: brg(), magnification: 1 }, 'keyboard');
  run(c, 1);
  return c;
}

describe('wire-guided torpedoes', () => {
  it('a torpedo fired on a wrong course misses; aimed again through the wire, it hits', () => {
    for (const steer of [false, true]) {
      const c = attack();
      c.submit({ kind: 'fireTorpedo' }, 'keyboard');
      run(c, 1);
      const t = c.world.torpedoes[0]!;
      expect(t.state.wired).toBe(true);
      expect(c.wire.targetOf(t.state.id)).toBe('M1');
      // As if the solution had been poor: 25° off, the seeker kept asleep.
      t.orders.course += (25 * Math.PI) / 180;
      t.orders.seekAfter = 1e9;
      run(c, 20);
      if (steer) c.submit({ kind: 'wire', torpedo: t.state.id, action: 'update' }, 'touch');
      run(c, 500, () => t.state.phase === 'done');
      expect(t.state.result).toBe(steer ? 'hit' : 'miss');
      if (steer) expect(c.log.some((e) => /^Torped 1 styrd mot M1: kurs \d{3}°/.test(e.text))).toBe(true);
    }
  });

  it('seek wakes the seeker now; cut leaves it on its own and refuses more orders', () => {
    const c = attack();
    c.submit({ kind: 'fireTorpedo' }, 'keyboard');
    run(c, 5);
    const t = c.world.torpedoes[0]!;
    c.submit({ kind: 'wire', torpedo: t.state.id, action: 'seek' }, 'touch');
    run(c, 0.1);
    expect(t.orders.seekAfter).toBeLessThanOrEqual(t.state.run);
    c.submit({ kind: 'wire', torpedo: t.state.id, action: 'cut' }, 'touch');
    run(c, 0.1);
    expect(t.state.wired).toBe(false);
    c.submit({ kind: 'wire', torpedo: t.state.id, action: 'update' }, 'touch');
    run(c, 0.1);
    expect(c.log.at(-1)!.text).toBe(`Torped ${t.state.id} har ingen tråd.`);
  });

  it('the wire parts when the boat goes too fast, or turns too far', () => {
    // Each torpedo sent off the target so that it runs its whole range (~8 min).
    const away = (c: Controller) => {
      c.submit({ kind: 'fireTorpedo' }, 'keyboard');
      run(c, 0.1);
      const t = c.world.torpedoes[0]!;
      t.orders.course += Math.PI / 2;
      t.orders.seekAfter = 1e9;
      return t;
    };
    const fast = attack();
    const tf = away(fast);
    fast.submit({ kind: 'setSpeed', knots: 19 }, 'keyboard');
    run(fast, 300, () => !tf.state.wired);
    expect(tf.state.wired).toBe(false);
    expect(fast.sim.kinematics().u).toBeGreaterThan(WEAPONS.torpedo.wireSpeed);
    expect(fast.log.some((e) => /har gått av \(för hög fart\)/.test(e.text))).toBe(true);

    const turn = attack();
    const tt = away(turn);
    turn.submit({ kind: 'setHeading', heading: 180 }, 'keyboard');
    turn.submit({ kind: 'setSpeed', knots: 7 }, 'keyboard'); // under the wire's speed limit, but a faster turn
    run(turn, 400, () => !tt.state.wired);
    expect(turn.log.some((e) => /har gått av \(ubåten svängde för långt\)/.test(e.text))).toBe(true);
  });
});
