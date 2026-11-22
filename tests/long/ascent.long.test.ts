import { describe, expect, it } from 'vitest';
import { ASCENT, CANCELLED, STILL_HINT } from '../../src/control/ascent';
import { Controller } from '../../src/control/controller';
import type { Order } from '../../src/control/orders';
import { Simulation, type InitialConditions } from '../../src/sim/simulation';
import type { VesselDef } from '../../src/sim/vessel';
import { submitEmergencyBlow } from '../../src/ui/keyboard';

const KN = 1852 / 3600;
const NO_CURRENT = { speed: 0, toward: 0, decay: 1 };

function start(initial: InitialConditions, crewSpeed = true) {
  const c = new Controller(new Simulation({ area: 'atlantic', current: NO_CURRENT, ...initial }));
  c.crewTakesAll();
  c.setpoints.depth = Math.round(c.sim.y[2]!);
  if (!crewSpeed) c.submit({ kind: 'setRpm', rpm: 0 }, 'keyboard');
  const send = (o: Order) => c.submit(o, 'touch');
  const run = (seconds: number, each?: () => boolean | void) => {
    for (let i = 0; i < seconds * 100; i++) {
      c.step();
      if (i % 100 === 0 && each?.()) return;
    }
  };
  return { c, send, run };
}

const blowing = (c: Controller) => c.sim.tanks.some((t) => t.blowOpen);
const logged = (c: Controller, re: RegExp) => c.log.some((e) => re.test(e.text));

describe('coming up from the deep with speed (the crew handles depth and speed)', () => {
  it('to periscope depth: 8 knots up, levels off at 35 m at 4 knots and listens, then 13 m without the main ballast', () => {
    const { c, send, run } = start({ depth: 200, speed: 0, neutral: true, heading: 0 });
    run(20);
    send({ kind: 'setDepth', depth: 13 });
    let fastest = 0;
    let shallowest = 200;
    let listenedAt: number | null = null;
    let turned = 0;
    run(900, () => {
      const k = c.sim.kinematics();
      fastest = Math.max(fastest, k.u / KN);
      shallowest = Math.min(shallowest, k.depth);
      if (c.ascent.phase === 'listen' && listenedAt === null) listenedAt = k.depth;
      if (c.ascent.phase === 'listen') turned = Math.max(turned, Math.abs((((k.heading * 180) / Math.PI + 180) % 360) - 180));
      expect(blowing(c)).toBe(false);
      return !c.ascent.active && Math.abs(k.depth - 13) < 1;
    });
    expect(fastest).toBeGreaterThan(7.5);
    expect(listenedAt).not.toBeNull();
    expect(Math.abs(listenedAt! - ASCENT.levelDepth)).toBeLessThan(3);
    expect(turned).toBeGreaterThan(40);
    expect(logged(c, /Planar ut på 35 m/)).toBe(true);
    expect(logged(c, /Inga kontakter nära/)).toBe(true);
    expect(logged(c, /Maskinen går tillbaka till 0 knop/)).toBe(true);
    expect(c.log.some((e) => e.text === CANCELLED)).toBe(false);
    expect(shallowest).toBeGreaterThan(11);
    run(60);
    expect(Math.abs(c.sim.y[2]! - 13)).toBeLessThan(1.5);
    expect(c.sim.y[7]!).toBeLessThan(0.6);
  });

  it('a new speed ahead keeps the steps: a floor while rising, 4 knots listening, the new speed once up', () => {
    const { c, send, run } = start({ depth: 200, speed: 0, neutral: true, heading: 0 });
    run(20);
    send({ kind: 'setDepth', depth: 13 });
    run(30);
    send({ kind: 'setSpeed', knots: 12 });
    run(1);
    expect(c.ascent.phase).toBe('rise');
    expect(logged(c, /Stigningen fortsätter i 12 knop\. Maskinen går till 12 knop på målet/)).toBe(true);
    let fastest = 0;
    run(600, () => {
      fastest = Math.max(fastest, c.sim.kinematics().u / KN);
      return c.ascent.phase === 'listen';
    });
    expect(fastest).toBeGreaterThan(11);
    expect(c.ascent.phase).toBe('listen');
    run(5);
    send({ kind: 'setSpeed', knots: 8 });
    run(1);
    expect(c.ascent.phase).toBe('listen');
    expect(logged(c, /Stigningen fortsätter i 4 knop\. Maskinen går till 8 knop på målet/)).toBe(true);
    run(600, () => !c.ascent.active);
    expect(c.ascent.active).toBe(false);
    expect(c.log.some((e) => e.text === CANCELLED)).toBe(false);
    expect(logged(c, /Maskinen går tillbaka till 8 knop/)).toBe(true);
  });

  it('Stopp, astern or full ahead cut the ascent short', () => {
    for (const knots of [0, -4, 19]) {
      const { c, send, run } = start({ depth: 200, speed: 0, neutral: true });
      send({ kind: 'setDepth', depth: 13 });
      run(5);
      expect(c.ascent.phase).toBe('rise');
      send({ kind: 'setSpeed', knots });
      run(1);
      expect(c.ascent.active).toBe(false);
      expect(c.log.some((e) => e.text === CANCELLED)).toBe(true);
    }
  });

  it('a ship close by: the crew stays at 35 m and says so; a new depth order takes it up', () => {
    const { c, send, run } = start({ depth: 120, speed: 0, neutral: true, heading: 0 });
    const ship: VesselDef = {
      id: 'nara', name: 'M/S Nära', kind: 'freighter', length: 130, beam: 20, draft: 8, speed: 2,
      turnRate: 0.01, route: [[600, -1500], [600, 1500]], repeat: 'shuttle', propellerRps: 2, blades: 4,
    };
    c.world.add([ship]);
    send({ kind: 'setDepth', depth: 13 });
    run(900, () => c.ascent.phase === 'hold');
    expect(c.ascent.phase).toBe('hold');
    expect(logged(c, /stark kontakt/)).toBe(true);
    run(60);
    expect(Math.abs(c.sim.y[2]! - ASCENT.levelDepth)).toBeLessThan(3);
    send({ kind: 'setDepth', depth: 13 });
    run(400, () => Math.abs(c.sim.y[2]! - 13) < 1);
    expect(Math.abs(c.sim.y[2]! - 13)).toBeLessThan(1);
  });

  it('to the surface: the same way up, the main ballast blown only at 15 m, then the old speed', () => {
    const { c, send, run } = start({ depth: 200, speed: 0, neutral: true });
    run(20);
    send({ kind: 'setDepth', depth: 0 });
    let blownDeep = false;
    run(1200, () => {
      if (blowing(c) && c.sim.y[2]! > 16) blownDeep = true;
      return c.sim.y[2]! < 4 && !c.ascent.active;
    });
    expect(blownDeep).toBe(false);
    expect(c.sim.y[2]!).toBeLessThan(4);
    expect(logged(c, /Assistent: nödblåsning/)).toBe(false);
    run(90);
    expect(Math.abs(c.sim.y[7]!)).toBeLessThan(0.5);
  });
});

