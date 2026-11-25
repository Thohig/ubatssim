/**
 * The crew near land on the surface and stopped, and hovering up from the deep (also
 * verticalSafety.long.test.ts).
 */
import { describe, expect, it } from 'vitest';
import { Controller } from '../../src/control/controller';
import type { Order } from '../../src/control/orders';
import { GameSession, freePlaySpec } from '../../src/game/session';
import type { AreaId } from '../../src/sim/config/areas';
import { Simulation } from '../../src/sim/simulation';

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

describe('on the surface and stopped near land', () => {
  // 12 knots on the surface into the archipelago: slowed only to 4 knots by the speed autopilot, it ran aground.
  it('12 knots on the surface towards the islands: full astern, and no grounding', () => {
    const c = new Controller(new Simulation({}));
    c.crewTakesAll();
    c.submit({ kind: 'setHeading', heading: 90 }, 'keyboard');
    c.submit({ kind: 'setSpeed', knots: 12 }, 'keyboard');
    let braked = false;
    for (let i = 0; i < 700 * 100 && c.sim.groundContacts === 0; i++) {
      c.step();
      if (c.conn.shoalBraking) braked = true;
    }
    expect(braked).toBe(true);
    expect(c.sim.groundContacts).toBe(0);
  });

  // Stopped in the sound the boat drifted with the current onto the rocks and nobody said a word.
  it('stopped in a sound, drifting with the current towards the shore: the crew moves away, then stops', () => {
    const { c, send, run } = play('westCoast', 'archipelago');
    send({ kind: 'setDepth', depth: 30 });
    run(700);
    expect(logged(c, /ubåten driver mot grundet i \d{3}°\. Besättningen går (back|fram) 2 knop\./)).toBe(true);
    expect(logged(c, /Ubåten är fri från grundet\. Stopp i maskin\./)).toBe(true);
    expect(logged(c, /Grundstötning/)).toBe(false);
  });
});

describe('hovering up from the deep', () => {
  // The rate up was as slow as down: 200 → 100 m stopped took ~17 minutes.
  it('200 → 100 m stopped within 14 minutes, without overshooting by more than a metre', () => {
    const { c, send, run } = play('atlantic', 'deep');
    send({ kind: 'setSpeed', knots: 0 });
    send({ kind: 'setDepth', depth: 100 });
    let shallowest = Infinity;
    let reachedAt: number | null = null;
    const t0 = c.sim.t;
    run(1000, () => {
      shallowest = Math.min(shallowest, c.sim.y[2]!);
      if (reachedAt === null && Math.abs(c.sim.y[2]! - 100) < 1) reachedAt = c.sim.t - t0;
    });
    expect(reachedAt).not.toBeNull();
    expect(reachedAt!).toBeLessThan(14 * 60);
    expect(shallowest).toBeGreaterThan(99);
  });
});

