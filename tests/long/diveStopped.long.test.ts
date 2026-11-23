import { describe, expect, it } from 'vitest';
import { Controller } from '../../src/control/controller';
import { PERISCOPE_DEPTH } from '../../src/control/crew';
import { Simulation } from '../../src/sim/simulation';

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
    expect(c.log.some((e) => e.text === 'Maskinen går 4 knop under dykningen, så att djuprodren biter.')).toBe(!playerSpeed);
    // Stopped on purpose, the planes are not what is wrong.
    expect(c.log.some((e) => /Djuprodren orkar inte/.test(e.text))).toBe(false);
  });
});