describe('the main ballast blown', () => {
  it('an emergency blow from 200 m goes to the surface, even if periscope depth is ordered on the way', () => {
    const { c, send, run } = start({ depth: 200, speed: 4 * KN, neutral: true });
    send({ kind: 'surface' });
    run(20);
    expect(c.blowCommitted).toBe(true);
    send({ kind: 'setDepth', depth: 13 });
    run(2);
    expect(logged(c, /Nödblåsning pågår, ubåten går till ytan/)).toBe(true);
    run(300, () => c.sim.y[2]! < 4);
    expect(c.sim.y[2]!).toBeLessThan(4);
    run(10);
    expect(c.blowCommitted).toBe(false);
  });

  it('Nödblåsning from 150 m (surface, full ahead, 0 m): no stepped ascent on top of it, full speed all the way', () => {
    const { c, run } = start({ depth: 150, speed: 0, neutral: true, heading: 0 });
    run(20);
    submitEmergencyBlow(c, 'keyboard');
    let slowest = Infinity;
    run(300, () => {
      expect(c.ascent.active).toBe(false);
      const k = c.sim.kinematics();
      if (k.u > 8 * KN) slowest = Math.min(slowest, k.u / KN);
      return k.depth < 4;
    });
    expect(c.sim.y[2]!).toBeLessThan(4);
    expect(slowest).toBeGreaterThan(8);
    expect(logged(c, /Stigning i|Planar ut på/)).toBe(false);
  });

  it('a shallow blow (Yta at 15 m) is stopped and vented when a depth under water is ordered', () => {
    const { c, send, run } = start({ depth: 30, speed: 4 * KN, neutral: true });
    send({ kind: 'setSpeed', knots: 4 });
    send({ kind: 'setDepth', depth: 0 });
    run(400, () => blowing(c));
    expect(blowing(c)).toBe(true);
    run(3);
    send({ kind: 'setDepth', depth: 13 });
    run(2);
    expect(blowing(c)).toBe(false);
    expect(logged(c, /Blåsningen stoppas/)).toBe(true);
    let shallowest = 99;
    run(300, () => {
      shallowest = Math.min(shallowest, c.sim.y[2]!);
    });
    expect(shallowest).toBeGreaterThan(2);
    expect(Math.abs(c.sim.y[2]! - 13)).toBeLessThan(2);
    const mbt = c.sim.telemetry().tanks.filter((t) => t.kind === 'mainBallast');
    expect(Math.min(...mbt.map((t) => t.fill))).toBeGreaterThan(0.98);
  });

  it('a corvette hears an emergency blow from the deep', () => {
    const { c, send, run } = start({ depth: 150, speed: 4 * KN, neutral: true });
    c.world.add([{ id: 'vakt', name: 'korvetten Vakt', kind: 'patrol', length: 72, beam: 10, draft: 3.5, speed: 0, turnRate: 0.04, route: [[4000, 0]], repeat: 'loop', propellerRps: 4, blades: 5 }]);
    run(2);
    const before = c.sonar.awareness.vakt ?? 0;
    send({ kind: 'surface' });
    run(2);
    expect((c.sonar.awareness.vakt ?? 0) - before).toBeGreaterThan(0.3);
  });

  it('venting shallow shows as a bubble on the surface', () => {
    const { c, run } = start({ depth: 20, speed: 4 * KN, neutral: true });
    c.sim.setVents(true);
    // Air in the tanks to vent: a little blown in first.
    c.sim.setVents(false);
    c.sim.setBlow(true);
    run(3);
    c.sim.setBlow(false);
    c.sim.setVents(true);
    run(1);
    expect(c.sonar.venting(c.sim.telemetry())).toBe(true);
  });
});

