import { describe, expect, it } from 'vitest';
import { PID, wrapAngle } from '../../src/control/autopilot';
import { Controller } from '../../src/control/controller';
import { parseCommand } from '../../src/control/parser';
import { Simulation } from '../../src/sim/simulation';

const DEG = 180 / Math.PI;
const KN = 1852 / 3600;
const cmd = (c: Controller, s: string) => {
  const r = parseCommand(s);
  if (!r.ok || !('order' in r)) throw new Error(s);
  c.submit(r.order, 'console');
};
const headingError = (c: Controller) => ((c.sim.telemetry().heading * DEG - c.setpoints.heading + 540) % 360) - 180;

describe('PID', () => {
  it('does not wind up while saturated', () => {
    const pid = new PID(1, 1, 0, -1, 1);
    for (let i = 0; i < 1000; i++) pid.update(10, 0, 0.01);
    // Error reverses: output must leave saturation immediately.
    expect(pid.update(-0.5, 0, 0.01)).toBeLessThan(0);
  });

  it('wraps heading errors the short way round', () => {
    expect(wrapAngle((350 - 10) / DEG) * DEG).toBeCloseTo(-20, 9);
    expect(wrapAngle((10 - 350) / DEG) * DEG).toBeCloseTo(20, 9);
  });
});

describe('autopilot', () => {
  it('takes the boat to 120 m and course 270 at 8 knots without large overshoot', { timeout: 60000 }, () => {
    const c = new Controller(new Simulation({ depth: 25, designTrim: true, speed: 8 * KN }));
    cmd(c, 'djup 120');
    cmd(c, 'kurs 270');
    cmd(c, 'fart 8 knop');
    let maxDepth = 0;
    let headingReached = false;
    let maxHeadingOvershoot = 0;
    for (let i = 0; i < 400 * 100; i++) {
      c.step();
      const t = c.sim.telemetry();
      maxDepth = Math.max(maxDepth, t.depth);
      const he = headingError(c);
      if (Math.abs(he) < 1) headingReached = true;
      if (headingReached) maxHeadingOvershoot = Math.max(maxHeadingOvershoot, Math.abs(he));
    }
    const t = c.sim.telemetry();
    expect(Math.abs(t.depth - 120)).toBeLessThan(1.5);
    expect(Math.abs(headingError(c))).toBeLessThan(1);
    expect(maxDepth - 120).toBeLessThan(6);
    expect(maxHeadingOvershoot).toBeLessThan(3);
    expect(Math.abs(t.u / KN - 8)).toBeLessThan(0.2);
  });

  it('turns the short way (350° → 10° via north)', { timeout: 30000 }, () => {
    const c = new Controller(new Simulation({ depth: 50, designTrim: true, speed: 6 * KN }));
    cmd(c, 'kurs 340');
    for (let i = 0; i < 150 * 100; i++) c.step();
    cmd(c, 'kurs 10');
    c.step();
    for (let i = 0; i < 20 * 100; i++) c.step();
    expect(c.sim.telemetry().r).toBeGreaterThan(0); // turning to starboard
  });

  it('holds speed with the speed autopilot', { timeout: 30000 }, () => {
    const c = new Controller(new Simulation({ depth: 60, designTrim: true }));
    cmd(c, 'fart 12 knop');
    for (let i = 0; i < 300 * 100; i++) c.step();
    expect(Math.abs(c.sim.telemetry().u / KN - 12)).toBeLessThan(0.2);
  });

  it('dives from the surface and levels off at the ordered depth', { timeout: 60000 }, () => {
    const c = new Controller(new Simulation());
    cmd(c, 'klart bryggan');
    cmd(c, 'fyll huvudballast');
    cmd(c, 'fart 6');
    cmd(c, 'djup 40');
    for (let i = 0; i < 500 * 100; i++) c.step();
    expect(Math.abs(c.sim.telemetry().depth - 40)).toBeLessThan(2);
  });

  it('manual planes take over depth while the heading autopilot keeps steering', { timeout: 30000 }, () => {
    const c = new Controller(new Simulation({ depth: 60, designTrim: true, speed: 8 * KN }));
    cmd(c, 'djup 60');
    cmd(c, 'kurs 45');
    for (let i = 0; i < 100 * 100; i++) c.step();
    c.submit({ kind: 'planes', angle: 5, relative: true }, 'keyboard');
    for (let i = 0; i < 100 * 100; i++) c.step();
    expect(c.ap.depth).toBe(false);
    expect(c.ap.heading).toBe(true);
    expect(c.sim.commands.sternPlanes * DEG).toBeCloseTo(c.manual.planes, 9);
    expect(Math.abs(headingError(c))).toBeLessThan(1.5);
  });

  it('hands over without a jump when switched off', () => {
    const c = new Controller(new Simulation({ depth: 50, designTrim: true, speed: 8 * KN }));
    cmd(c, 'kurs 90');
    for (let i = 0; i < 1000; i++) c.step();
    const before = c.sim.commands.rudder * DEG;
    cmd(c, 'autopilot av');
    c.step();
    expect(Math.abs(c.sim.commands.rudder * DEG - before)).toBeLessThan(1);
  });
});

