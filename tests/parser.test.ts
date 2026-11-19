import { describe, expect, it } from 'vitest';
import { Controller, formatSimTime } from '../src/control/controller';
import { acknowledgement, type Order } from '../src/control/orders';
import { parseCommand } from '../src/control/parser';
import { Simulation } from '../src/sim/simulation';

const order = (s: string): Order => {
  const r = parseCommand(s);
  if (!r.ok || !('order' in r)) throw new Error(`expected order for "${s}", got ${JSON.stringify(r)}`);
  return r.order;
};
const error = (s: string): string => {
  const r = parseCommand(s);
  if (r.ok) throw new Error(`expected error for "${s}"`);
  return r.error;
};

describe('parser', () => {
  it.each<[string, Order]>([
    ['djup 120', { kind: 'setDepth', depth: 120 }],
    ['Djup 120 m', { kind: 'setDepth', depth: 120 }],
    ['djup 45,5', { kind: 'setDepth', depth: 45.5 }],
    ['/djup 120', { kind: 'setDepth', depth: 120 }],
    ['kurs 270', { kind: 'setHeading', heading: 270 }],
    ['kurs 360', { kind: 'setHeading', heading: 0 }],
    ['fart 8 knop', { kind: 'setSpeed', knots: 8 }],
    ['fart 8 kn', { kind: 'setSpeed', knots: 8 }],
    ['fart 12,5', { kind: 'setSpeed', knots: 12.5 }],
    ['fart stopp', { kind: 'setSpeed', knots: 0 }],
    ['stopp', { kind: 'setSpeed', knots: 0 }],
    ['varv 120', { kind: 'setRpm', rpm: 120 }],
    ['roder styrbord 15', { kind: 'rudder', angle: 15 }],
    ['roder sb 15', { kind: 'rudder', angle: 15 }],
    ['roder 15 bb', { kind: 'rudder', angle: -15 }],
    ['roder babord 10°', { kind: 'rudder', angle: -10 }],
    ['roder midskepps', { kind: 'rudder', angle: 0 }],
    ['djuproder ned 10', { kind: 'planes', angle: 10 }],
    ['djuproder upp 5', { kind: 'planes', angle: -5 }],
    ['djuproder noll', { kind: 'planes', angle: 0 }],
    ['fyll huvudballast', { kind: 'mainBallast', action: 'flood', group: 'all' }],
    ['fyll hb akter', { kind: 'mainBallast', action: 'flood', group: 'aft' }],
    ['blås huvudballast', { kind: 'mainBallast', action: 'blow', group: 'all' }],
    ['blas hb för', { kind: 'mainBallast', action: 'blow', group: 'fwd' }],
    ['stäng huvudballast', { kind: 'mainBallast', action: 'shut', group: 'all' }],
    ['trimma för 200', { kind: 'trim', litres: 200 }],
    ['trimma akter 150 liter', { kind: 'trim', litres: -150 }],
    ['trimma 200 l för', { kind: 'trim', litres: 200 }],
    ['kompensera ut 300', { kind: 'compensate', litres: -300 }],
    ['kompensera in 200 liter', { kind: 'compensate', litres: 200 }],
    ['kompensera -300', { kind: 'compensate', litres: -300 }],
    ['autopilot av', { kind: 'autopilot', axis: 'all', on: false }],
    ['ap på djup', { kind: 'autopilot', axis: 'depth', on: true }],
    ['autopilot kurs av', { kind: 'autopilot', axis: 'heading', on: false }],
  ])('parses "%s"', (input, expected) => {
    expect(order(input)).toEqual(expected);
  });

  it('recognises help', () => {
    expect(parseCommand('hjälp')).toEqual({ ok: true, help: true });
  });

  it('gives clear errors', () => {
    expect(error('')).toMatch(/Tomt kommando/);
    expect(error('djuo 120')).toMatch(/Okänt kommando "djuo".*Menade du "djup"/);
    expect(error('djup')).toMatch(/Ange ett djup i meter/);
    expect(error('djup hundra')).toMatch(/"hundra" är inget tal/);
    expect(error('djup 900')).toMatch(/mellan 0 och 400/);
    expect(error('roder 15')).toMatch(/styrbord \(sb\) eller babord \(bb\)/);
    expect(error('roder styrbrd 15')).toMatch(/Menade du "styrbord"/);
    expect(error('roder sb 45')).toMatch(/högst 30/);
    expect(error('djuproder 10')).toMatch(/"ned" eller "upp"/);
    expect(error('trimma 200')).toMatch(/"för" eller "akter"/);
    expect(error('autopilot')).toMatch(/"på" eller "av"/);
    expect(error('blås toppen')).toMatch(/Förstår inte "toppen"/);
  });
});