describe('no speed', () => {
  it('stopped by the player at 200 m, Yta: no blow; the crew hovers up and says how to go on', () => {
    const { c, send, run } = start({ depth: 200, speed: 0, neutral: true }, false);
    run(20);
    send({ kind: 'setDepth', depth: 0 });
    run(300);
    expect(blowing(c)).toBe(false);
    expect(c.hovering).toBe(true);
    expect(c.sim.y[2]!).toBeLessThan(195);
    expect(logged(c, /djuprodren biter inte/)).toBe(true);
  });

  it('the player handles the speed, little way on at 200 m, Per.djup: said at once; the telegraph and Per.djup again take it up', () => {
    const { c, send, run } = start({ depth: 200, speed: 2 * KN, neutral: true }, false);
    run(5);
    send({ kind: 'setDepth', depth: 13 });
    run(1);
    expect(c.ascent.active).toBe(false);
    expect(c.log.some((e) => e.text === STILL_HINT)).toBe(true);
    send({ kind: 'setSpeed', knots: 0 });
    send({ kind: 'setDepth', depth: 13 });
    run(1);
    expect(c.ascent.phase).toBe('rise');
    run(90);
    expect(c.sim.y[2]!).toBeLessThan(185);
  });

  it('stopped and hovering: only the hover\'s own word, not the hint as well', () => {
    const { c, send, run } = start({ depth: 200, speed: 0, neutral: true }, false);
    run(20);
    send({ kind: 'setDepth', depth: 13 });
    run(2);
    expect(c.hovering).toBe(true);
    expect(c.log.some((e) => e.text === STILL_HINT)).toBe(false);
  });

  it('the compensating pump is slower out against the sea pressure, faster in', () => {
    const rate = (depth: number, litres: number) => {
      const sim = new Simulation({ area: 'atlantic', depth, neutral: true });
      const before = sim.tanks.find((_, i) => sim.tankDefs[i]!.id === 'comp')!.water;
      sim.requestCompensation(litres / 1000);
      for (let i = 0; i < 1000; i++) sim.step();
      return Math.abs(sim.tanks.find((_, i) => sim.tankDefs[i]!.id === 'comp')!.water - before) / 10;
    };
    expect(rate(200, -200)).toBeLessThan(0.6 * rate(5, -200));
    expect(rate(200, 200)).toBeGreaterThan(1.3 * rate(5, 200));
  });
});
