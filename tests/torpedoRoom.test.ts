import { describe, expect, it } from 'vitest';
import { corvette, freighter } from '../src/control/areas';
import { Controller } from '../src/control/controller';
import { radarHorizon } from '../src/control/radar';
import { isReady, tubeState } from '../src/control/torpedoRoom';
import { WEAPONS } from '../src/sim/config/weapons';
import { Simulation, type InitialConditions } from '../src/sim/simulation';
import type { VesselDef } from '../src/sim/vessel';

const W = WEAPONS.tubes;

function game(init: InitialConditions = { depth: 40, neutral: true }, traffic: VesselDef[] = [], crew = false) {
  const c = new Controller(new Simulation(init));
  c.world.add(traffic);
  if (crew) c.crewTakesAll();
  const run = (s: number) => {
    for (let i = 0; i < Math.round(s * 100); i++) c.step();
  };
  return { c, run };
}

describe('the torpedo room', () => {
  it('a tube is ready after flooding and opening the door, and secured again', () => {
    const { c, run } = game();
    const t = c.fire.tubes[0]!;
    expect(isReady(t)).toBe(false);
    expect(tubeState(t)).toBe('laddad');
    c.submit({ kind: 'tube', tube: 1, action: 'ready' }, 'keyboard');
    run(W.floodTime + 1);
    expect(t.flooded).toBe(true);
    expect(t.open).toBe(false);
    expect(tubeState(t)).toMatch(/^öppnar luckan, \d+ s$/);
    run(W.openTime);
    expect(isReady(t)).toBe(true);
    expect(c.log.some((e) => e.text === 'Tub 1 klar.')).toBe(true);
    c.submit({ kind: 'tube', tube: 1, action: 'secure' }, 'keyboard');
    run(W.shutTime + W.drainTime + 1);
    expect(t.open || t.flooded).toBe(false);
  });

  it('an empty tube is loaded from the racks, one tube at a time on the loading rail', () => {
    const { c, run } = game();
    c.fire.room.fired(0);
    c.fire.room.fired(1);
    c.submit({ kind: 'tube', tube: 1, action: 'load' }, 'keyboard');
    c.submit({ kind: 'tube', tube: 2, action: 'load' }, 'keyboard');
    // Both: shut, drain (in parallel), then the rail one by one.
    run(W.shutTime + W.drainTime + W.reloadTime + 1);
    expect(c.fire.tubes[0]!.loaded).toBe(true);
    expect(c.fire.tubes[1]!.loaded).toBe(false);
    expect(c.fire.reserve).toBe(W.reserve - 1);
    run(W.reloadTime);
    expect(c.fire.tubes[1]!.loaded).toBe(true);
    expect(c.fire.reserve).toBe(W.reserve - 2);
  });

  it('refuses what cannot be done, and a tube order takes the torpedo room over', () => {
    const { c, run } = game(undefined, [], true);
    expect(c.duty('torpedoRoom')).toBe(true);
    c.submit({ kind: 'tube', tube: 1, action: 'load' }, 'keyboard');
    run(0.1);
    expect(c.log.at(-1)!.text).toBe('Tub 1 är redan laddad.');
    c.submit({ kind: 'tube', tube: 2, action: 'ready' }, 'keyboard');
    run(0.1);
    expect(c.duty('torpedoRoom')).toBe(false);
  });

  it('the crew makes the tubes ready once a target is marked, and reloads after firing', () => {
    const { c, run } = game({ depth: 40, neutral: true, heading: 0, speed: 2 }, [freighter('f', 'F', [[3000, -3000], [3000, 3000]])], true);
    run(3);
    expect(c.fire.tubes.some((t) => t.plan.length)).toBe(false);
    c.submit({ kind: 'markTarget', label: c.sonar.contacts[0]!.label }, 'keyboard');
    run(W.floodTime + W.openTime + 2);
    expect(c.fire.tubes.every(isReady)).toBe(true);
    c.fire.room.fired(0);
    run(W.shutTime + W.drainTime + W.reloadTime + 2);
    expect(c.fire.tubes[0]!.loaded).toBe(true);
  });

  it('a fired torpedo makes the boat 150 kg lighter (sea water fills its tube); none at the start (the design loadout)', () => {
    const { c, run } = game();
    expect(c.sim.payload).toHaveLength(0);
    const before = c.sim.telemetry().mass;
    c.fire.room.fired(0);
    run(0.02);
    expect(c.sim.telemetry().mass - before).toBeCloseTo(-(W.torpedoMass - W.tubeWater + W.annulusWater), 6);
    // Reloading moves a torpedo from the racks into the tube: the mass stays, the centre moves forward.
    c.submit({ kind: 'tube', tube: 1, action: 'load' }, 'keyboard');
    run(W.shutTime + W.drainTime + W.reloadTime + 1);
    expect(c.sim.telemetry().payload).toBeCloseTo(-(W.torpedoMass - W.tubeWater + W.annulusWater), 6);
  });

  it('a corvette close by hears a muzzle door open; one far off does not', () => {
    const near = game({ depth: 40, neutral: true }, [corvette('k', 'korvetten K', [[1500, 0], [1500, 1]])]);
    near.c.submit({ kind: 'tube', tube: 1, action: 'ready' }, 'keyboard');
    near.run(W.floodTime + W.openTime + 1);
    expect(near.c.sonar.awareness.k ?? 0).toBeGreaterThan(0);
    const far = game({ depth: 40, neutral: true }, [corvette('k', 'korvetten K', [[9000, 0], [9000, 1]])]);
    far.c.submit({ kind: 'tube', tube: 1, action: 'ready' }, 'keyboard');
    far.run(W.floodTime + W.openTime + 1);
    expect(far.c.sonar.awareness.k ?? 0).toBe(0);
  });
});

