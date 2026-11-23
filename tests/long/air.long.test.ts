import { describe, expect, it } from 'vitest';
import { Controller } from '../../src/control/controller';
import type { Order } from '../../src/control/orders';
import { Simulation, type InitialConditions } from '../../src/sim/simulation';

const NO_CURRENT = { speed: 0, toward: 0, decay: 1 };

function start(initial: InitialConditions, bar: number) {
  const c = new Controller(new Simulation({ area: 'atlantic', current: NO_CURRENT, ...initial }));
  c.crewTakesAll();
  if (initial.depth !== undefined) c.setpoints.depth = Math.round(c.sim.y[2]!);
  c.sim.air.bottlePV = bar * 1e5 * c.sim.cfg.air.bottleVolume;
  const send = (o: Order) => c.submit(o, 'touch');
  const run = (seconds: number, each?: () => boolean | void) => {
    for (let i = 0; i < seconds * 100; i++) {
      c.step();
      if (i % 100 === 0 && each?.()) return;
    }
  };
  return { c, send, run };
}

const logged = (c: Controller, re: RegExp) => c.log.some((e) => re.test(e.text));

describe('an emergency blow without enough air', () => {
  it('is called off at once: the crew goes up on the planes, and depth orders work again', () => {
    // Bottles at 14 bar after an earlier blow; 200 m down the sea presses with ~21 bar.
    const { c, send, run } = start({ depth: 200, speed: 0, neutral: true, heading: 0 }, 14);
    send({ kind: 'setSpeed', knots: 0 });
    run(5);
    send({ kind: 'surface' });
    run(5);
    expect(c.blowCommitted).toBe(false);
    expect(logged(c, /Tryckluften räcker inte för att blåsa på 2\d\d m/)).toBe(true);
    expect(c.sim.tanks.some((t) => t.blowOpen)).toBe(false);
    // Up on the planes with way on: past 35 m within a few minutes (it stood still at ~195 m before).
    let shallowest = 200;
    run(600, () => {
      shallowest = Math.min(shallowest, c.sim.kinematics().depth);
      return shallowest < 40;
    });
    expect(shallowest).toBeLessThan(40);
    // A depth order is no longer refused.
    send({ kind: 'setDepth', depth: 60 });
    run(1);
    expect(c.setpoints.depth).toBe(60);
  });

  it('the compressors refill the bottles on the surface, and the crew says when they are full', () => {
    const { c, run } = start({ heading: 0 }, 80);
    run(1);
    expect(logged(c, /Tryckluften är nere i 80 bar/)).toBe(true);
    const p0 = c.sim.telemetry().airPressure;
    run(60);
    const t = c.sim.telemetry();
    expect(t.compressor).toBe(true);
    expect(t.airPressure).toBeGreaterThan(p0 + 5e5);
    run(1800, () => !c.sim.telemetry().compressor);
    expect(c.sim.telemetry().airPressure).toBeCloseTo(c.sim.cfg.air.bottlePressure, -3);
    expect(logged(c, /Luftflaskorna är fulla \(250 bar\)/)).toBe(true);
  });

  it('dived, the compressors stand still', () => {
    const { c, run } = start({ depth: 50, speed: 0, neutral: true, heading: 0 }, 80);
    run(30);
    expect(c.sim.telemetry().compressor).toBe(false);
    expect(c.sim.telemetry().airPressure).toBeCloseTo(80e5, -3);
  });

  it('an emergency blow from 250 m at 12 knots: the shaft stops once rising fast, the bow stays up and the boat does not run astern', () => {
    // Played: the bow went 24° down against full rise on the planes, and the boat came up 7 knots astern.
    const { c, send, run } = start({ depth: 250, speed: 12 * (1852 / 3600), neutral: true, heading: 0 }, 250);
    send({ kind: 'setSpeed', knots: 12 });
    run(5);
    send({ kind: 'surface' });
    let bowDown = 0;
    let astern = 0;
    let stopped = false;
    run(250, () => {
      const t = c.sim.telemetry();
      bowDown = Math.min(bowDown, t.pitch);
      astern = Math.min(astern, t.u);
      stopped ||= c.conn.blowStopped;
      return t.depth < 3;
    });
    expect(c.sim.kinematics().depth).toBeLessThan(3);
    expect(stopped).toBe(true);
    expect(bowDown * (180 / Math.PI)).toBeGreaterThan(-15);
    expect(astern / (1852 / 3600)).toBeGreaterThan(-4);
  });
});
