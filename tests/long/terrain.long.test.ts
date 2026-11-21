import { describe, expect, it } from 'vitest';
import { Controller } from '../../src/control/controller';
import { SCENARIOS, ScenarioRunner, waypointInfo } from '../../src/control/scenarios';
import { Simulation } from '../../src/sim/simulation';

describe('grounding', () => {
  it('a heavy boat comes to rest on the sea bed without sinking into it', () => {
    const s = new Simulation({ depth: 30, east: 2300, designTrim: true, tankFills: { comp: 0.8 } });
    for (let i = 0; i < 200 * 100; i++) s.step();
    const t = s.telemetry();
    expect(t.grounded).toBe(true);
    expect(Math.abs(t.w)).toBeLessThan(0.01);
    expect(t.depthUnderKeel).toBeGreaterThan(-0.5);
    expect(t.depthUnderKeel).toBeLessThan(3);
  });

  it('the crew warns of the shore ahead, slows down, and stops the engine after grounding', () => {
    // Diving east towards the archipelago at 8 knots: the safety net used to look a fixed 150 m ahead,
    // limited the depth only 29 m above the bottom, and the crew drove on into the land for minutes.
    const c = new Controller(new Simulation({}));
    c.crewTakesAll();
    c.submit({ kind: 'setHeading', heading: 90 }, 'keyboard');
    c.submit({ kind: 'setSpeed', knots: 8 }, 'keyboard');
    c.submit({ kind: 'setDepth', depth: 80 }, 'keyboard');
    let warnedAt = -1;
    let speedAtWarning = 0;
    for (let i = 0; i < 1000 * 100; i++) {
      c.step();
      if (warnedAt < 0 && c.log.some((e) => /grunt förut/.test(e.text))) {
        warnedAt = c.sim.t;
        c.step(); // the crew's speed order is carried out at the next step
        speedAtWarning = c.setpoints.speed;
      }
      if (c.sim.groundContacts > 0) break;
    }
    expect(warnedAt).toBeGreaterThan(0);
    expect(speedAtWarning).toBeLessThanOrEqual(4);
    for (let i = 0; i < 10; i++) c.step();
    expect(c.log.some((e) => e.text === 'Stopp i maskin efter grundstötningen.')).toBe(true);
    expect(c.setpoints.speed).toBe(0);
  });

  it('driving into the archipelago ends on the rocks, and the log says so', () => {
    const c = new Controller(new Simulation({ depth: 25, east: 1800, heading: Math.PI / 2, speed: 4, designTrim: true }));
    c.submit({ kind: 'setDepth', depth: 25 }, 'console');
    c.submit({ kind: 'setHeading', heading: 90 }, 'console');
    c.submit({ kind: 'setSpeed', knots: 8 }, 'console');
    for (let i = 0; i < 400 * 100; i++) c.step();
    const t = c.sim.telemetry();
    expect(c.log.some((e) => e.kind === 'error' && e.text.startsWith('Grundstötning'))).toBe(true);
    expect(Number.isFinite(t.depth)).toBe(true);
    expect(t.position[1]).toBeLessThan(3000);
  });
});

describe('scenario "Genom sundet"', () => {
  const sc = SCENARIOS.find((s) => s.id === 'sound-transit')!;
  // Channel centre line found by a widest-path search over the terrain.
  const route: [number, number][] = [
    [0, 2560], [100, 2600], [200, 2600], [300, 2640], [400, 2680], [500, 2720], [600, 2736],
    [700, 2776], [800, 2816], [900, 2856], [1000, 2856], [1100, 2848], [1200, 2848],
  ];

  it('can be completed by following the channel', () => {
    const c = new Controller(new Simulation(sc.initial));
    const runner = new ScenarioRunner(sc, c);
    c.submit({ kind: 'setSpeed', knots: 4 }, 'console');
    for (let i = 0; i < 900 * 100 && runner.status === 'running'; i++) {
      if (i % 100 === 0) {
        const t = c.sim.telemetry();
        // Pure pursuit: aim at the route point 60 m ahead (linear interpolation).
        const nAim = Math.min(1200, t.position[0] + 60);
        const k = Math.min(route.length - 2, Math.floor(nAim / 100));
        const [n0, e0] = route[k]!;
        const [n1, e1] = route[k + 1]!;
        const eAim = e0 + ((e1 - e0) * (nAim - n0)) / (n1 - n0);
        const { bearing } = waypointInfo(t, [nAim, eAim]);
        c.submit({ kind: 'setHeading', heading: Math.round(bearing) % 360 }, 'console');
      }
      c.step();
      runner.update();
    }
    expect(runner.message).toMatch(/slutfört/);
    expect(runner.status).toBe('completed');
  });

  it('fails when the boat runs aground', () => {
    const c = new Controller(new Simulation(sc.initial));
    const runner = new ScenarioRunner(sc, c);
    c.submit({ kind: 'setSpeed', knots: 6 }, 'console');
    c.submit({ kind: 'setHeading', heading: 90 }, 'console'); // straight into the rocks
    for (let i = 0; i < 400 * 100 && runner.status === 'running'; i++) {
      c.step();
      runner.update();
    }
    expect(runner.status).toBe('failed');
    expect(runner.message).toMatch(/grund/);
  });
});
