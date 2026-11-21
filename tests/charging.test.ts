import { describe, expect, it } from 'vitest';
import { Controller } from '../src/control/controller';
import { parseCommand } from '../src/control/parser';
import { Simulation, type InitialConditions } from '../src/sim/simulation';

const KN = 1852 / 3600;
const game = (init: InitialConditions) => {
  const c = new Controller(new Simulation(init));
  c.crewTakesAll();
  return c;
};
const run = (c: Controller, seconds: number) => {
  for (let i = 0; i < seconds * 100; i++) c.step();
};
const logs = (c: Controller) => c.log.map((e) => e.text);

describe('charging', () => {
  it('the crew runs the diesels once the snorkel is up, and stops them when the battery is full', () => {
    const c = game({ depth: 13, neutral: true, speed: 4 * KN, battery: 0.9 });
    run(c, 5);
    expect(c.sim.telemetry().dieselRunning).toBe(false);
    c.submit({ kind: 'snorkel', up: true }, 'keyboard');
    run(c, 15);
    expect(c.sim.telemetry().dieselRunning).toBe(true);
    expect(logs(c)).toContain('Dieslarna går. Batteriet laddas.');
    expect(c.duty('charging')).toBe(true);
    // Full: the crew stops them.
    c.sim.systems.electrics.soc = 0.995;
    run(c, 1);
    expect(c.sim.commands.diesel).toBe(false);
    expect(logs(c)).toContain('Batteriet är laddat. Dieslarna stoppade.');
  });

  it('lowering the snorkel with the diesels running is no fault (no alarm), but a dipping snorkel head is', () => {
    const c = game({ depth: 13, neutral: true, speed: 4 * KN, battery: 0.5 });
    c.submit({ kind: 'snorkel', up: true }, 'keyboard');
    run(c, 20);
    expect(c.sim.telemetry().dieselRunning).toBe(true);
    c.submit({ kind: 'snorkel', up: false }, 'keyboard');
    run(c, 10);
    expect(c.sim.telemetry().dieselRunning).toBe(false);
    expect(logs(c)).toContain('Dieslarna stoppade: snorkeln är nere.');
    expect(c.log.some((e) => e.kind === 'error' && /luftintaget/.test(e.text))).toBe(false);
    c.submit({ kind: 'snorkel', up: true }, 'keyboard');
    run(c, 20);
    c.submit({ kind: 'setDepth', depth: 20 }, 'keyboard');
    run(c, 60);
    expect(logs(c)).toContain('Dieslarna har stannat: luftintaget är under vatten.');
  });

  it('a diesel order takes the charging over; without air the diesels wait', () => {
    const c = game({ depth: 40, designTrim: true, battery: 0.5 });
    c.submit({ kind: 'diesel', on: true }, 'keyboard');
    run(c, 1);
    expect(c.duty('charging')).toBe(false);
    expect(c.sim.commands.diesel).toBe(true);
    expect(logs(c)).toContain('Dieslarna startar när snorkeln är uppe eller ubåten ligger i ytläge.');
    expect(c.sim.telemetry().dieselRunning).toBe(false);
  });

  it('warns as the battery runs down', () => {
    const c = game({ depth: 40, designTrim: true, battery: 0.12 });
    run(c, 0.1);
    expect(logs(c)).toContain('Batteriet är under 30 %. Snorkla eller gå till ytläge och ladda.');
    expect(logs(c)).toContain('Batteriet är under 15 %. Snorkla eller gå till ytläge och ladda.');
    c.sim.systems.electrics.soc = 0.001;
    run(c, 0.1);
    expect(logs(c)).toContain('Batteriet är tomt. Motorn får bara det dieslarna ger.');
  });

  it('the console: snorkel, diesel, ladda and "själv laddning"', () => {
    expect(parseCommand('snorkel upp')).toEqual({ ok: true, order: { kind: 'snorkel', up: true } });
    expect(parseCommand('snorkla')).toEqual({ ok: true, order: { kind: 'snorkel', up: true } });
    expect(parseCommand('snorkel ned')).toEqual({ ok: true, order: { kind: 'snorkel', up: false } });
    expect(parseCommand('diesel start')).toEqual({ ok: true, order: { kind: 'diesel', on: true } });
    expect(parseCommand('dieslarna stopp')).toEqual({ ok: true, order: { kind: 'diesel', on: false } });
    expect(parseCommand('ladda')).toEqual({ ok: true, order: { kind: 'diesel', on: true } });
    expect(parseCommand('själv laddning')).toEqual({ ok: true, order: { kind: 'crew', system: 'charging', crew: false } });
    expect(parseCommand('diesel').ok).toBe(false);
  });
});

describe('leaks in the game', () => {
  it('are logged, sealed and pumped out', () => {
    const c = game({ depth: 30, designTrim: true, speed: 4 * KN, leaks: { engine: 2e-4 } });
    run(c, 0.1);
    expect(logs(c).some((t) => t.startsWith('Läckage i maskinrum'))).toBe(true);
    run(c, 900);
    expect(logs(c)).toContain('Läckan i maskinrum är tätad.');
    expect(logs(c)).toContain('Maskinrum är länsat.');
  });

  it('the safety net blows the main ballast when the boat takes in much water', () => {
    const c = game({ depth: 150, designTrim: true, speed: 4 * KN, area: 'atlantic', leaks: { engine: 8e-3 } });
    run(c, 120);
    expect(logs(c).some((t) => /tagit in \d+ ton vatten/.test(t))).toBe(true);
    expect(logs(c)).toContain('Assistent: nödblåsning! Ubåten tar in vatten.');
    expect(c.sim.tanks.some((t) => t.blowOpen)).toBe(true);
  });

  it('a diesel start is refused with the engine room flooded', () => {
    const c = game({ battery: 0.5 });
    const eng = c.sim.systems.flooding.compartments.find((x) => x.id === 'engine')!;
    eng.water = eng.volume;
    c.submit({ kind: 'diesel', on: true }, 'keyboard');
    run(c, 0.1);
    expect(logs(c)).toContain('Maskinrummet är vattenfyllt. Dieslarna kan inte startas.');
  });
});
