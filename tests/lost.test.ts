import { describe, expect, it } from 'vitest';
import { Controller } from '../src/control/controller';
import { Simulation } from '../src/sim/simulation';

describe('a lost boat', () => {
  it('after the hull collapses the crew gives no more orders (it ordered 786 m³ out of the compensating tank)', () => {
    const c = new Controller(new Simulation({ area: 'atlantic', depth: 200, designTrim: true }));
    c.crewTakesAll();
    c.sim.systems.flooding.collapsed = true;
    const before = c.log.length;
    c.submit({ kind: 'setSpeed', knots: 0 }, 'touch');
    for (let i = 0; i < 100 * 60; i++) c.step();
    const assist = c.log.slice(before).filter((e) => e.source === 'assist');
    expect(assist.map((e) => e.text)).toEqual([]);
  });

  it('the hovering crew never orders more than the compensating tank holds or has room for', () => {
    const c = new Controller(new Simulation({ area: 'atlantic', depth: 100, designTrim: true }));
    c.crewTakesAll();
    c.submit({ kind: 'setSpeed', knots: 0 }, 'touch');
    c.submit({ kind: 'setDepth', depth: 20 }, 'touch');
    const comp = c.sim.tankDefs.findIndex((d) => d.kind === 'compensating');
    const volume = c.sim.tankDefs[comp]!.volume * 1000;
    for (let i = 0; i < 100 * 300; i++) {
      c.step();
      expect(Math.abs(c.sim.compRemaining * 1000)).toBeLessThanOrEqual(volume + 1);
    }
  });
});
