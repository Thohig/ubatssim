import { describe, expect, it } from 'vitest';
import { Controller } from '../../src/control/controller';
import { parseCommand } from '../../src/control/parser';
import { SCENARIOS, ScenarioRunner, type Scenario } from '../scenarios';
import { Simulation } from '../../src/sim/simulation';

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
    const { ctrl, runner, cmd, run } = start('first-dive');
    cmd('fyll huvudballast');
    run(1);
    expect(runner.progress.index).toBe(0); // refused: the bridge is manned
    expect(ctrl.log.some((e) => e.kind === 'error' && /klart bryggan/.test(e.text))).toBe(true);
    cmd('klart bryggan');
    run(1);
    expect(runner.progress.index).toBe(1);
    cmd('fyll huvudballast');
    run(1);
    expect(runner.progress.index).toBe(2);
    cmd('fart 5 knop');
    run(60, () => runner.progress.index >= 3);
    cmd('djup 30');
    run(400, () => runner.progress.index >= 4);
    expect(runner.progress.index).toBe(4);
    const net = runner.ctrl.sim.telemetry().netBuoyancy / 9.80665;
    expect(net).toBeLessThan(-300); // starts heavy: the trim step is real work
    cmd(`kompensera ut ${Math.round(-net)}`);
    run(400, () => runner.progress.index >= 5);
    expect(runner.progress.index).toBe(5);
    cmd('blås huvudballast');
    cmd('djup 0');
    run(400);
    expect(runner.status).toBe('completed');
  });

  it('"Trimövning" refuses the depth autopilot (locked on Hand) and fails when the boat sinks', () => {
    const { ctrl, runner, cmd, run } = start('trim-drill');
    cmd('djup 50');
    run(1);
    expect(ctrl.ap.depth).toBe(false);
    expect(ctrl.log.some((e) => e.kind === 'error' && /Här styr du djupet själv/.test(e.text))).toBe(true);
    cmd('djuproder ned 15');
    run(600);
    expect(runner.status).toBe('failed');
    expect(runner.message).toMatch(/15 m/);
  });

  it('"Trimövning" can be completed by hand: stern planes and compensation', () => {
    const { ctrl, runner, run } = start('trim-drill');
    const t0 = ctrl.sim.telemetry();
    // Pump out what makes the boat heavy (1 litre ≈ 1 kg), as the hint says.
    ctrl.submit({ kind: 'compensate', litres: Math.round(t0.netBuoyancy / 9.80665) }, 'touch');
    // A player on the planes: a few degrees against the depth error and the depth rate, once a second.
    run(400, () => {
      if (Math.round(ctrl.sim.t * 100) % 100 === 0) {
        const k = ctrl.sim.kinematics();
        const angle = Math.max(-15, Math.min(15, Math.round(-(2 * (k.depth - 50) + 25 * k.depthRate + 40 * k.pitch))));
        if (angle !== ctrl.manual.planes) ctrl.submit({ kind: 'planes', angle }, 'touch');
      }
      return false;
    });
    expect(runner.status).toBe('completed');
    expect(ctrl.duties()).toMatchObject({ depth: false, trim: false });
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
