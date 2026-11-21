/**
 * The simulation is deterministic: the same start and the same orders give
 * exactly the same result (CLAUDE.md). This runs "Jagad" — a corvette that
 * hunts with active sonar and depth charges, leaks, the crew and the trim
 * assistant — with a fixed program of orders, and hashes the state.
 *
 * - Two runs must give the same hashes. That catches Math.random(), the wall
 *   clock and anything that depends on the order of a Map or a Set filled
 *   from outside.
 * - The hashes are compared with REFERENCE. They change, on purpose, when the
 *   physics, the crew or a scenario changes: then run `npm run
 *   update-determinism` (it writes the new values for this platform into this
 *   file) or copy the values printed by the failing test, and say so in the
 *   commit message.
 *   An optimisation must not change them (CLAUDE.md, "Optimeringar ska vara exakta").
 *   Floating point may differ in the last bit between platforms (macOS on
 *   ARM and Linux on x64 give different hashes after a minute, with the same
 *   Node), and a long simulation makes that visible: there is one reference
 *   per platform, and the test is skipped on a platform without one.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { Order } from '../../src/control/orders';
import { SCENARIOS } from '../../src/control/scenarios';
import { GameSession, scenarioSpec } from '../../src/game/session';

/** FNV-1a over the bytes of the numbers and the characters of the strings. */
function hash(values: readonly (number | string)[]): string {
  let h = 0x811c9dc5;
  const f = new Float64Array(1);
  const b = new Uint8Array(f.buffer);
  const mix = (x: number) => {
    h ^= x;
    h = Math.imul(h, 0x01000193) >>> 0;
  };
  for (const v of values) {
    if (typeof v === 'number') {
      f[0] = v;
      for (const x of b) mix(x);
    } else {
      for (let i = 0; i < v.length; i++) {
        mix(v.charCodeAt(i) & 0xff);
        mix(v.charCodeAt(i) >> 8);
      }
    }
  }
  return h.toString(16).padStart(8, '0');
}

function snapshot(s: GameSession): string {
  const c = s.ctrl;
  const values: (number | string)[] = [s.sim.t, ...s.sim.y];
  for (const v of c.world.vessels) values.push(v.def.id, v.state.north, v.state.east, v.state.heading, v.state.speed);
  for (const t of c.world.torpedoes) values.push(t.state.north, t.state.east, t.state.depth, t.state.phase);
  values.push(c.sim.systems.flooding.water, c.hunter.pings);
  for (const e of c.log) values.push(e.t, e.kind, e.text);
  values.push(s.runner?.status ?? '', s.runner?.progress.index ?? -1);
  return hash(values);
}

/** Orders at fixed times [s]. */
const PROGRAM: [number, Order][] = [
  [1, { kind: 'setDepth', depth: 200 }],
  [1, { kind: 'setSpeed', knots: 8 }],
  [40, { kind: 'setHeading', heading: 250 }],
  [70, { kind: 'crew', system: 'heading', crew: false }],
  [71, { kind: 'rudder', angle: 10 }],
  [90, { kind: 'setSpeed', knots: 4 }],
  [100, { kind: 'crew', system: 'heading', crew: true }],
  [120, { kind: 'setHeading', heading: 120 }],
  [150, { kind: 'setDepth', depth: 160 }],
];
// (in time order)
const CHECKPOINTS = [60, 120, 180, 240];

function run(): string[] {
  const sc = SCENARIOS.find((s) => s.id === 'hunted')!;
  const s = new GameSession(scenarioSpec(sc, ''));
  const out: string[] = [];
  let next = 0;
  for (const at of CHECKPOINTS) {
    while (s.sim.t < at - 1e-9) {
      while (next < PROGRAM.length && PROGRAM[next]![0] <= s.sim.t) s.ctrl.submit(PROGRAM[next++]![1], 'keyboard');
      s.step();
    }
    out.push(snapshot(s));
  }
  return out;
}

/** Update deliberately (see the comment at the top), per platform: `linux-x64` is what CI runs. */
const REFERENCE: Record<string, string[]> = {
  'darwin-arm64': ['ef8b1416', '625a80a8', 'e8d71e6d', '20288105'],
  'linux-x64': ['ef8b1416', '625a80a8', 'e8d71e6d', '76898e80'],
};
const PLATFORM = `${process.platform}-${process.arch}`;

describe('determinism', () => {
  const first = run();

  it('the same start and orders give exactly the same state', () => {
    expect(run()).toEqual(first);
  });

  it.skipIf(!REFERENCE[PLATFORM])(`the state matches the reference for ${PLATFORM} (changes only when the simulation is meant to)`, () => {
    // `npm run update-determinism` writes the new values into this file instead (no copying by hand).
    if (process.env.UPDATE_DETERMINISM === '1' && JSON.stringify(first) !== JSON.stringify(REFERENCE[PLATFORM])) {
      const file = fileURLToPath(import.meta.url);
      const line = new RegExp(`(  '${PLATFORM}': )\\[[^\\]]*\\]`);
      writeFileSync(file, readFileSync(file, 'utf8').replace(line, `$1[${first.map((h) => `'${h}'`).join(', ')}]`));
      console.log(`Determinism reference for ${PLATFORM} updated: ${JSON.stringify(first)}`);
      return;
    }
    expect(first, `new reference for ${PLATFORM}: ${JSON.stringify(first)}`).toEqual(REFERENCE[PLATFORM]);
  });
});
