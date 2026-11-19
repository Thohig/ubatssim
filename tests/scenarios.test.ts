import { describe, expect, it } from 'vitest';
import { Controller } from '../src/control/controller';
import { parseCommand } from '../src/control/parser';
import { SCENARIOS, ScenarioRunner, type Scenario } from '../src/control/scenarios';
import { Simulation } from '../src/sim/simulation';

const scenario = (id: string): Scenario => SCENARIOS.find((s) => s.id === id)!;

function start(id: string) {
  const sc = scenario(id);
  const ctrl = new Controller(new Simulation(sc.initial));
  const runner = new ScenarioRunner(sc, ctrl);
  const cmd = (s: string) => {
    const r = parseCommand(s);
    if (!r.ok || !('order' in r)) throw new Error(s);
    ctrl.submit(r.order, 'console');
  };
  const run = (seconds: number, until?: () => boolean) => {
    for (let i = 0; i < seconds * 100; i++) {
      ctrl.step();
      runner.update();
      if (runner.status !== 'running' || until?.()) return;
    }
  };
  return { ctrl, runner, cmd, run };
}

describe('scenarios', () => {
  it('all scenarios have objectives and valid ids', () => {
    const ids = new Set(SCENARIOS.map((s) => s.id));
    expect(ids.size).toBe(SCENARIOS.length);
    for (const s of SCENARIOS) expect(s.objectives.length).toBeGreaterThan(0);
  });

  it('"Första dykningen" can be completed with the hinted commands', () => {
    const { runner, cmd, run } = start('first-dive');
    cmd('fyll huvudballast');
    run(1);
    expect(runner.progress.index).toBe(1);
    cmd('fart 5 knop');
    run(60, () => runner.progress.index >= 2);
    cmd('djup 30');
    run(400, () => runner.progress.index >= 3);
    expect(runner.progress.index).toBe(3);
    const net = runner.ctrl.sim.telemetry().netBuoyancy / 9.80665;
    expect(net).toBeLessThan(-300); // starts heavy: the trim step is real work
    cmd(`kompensera ut ${Math.round(-net)}`);
    run(400, () => runner.progress.index >= 4);
    expect(runner.progress.index).toBe(4);
    cmd('blås huvudballast');
    cmd('djup 0');
    run(400);
    expect(runner.status).toBe('completed');
  });

  it('"Trimövning" refuses the depth autopilot and fails when the boat sinks', () => {
    const { ctrl, runner, cmd, run } = start('trim-drill');
    cmd('djup 50');
    run(1);
    expect(ctrl.ap.depth).toBe(false);
    expect(ctrl.log.some((e) => e.kind === 'error' && /inte tillåten/.test(e.text))).toBe(true);
    cmd('djuproder ned 15');
    run(600);
    expect(runner.status).toBe('failed');
    expect(runner.message).toMatch(/15 m/);
  });

  it('"Nödblåsning" is survivable by blowing and driving up', () => {
    const { runner, cmd, run } = start('emergency-blow');
    cmd('blås huvudballast');
    cmd('fart 10');
    cmd('djup 0');
    run(600);
    expect(runner.status).toBe('completed');
  });

  it('"Nödblåsning" fails if nothing is done', () => {
    const { runner, run } = start('emergency-blow');
    run(600);
    expect(runner.status).toBe('failed');
  });

  it('"Språngskiktet" requires taking on water below the thermocline', () => {
    const { ctrl, runner, cmd, run } = start('thermocline');
    cmd('djup 90');
    run(600, () => runner.progress.index >= 1 && Math.abs(ctrl.sim.telemetry().depth - 90) < 1);
    const net = ctrl.sim.telemetry().netBuoyancy / 9.80665;
    expect(net).toBeGreaterThan(300); // light below the layer
    cmd(`kompensera in ${Math.round(net)}`);
    run(600);
    expect(runner.status).toBe('completed');
  });
});
