// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { Autopilot, type AutopilotInput } from '../src/control/autopilot';
import { Controller } from '../src/control/controller';
import { acknowledgement, type Order } from '../src/control/orders';
import { LIMITS, parseCommand } from '../src/control/parser';
import { SUBMARINE } from '../src/sim/config/submarine';
import { propellerForces } from '../src/sim/propulsion';
import { Simulation } from '../src/sim/simulation';
import { createInstruments } from '../src/ui/instruments';

const KN = 1852 / 3600;
const DEG = Math.PI / 180;
const P = SUBMARINE.propulsion;
const RHO = 1025;

const order = (s: string): Order => {
  const r = parseCommand(s);
  if (!r.ok || !('order' in r)) throw new Error(s);
  return r.order;
};
const error = (s: string): string => {
  const r = parseCommand(s);
  if (r.ok) throw new Error(s);
  return r.error;
};

describe('propeller astern', () => {
  it('gives less thrust astern than ahead at the same shaft speed', () => {
    const ahead = propellerForces(P, 1.5, 0, 1.5, RHO).thrust;
    const astern = propellerForces(P, -1.5, 0, -1.5, RHO).thrust;
    expect(astern).toBeLessThan(0);
    expect(-astern / ahead).toBeCloseTo(P.asternFactor, 9);
  });

  it('is continuous through zero shaft speed, also while the boat moves', () => {
    for (const u of [-2, 0, 3]) {
      const a = propellerForces(P, 1e-9, u, 0, RHO);
      const b = propellerForces(P, -1e-9, u, 0, RHO);
      expect(Math.abs(a.thrust - b.thrust)).toBeLessThan(1e-4);
      expect(Math.abs(a.torque - b.torque)).toBeLessThan(1e-4);
    }
  });

  it('brakes a boat going ahead when the shaft runs astern (and vice versa)', () => {
    expect(propellerForces(P, -1, 3, -1, RHO).thrust).toBeLessThan(0);
    expect(propellerForces(P, 1, -2, 1, RHO).thrust).toBeGreaterThan(0);
  });

  it('finds the steady astern shaft speed; 6 knots astern is within the astern limit', () => {
    const s = new Simulation({ depth: 50, designTrim: true });
    const n6 = s.rpsForSpeed(-6 * KN);
    expect(n6).toBeLessThan(0);
    expect(-n6).toBeLessThan(P.maxRpsAstern);
    // More shaft speed astern than ahead for the same speed (weaker propeller).
    expect(-n6).toBeGreaterThan(s.rpsForSpeed(6 * KN));
    // Thrust balances drag at that shaft speed.
    const T = propellerForces(P, n6, -6 * KN, n6, s.water.rhoSurface).thrust;
    const drag = 0.5 * s.water.rhoSurface * SUBMARINE.hull.length ** 2 * SUBMARINE.hydro.Xuu * (6 * KN) ** 2 + SUBMARINE.hydro.lowSpeed.Xu * 6 * KN;
    expect(T).toBeCloseTo(drag, -1);
    // Out of reach: the astern limit.
    expect(s.rpsForSpeed(-12 * KN)).toBeCloseTo(-P.maxRpsAstern, 6);
  });

  it('limits the commanded shaft speed astern', () => {
    const s = new Simulation({ depth: 50, designTrim: true });
    s.commands.rps = -P.maxRps;
    s.step();
    expect(s.commands.rps).toBe(-P.maxRpsAstern);
  });

  it('can start going astern', () => {
    const s = new Simulation({ depth: 50, designTrim: true, speed: -4 * KN });
    expect(s.kinematics().u / KN).toBeCloseTo(-4, 1);
    expect(s.commands.rps).toBeLessThan(0);
  });
});

