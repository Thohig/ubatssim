import { describe, expect, it } from 'vitest';
import { Controller } from '../src/control/controller';
import { PERISCOPE_DEPTH, type GameMode } from '../src/control/gameMode';
import { acknowledgement, type Order } from '../src/control/orders';
import { parseCommand } from '../src/control/parser';
import { SCENARIOS, ScenarioRunner, scenarioMode, waypointInfo } from '../src/control/scenarios';
import { ASSIST } from '../src/control/trimAssist';
import { Simulation, type InitialConditions } from '../src/sim/simulation';

const G = 9.80665;
const DEG = 180 / Math.PI;

function game(initial: InitialConditions, mode: GameMode) {
  const c = new Controller(new Simulation(initial));
  c.setMode(mode);
  const run = (seconds: number, each?: () => void) => {
    for (let i = 0; i < seconds * 100; i++) {
      c.step();
      each?.();
    }
  };
  const send = (o: Order) => c.submit(o, 'keyboard');
  return { c, sim: c.sim, run, send };
}

/** The simplified "D" key: dive and, without a deeper target, periscope depth. */
const dive = (c: Controller) => {
  c.submit({ kind: 'dive' }, 'keyboard');
  if (!c.ap.depth || c.setpoints.depth < PERISCOPE_DEPTH) c.submit({ kind: 'setDepth', depth: PERISCOPE_DEPTH }, 'keyboard');
};

describe('orders for the simplified simulation', () => {
  it('"dyk" and "ytläge" parse; "fyll" still floods', () => {
    const order = (s: string) => {
      const r = parseCommand(s);
      if (!r.ok || !('order' in r)) throw new Error(s);
      return r.order;
    };
    expect(order('dyk')).toEqual({ kind: 'dive' });
    expect(order('ytläge')).toEqual({ kind: 'surface' });
    expect(order('yta')).toEqual({ kind: 'surface' });
    expect(order('fyll hb')).toEqual({ kind: 'mainBallast', action: 'flood', group: 'all' });
    expect(parseCommand('dyk 30').ok).toBe(false);
  });

  it('acknowledges in Swedish', () => {
    expect(acknowledgement({ kind: 'adjustDepth', deltaMetres: 5 })).toBe('Djup 5 m djupare, ja');
    expect(acknowledgement({ kind: 'adjustDepth', deltaMetres: -5 })).toBe('Djup 5 m grundare, ja');
    expect(acknowledgement({ kind: 'adjustHeading', deltaDegrees: -10 })).toBe('Kurs 10° babord, ja');
    expect(acknowledgement({ kind: 'holdCourse' })).toBe('Håll kurs och djup, ja');
    expect(acknowledgement({ kind: 'dive' })).toBe('Dyk, ja');
    expect(acknowledgement({ kind: 'surface' })).toBe('Ytläge, ja');
  });

  it('target changes move the autopilot set points, wrapping the heading', () => {
    const { c, run, send } = game({ depth: 40, speed: 3, designTrim: true, heading: 5 / DEG }, 'simplified');
    expect(c.ap.depth && c.ap.heading).toBe(true);
    expect(c.setpoints).toMatchObject({ depth: 40, heading: 5 });
    send({ kind: 'adjustDepth', deltaMetres: 5 });
    send({ kind: 'adjustHeading', deltaDegrees: -10 });
    send({ kind: 'adjustHeading', deltaDegrees: -10 });
    run(0.02);
    expect(c.setpoints.depth).toBe(45);
    expect(c.setpoints.heading).toBe(345);
  });

  it('"dyk" floods the main ballast and shuts the vents when it is full', () => {
    const { c, sim, run, send } = game({}, 'simplified');
    dive(c);
    send({ kind: 'setSpeed', knots: 5 });
    run(1);
    const mbt = () => sim.telemetry().tanks.filter((t) => t.kind === 'mainBallast');
    expect(mbt().every((t) => t.ventOpen)).toBe(true);
    expect(c.setpoints.depth).toBe(PERISCOPE_DEPTH);
    run(240);
    expect(mbt().every((t) => !t.ventOpen && t.fill > 0.98)).toBe(true);
    expect(c.log.some((e) => /Ventilerna stängda/.test(e.text))).toBe(true);
  });

  it('"ytläge" blows and sends the depth autopilot to the surface', () => {
    const { c, sim, run, send } = game({ depth: 30, speed: 3, designTrim: true }, 'simplified');
    send({ kind: 'surface' });
    run(1);
    expect(c.setpoints.depth).toBe(0);
    expect(sim.telemetry().tanks.filter((t) => t.kind === 'mainBallast').every((t) => t.blowOpen)).toBe(true);
  });
});

