import { expect } from 'vitest';
import { Controller } from '../../src/control/controller';
import type { Order } from '../../src/control/orders';
import { SCENARIOS, ScenarioRunner } from '../scenarios';
import { Simulation } from '../../src/sim/simulation';

/** Shared by the attack tests (attack, hunted and convoy .long.test.ts): a scenario started for the crew or the player. */
export type Who = 'crew' | 'player';
export const KN = 1852 / 3600;

/** `timeLimit` [s] shortens the scenario's: the rule that fails it is the same, the test far shorter. */
export function start(id: string, who: Who, timeLimit?: number) {
  const found = SCENARIOS.find((s) => s.id === id)!;
  const sc = timeLimit === undefined ? found : { ...found, timeLimit };
  const c = new Controller(new Simulation(sc.initial));
  const runner = new ScenarioRunner(sc, c);
  c.crewTakesAll();
  if (who === 'player') c.submit({ kind: 'crew', system: 'all', crew: false }, 'keyboard');
  const send = (o: Order) => c.submit(o, 'keyboard');
  const run = (seconds: number, until?: () => boolean) => {
    for (let i = 0; i < seconds * 100; i++) {
      c.step();
      runner.update();
      if (runner.status !== 'running' || until?.()) return;
    }
  };
  /** True bearing [deg] to a vessel (what the cross hair shows when it is on it). */
  const bearingTo = (id: string) => {
    const k = c.world.contacts().find((x) => x.vessel.def.id === id)!;
    return (k.bearing * 180) / Math.PI;
  };
  return { c, runner, send, run, bearingTo };
}

/** The player makes all four tubes ready (the torpedo room does it once a target is marked). */
export function readyTubes(send: (o: Order) => void, who: Who) {
  if (who === 'player') for (let tube = 1; tube <= 4; tube++) send({ kind: 'tube', tube, action: 'ready' });
}

/** Periscope attack: mark and range (the player every 30 s; the crew ranges itself), then fire. */
export function periscopeAttack(s: ReturnType<typeof start>, who: Who, id: string) {
  const { runner, send, run, bearingTo } = s;
  send({ kind: 'periscope', up: true });
  readyTubes(send, who);
  run(12);
  const good = () => ['ok', 'bra'].includes(s.c.fire.target?.solution?.quality ?? '');
  for (let i = 0; i < 8 && !good(); i++) {
    send({ kind: 'markTarget', bearing: bearingTo(id) });
    if (who === 'player') send({ kind: 'rangeTarget', bearing: bearingTo(id), magnification: 1 });
    run(30);
  }
  const q = s.c.fire.target?.solution?.quality;
  expect(q === 'ok' || q === 'bra').toBe(true);
  send({ kind: 'fireTorpedo' });
  run(1);
  expect(runner.status).toBe('running');
}