describe('speed autopilot at the shaft limit', () => {
  it('an unreachable target (full ahead) winds nothing up: back to 8 knots without overshoot', { timeout: 60000 }, () => {
    const c = new Controller(new Simulation({ depth: 100, designTrim: true, speed: 18 * KN }));
    cmd(c, 'djup 100');
    cmd(c, 'fart 19');
    for (let i = 0; i < 600 * 100; i++) c.step();
    expect(c.sim.telemetry().u / KN).toBeGreaterThan(18.5); // full power, the target is just out of reach
    cmd(c, 'fart 8');
    let lowest = Infinity;
    for (let i = 0; i < 400 * 100; i++) {
      c.step();
      if (i > 200 * 100) lowest = Math.min(lowest, c.sim.telemetry().u / KN);
    }
    expect(Math.abs(c.sim.telemetry().u / KN - 8)).toBeLessThan(0.2);
    expect(lowest).toBeGreaterThan(7.6);
  });

  it('full astern runs the shaft at its astern limit and reaches the top speed astern', { timeout: 60000 }, () => {
    const c = new Controller(new Simulation({ depth: 100, designTrim: true }));
    cmd(c, 'djup 100');
    cmd(c, 'back full');
    for (let i = 0; i < 400 * 100; i++) c.step();
    const t = c.sim.telemetry();
    expect(t.rpsCmd).toBeCloseTo(-c.sim.cfg.propulsion.maxRpsAstern, 6);
    expect(t.u / KN).toBeLessThan(-6.6);
  });
});

describe('climb to periscope depth', () => {
  it('from 40 m at 4 knots overshoots less than 3 m (the sail stays under)', () => {
    const c = new Controller(new Simulation({ area: 'atlantic', depth: 40, speed: 4 * KN, neutral: true }));
    c.crewTakesAll();
    c.submit({ kind: 'setDepth', depth: 13 }, 'keyboard');
    c.submit({ kind: 'setSpeed', knots: 4 }, 'keyboard');
    let shallowest = Infinity;
    for (let i = 0; i < 600 * 100; i++) {
      c.step();
      shallowest = Math.min(shallowest, c.sim.y[2]!);
    }
    expect(shallowest).toBeGreaterThan(10);
    expect(Math.abs(c.sim.y[2]! - 13)).toBeLessThan(1.5);
  });

  it('then holds 13 m without swinging, with the crew trimming (snorkel up)', () => {
    // The depth integral and the trim assistant used to swing the boat 10.7–15.2 m about periscope depth with a
    // period of ~7 minutes after this climb: the snorkel dipped and the diesels stopped every few minutes.
    const c = new Controller(new Simulation({ area: 'atlantic', depth: 40, speed: 4 * KN, neutral: true, battery: 0.25 }));
    c.crewTakesAll();
    c.submit({ kind: 'setDepth', depth: 13 }, 'keyboard');
    let lo = Infinity;
    let hi = -Infinity;
    for (let i = 0; i < 1500 * 100; i++) {
      if (i === 400 * 100) c.submit({ kind: 'snorkel', up: true }, 'keyboard');
      c.step();
      if (i > 600 * 100) {
        lo = Math.min(lo, c.sim.y[2]!);
        hi = Math.max(hi, c.sim.y[2]!);
      }
    }
    expect(lo).toBeGreaterThan(11.8);
    expect(hi).toBeLessThan(14);
    expect(c.log.some((e) => /Dieslarna har stannat/.test(e.text))).toBe(false);
  });
});