describe('acknowledgements', () => {
  it('uses Swedish naval phrasing', () => {
    expect(acknowledgement(order('djup 120'))).toBe('Djup 120, ja');
    expect(acknowledgement(order('kurs 90'))).toBe('Kurs 090, ja');
    expect(acknowledgement(order('fart 8 knop'))).toBe('Fart 8 knop, ja');
    expect(acknowledgement(order('roder sb 15'))).toBe('Roder styrbord 15, ja');
    expect(acknowledgement(order('roder midskepps'))).toBe('Roder midskepps, ja');
    expect(acknowledgement(order('djuproder ned 10'))).toBe('Djuproder ned 10, ja');
    expect(acknowledgement(order('fyll huvudballast'))).toBe('Fyll huvudballast, ja');
    expect(acknowledgement(order('trimma för 200'))).toBe('Trimma 200 liter förut, ja');
    expect(acknowledgement(order('autopilot av'))).toBe('Autopilot av, ja');
  });

  it('formats simulation time', () => {
    expect(formatSimTime(3723.9)).toBe('01:02:03');
  });
});

describe('order queue and controller', () => {
  it('executes orders at the next step and acknowledges them with sim time', () => {
    const sim = new Simulation({ depth: 50, designTrim: true, speed: 4 });
    const c = new Controller(sim);
    for (let i = 0; i < 100; i++) c.step();
    c.submit(order('roder sb 20'), 'console');
    expect(sim.commands.rudder).toBe(0);
    expect(c.log).toHaveLength(0);
    c.step();
    expect(sim.commands.rudder).toBeCloseTo((20 * Math.PI) / 180, 12);
    expect(c.log[0]).toMatchObject({ text: 'Roder styrbord 20, ja', kind: 'ack', source: 'console' });
    expect(c.log[0]!.t).toBeCloseTo(1, 9);
  });

  it('keyboard and console orders go through the same queue in order', () => {
    const c = new Controller(new Simulation({ depth: 50, designTrim: true }));
    c.submit({ kind: 'rudder', angle: 5, relative: true }, 'keyboard');
    c.submit({ kind: 'rudder', angle: 5, relative: true }, 'keyboard');
    c.submit(order('roder bb 10'), 'console');
    c.submit({ kind: 'rudder', angle: 5, relative: true }, 'keyboard');
    c.step();
    expect(c.manual.rudder).toBe(-5);
    expect(c.log.map((e) => e.source)).toEqual(['keyboard', 'keyboard', 'console', 'keyboard']);
  });

  it('manual rudder disengages only the heading autopilot', () => {
    const c = new Controller(new Simulation({ depth: 50, designTrim: true, speed: 4 }));
    c.submit(order('djup 60'), 'console');
    c.submit(order('kurs 90'), 'console');
    c.submit(order('fart 8'), 'console');
    c.step();
    expect(c.ap).toEqual({ depth: true, heading: true, speed: true });
    c.submit({ kind: 'rudder', angle: 5, relative: true }, 'keyboard');
    c.step();
    expect(c.ap).toEqual({ depth: true, heading: false, speed: true });
    c.submit({ kind: 'planes', angle: -5, relative: true }, 'keyboard');
    c.step();
    expect(c.ap).toEqual({ depth: false, heading: false, speed: true });
  });

  it('is deterministic for the same order sequence', () => {
    const runOnce = () => {
      const c = new Controller(new Simulation());
      c.submit(order('fyll huvudballast'), 'console');
      c.submit(order('fart 6'), 'console');
      for (let i = 0; i < 3000; i++) {
        if (i === 1000) c.submit(order('roder sb 10'), 'keyboard');
        c.step();
      }
      return Array.from(c.sim.y);
    };
    expect(runOnce()).toEqual(runOnce());
  });
});
