import { describe, expect, it } from 'vitest';
describe('a course reversal', () => {
  it('a target 180° off turns the boat round (the wrapped error used to flip sign and hold it on its course)', async () => {
    const { Controller } = await import('../src/control/controller');
    const { Simulation } = await import('../src/sim/simulation');
    const c = new Controller(new Simulation({ depth: 30, neutral: true, heading: 0, speed: 2 }));
    c.crewTakesAll();
    c.submit({ kind: 'setHeading', heading: 180 }, 'keyboard');
    for (let i = 0; i < 18000; i++) c.step();
    const h = (c.sim.kinematics().heading * 180) / Math.PI;
    expect(Math.min(h, 360 - h)).toBeGreaterThan(60);
  });
});