describe('the active sonar', () => {
  it('a ping gives echoes with range and bearing, ranges a marked target, and a corvette hears it far off', () => {
    const ship = freighter('f', 'F', [[4000, 0], [4000, 1]]);
    const { c, run } = game({ depth: 40, neutral: true }, [ship, corvette('k', 'korvetten K', [[-12000, 0], [-12000, 1]])], true);
    run(3);
    c.submit({ kind: 'markTarget', label: c.sonar.contacts.find((x) => x.vesselId === 'f')!.label }, 'keyboard');
    c.submit({ kind: 'ping' }, 'keyboard');
    run(0.1);
    const e = c.sonar.echoes.find((x) => x.vesselId === 'f')!;
    expect(Math.abs(e.range - 4000)).toBeLessThan(4000 * WEAPONS.ping.rangeError + 5);
    expect(c.fire.target!.obs.some((o) => o.range !== undefined)).toBe(true);
    expect(c.log.some((x) => /^Sonar: (ett eko|\d+ ekon): S\d+ (00[0-9]|35[0-9])° (3,9|4,0) km/.test(x.text))).toBe(true);
    expect(c.sonar.awareness.k).toBeGreaterThan(0.5);
    expect(c.hunter.state('k')).toBe('search');
  });
});

describe('the radar', () => {
  it('the radar horizon: 4,12·(√h₁ + √h₂) km', () => {
    expect(radarHorizon(0, 25)).toBeCloseTo(20600, 0);
    expect(radarHorizon(4, 9)).toBeCloseTo(4120 * 5, 0);
  });

  it('at periscope depth the antenna is above the water; deep it is not and the radar does not transmit', () => {
    const { c, run } = game({ depth: 13, neutral: true }, [freighter('f', 'F', [[6000, 0], [6000, 1]])]);
    c.submit({ kind: 'radarMast', up: true }, 'keyboard');
    c.submit({ kind: 'radar', on: true }, 'keyboard');
    run(12);
    expect(c.radar.antennaHeight()).toBeGreaterThan(0.5);
    expect(c.radar.active).toBe(true);
    const e = c.radar.echoes.find((x) => x.vesselId === 'f')!;
    expect(Math.abs(e.range - 6000)).toBeLessThan(6000 * WEAPONS.radar.rangeError + 5);
    const deep = game({ depth: 40, neutral: true }, [freighter('f', 'F', [[6000, 0], [6000, 1]])]);
    deep.c.submit({ kind: 'radarMast', up: true }, 'keyboard');
    deep.c.submit({ kind: 'radar', on: true }, 'keyboard');
    deep.run(12);
    expect(deep.c.radar.active).toBe(false);
    expect(deep.c.radar.echoes).toHaveLength(0);
  });

  it('the radar mast in the water has drag: the boat goes a little slower with it up', () => {
    const a = game({ depth: 30, neutral: true, speed: 4 });
    const b = game({ depth: 30, neutral: true, speed: 4 });
    b.c.submit({ kind: 'radarMast', up: true }, 'keyboard');
    for (const g of [a, b]) g.c.sim.commands.rps = 1.5;
    a.run(60);
    b.run(60);
    expect(b.c.sim.kinematics().u).toBeLessThan(a.c.sim.kinematics().u);
  });
});
