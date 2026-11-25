/**
 * Ships that act together: two corvettes hunting as a pair (one directs
 * and pings, the other runs in), and a convoy that speeds up and zigzags
 * when one of its ships is hit. Each scenario with the crew and with the
 * player, and its failure.
 */
import { describe, expect, it } from 'vitest';
import { Controller } from '../../src/control/controller';
import type { Order } from '../../src/control/orders';
import { SCENARIOS, ScenarioRunner } from '../scenarios';
import { Simulation } from '../../src/sim/simulation';
import { Vessel, ZIGZAG, ZIGZAG_LEG } from '../../src/sim/vessel';
import { freighter } from '../../src/control/areas';

type Who = 'crew' | 'player';

function start(id: string, who: Who, timeLimit?: number) {
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
  const bearingTo = (vid: string) => {
    const k = c.world.contacts().find((x) => x.vessel.def.id === vid)!;
    return (k.bearing * 180) / Math.PI;
  };
  return { c, runner, send, run, bearingTo };
}

describe('a convoy alarmed by a hit', () => {
  it('speeds up and zigzags about its route in a fixed pattern', () => {
    const v = new Vessel({ ...freighter('f', 'F', [[0, 0], [0, 50000]]), speed: 4 });
    for (let i = 0; i < 6000; i++) v.step(0.01);
    expect(v.state.heading).toBeCloseTo(Math.PI / 2, 2);
    v.alarm();
    for (let i = 0; i < 9000; i++) v.step(0.01);
    expect(v.state.speed).toBeGreaterThan(4.5);
    expect(v.zigzag).toBe(ZIGZAG[0]);
    expect(Math.abs(v.state.heading - (Math.PI / 2 + ZIGZAG[0]!))).toBeLessThan(0.05);
    for (let i = 0; i < ZIGZAG_LEG * 100; i++) v.step(0.01);
    expect(v.zigzag).toBe(ZIGZAG[1]);
  });
});

describe('"Två jägare"', () => {
  it.each(['crew', 'player'] as const)('deep, slow and away: both corvettes give up (%s)', (who) => {
    const { c, runner, send, run } = start('hunting-pair', who);
    send({ kind: 'setDepth', depth: 200 });
    send({ kind: 'setSpeed', knots: 8 });
    send({ kind: 'setHeading', heading: 180 });
    run(240);
    send({ kind: 'setSpeed', knots: 4 });
    send({ kind: 'setHeading', heading: 250 });
    run(2200);
    // The first called the second.
    expect(c.log.some((e) => e.text === 'Sonar: korvetten Falken ropar på korvetten Höken.')).toBe(true);
    expect(runner.status).toBe('completed');
    expect(c.sim.systems.flooding.water).toBeLessThan(120);
  });

  it('with both attacking, one directs from a distance and the other runs in; they change places after a pattern', () => {
    const { c, send, run } = start('hunting-pair', 'crew');
    send({ kind: 'setDepth', depth: 40 });
    send({ kind: 'setSpeed', knots: 8 });
    run(600, () => c.log.some((e) => / går in, korvetten \S+ lyssnar\.$/.test(e.text)));
    expect(c.hunter.state('falken')).toBe('attack');
    expect(c.hunter.state('hoken')).toBe('attack');
    expect(c.log.some((e) => / går in, korvetten \S+ lyssnar\.$/.test(e.text))).toBe(true);
    const striker = c.hunter.strikers.paret!;
    const director = c.world.vessels.find((v) => v.def.group === 'paret' && v.def.id !== striker)!;
    run(30);
    expect(director.goalSpeed ?? 0).toBeLessThan(4);
  });

  it('fails when the boat stays shallow and fast', () => {
    const { runner, send, run } = start('hunting-pair', 'crew', 900);
    send({ kind: 'setDepth', depth: 30 });
    send({ kind: 'setSpeed', knots: 12 });
    run(950);
    expect(runner.status).toBe('failed');
  });
});

