import { describe, expect, it } from 'vitest';
import { Controller } from '../../src/control/controller';
import { PERISCOPE_DEPTH } from '../../src/control/crew';
import { SCENARIOS, ScenarioRunner, waypointInfo } from '../scenarios';
import { Simulation } from '../../src/sim/simulation';
import { submitEmergencyBlow } from '../../src/ui/keyboard';

/** The "D" key: dive and, without a deeper target, periscope depth. */
const dive = (c: Controller) => {
  c.submit({ kind: 'dive' }, 'keyboard');
  if (!c.ap.depth || c.setpoints.depth < PERISCOPE_DEPTH) c.submit({ kind: 'setDepth', depth: PERISCOPE_DEPTH }, 'keyboard');
};

describe('scenarios with the crew handling everything', () => {
  const start = (id: string) => {
    const sc = SCENARIOS.find((s) => s.id === id)!;
    const c = new Controller(new Simulation(sc.initial));
    const runner = new ScenarioRunner(sc, c);
    c.crewTakesAll();
    const run = (seconds: number, until?: () => boolean) => {
      for (let i = 0; i < seconds * 100; i++) {
        c.step();
        runner.update();
        if (runner.status !== 'running' || until?.()) return;
      }
    };
    return { c, runner, run };
  };

  it('"Trimövning" locks the depth on Hand and the trim on the player; other scenarios leave the choice', () => {
    const { c } = start('trim-drill');
    expect(c.duties()).toMatchObject({ depth: false, trim: false, heading: true, ballast: true });
    for (const s of SCENARIOS.filter((x) => !['trim-drill', 'emergency-blow', 'tubes'].includes(x.id))) expect(s.locks).toBeUndefined();
  });

  it('"Första dykningen" can be completed with D, ↓ and S, the assistant trimming', () => {
    const { c, runner, run } = start('first-dive');
    dive(c);
    run(1);
    expect(runner.progress.index).toBe(2); // D clears the bridge and opens the vents
    expect(c.bridgeManned).toBe(false);
    for (let i = 0; i < 5; i++) c.submit({ kind: 'adjustSpeed', deltaKnots: 1 }, 'keyboard');
    run(90, () => runner.progress.index >= 3);
    expect(runner.progress.index).toBe(3);
    while (c.setpoints.depth < 30) {
      c.submit({ kind: 'adjustDepth', deltaMetres: 5 }, 'keyboard');
      run(0.02);
    }
    run(1200, () => runner.progress.index >= 5);
    expect(runner.progress.index).toBe(5);
    c.submit({ kind: 'surface' }, 'keyboard');
    run(400);
    expect(runner.status).toBe('completed');
  });

  it('"Språngskiktet" is completed by the assistant taking on water', () => {
    const { c, runner, run } = start('thermocline');
    c.submit({ kind: 'setDepth', depth: 90 }, 'console');
    run(1500);
    expect(runner.status).toBe('completed');
    expect(c.log.some((e) => e.source === 'assist' && /Kompensera in/.test(e.text))).toBe(true);
  });

  it('"Nödblåsning" has no automatic blow, but blowing (as the hint says) and speed save the boat', () => {
    const idle = start('emergency-blow');
    idle.run(600);
    expect(idle.runner.status).toBe('failed');
    expect(idle.c.log.some((e) => /nödblåsning/.test(e.text))).toBe(false);

    const { c, runner, run } = start('emergency-blow');
    submitEmergencyBlow(c, 'touch');
    run(600);
    expect(runner.status).toBe('completed');
    expect(c.duty('ballast')).toBe(true); // Nödblåsning leaves the ballast to the crew

    // Blås vid Båda in the panel (the player takes the ballast over), full ahead and the surface.
    const panel = start('emergency-blow');
    panel.c.submit({ kind: 'mainBallast', action: 'blow', group: 'all' }, 'touch');
    panel.c.submit({ kind: 'setSpeed', knots: 19 }, 'touch');
    panel.c.submit({ kind: 'setDepth', depth: 0 }, 'touch');
    panel.run(600);
    expect(panel.runner.status).toBe('completed');

    // The order "ytläge" (an emergency blow from any depth) still saves it.
    const ytl = start('emergency-blow');
    ytl.c.submit({ kind: 'surface' }, 'keyboard');
    ytl.c.submit({ kind: 'setSpeed', knots: 10 }, 'keyboard');
    ytl.run(600);
    expect(ytl.runner.status).toBe('completed');
  });

  it('"Genom sundet" can be completed with heading targets', () => {
    const { c, runner, run } = start('sound-transit');
    const route: [number, number][] = [
      [0, 2560], [100, 2600], [200, 2600], [300, 2640], [400, 2680], [500, 2720], [600, 2736],
      [700, 2776], [800, 2816], [900, 2856], [1000, 2856], [1100, 2848], [1200, 2848],
    ];
    c.submit({ kind: 'setSpeed', knots: 4 }, 'keyboard');
    for (let s = 0; s < 900 && runner.status === 'running'; s++) {
      const t = c.sim.telemetry();
      const nAim = Math.min(1200, t.position[0] + 60);
      const k = Math.min(route.length - 2, Math.floor(nAim / 100));
      const [n0, e0] = route[k]!;
      const [n1, e1] = route[k + 1]!;
      const { bearing } = waypointInfo(t, [nAim, e0 + ((e1 - e0) * (nAim - n0)) / (n1 - n0)]);
      // Steer like a player: 10° steps towards the bearing.
      const diff = ((((bearing - c.setpoints.heading) % 360) + 540) % 360) - 180;
      if (Math.abs(diff) >= 5) c.submit({ kind: 'adjustHeading', deltaDegrees: 10 * Math.sign(diff) }, 'keyboard');
      run(1);
    }
    expect(runner.status).toBe('completed');
  });
});