describe('switching game mode', () => {
  it('to simplified holds the present depth and heading', () => {
    const { c, run, send } = game({ depth: 60, speed: 3, designTrim: true }, 'realistic');
    send({ kind: 'rudder', angle: 10 });
    run(30);
    const k = c.sim.kinematics();
    c.setMode('simplified');
    expect(c.ap.depth && c.ap.heading).toBe(true);
    expect(c.setpoints.depth).toBe(Math.round(k.depth));
    expect(c.setpoints.heading).toBe(Math.round(k.heading * DEG) % 360);
  });

  it('to realistic keeps the last rudder and plane commands', () => {
    const { c, sim, run, send } = game({ depth: 60, speed: 3, designTrim: true }, 'simplified');
    send({ kind: 'adjustHeading', deltaDegrees: 30 });
    send({ kind: 'adjustDepth', deltaMetres: 10 });
    run(10);
    const before = { ...sim.commands };
    c.setMode('realistic');
    expect(c.ap.depth || c.ap.heading).toBe(false);
    run(0.01);
    expect(Math.abs(sim.commands.rudder - before.rudder) * DEG).toBeLessThanOrEqual(0.5);
    expect(Math.abs(sim.commands.sternPlanes - before.sternPlanes) * DEG).toBeLessThanOrEqual(0.5);
  });

  it('realistic mode honours "autopilot not allowed"; simplified mode is built on it', () => {
    const { c, run, send } = game({ depth: 30, speed: 3, designTrim: true }, 'realistic');
    c.options.autopilotAllowed = false;
    send({ kind: 'adjustDepth', deltaMetres: 5 });
    run(0.02);
    expect(c.ap.depth).toBe(false);
    c.setMode('simplified');
    send({ kind: 'adjustDepth', deltaMetres: 5 });
    run(0.02);
    expect(c.ap.depth).toBe(true);
  });
});

describe('trim assistant', () => {
  it('dives to 50 m and trims neutral without help from the player', () => {
    const { c, sim, run, send } = game({}, 'simplified');
    dive(c);
    send({ kind: 'setSpeed', knots: 6 });
    run(120);
    send({ kind: 'setDepth', depth: 50 });
    run(720);
    let worst = 0;
    run(180, () => (worst = Math.max(worst, Math.abs(sim.y[2]! - 50))));
    expect(worst).toBeLessThan(1);
    expect(Math.abs(sim.telemetry().netBuoyancy / G)).toBeLessThan(150);
    expect(c.log.some((e) => e.source === 'assist' && /Kompensera/.test(e.text))).toBe(true);
  });

  it('does nothing in the realistic simulation', () => {
    const { c, run, send } = game({}, 'realistic');
    send({ kind: 'bridge', manned: false });
    send({ kind: 'dive' });
    send({ kind: 'setDepth', depth: 50 });
    send({ kind: 'setSpeed', knots: 6 });
    run(600);
    expect(c.log.some((e) => e.source === 'assist')).toBe(false);
    expect(c.sim.telemetry().netBuoyancy / G).toBeLessThan(-150); // still heavy: nobody trimmed
  });

  it('is deterministic', () => {
    const play = () => {
      const { c, sim, run, send } = game({}, 'simplified');
      dive(c);
      send({ kind: 'setSpeed', knots: 6 });
      run(60);
      send({ kind: 'setDepth', depth: 40 });
      send({ kind: 'adjustHeading', deltaDegrees: 40 });
      run(300);
      return Array.from(sim.y);
    };
    expect(play()).toEqual(play());
  });
});

