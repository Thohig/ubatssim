import { describe, expect, it } from 'vitest';
import { Controller } from '../src/control/controller';
import { Simulation } from '../src/sim/simulation';

const KN = 1852 / 3600;
const run = (c: Controller, seconds: number) => {
  for (let i = 0; i < seconds * 100; i++) c.step();
};
/** At 40 m and 3 knots, told to go to periscope depth. */
const slowClimb = (crewSpeed: boolean) => {
  const c = new Controller(new Simulation({ area: 'atlantic', depth: 40, speed: 3 * KN, neutral: true }));
  c.crewTakesAll();
  if (crewSpeed) c.submit({ kind: 'setSpeed', knots: 3 }, 'keyboard');
  else c.submit({ kind: 'setRpm', rpm: Math.round(c.sim.rpsForSpeed(3 * KN) * 60) }, 'keyboard');
  c.submit({ kind: 'setDepth', depth: 13 }, 'keyboard');
  return c;
};

describe('the planes need speed', () => {
  it('the crew raises the speed to 4 knots until the depth is reached, then goes back', () => {
    const c = slowClimb(true);
    run(c, 60);
    expect(c.depthBoost).toBe(true);
    expect(c.log.some((e) => e.text === 'Djuprodren orkar inte vid den här farten. Maskinen ökar till 4 knop tills djupet är nått.')).toBe(true);
    expect(c.setpoints.speed).toBe(3); // the player's speed is kept
    run(c, 500);
    expect(c.depthBoost).toBe(false);
    expect(Math.abs(c.sim.y[2]! - 13)).toBeLessThan(3);
    expect(c.log.some((e) => e.text === 'Djupet nått. Maskinen går tillbaka till 3 knop.')).toBe(true);
  });

  it("with the speed in the player's hands, the depth helmsman says so", () => {
    const c = slowClimb(false);
    run(c, 60);
    expect(c.depthBoost).toBe(false);
    expect(c.log.some((e) => e.text === 'Djuprodren orkar inte vid den här farten. Öka till minst 4 knop.')).toBe(true);
    expect(c.sim.y[2]!).toBeGreaterThan(35);
  });

  it('a climb with enough speed says nothing', () => {
    const c = new Controller(new Simulation({ area: 'atlantic', depth: 40, speed: 6 * KN, neutral: true }));
    c.crewTakesAll();
    c.submit({ kind: 'setSpeed', knots: 6 }, 'keyboard');
    c.submit({ kind: 'setDepth', depth: 13 }, 'keyboard');
    run(c, 300);
    expect(c.log.some((e) => e.text.startsWith('Djuprodren orkar inte'))).toBe(false);
  });

  it('a new speed order ends the boost: full ahead and then Stopp is a full stop, not 4 knots', () => {
    const c = slowClimb(true);
    run(c, 60);
    expect(c.depthBoost).toBe(true);
    c.submit({ kind: 'setSpeed', knots: 19 }, 'keyboard');
    c.submit({ kind: 'setDepth', depth: 50 }, 'keyboard');
    run(c, 30);
    expect(c.depthBoost).toBe(false);
    c.submit({ kind: 'setSpeed', knots: 0 }, 'keyboard');
    run(c, 1);
    expect(c.conn.crashStopping).toBe(true);
    expect(c.crewSpeed()).toBeNull();
  });

  it('diving from the surface at full ahead, the depth helmsman does not ask for more speed', () => {
    const c = new Controller(new Simulation({ area: 'atlantic', designTrim: true }));
    c.crewTakesAll();
    c.submit({ kind: 'setSpeed', knots: 19 }, 'keyboard');
    c.submit({ kind: 'setDepth', depth: 50 }, 'keyboard');
    run(c, 70);
    expect(c.log.some((e) => /Djuprodren orkar inte/.test(e.text))).toBe(false);
    expect(c.sim.y[2]!).toBeGreaterThan(15);
  });
});
