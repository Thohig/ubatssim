import { describe, expect, it } from 'vitest';
import { Controller } from '../../src/control/controller';
import { PERISCOPE_DEPTH } from '../../src/control/crew';
import { Simulation } from '../../src/sim/simulation';
import { DEG } from '../../src/sim/units';

describe('a dive from the surface to a stop', () => {
  // Surfaced and stopped in the Baltic, Periskop: the boat is trimmed heavy for a dive with way on. It sank on
  // the compensation alone to 25 m before it turned (the hovering began at 8 m, the pump moves 6 l/s).
  it.each([
    ['the crew handles the speed: 4 knots during the dive, then stopped and hovering', false],
    ['the player has the shaft stopped: the crew pumps out during the dive and hovers', true],
  ] as const)('a dive from the surface to periscope depth without speed, %s', (_name, playerSpeed) => {
    const c = new Controller(new Simulation({ area: 'baltic' }));
    c.crewTakesAll();
    if (playerSpeed) c.submit({ kind: 'setRpm', rpm: 0 }, 'keyboard');
    c.submit({ kind: 'setDepth', depth: PERISCOPE_DEPTH }, 'keyboard');
    let deepest = 0;
    let reachedAt: number | null = null;
    for (let i = 0; i < 420 * 100; i++) {
      c.step();
      const d = c.sim.kinematics().depth;
      deepest = Math.max(deepest, d);
      if (reachedAt === null && Math.abs(d - PERISCOPE_DEPTH) < 1) reachedAt = c.sim.t;
    }
    expect(deepest).toBeLessThan(PERISCOPE_DEPTH + 1.5);
    expect(reachedAt).not.toBeNull();
    expect(reachedAt!).toBeLessThan(300);
    expect(Math.abs(c.sim.kinematics().depth - PERISCOPE_DEPTH)).toBeLessThan(1);
    expect(c.hovering).toBe(true);
    expect(c.log.some((e) => e.text === `Trimmet förbereds för att stå still på ${PERISCOPE_DEPTH} m.`)).toBe(true);
    expect(c.log.some((e) => e.text === 'Maskinen går 6 knop under dykningen, så att djuprodren biter.')).toBe(!playerSpeed);
    // Stopped on purpose, the planes are not what is wrong.
    expect(c.log.some((e) => /Djuprodren orkar inte/.test(e.text))).toBe(false);
  });
});

describe('a dive to a stop in a rough sea', () => {
  // Rough Atlantic (Hs 3 m): the waves lift a boat near the surface (~65 kg at 13 m in a head or following
  // sea). At 4 knots the planes took four minutes to reach periscope depth, and the hovering, which saw
  // only the net buoyancy, then hung 1,5–2,5 m above the target, as heavy as its speed term asked for.
  it('reaches periscope depth at 6 knots and hovers there', () => {
    const c = new Controller(new Simulation({ area: 'atlantic', sea: 'rough' }));
    c.crewTakesAll();
    c.submit({ kind: 'setDepth', depth: PERISCOPE_DEPTH }, 'keyboard');
    let reachedAt: number | null = null;
    let sum = 0;
    let n = 0;
    for (let i = 0; i < 600 * 100; i++) {
      c.step();
      const d = c.sim.kinematics().depth;
      if (reachedAt === null && Math.abs(d - PERISCOPE_DEPTH) < 0.5) reachedAt = c.sim.t;
      if (c.sim.t > 480) {
        sum += d;
        n++;
      }
    }
    expect(c.log.some((e) => e.text === 'Maskinen går 6 knop under dykningen, så att djuprodren biter.')).toBe(true);
    expect(reachedAt).not.toBeNull();
    expect(reachedAt!).toBeLessThan(200); // 247 s at 4 knots
    expect(c.hovering).toBe(true);
    expect(Math.abs(sum / n - PERISCOPE_DEPTH)).toBeLessThan(0.7); // 10,4–12,7 m without the integral
  });

  it.each([0, 160])('hovers on periscope depth heading %d°', (heading) => {
    const c = new Controller(new Simulation({ area: 'atlantic', sea: 'rough', depth: PERISCOPE_DEPTH, heading: heading * DEG, neutral: true }));
    c.crewTakesAll();
    c.submit({ kind: 'setDepth', depth: PERISCOPE_DEPTH }, 'keyboard');
    c.submit({ kind: 'setHeading', heading }, 'keyboard');
    c.submit({ kind: 'setSpeed', knots: 0 }, 'keyboard');
    let sum = 0;
    let n = 0;
    for (let i = 0; i < 400 * 100; i++) {
      c.step();
      if (c.sim.t > 200) {
        sum += c.sim.kinematics().depth;
        n++;
      }
    }
    expect(c.hovering).toBe(true);
    expect(Math.abs(sum / n - PERISCOPE_DEPTH)).toBeLessThan(0.5); // ~11,5 m without the integral
  });
});