describe('"Stora konvojen"', () => {
  it.each(['crew', 'player'] as const)('sink a freighter; the others zigzag; get away from the escort (%s)', (who) => {
    const s = start('big-convoy', who);
    const { c, runner, send, run, bearingTo } = s;
    if (who === 'player') for (let tube = 1; tube <= 4; tube++) send({ kind: 'tube', tube, action: 'ready' });
    // Periscope depth held by a depth target (the player keeps the rest): on Hand at 3 knots the boat rises.
    send({ kind: 'setDepth', depth: 13 });
    send({ kind: 'periscope', up: true });
    run(12);
    for (let i = 0; i < 8 && !['ok', 'bra'].includes(c.fire.target?.solution?.quality ?? ''); i++) {
      send({ kind: 'markTarget', bearing: bearingTo('ettan') });
      if (who === 'player') send({ kind: 'rangeTarget', bearing: bearingTo('ettan'), magnification: 1 });
      run(30);
    }
    send({ kind: 'setSpread', count: 2 });
    send({ kind: 'fireTorpedo' });
    // Down at once: the salva makes the boat lighter forward, and the player handling the trim has not compensated.
    send({ kind: 'periscope', up: false });
    send({ kind: 'setDepth', depth: 40 });
    send({ kind: 'setSpeed', knots: 8 });
    run(600, () => runner.progress.index >= 1);
    expect(runner.progress.index).toBe(1);
    // The rest of the convoy is alarmed and zigzags.
    const others = c.world.vessels.filter((v) => v.def.group === 'konvojen' && v.def.kind !== 'patrol' && !v.state.sinking);
    expect(others.length).toBe(2);
    for (const v of others) expect(v.alarmed).not.toBeNull();
    send({ kind: 'setDepth', depth: 200 });
    send({ kind: 'setSpeed', knots: 8 });
    send({ kind: 'setHeading', heading: 180 });
    run(240);
    send({ kind: 'setSpeed', knots: 4 });
    send({ kind: 'setHeading', heading: 270 });
    run(2500);
    expect(runner.status).toBe('completed');
  });

  it('fails when time runs out', () => {
    const s = start('big-convoy', 'crew', 60);
    s.run(70);
    expect(s.runner.status).toBe('failed');
    expect(s.runner.message).toBe('Tiden tog slut.');
  });
});

describe('"Lockmålet"', () => {
  it.each(['crew', 'player'] as const)('a decoy astern draws the corvette; deep, slow and away (%s)', (who) => {
    const { c, runner, send, run } = start('decoy', who);
    send({ kind: 'decoy' });
    send({ kind: 'setDepth', depth: 200 });
    send({ kind: 'setSpeed', knots: 8 });
    send({ kind: 'setHeading', heading: 240 });
    run(1);
    expect(runner.progress.index).toBe(1);
    expect(c.log.some((e) => /^Lockmål 1 ute på kurs 000°/.test(e.text))).toBe(true);
    run(240);
    send({ kind: 'setSpeed', knots: 4 });
    run(1500);
    expect(runner.status).toBe('completed');
    expect(c.decoys).toBe(3);
  });

  it('the corvette hears the decoy louder than the quiet boat, goes for it and drops its charges there', () => {
    const { c, send, run } = start('decoy', 'crew');
    send({ kind: 'decoy' });
    send({ kind: 'setDepth', depth: 100 });
    send({ kind: 'setHeading', heading: 240 });
    // At each pattern: how far it fell from the decoy and from the boat.
    const drops: { decoy: number; boat: number }[] = [];
    let seen = 0;
    run(300, () => {
      if (c.world.charges.length > seen) {
        const ch = c.world.charges[c.world.charges.length - 1]!.state;
        const d = Math.min(...c.world.decoys.map((x) => Math.hypot(x.north - ch.north, x.east - ch.east)));
        drops.push({ decoy: d, boat: Math.hypot(c.sim.y[0]! - ch.north, c.sim.y[1]! - ch.east) });
      }
      seen = c.world.charges.length;
      return false;
    });
    expect(drops.length).toBeGreaterThan(0);
    // The first pattern went for the decoy.
    expect(drops[0]!.decoy).toBeLessThan(drops[0]!.boat);
    expect(c.sim.systems.flooding.water).toBe(0);
  });

  it('fails when time runs out; with none left, a decoy is refused', () => {
    const s = start('decoy', 'crew', 60);
    s.c.decoys = 0;
    s.send({ kind: 'decoy' });
    s.run(70);
    expect(s.c.log.some((e) => e.text === 'Inga lockmål kvar.')).toBe(true);
    expect(s.runner.status).toBe('failed');
  });
});
