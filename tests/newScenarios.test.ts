import { describe, expect, it } from 'vitest';
import { AREA_INFO } from '../src/control/areas';
import { Controller } from '../src/control/controller';
import type { GameMode } from '../src/control/gameMode';
import type { Order } from '../src/control/orders';
import { SCENARIOS, ScenarioRunner, scenarioMode, waypointInfo } from '../src/control/scenarios';
import { Simulation } from '../src/sim/simulation';

const G = 9.80665;

function start(id: string, mode: GameMode) {
  const sc = SCENARIOS.find((s) => s.id === id)!;
  const c = new Controller(new Simulation(sc.initial));
  const runner = new ScenarioRunner(sc, c);
  c.setMode(scenarioMode(sc, mode));
  const send = (o: Order) => c.submit(o, 'keyboard');
  const run = (seconds: number, until?: () => boolean, each?: (i: number) => void) => {
    for (let i = 0; i < seconds * 100; i++) {
      each?.(i);
      c.step();
      runner.update();
      if (runner.status !== 'running' || until?.()) return;
    }
  };
  return { c, runner, send, run };
}

const light = (name: string) => AREA_INFO.westCoast.lighthouses.find((l) => l.name === name)!.position;
const bearing = (c: Controller, to: [number, number]) =>
  (((Math.atan2(to[1] - c.sim.y[1]!, to[0] - c.sim.y[0]!) * 180) / Math.PI) + 360) % 360;

describe.each(['realistic', 'simplified'] as const)('new scenarios (%s)', (mode) => {
  it('"Periskopspaning": raise, report the bearing, lower', () => {
    const { c, runner, send, run } = start('periscope-recce', mode);
    send({ kind: 'periscope', up: true });
    run(15, () => runner.progress.index >= 1);
    expect(runner.progress.index).toBe(1);
    send({ kind: 'reportBearing', bearing: Math.round(bearing(c, light('Västra fyren'))) });
    run(2, () => runner.progress.index >= 2);
    expect(runner.progress.index).toBe(2);
    send({ kind: 'periscope', up: false });
    run(15);
    expect(runner.status).toBe('completed');
  });

  it('"Periskopspaning" fails on a wrong bearing alone, and when the periscope shows too long', () => {
    const { c, runner, send, run } = start('periscope-recce', mode);
    send({ kind: 'periscope', up: true });
    run(15, () => runner.progress.index >= 1);
    send({ kind: 'reportBearing', bearing: Math.round(bearing(c, light('Västra fyren')) + 20) % 360 });
    run(80);
    expect(runner.progress.index).toBe(1);
    expect(runner.status).toBe('failed');
    expect(runner.message).toMatch(/upptäcktes/);
  });

  it('"Fjordinloppet": following the fjord at 35 m reaches the buoy', () => {
    const { c, runner, send, run } = start('fjord-entry', mode);
    // Centre line of the fjord (deepest points), south to north.
    const route: [number, number][] = [
      [-2200, 0], [-1000, -10], [-600, -10], [-200, 20], [200, 90], [600, 160], [1000, 360],
      [1400, 450], [1800, 380], [2200, 230], [2400, 120],
    ];
    send({ kind: 'setDepth', depth: 35 });
    send({ kind: 'setSpeed', knots: 7 });
    run(1500, undefined, (i) => {
      if (i % 200 !== 0) return;
      const n = c.sim.y[0]!;
      const aimN = Math.min(2400, n + 150);
      let k = route.findIndex((p) => p[0] >= aimN);
      if (k < 1) k = 1;
      const [n0, e0] = route[k - 1]!;
      const [n1, e1] = route[k]!;
      const aim: [number, number] = [aimN, e0 + ((e1 - e0) * (aimN - n0)) / (n1 - n0)];
      send({ kind: 'setHeading', heading: Math.round(bearing(c, aim)) % 360 });
    });
    expect(runner.message).toMatch(/slutfört/);
    expect(runner.status).toBe('completed');
  });

  it('"Fyrljuset": steering on the light reaches it', () => {
    const { c, runner, send, run } = start('night-light', mode);
    send({ kind: 'setSpeed', knots: 6 });
    run(1500, undefined, (i) => {
      if (i % 1000 === 0) send({ kind: 'setHeading', heading: Math.round(bearing(c, light('Södra fyren'))) % 360 });
    });
    expect(runner.status).toBe('completed');
    expect(waypointInfo(c.sim.telemetry(), light('Södra fyren')).distance).toBeLessThan(700);
  });
});

