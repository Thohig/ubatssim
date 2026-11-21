import { describe, expect, it } from 'vitest';
import { Controller } from '../src/control/controller';
import { LOCK_TEXT, PERISCOPE_DEPTH } from '../src/control/crew';
import { acknowledgement, type Order } from '../src/control/orders';
import { parseCommand } from '../src/control/parser';
import { Simulation, type InitialConditions } from '../src/sim/simulation';

const DEG = 180 / Math.PI;

/** A game where the crew handles everything (as every game starts), or the player does (`crew` false). */
function game(initial: InitialConditions, crew: boolean) {
  const c = new Controller(new Simulation(initial));
  if (crew) c.crewTakesAll();
  const run = (seconds: number, each?: () => void) => {
    for (let i = 0; i < seconds * 100; i++) {
      c.step();
      each?.();
    }
  };
  const send = (o: Order) => c.submit(o, 'keyboard');
  return { c, sim: c.sim, run, send };
}

/** The "D" key: dive and, without a deeper target, periscope depth. */
const dive = (c: Controller) => {
  c.submit({ kind: 'dive' }, 'keyboard');
  if (!c.ap.depth || c.setpoints.depth < PERISCOPE_DEPTH) c.submit({ kind: 'setDepth', depth: PERISCOPE_DEPTH }, 'keyboard');
};

describe('orders while the crew handles the boat', () => {
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
    const { c, run, send } = game({ depth: 40, speed: 3, designTrim: true, heading: 5 / DEG }, true);
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
    const { c, sim, run, send } = game({}, true);
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
    const { c, sim, run, send } = game({ depth: 30, speed: 3, designTrim: true }, true);
    send({ kind: 'surface' });
    run(1);
    expect(c.setpoints.depth).toBe(0);
    // From 30 m forward first (the bow comes up), aft 15 s later.
    const mbt = () => sim.telemetry().tanks.filter((t) => t.kind === 'mainBallast');
    expect(mbt().map((t) => t.blowOpen)).toEqual([true, false]);
    run(15);
    expect(mbt()[1]!.blowOpen).toBe(true);
    expect(c.log.some((e) => e.text === 'Huvudballasten akter blåses.')).toBe(true);
  });
});

