import { describe, expect, it } from 'vitest';
import { Controller, normalizeOrder } from '../src/control/controller';
import { Simulation, type InitialConditions } from '../src/sim/simulation';

/** Fixes from the playtest (November 2026): orders and log lines. */
const game = (init: InitialConditions = {}) => {
  const c = new Controller(new Simulation({ area: 'atlantic', designTrim: true, ...init }));
  c.crewTakesAll();
  return c;
};
const run = (c: Controller, seconds: number) => {
  for (let i = 0; i < seconds * 100; i++) c.step();
};
const said = (c: Controller, re: RegExp) => c.log.some((e) => re.test(e.text));

describe('orders from the playtest', () => {
  it('courses are normalised to 0–359° and depths to 0–400 m before the acknowledgement', () => {
    expect(normalizeOrder({ kind: 'setHeading', heading: -10 })).toEqual({ kind: 'setHeading', heading: 350 });
    expect(normalizeOrder({ kind: 'setHeading', heading: 360 })).toEqual({ kind: 'setHeading', heading: 0 });
    expect(normalizeOrder({ kind: 'setDepth', depth: -5 })).toEqual({ kind: 'setDepth', depth: 0 });
    const c = game({ depth: 50, neutral: true });
    c.submit({ kind: 'setHeading', heading: -10 }, 'touch');
    run(c, 0.1);
    expect(said(c, /^Kurs 350, ja/)).toBe(true);
    expect(c.setpoints.heading).toBe(350);
  });

  it('a value that is not a number is refused: setDepth NaN grounded the whole simulation at once', () => {
    const c = game({ depth: 50, neutral: true });
    c.submit({ kind: 'setDepth', depth: Number.NaN }, 'touch');
    run(c, 5);
    expect(said(c, /Ogiltig order/)).toBe(true);
    expect(Number.isFinite(c.sim.y[2]!)).toBe(true);
    expect(c.setpoints.depth).toBe(50);
  });

  it("the player's Blås on both groups from the deep blows forward first, and the crew on the planes follows it up", () => {
    const c = game({ depth: 200, neutral: true });
    c.submit({ kind: 'crew', system: 'ballast', crew: false }, 'touch');
    c.submit({ kind: 'mainBallast', action: 'blow', group: 'all' }, 'touch');
    run(c, 1);
    const blowing = (id: string) => c.sim.tanks[c.sim.tankDefs.findIndex((d) => d.id === id)]!.blowOpen;
    expect(blowing('mbt_fwd')).toBe(true);
    expect(blowing('mbt_aft')).toBe(false);
    expect(said(c, /Huvudballasten för blåses först/)).toBe(true);
    expect(c.setpoints.depth).toBe(0);
    run(c, 20);
    expect(blowing('mbt_aft')).toBe(true);
  });

  it('a bearing without a lookout is refused, not acknowledged after the error', () => {
    const c = game({ depth: 50, neutral: true });
    c.submit({ kind: 'reportBearing', bearing: 63 }, 'touch');
    run(c, 0.1);
    expect(said(c, /Ingen utkik/)).toBe(true);
    expect(said(c, /Bäring 063/)).toBe(false);
  });

  it('"Besättningen sköter allt" says what the scenario keeps locked', () => {
    const c = game({ depth: 50, neutral: true });
    c.options.locks = { trim: false, depth: false };
    c.submit({ kind: 'crew', system: 'all', crew: true }, 'touch');
    run(c, 0.1);
    expect(said(c, /^Utom djupet och trimmet, som scenariot låser\./)).toBe(true);
  });

  it('the periscope raised deep down says it does not reach the surface; masts left up deep are told once', () => {
    const c = game({ depth: 60, neutral: true });
    c.submit({ kind: 'periscope', up: true }, 'touch');
    run(c, 12);
    expect(said(c, /På 60 m når periskopet inte över ytan/)).toBe(true);
    expect(c.log.filter((e) => /Periskopet är uppe på \d+ m/.test(e.text))).toHaveLength(1);
  });

  it('masts up at speed are told', () => {
    const c = game({ depth: 13, neutral: true, speed: 12 * (1852 / 3600) });
    c.submit({ kind: 'setSpeed', knots: 12 }, 'touch');
    c.submit({ kind: 'snorkel', up: true }, 'touch');
    run(c, 15);
    expect(said(c, /^Snorkeln är uppe i 1\d knop/)).toBe(true);
  });
});