describe('"Saltsprånget"', () => {
  it('realistic: dive, take on water for the denser layer, hold', () => {
    const { c, runner, send, run } = start('halocline', 'realistic');
    send({ kind: 'setDepth', depth: 90 });
    run(900, () => runner.progress.index >= 1 && Math.abs(c.sim.y[2]! - 90) < 1 && Math.abs(c.sim.kinematics().depthRate) < 0.05);
    const net = c.sim.telemetry().netBuoyancy / G;
    expect(net).toBeGreaterThan(2000); // several tonnes light below the halocline
    send({ kind: 'compensate', litres: Math.round(net / 1.0054) });
    run(1500);
    expect(runner.status).toBe('completed');
  });

  it('simplified: the assistant does it (slowly)', () => {
    const { runner, send, run } = start('halocline', 'simplified');
    send({ kind: 'setDepth', depth: 90 });
    run(2400);
    expect(runner.status).toBe('completed');
  });

  it('fails when the boat goes too deep', () => {
    const { runner, send, run } = start('halocline', 'realistic');
    send({ kind: 'setDepth', depth: 118 });
    send({ kind: 'compensate', litres: 6000 }); // heavy enough to get through the layer
    run(1500);
    expect(runner.status).toBe('failed');
  });
});

describe('fail cases', () => {
  it('"Fjordinloppet" fails when the boat comes up shallower than 15 m', () => {
    const { runner, send, run } = start('fjord-entry', 'simplified');
    send({ kind: 'setDepth', depth: 5 });
    run(300);
    expect(runner.status).toBe('failed');
    expect(runner.message).toMatch(/15 m/);
  });

  it('"Fyrljuset" fails when time runs out', () => {
    const { runner, run } = start('night-light', 'realistic');
    run(1600);
    expect(runner.status).toBe('failed');
  });
});

describe.each(['realistic', 'simplified'] as const)('"Fartyget" (%s)', (mode) => {
  it('can be completed by reporting the bearing to the ship', () => {
    const { c, runner, send, run } = start('ship-recce', mode);
    expect(c.world.vessels).toHaveLength(1);
    send({ kind: 'periscope', up: true });
    run(15, () => runner.progress.index >= 1);
    const k = c.world.contacts()[0]!;
    send({ kind: 'reportBearing', bearing: Math.round((k.bearing * 180) / Math.PI) % 360 });
    run(2, () => runner.progress.index >= 2);
    expect(runner.progress.index).toBe(2);
    send({ kind: 'periscope', up: false });
    run(15);
    expect(runner.status).toBe('completed');
  });

  it('fails on a bearing to the lighthouse instead of the ship', () => {
    const { c, runner, send, run } = start('ship-recce', mode);
    send({ kind: 'periscope', up: true });
    run(15, () => runner.progress.index >= 1);
    send({ kind: 'reportBearing', bearing: Math.round(bearing(c, light('Västra fyren'))) });
    run(80);
    expect(runner.progress.index).toBe(1);
    expect(runner.status).toBe('failed');
  });
});

describe('collision in a scenario', () => {
  it('fails the scenario, like grounding', () => {
    const { c, runner, run } = start('ship-recce', 'realistic');
    // Put the boat in the ship's path at periscope depth.
    c.world.vessels[0]!.state.north = c.sim.y[0]! - 300;
    c.world.vessels[0]!.state.east = c.sim.y[1]!;
    c.world.vessels[0]!.state.heading = 0;
    run(120);
    expect(runner.status).toBe('failed');
    expect(runner.message).toMatch(/kolliderade med M\/S Skagerack/);
  });
});