describe('the crew and the player', () => {
  it('a new Controller leaves everything to the player; a game starts with the crew on everything', () => {
    const player = new Controller(new Simulation({ depth: 40, designTrim: true }));
    expect(Object.values(player.duties()).every((d) => !d)).toBe(true);
    const { c } = game({ depth: 40, speed: 3, designTrim: true }, true);
    expect(Object.values(c.duties()).every((d) => d)).toBe(true);
    expect(c.setpoints.depth).toBe(40);
  });

  it('handing everything to the crew holds the present depth and heading', () => {
    const { c, run, send } = game({ depth: 60, speed: 3, designTrim: true }, false);
    send({ kind: 'rudder', angle: 10 });
    run(30);
    const k = c.sim.kinematics();
    send({ kind: 'crew', system: 'all', crew: true });
    run(0.01);
    expect(c.ap.depth && c.ap.heading && c.options.crew.trim).toBe(true);
    expect(c.setpoints.depth).toBe(Math.round(k.depth));
    expect(Math.abs(c.setpoints.heading - Math.round(k.heading * DEG))).toBeLessThanOrEqual(1);
  });

  it('taking over keeps the last rudder and plane commands', () => {
    const { c, sim, run, send } = game({ depth: 60, speed: 3, designTrim: true }, true);
    send({ kind: 'adjustHeading', deltaDegrees: 30 });
    send({ kind: 'adjustDepth', deltaMetres: 10 });
    run(10);
    const before = { ...sim.commands };
    send({ kind: 'crew', system: 'all', crew: false });
    run(0.01);
    expect(c.ap.depth || c.ap.heading).toBe(false);
    expect(Math.abs(sim.commands.rudder - before.rudder) * DEG).toBeLessThanOrEqual(0.5);
    expect(Math.abs(sim.commands.sternPlanes - before.sternPlanes) * DEG).toBeLessThanOrEqual(0.5);
    expect(c.log.at(-1)?.text).toBe('Du sköter allt, ja');
  });

  it('a manual order takes its system over; the crew\'s own orders do not', () => {
    const { c, run, send } = game({ depth: 40, speed: 3, designTrim: true }, true);
    c.submit({ kind: 'compensate', litres: -100 }, 'assist');
    run(0.01);
    expect(c.options.crew.trim).toBe(true);
    send({ kind: 'trim', litres: 100 });
    run(0.01);
    expect(c.options.crew.trim).toBe(false);
    expect(c.log.some((e) => /Trimassistenten avlöst/.test(e.text))).toBe(true);
    send({ kind: 'mainBallast', action: 'shut', group: 'all' });
    send({ kind: 'rudder', angle: 5 });
    send({ kind: 'setRpm', rpm: 60 });
    run(0.01);
    expect(c.duties()).toMatchObject({ ballast: false, heading: false, speed: false, depth: true });
    // Targets hand the axes back.
    send({ kind: 'setHeading', heading: 90 });
    send({ kind: 'setSpeed', knots: 4 });
    run(0.01);
    expect(c.duties()).toMatchObject({ heading: true, speed: true });
    expect([...c.selfHandled].sort()).toEqual(['ballast', 'heading', 'speed', 'trim']);
  });

  it('the trim assistant works only while the crew handles the trim', () => {
    const { c, run, send } = game({ depth: 40, speed: 4 * 1852 / 3600, designTrim: true, tankFills: { comp: 0.6 } }, true);
    send({ kind: 'crew', system: 'trim', crew: false });
    run(120);
    expect(c.log.some((e) => e.source === 'assist')).toBe(false);
    send({ kind: 'crew', system: 'trim', crew: true });
    run(120);
    expect(c.log.some((e) => e.source === 'assist' && /Kompensera/.test(e.text))).toBe(true);
  });

  it('a player handling the ballast must clear the bridge; the crew clears it', () => {
    const player = game({}, true);
    player.send({ kind: 'crew', system: 'ballast', crew: false });
    player.send({ kind: 'dive' });
    player.run(0.02);
    expect(player.c.log.at(-1)?.text).toMatch(/Bryggan är bemannad/);
    const crew = game({}, true);
    crew.send({ kind: 'dive' });
    crew.run(0.02);
    expect(crew.c.bridgeManned).toBe(false);
  });

  it('a scenario\'s locks refuse orders that would change them, and "allt" leaves them be', () => {
    const c = new Controller(new Simulation({ depth: 30, speed: 3, designTrim: true }));
    c.options.locks = { depth: false, safetyNet: false };
    c.crewTakesAll();
    expect(c.duties()).toMatchObject({ depth: false, heading: true, trim: true, safetyNet: false });
    c.submit({ kind: 'adjustDepth', deltaMetres: 5 }, 'keyboard');
    c.step();
    expect(c.ap.depth).toBe(false);
    expect(c.log.at(-1)?.text).toBe(LOCK_TEXT.depth[1]);
    c.submit({ kind: 'crew', system: 'safetyNet', crew: true }, 'touch');
    c.step();
    expect(c.options.crew.safetyNet).toBe(false);
    c.submit({ kind: 'crew', system: 'all', crew: true }, 'touch');
    c.step();
    expect(c.duties()).toMatchObject({ depth: false, safetyNet: false });
    c.submit({ kind: 'planes', angle: 5 }, 'keyboard');
    c.step();
    expect(c.manual.planes).toBe(5);
  });

  it('pending duties include crew orders still in the queue (menus while paused)', () => {
    const { c, send } = game({ depth: 40, designTrim: true }, true);
    send({ kind: 'crew', system: 'trim', crew: false });
    expect(c.duties().trim).toBe(true);
    expect(c.pendingDuties().trim).toBe(false);
  });

  it('parses "besättning" and "själv"', () => {
    const order = (s: string) => {
      const r = parseCommand(s);
      if (!r.ok || !('order' in r)) throw new Error(s);
      return r.order;
    };
    expect(order('själv trim')).toEqual({ kind: 'crew', system: 'trim', crew: false });
    expect(order('besättning djup')).toEqual({ kind: 'crew', system: 'depth', crew: true });
    expect(order('besättningen allt')).toEqual({ kind: 'crew', system: 'all', crew: true });
    expect(order('själv skyddsnät')).toEqual({ kind: 'crew', system: 'safetyNet', crew: false });
    const bad = parseCommand('själv trimm');
    expect(bad.ok).toBe(false);
    expect(!bad.ok && bad.error).toMatch(/Menade du "trim"/);
    expect(acknowledgement({ kind: 'crew', system: 'trim', crew: false })).toBe('Trimassistenten avlöst, ja');
  });
});