describe('safety net', () => {
  it('blows the main ballast before crush depth', () => {
    const { c, sim, run } = game({ depth: 200, speed: 4 * 0.5144, tankFills: { comp: 1 }, east: -3000 }, 'simplified');
    let deepest = 0;
    run(600, () => (deepest = Math.max(deepest, sim.y[2]!)));
    expect(c.log.some((e) => e.source === 'assist' && /nödblåsning/.test(e.text))).toBe(true);
    expect(deepest).toBeLessThan(ASSIST.crushDepth);
  });

  it('keeps the depth target off the sea bed', () => {
    // Heading east towards the archipelago, where the sea bed rises.
    const { c, sim, run, send } = game({ east: 1500, depth: 30, speed: 3, designTrim: true, heading: 90 / DEG }, 'simplified');
    for (let i = 0; i < 40; i++) send({ kind: 'adjustDepth', deltaMetres: 5 });
    run(0.02);
    const limit = c.assist.depthLimit();
    expect(c.setpoints.depth).toBeLessThanOrEqual(Math.max(30, limit));
    let minKeel = Infinity;
    run(300, () => {
      const under = sim.ground(sim.y[0]!, sim.y[1]!) - (sim.y[2]! + sim.cfg.hull.radius);
      minKeel = Math.min(minKeel, under);
    });
    expect(c.setpoints.depth).toBeLessThanOrEqual(c.assist.depthLimit() + 1);
    expect(minKeel).toBeGreaterThan(0);
  });
});

describe('scenarios in the simplified simulation', () => {
  const start = (id: string) => {
    const sc = SCENARIOS.find((s) => s.id === id)!;
    const c = new Controller(new Simulation(sc.initial));
    const runner = new ScenarioRunner(sc, c);
    c.setMode(scenarioMode(sc, 'simplified'));
    const run = (seconds: number, until?: () => boolean) => {
      for (let i = 0; i < seconds * 100; i++) {
        c.step();
        runner.update();
        if (runner.status !== 'running' || until?.()) return;
      }
    };
    return { c, runner, run };
  };

  it('"Trimövning" is played in the realistic simulation only', () => {
    const sc = SCENARIOS.find((s) => s.id === 'trim-drill')!;
    expect(scenarioMode(sc, 'simplified')).toBe('realistic');
    for (const s of SCENARIOS.filter((x) => x.id !== 'trim-drill')) expect(scenarioMode(s, 'simplified')).toBe('simplified');
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

  it('"Nödblåsning" has no automatic blow, but S and speed save the boat', () => {
    const idle = start('emergency-blow');
    idle.run(600);
    expect(idle.runner.status).toBe('failed');
    expect(idle.c.log.some((e) => /nödblåsning/.test(e.text))).toBe(false);

    const { c, runner, run } = start('emergency-blow');
    c.submit({ kind: 'surface' }, 'keyboard');
    c.submit({ kind: 'setSpeed', knots: 10 }, 'keyboard');
    run(600);
    expect(runner.status).toBe('completed');
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

describe('depth target with empty main ballast', () => {
  it('simplified: starts the dive and reaches the depth', () => {
    const { c, sim, run, send } = game({ area: 'atlantic', sea: 'moderate' }, 'simplified');
    send({ kind: 'setSpeed', knots: 10 });
    send({ kind: 'setDepth', depth: 32 });
    run(1);
    expect(c.bridgeManned).toBe(false);
    expect(c.log.some((e) => /fylls för dykning/.test(e.text))).toBe(true);
    run(300);
    expect(Math.abs(sim.y[2]! - 32)).toBeLessThan(3);
  });

  it('simplified: a target near the surface does not flood', () => {
    const { sim, run, send } = game({}, 'simplified');
    send({ kind: 'adjustDepth', deltaMetres: 2 });
    run(1);
    expect(sim.tanks.some((t) => t.ventOpen)).toBe(false);
  });

  it('realistic: reminds the player instead', () => {
    const { c, sim, run, send } = game({}, 'realistic');
    send({ kind: 'setDepth', depth: 32 });
    run(1);
    expect(sim.tanks.some((t) => t.ventOpen)).toBe(false);
    expect(c.log.some((e) => e.kind === 'error' && /Huvudballasten är tom/.test(e.text))).toBe(true);
  });
});
