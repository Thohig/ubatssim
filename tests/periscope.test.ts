import { describe, expect, it } from 'vitest';
import { Controller } from '../src/control/controller';
import { acknowledgement } from '../src/control/orders';
import { parseCommand } from '../src/control/parser';
import { SUBMARINE } from '../src/sim/config/submarine';
import { Simulation } from '../src/sim/simulation';

const KN = 1852 / 3600;

describe('periscope', () => {
  it('parses and acknowledges', () => {
    expect(parseCommand('periskop upp')).toEqual({ ok: true, order: { kind: 'periscope', up: true } });
    expect(parseCommand('per ned')).toEqual({ ok: true, order: { kind: 'periscope', up: false } });
    expect(parseCommand('periskop').ok).toBe(false);
    expect(acknowledgement({ kind: 'periscope', up: true })).toBe('Periskop upp, ja');
  });

  it('takes the raise time to go up and down', () => {
    const c = new Controller(new Simulation({ depth: 13, designTrim: true }));
    c.submit({ kind: 'periscope', up: true }, 'keyboard');
    for (let i = 0; i < (SUBMARINE.periscope.raiseTime / 2) * 100; i++) c.step();
    expect(c.sim.actuators.periscope).toBeGreaterThan(0.45);
    expect(c.sim.actuators.periscope).toBeLessThan(0.55);
    for (let i = 0; i < SUBMARINE.periscope.raiseTime * 100; i++) c.step();
    expect(c.sim.actuators.periscope).toBe(1);
    c.submit({ kind: 'periscope', up: false }, 'keyboard');
    for (let i = 0; i < (SUBMARINE.periscope.raiseTime + 1) * 100; i++) c.step();
    expect(c.sim.actuators.periscope).toBe(0);
  });

  it('looks out above the water at periscope depth, not at 20 m', () => {
    const raised = (depth: number) => {
      const sim = new Simulation({ depth, designTrim: true });
      sim.actuators.periscope = 1;
      return sim.telemetry().periscopeHeadDepth;
    };
    expect(raised(13)).toBeLessThan(-1);
    expect(raised(20)).toBeGreaterThan(0);
  });

  it('the wetted mast adds drag at speed', () => {
    const run = (up: boolean) => {
      const sim = new Simulation({ depth: 13, speed: 8 * KN, designTrim: true });
      sim.actuators.periscope = up ? 1 : 0;
      sim.commands.periscopeUp = up;
      const drag = sim.externalForces(sim.y).tau[0]!;
      return drag;
    };
    const extra = run(false) - run(true);
    expect(extra).toBeGreaterThan(1e3); // a few kN at 8 knots
    expect(extra).toBeLessThan(3e4);
  });
});

describe('bridge', () => {
  it('starts manned on the surface and empty when submerged', () => {
    expect(new Controller(new Simulation()).bridgeManned).toBe(true);
    expect(new Controller(new Simulation({ depth: 30 })).bridgeManned).toBe(false);
  });

  it('parses "klart bryggan" and "bemanna bryggan"', () => {
    expect(parseCommand('klart bryggan')).toEqual({ ok: true, order: { kind: 'bridge', manned: false } });
    expect(parseCommand('bemanna bryggan')).toEqual({ ok: true, order: { kind: 'bridge', manned: true } });
    expect(parseCommand('klart').ok).toBe(false);
  });

  it('the realistic mode refuses to flood with the bridge manned', () => {
    const c = new Controller(new Simulation());
    c.submit({ kind: 'mainBallast', action: 'flood', group: 'all' }, 'console');
    c.step();
    expect(c.sim.tanks.some((t) => t.ventOpen)).toBe(false);
    c.submit({ kind: 'bridge', manned: false }, 'console');
    c.submit({ kind: 'mainBallast', action: 'flood', group: 'all' }, 'console');
    c.step();
    expect(c.sim.tanks.filter((t) => t.ventOpen).length).toBe(2);
  });

  it('cannot be manned under water, and is cleared when water reaches it', () => {
    const deep = new Controller(new Simulation({ depth: 30 }));
    deep.submit({ kind: 'bridge', manned: true }, 'console');
    deep.step();
    expect(deep.bridgeManned).toBe(false);
    expect(deep.log.some((e) => e.kind === 'error' && /under vatten/.test(e.text))).toBe(true);

    // Forced dive with the bridge manned (bypassing the order check).
    const c = new Controller(new Simulation({ speed: 5 * KN }));
    c.sim.setVents(true);
    c.submit({ kind: 'setDepth', depth: 20 }, 'console');
    for (let i = 0; i < 200 * 100 && c.bridgeManned; i++) c.step();
    expect(c.bridgeManned).toBe(false);
    expect(c.log.some((e) => /Vatten över bryggan/.test(e.text))).toBe(true);
  });
});
