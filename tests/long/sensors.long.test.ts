/**
 * The radar, the active sonar and the torpedo room in their scenarios:
 * each can be completed with the crew handling everything and with the
 * player handling everything the locks allow, and fails when it should.
 */
import { describe, expect, it } from 'vitest';
import { Controller } from '../../src/control/controller';
import type { Order } from '../../src/control/orders';
import { SCENARIOS, ScenarioRunner } from '../../src/control/scenarios';
import { Simulation } from '../../src/sim/simulation';

type Who = 'crew' | 'player';

/** `timeLimit` [s] shortens the scenario's: the rule that fails it is the same, the test far shorter. */
function start(id: string, who: Who, timeLimit?: number) {
  const found = SCENARIOS.find((s) => s.id === id)!;
  const sc = timeLimit === undefined ? found : { ...found, timeLimit };
  const c = new Controller(new Simulation(sc.initial));
  // The runner sets the locks and adds the traffic; then the crew takes the rest, as in a game.
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
  const contact = (vesselId: string) => c.sonar.contacts.find((x) => x.vesselId === vesselId)?.label;
  const bearingTo = (vesselId: string) => {
    const k = c.world.contacts().find((x) => x.vessel.def.id === vesselId)!;
    return (k.bearing * 180) / Math.PI;
  };
  const quality = () => c.fire.target?.solution?.quality;
  return { c, runner, send, run, contact, bearingTo, quality };
}

describe('"Radar i dimman"', () => {
  it.each(['crew', 'player'] as const)('a few sweeps give a good solution; silent again before the corvette knows (%s)', (who) => {
    const s = start('radar-fog', who);
    s.run(30, () => s.contact('dimman') !== undefined);
    s.send({ kind: 'markTarget', label: s.contact('dimman')! });
    s.send({ kind: 'radarMast', up: true });
    s.run(12);
    expect(s.c.radar.antennaHeight()).toBeGreaterThan(0);
    // The corvette's radar is heard by the radar warning receiver.
    expect(s.c.log.some((e) => /^Radarvarnare: radar i bäring/.test(e.text))).toBe(true);
    s.send({ kind: 'radar', on: true });
    s.run(60, () => s.quality() === 'bra');
    expect(s.quality()).toBe('bra');
    s.send({ kind: 'radar', on: false });
    s.send({ kind: 'radarMast', up: false });
    s.run(30);
    expect(s.runner.status).toBe('completed');
    expect(s.c.sonar.detectedBy).toBeNull();
  });

  it('transmitting on and on is heard by the corvette, which finds the boat', () => {
    const s = start('radar-fog', 'crew');
    s.send({ kind: 'radarMast', up: true });
    s.send({ kind: 'radar', on: true });
    s.run(300);
    expect(s.runner.status).toBe('failed');
    expect(s.c.sonar.detectedBy).toBe('korvetten Lyssnaren');
  });

  it('the radar needs the mast up, and the antenna above the water', () => {
    const s = start('radar-fog', 'player');
    s.send({ kind: 'radar', on: true });
    s.run(1);
    expect(s.c.log.some((e) => e.kind === 'error' && e.text === 'Radarmasten är nere. Hissa den först.')).toBe(true);
    s.send({ kind: 'setDepth', depth: 40 });
    s.send({ kind: 'radarMast', up: true });
    s.run(120);
    s.send({ kind: 'radar', on: true });
    s.run(10);
    expect(s.c.radar.active).toBe(false);
    expect(s.c.radar.echoes).toHaveLength(0);
  });
});

describe('"Ekot"', () => {
  it.each(['crew', 'player'] as const)('pings give the range at once, a hit, and away from the corvette that heard them (%s)', (who) => {
    const s = start('echo', who);
    s.run(30, () => s.contact('ekot') !== undefined);
    s.send({ kind: 'markTarget', label: s.contact('ekot')! });
    if (who === 'player') for (let tube = 1; tube <= 4; tube++) s.send({ kind: 'tube', tube, action: 'ready' });
    s.run(1);
    // A ping every 11 s: the ranges give the course and speed after half a dozen.
    for (let i = 0; i < 10; i++) {
      s.send({ kind: 'ping' });
      s.run(11);
    }
    expect(s.quality()).toBe('bra');
    // The corvette 11 km off heard the ping and comes searching.
    expect(s.c.hunter.state('hornet')).toBe('search');
    s.send({ kind: 'setSpread', count: 3 });
    s.send({ kind: 'fireTorpedo' });
    s.run(600, () => s.runner.progress.index >= 3);
    expect(s.runner.progress.index).toBe(3);
    s.send({ kind: 'setDepth', depth: 200 });
    s.send({ kind: 'setSpeed', knots: 4 });
    s.send({ kind: 'setHeading', heading: 300 });
    s.run(2400);
    expect(s.runner.status).toBe('completed');
  });

  it('a second ping within ten seconds is refused', () => {
    const s = start('echo', 'crew');
    s.send({ kind: 'ping' });
    s.run(2);
    s.send({ kind: 'ping' });
    s.run(1);
    expect(s.c.sonar.pings).toBe(1);
    expect(s.c.log.some((e) => /^Sonaren kan pinga igen om \d+ s\.$/.test(e.text))).toBe(true);
  });

  it('fails when time runs out', () => {
    const s = start('echo', 'crew', 60);
    s.run(70);
    expect(s.runner.status).toBe('failed');
    expect(s.runner.message).toBe('Tiden tog slut.');
  });
});

describe('"Klart för eld"', () => {
  it.each(['crew', 'player'] as const)('ready the tubes, sink both ships and reload (%s)', (who) => {
    const s = start('tubes', who);
    expect(s.c.duty('torpedoRoom')).toBe(false); // locked to the player
    s.send({ kind: 'tube', tube: 1, action: 'ready' });
    s.send({ kind: 'tube', tube: 2, action: 'ready' });
    s.send({ kind: 'periscope', up: true });
    s.run(30);
    expect(s.runner.progress.index).toBe(1);
    for (const id of ['mal-a', 'mal-b']) {
      for (let i = 0; i < 8; i++) {
        s.send({ kind: 'markTarget', bearing: s.bearingTo(id) });
        s.send({ kind: 'rangeTarget', bearing: s.bearingTo(id), magnification: 1 });
        s.run(30);
        if (s.c.fire.target?.vesselId === id && ['ok', 'bra'].includes(s.quality() ?? '')) break;
      }
      s.send({ kind: 'fireTorpedo' });
      s.run(600, () => s.c.world.vessels.find((v) => v.def.id === id)!.state.sinking);
      s.run(1);
    }
    expect(s.runner.progress.index).toBe(3);
    s.send({ kind: 'tube', tube: 1, action: 'load' });
    s.send({ kind: 'tube', tube: 2, action: 'load' });
    s.run(400);
    expect(s.runner.status).toBe('completed');
    expect(s.c.fire.reserve).toBe(6);
    // The loading rail takes one torpedo at a time.
    expect(s.c.log.filter((e) => /^Tub [12] laddad\.$/.test(e.text)).map((e) => e.t)[1]! - s.c.log.find((e) => /^Tub [12] laddad\.$/.test(e.text))!.t).toBeGreaterThanOrEqual(119);
  });

  it('fails when time runs out, the tubes never made ready', () => {
    const s = start('tubes', 'crew', 60);
    s.run(70);
    expect(s.runner.status).toBe('failed');
    expect(s.c.fire.tubes.some((x) => x.open)).toBe(false);
  });
});
