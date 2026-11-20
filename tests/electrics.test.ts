import { describe, expect, it } from 'vitest';
import { Simulation } from '../src/sim/simulation';

const KN = 1852 / 3600;
const run = (s: Simulation, seconds: number) => {
  for (let i = 0; i < seconds * 100; i++) s.step();
};
const under = (kn: number, extra: ConstructorParameters<typeof Simulation>[0] = {}) => {
  const s = new Simulation({ depth: 50, designTrim: true, speed: kn * KN, ...extra });
  s.commands.rps = s.rpsForSpeed(kn * KN);
  return s;
};

describe('battery', () => {
  it('drains faster the faster the boat goes: hotel load at rest, about the motor rating at full speed', () => {
    const slow = under(4);
    const fast = under(19);
    const rest = under(0);
    run(slow, 20);
    run(fast, 20);
    run(rest, 20);
    const e = slow.cfg.electrics;
    expect(rest.telemetry().electricalLoad).toBeCloseTo(e.hotelLoad, -3);
    expect(slow.telemetry().electricalLoad).toBeGreaterThan(e.hotelLoad);
    expect(fast.telemetry().electricalLoad).toBeGreaterThan(10 * slow.telemetry().electricalLoad);
    expect(fast.telemetry().electricalLoad).toBeLessThan(fast.cfg.propulsion.maxPower / e.motorEfficiency + e.hotelLoad + 1);
    // Energy balance: the charge falls by the battery energy drawn.
    const before = slow.systems.electrics.soc;
    run(slow, 10);
    const drawn = slow.telemetry().batteryPower * 10;
    expect((before - slow.systems.electrics.soc) * e.batteryCapacity).toBeCloseTo(drawn, -4);
    // Days at 4 knots, under two hours at full speed (a 60 m boat on ~6 MWh).
    const hours = (s: Simulation) => (e.batteryCapacity * 0.9) / s.telemetry().electricalLoad / 3600;
    expect(hours(slow)).toBeGreaterThan(24);
    expect(hours(fast)).toBeLessThan(2);
  });

  it('empty, the motor stops and the boat slows; the charge never goes below zero', () => {
    const s = under(8, { battery: 0 });
    run(s, 90);
    const t = s.telemetry();
    expect(t.battery).toBe(0);
    expect(t.motorPowerLimit).toBe(0);
    expect(t.u / KN).toBeLessThan(5.5);
  });
});

describe('diesels and snorkel', () => {
  it('do not run submerged with the snorkel down, even when ordered', () => {
    const s = under(4, { battery: 0.5 });
    s.commands.diesel = true;
    run(s, 10);
    const t = s.telemetry();
    expect(t.inductionAir).toBe(false);
    expect(t.dieselRunning).toBe(false);
    expect(t.batteryPower).toBeGreaterThan(0);
  });

  it('snorkelling at periscope depth they charge the battery; lowering the snorkel stops them', () => {
    const s = new Simulation({ depth: 13, neutral: true, speed: 4 * KN, battery: 0.5 });
    s.commands.rps = s.rpsForSpeed(4 * KN);
    s.commands.snorkelUp = true;
    s.commands.diesel = true;
    run(s, 12);
    let t = s.telemetry();
    expect(t.snorkel).toBe(1);
    expect(t.snorkelHeadDepth).toBeLessThan(-1);
    expect(t.dieselRunning).toBe(true);
    run(s, 30);
    t = s.telemetry();
    expect(t.generatorPower).toBe(s.cfg.electrics.generatorPower);
    expect(t.batteryPower).toBeLessThan(-0.8e6); // charging at ~1 MW
    const soc = t.battery;
    run(s, 60);
    expect(s.telemetry().battery).toBeGreaterThan(soc);
    s.commands.snorkelUp = false;
    run(s, 4 + s.cfg.snorkel.airGrace);
    expect(s.telemetry().dieselRunning).toBe(false);
  });

  it('a snorkel head under water stops them after a few seconds (too deep to snorkel)', () => {
    const s = new Simulation({ depth: 18, neutral: true, battery: 0.5 });
    s.commands.snorkelUp = true;
    s.commands.diesel = true;
    run(s, 11);
    expect(s.telemetry().snorkelHeadDepth).toBeGreaterThan(0);
    expect(s.telemetry().dieselRunning).toBe(false);
  });

  it('run on the surface through the sail, and charging tapers as the battery fills', () => {
    const s = new Simulation({ battery: 0.97 });
    s.commands.diesel = true;
    run(s, 20);
    const t = s.telemetry();
    expect(t.dieselRunning).toBe(true);
    // Near full the cells take far less than the generators can give.
    expect(-t.batteryPower).toBeLessThan(0.3 * s.cfg.electrics.generatorPower);
    expect(-t.batteryPower).toBeGreaterThan(0);
  });

  it('with an empty battery the generators drive the motor (and charge what is left over)', () => {
    const s = new Simulation({ battery: 0 });
    const e = s.cfg.electrics;
    s.commands.diesel = true;
    run(s, 2);
    // Ramping up: the motor may take what the generators give beyond the hotel load.
    const early = s.telemetry();
    expect(early.motorPowerLimit).toBeCloseTo(Math.max(0, early.generatorPower - e.hotelLoad) * e.motorEfficiency, -3);
    run(s, 20);
    const t = s.telemetry();
    expect(t.motorPowerLimit).toBeGreaterThanOrEqual((e.generatorPower - e.hotelLoad) * e.motorEfficiency);
    expect(t.battery).toBeGreaterThan(0);
  });
});
