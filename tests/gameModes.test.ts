import { describe, expect, it } from 'vitest';
import { Controller } from '../src/control/controller';
import { PERISCOPE_DEPTH, type GameMode } from '../src/control/gameMode';
import { acknowledgement, type Order } from '../src/control/orders';
import { parseCommand } from '../src/control/parser';
import { Simulation, type InitialConditions } from '../src/sim/simulation';

const DEG = 180 / Math.PI;

function game(initial: InitialConditions, mode: GameMode) {
  const c = new Controller(new Simulation(initial));
  c.setMode(mode);
  const run = (seconds: number, each?: () => void) => {
    for (let i = 0; i < seconds * 100; i++) {
      c.step();
      each?.();
    }
  };
  const send = (o: Order) => c.submit(o, 'keyboard');
  return { c, sim: c.sim, run, send };
}

/** The simplified "D" key: dive and, without a deeper target, periscope depth. */
const dive = (c: Controller) => {
  c.submit({ kind: 'dive' }, 'keyboard');
  if (!c.ap.depth || c.setpoints.depth < PERISCOPE_DEPTH) c.submit({ kind: 'setDepth', depth: PERISCOPE_DEPTH }, 'keyboard');
};

describe('orders for the simplified simulation', () => {
  it('"dyk" and "ytläge" parse; "fyll" still floods', () => {
    const order = (s: string) => {
      const r = parseCommand(s);
      if (!r.ok || !('order' in r)) throw new Error(s);
      return r.order;
    };
    expect(order('dyk')).toEqual({ kind: 'dive' });
    expect(order('ytläge')).toEqual({ kind: 'surface' });
    expect(order('yta')).toEqual({ kind: 'surface' });
    expect(order('fyll hb')).toEqual({ kind: 'mainBallast', action: 'flood', group: 'all' });
    expect(parseCommand('dyk 30').ok).toBe(false);
  });

  it('acknowledges in Swedish', () => {
    expect(acknowledgement({ kind: 'adjustDepth', deltaMetres: 5 })).toBe('Djup 5 m djupare, ja');
    expect(acknowledgement({ kind: 'adjustDepth', deltaMetres: -5 })).toBe('Djup 5 m grundare, ja');
    expect(acknowledgement({ kind: 'adjustHeading', deltaDegrees: -10 })).toBe('Kurs 10° babord, ja');
    expect(acknowledgement({ kind: 'holdCourse' })).toBe('Håll kurs och djup, ja');
    expect(acknowledgement({ kind: 'dive' })).toBe('Dyk, ja');
    expect(acknowledgement({ kind: 'surface' })).toBe('Ytläge, ja');
  });

  it('target changes move the autopilot set points, wrapping the heading', () => {
    const { c, run, send } = game({ depth: 40, speed: 3, designTrim: true, heading: 5 / DEG }, 'simplified');
    expect(c.ap.depth && c.ap.heading).toBe(true);
    expect(c.setpoints).toMatchObject({ depth: 40, heading: 5 });
    send({ kind: 'adjustDepth', deltaMetres: 5 });
    send({ kind: 'adjustHeading', deltaDegrees: -10 });
    send({ kind: 'adjustHeading', deltaDegrees: -10 });
    run(0.02);
    expect(c.setpoints.depth).toBe(45);
    expect(c.setpoints.heading).toBe(345);
  });

  it('"dyk" floods the main ballast and shuts the vents when it is full', () => {
    const { c, sim, run, send } = game({}, 'simplified');
    dive(c);
    send({ kind: 'setSpeed', knots: 5 });
    run(1);
    const mbt = () => sim.telemetry().tanks.filter((t) => t.kind === 'mainBallast');
    expect(mbt().every((t) => t.ventOpen)).toBe(true);
    expect(c.setpoints.depth).toBe(PERISCOPE_DEPTH);
    run(240);
    expect(mbt().every((t) => !t.ventOpen && t.fill > 0.98)).toBe(true);
    expect(c.log.some((e) => /Ventilerna stängda/.test(e.text))).toBe(true);
  });

  it('"ytläge" blows and sends the depth autopilot to the surface', () => {
    const { c, sim, run, send } = game({ depth: 30, speed: 3, designTrim: true }, 'simplified');
    send({ kind: 'surface' });
    run(1);
    expect(c.setpoints.depth).toBe(0);
    expect(sim.telemetry().tanks.filter((t) => t.kind === 'mainBallast').every((t) => t.blowOpen)).toBe(true);
  });
});

describe('switching game mode', () => {
  it('to simplified holds the present depth and heading', () => {
    const { c, run, send } = game({ depth: 60, speed: 3, designTrim: true }, 'realistic');
    send({ kind: 'rudder', angle: 10 });
    run(30);
    const k = c.sim.kinematics();
    c.setMode('simplified');
    expect(c.ap.depth && c.ap.heading).toBe(true);
    expect(c.setpoints.depth).toBe(Math.round(k.depth));
    expect(c.setpoints.heading).toBe(Math.round(k.heading * DEG) % 360);
  });

  it('to realistic keeps the last rudder and plane commands', () => {
    const { c, sim, run, send } = game({ depth: 60, speed: 3, designTrim: true }, 'simplified');
    send({ kind: 'adjustHeading', deltaDegrees: 30 });
    send({ kind: 'adjustDepth', deltaMetres: 10 });
    run(10);
    const before = { ...sim.commands };
    c.setMode('realistic');
    expect(c.ap.depth || c.ap.heading).toBe(false);
    run(0.01);
    expect(Math.abs(sim.commands.rudder - before.rudder) * DEG).toBeLessThanOrEqual(0.5);
    expect(Math.abs(sim.commands.sternPlanes - before.sternPlanes) * DEG).toBeLessThanOrEqual(0.5);
  });

  it('realistic mode honours "autopilot not allowed"; simplified mode is built on it', () => {
    const { c, run, send } = game({ depth: 30, speed: 3, designTrim: true }, 'realistic');
    c.options.autopilotAllowed = false;
    send({ kind: 'adjustDepth', deltaMetres: 5 });
    run(0.02);
    expect(c.ap.depth).toBe(false);
    c.setMode('simplified');
    send({ kind: 'adjustDepth', deltaMetres: 5 });
    run(0.02);
    expect(c.ap.depth).toBe(true);
  });
});