describe('autopilot direction', () => {
  const input = (speed: number): AutopilotInput => ({ depth: 50, depthRate: 0, pitch: 0, pitchRate: 0, heading: 0, yawRate: 0, speed });

  it('switches to astern below −0.2 m/s and back above +0.2 m/s', () => {
    const ap = new Autopilot();
    const dirs = [0.5, 0, -0.1, -0.25, -0.1, 0, 0.1, 0.25, 0.1].map((u) => ap.direction(u));
    expect(dirs).toEqual([1, 1, 1, -1, -1, -1, -1, 1, 1]);
  });

  it('turns the rudder and planes the other way astern', () => {
    const ahead = new Autopilot();
    const astern = new Autopilot();
    astern.direction(-1);
    // Heading error to starboard: starboard rudder ahead, port rudder astern.
    expect(ahead.rudder(10 * DEG, input(2), 0.01)).toBeGreaterThan(0);
    expect(astern.rudder(10 * DEG, input(-2), 0.01)).toBeLessThan(0);
    // On depth with the bow up: dive planes ahead, rise planes astern (the water comes from aft).
    const bowUp = (speed: number): AutopilotInput => ({ ...input(speed), pitch: 3 * DEG });
    expect(ahead.planes(50, bowUp(2), 0.01)).toBeGreaterThan(0);
    expect(astern.planes(50, bowUp(-2), 0.01)).toBeLessThan(0);
  });

  it('aims the stern down to go deeper astern', () => {
    // Deeper target astern: the pitch reference is bow up, and astern a bow-up
    // pitch needs dive planes. Both signs flip, so the planes are positive as ahead.
    const astern = new Autopilot();
    astern.direction(-1);
    expect(astern.planes(60, input(-2), 0.01)).toBeGreaterThan(0);
    const shallower = new Autopilot();
    shallower.direction(-1);
    expect(shallower.planes(40, input(-2), 0.01)).toBeLessThan(0);
  });

  it('resets the loops when the direction changes', () => {
    const ap = new Autopilot();
    for (let i = 0; i < 500; i++) ap.rudder(5 * DEG, input(2), 0.01);
    const before = ap.rudder(0, input(2), 0.01);
    expect(before).not.toBe(0); // the integral holds some rudder
    ap.direction(-1);
    expect(ap.rudder(0, input(-1), 0.01)).toBeCloseTo(0, 12);
  });
});

describe('orders astern', () => {
  it.each<[string, number]>([
    ['back 3', -3],
    ['back 4,5 knop', -4.5],
    ['backa 2', -2],
    ['back sakta', -2],
    ['back halv', -4],
    ['back full', -6],
    ['back 0', 0],
    ['fart -4', -4],
  ])('parses "%s"', (input, knots) => {
    expect(order(input)).toEqual({ kind: 'setSpeed', knots });
  });

  it('gives clear errors', () => {
    expect(error('back')).toMatch(/Ange en fart back/);
    expect(error('back 9')).toMatch(/mellan 0 och 6/);
    expect(error('back hlv')).toMatch(/Menade du "halv"/);
    expect(error(`varv -${LIMITS.maxRpmAstern + 10}`)).toMatch(new RegExp(`mellan -${LIMITS.maxRpmAstern} och`));
    expect(LIMITS.maxRpmAstern).toBe(Math.round(P.maxRpsAstern * 60));
  });

  it('acknowledges astern as "Back"', () => {
    expect(acknowledgement(order('back halv'))).toBe('Back 4 knop, ja');
    expect(acknowledgement(order('fart 0'))).toBe('Fart 0 knop, ja');
  });

  it('the simplified speed keys go past zero to 6 knots astern', () => {
    const c = new Controller(new Simulation({ depth: 50, designTrim: true }));
    c.setMode('simplified');
    for (let i = 0; i < 10; i++) c.submit({ kind: 'adjustSpeed', deltaKnots: -1 }, 'keyboard');
    c.step();
    expect(c.setpoints.speed).toBe(-6);
  });
});

describe('safety net astern', () => {
  // Deep (300 m) to the north, 60 m to the south: shallow astern of a north-going boat.
  const ground = (n: number) => (n < -40 ? 60 : 300);

  it('looks for the sea bed where the boat is going', () => {
    const ahead = new Controller(new Simulation({ depth: 30, designTrim: true, speed: 3 * KN, ground }));
    const astern = new Controller(new Simulation({ depth: 30, designTrim: true, speed: -3 * KN, ground }));
    expect(ahead.assist.depthLimit()).toBeGreaterThan(200);
    expect(astern.assist.depthLimit()).toBeLessThan(50);
  });
});

describe('instrument panel astern', () => {
  it('shows BACK and the astern target', () => {
    const c = new Controller(new Simulation({ depth: 50, designTrim: true, speed: -3 * KN }));
    c.submit({ kind: 'setSpeed', knots: -4 }, 'console');
    c.step();
    const el = document.createElement('div');
    createInstruments(el, c)(c.sim.telemetry());
    expect(el.textContent).toMatch(/BACK 3,0/);
    expect(el.textContent).toMatch(/→ BACK 4,0/);
  });
});
