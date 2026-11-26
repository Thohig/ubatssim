import { describe, expect, it } from 'vitest';
import { corvette, freighter } from '../src/control/areas';
import { Controller } from '../src/control/controller';
import { crowdedObservation, fitSolution, hasSecondLeg, type Observation } from '../src/control/fireControl';
import { parseCommand } from '../src/control/parser';
import { WEAPONS } from '../src/sim/config/weapons';
import { chargeHole } from '../src/sim/depthCharge';
import { Simulation, type InitialConditions } from '../src/sim/simulation';
import { interceptTime } from '../src/sim/torpedo';
import type { VesselDef } from '../src/sim/vessel';

const KN = 1852 / 3600;
const DEG = Math.PI / 180;
const run = (c: Controller, seconds: number) => {
  for (let i = 0; i < seconds * 100; i++) c.step();
};
const game = (init: InitialConditions, traffic: VesselDef[]) => {
  const c = new Controller(new Simulation({ area: 'atlantic', ...init }));
  c.world.add(traffic);
  c.crewTakesAll();
  return c;
};
/** A target ship: 6 knots east, 3 km north. */
const ship = () => {
  const s = freighter('m', 'målfartyget', [[3000, -3000], [3000, 6000]]);
  s.speed = 6 * KN;
  return s;
};
const trueBearing = (c: Controller) => (c.world.contacts()[0]!.bearing * 180) / Math.PI;

describe('target motion analysis', () => {
  /** Bearings from an own track to a target going east at 4 m/s from (3000, −2000). */
  const target = (t: number): [number, number] => [3000, -2000 + 4 * t];
  const bearingsFrom = (own: (t: number) => [number, number], times: number[]): Observation[] =>
    times.map((t) => {
      const p = target(t);
      const o = own(t);
      return { t, own: o, bearing: Math.atan2(p[1] - o[1], p[0] - o[0]), sigma: 0.5 * DEG };
    });

  it('bearings from one leg give no range: the solution is poor', () => {
    const own = (t: number): [number, number] => [3 * t, 0];
    const s = fitSolution(bearingsFrom(own, [0, 60, 120, 180, 240, 300]), 3000)!;
    expect(s.quality).toBe('dålig');
  });

  it('bearings from two legs give the course, speed and range', () => {
    // North for 5 minutes, then east for 5 minutes.
    const own = (t: number): [number, number] => (t <= 300 ? [3 * t, 0] : [900, 3 * (t - 300)]);
    const times = Array.from({ length: 31 }, (_, i) => i * 20);
    let s = fitSolution(bearingsFrom(own, times), 3000)!;
    for (let i = 0; i < 3; i++) s = fitSolution(bearingsFrom(own, times), Math.hypot(s.position[0] - 900, s.position[1] - 900))!;
    const truth = target(600);
    expect(Math.hypot(s.position[0] - truth[0], s.position[1] - truth[1])).toBeLessThan(150);
    expect(s.velocity[1]).toBeCloseTo(4, 0);
    expect(s.quality).not.toBe('dålig');
  });

  it('two ranged periscope sightings a minute apart are enough', () => {
    const own = (t: number): [number, number] => [3 * t, 0];
    const obs = bearingsFrom(own, [0, 60]).map((o) => {
      const p = target(o.t);
      return { ...o, sigma: 0.3 * DEG, range: Math.hypot(p[0] - o.own[0], p[1] - o.own[1]), rangeError: 0.03 };
    });
    const s = fitSolution(obs, 3000)!;
    expect(Math.hypot(s.position[0] - target(60)[0], s.position[1] - target(60)[1])).toBeLessThan(200);
  });

  it('the intercept: a torpedo meets a crossing target where both arrive at once', () => {
    const t = interceptTime([0, 0], [3000, -2000], [0, 4], 20)!;
    const at: [number, number] = [3000, -2000 + 4 * t];
    expect(Math.hypot(at[0], at[1])).toBeCloseTo(20 * t, 3);
    expect(interceptTime([0, 0], [1000, 0], [30, 0], 20)).toBeNull();
  });
});

describe('the attack', () => {
  it('periscope: mark, range, fire, hit and sink; the tube reloads', () => {
    const c = game({ depth: 13, neutral: true, speed: 3 * KN, heading: 0 }, [ship()]);
    c.submit({ kind: 'periscope', up: true }, 'keyboard');
    run(c, 10);
    c.submit({ kind: 'markTarget', bearing: trueBearing(c) }, 'keyboard');
    c.submit({ kind: 'rangeTarget', bearing: trueBearing(c), magnification: 1 }, 'keyboard');
    run(c, 30);
    c.submit({ kind: 'markTarget', bearing: trueBearing(c) }, 'keyboard');
    c.submit({ kind: 'rangeTarget', bearing: trueBearing(c), magnification: 1 }, 'keyboard');
    run(c, 1);
    expect(c.fire.target?.label).toBe('M1');
    const s = c.fire.target!.solution!;
    const v = c.world.vessels[0]!;
    expect(Math.hypot(s.position[0] - v.state.north, s.position[1] - v.state.east)).toBeLessThan(300);
    c.submit({ kind: 'fireTorpedo' }, 'keyboard');
    run(c, 1);
    expect(c.fire.tubes[0]!.loaded).toBe(false);
    expect(c.world.torpedoes).toHaveLength(1);
    run(c, 300);
    expect(c.hits).toBe(1);
    expect(v.state.sinking).toBe(true);
    expect(c.log.some((e) => e.text === 'Träff! Torped 1 träffade målfartyget.')).toBe(true);
    run(c, 120);
    expect(c.fire.tubes[0]!.loaded).toBe(true);
    expect(c.fire.reserve).toBe(WEAPONS.tubes.reserve - 1);
  });

  it('a mark with nothing in the cross hair, or without a lookout, is refused', () => {
    const c = game({ depth: 13, neutral: true, heading: 0 }, [ship()]);
    const said = (re: RegExp) => c.log.some((e) => re.test(e.text));
    c.submit({ kind: 'markTarget', bearing: 0 }, 'keyboard');
    run(c, 0.1);
    expect(said(/Ingen utkik/)).toBe(true);
    c.submit({ kind: 'periscope', up: true }, 'keyboard');
    run(c, 10);
    c.submit({ kind: 'markTarget', bearing: (trueBearing(c) + 20) % 360 }, 'keyboard');
    run(c, 0.1);
    expect(said(/^Inget fartyg i hårkorset\.$/)).toBe(true);
    c.submit({ kind: 'fireTorpedo' }, 'keyboard');
    run(c, 0.1);
    expect(said(/^Inget mål/)).toBe(true);
  });

  it('the cross hair is on a ship anywhere along its length; beside it, the nearest is pointed out', () => {
    // A 150 m freighter broadside on, 600 m north: it fills some 14°. Aimed at its bow (5° off its middle), a
    // fixed 2° from the middle refused it.
    const near = { ...freighter('n', 'närfartyget', [[600, -100], [600, 6000]], 150), speed: 3 };
    const c = game({ depth: 13, neutral: true, heading: 0 }, [near]);
    c.submit({ kind: 'periscope', up: true }, 'keyboard');
    run(c, 10);
    const b = trueBearing(c);
    expect(c.fire.findInSight(((b + 5) * Math.PI) / 180)).toBe(c.world.vessels[0]);
    c.submit({ kind: 'markTarget', bearing: (b + 5) % 360 }, 'keyboard');
    run(c, 0.1);
    expect(c.fire.target?.label).toBe('M1');
    // The observation is the ship's bearing, not the cross hair's.
    expect(Math.abs(c.fire.target!.obs[0]!.bearing - (b * Math.PI) / 180)).toBeLessThan(0.5 * DEG);
    expect(c.fire.findInSight(((b + 12) * Math.PI) / 180)).toBe('Inget fartyg i hårkorset. Närmaste fartyg 12° till vänster.');
    expect(c.fire.findInSight(((b - 12) * Math.PI) / 180)).toBe('Inget fartyg i hårkorset. Närmaste fartyg 12° till höger.');
  });

  it('from the screen, a ship within a quarter of the periscope\'s field counts as in the cross hair, and can be ranged', () => {
    const c = game({ depth: 13, neutral: true, speed: 3 * KN, heading: 0 }, [ship()]);
    c.submit({ kind: 'periscope', up: true }, 'keyboard');
    run(c, 10);
    const b = trueBearing(c);
    // 6° off a ship 3 km away: refused without the field, taken with the 8° of the 1,5× periscope.
    expect(typeof c.fire.findInSight(((b + 6) * Math.PI) / 180)).toBe('string');
    c.submit({ kind: 'markTarget', bearing: (b + 6) % 360, field: 8 }, 'touch');
    c.submit({ kind: 'rangeTarget', bearing: (b + 6) % 360, magnification: 0, field: 8 }, 'touch');
    run(c, 0.1);
    expect(c.fire.target?.label).toBe('M1');
    expect(c.fire.target!.obs.some((o) => o.range !== undefined)).toBe(true);
  });

  it('a ship seen but too far to mark says so', () => {
    const far = { ...freighter('f', 'fjärran', [[10000, -100], [10000, 6000]]), speed: 3 };
    const c = game({ depth: 13, neutral: true, heading: 0 }, [far]);
    c.submit({ kind: 'periscope', up: true }, 'keyboard');
    run(c, 10);
    expect(c.fire.findInSight((trueBearing(c) * Math.PI) / 180)).toMatch(/^Fartyget är för långt bort för att markera, över 8 km\./);
  });

  it('a sonar contact can be a target; its bearings feed the solution', () => {
    const c = game({ depth: 40, designTrim: true, speed: 4 * KN, heading: 0 }, [ship()]);
    run(c, 3);
    c.submit({ kind: 'markTarget', label: 'S1' }, 'keyboard');
    run(c, 60);
    expect(c.fire.target!.obs.length).toBeGreaterThan(5);
    expect(c.fire.target!.solution).not.toBeNull();
  });

  it('a spread fires up to three torpedoes from the loaded tubes', () => {
    const c = game({ depth: 13, neutral: true, speed: 3 * KN, heading: 0 }, [ship()]);
    c.submit({ kind: 'periscope', up: true }, 'keyboard');
    run(c, 10);
    c.submit({ kind: 'markTarget', bearing: trueBearing(c) }, 'keyboard');
    c.submit({ kind: 'rangeTarget', range: 3600 }, 'keyboard');
    c.submit({ kind: 'setSpread', count: 3 }, 'keyboard');
    c.submit({ kind: 'fireTorpedo', tube: 2 }, 'keyboard');
    run(c, 1);
    expect(c.log.at(-1)!.text).toMatch(/^Tub 2 är inte klar|^Tuberna görs klara/);
    run(c, 25); // the torpedo room floods the tubes and opens the doors
    c.submit({ kind: 'fireTorpedo', tube: 2 }, 'keyboard');
    run(c, 1);
    expect(c.world.torpedoes).toHaveLength(3);
    expect(c.fire.tubes.map((t) => t.loaded)).toEqual([true, false, false, false]);
  });

  it('a torpedo set too deep runs under a shallow boat', () => {
    const c = game({ depth: 13, neutral: true, heading: 0 }, []);
    const boat: VesselDef = { ...freighter('f', 'F', [[600, 0], [600, 1]]), kind: 'fishing', draft: 3, speed: 0 };
    c.world.add([boat]);
    c.world.launch({ course: 0, depth: 10, seekAfter: 1e9 });
    run(c, 60);
    expect(c.world.vessels[0]!.state.sinking).toBe(false);
  });

  it('console: mål, avstånd, skjut, spridning, besättning eldledning', () => {
    expect(parseCommand('mål 245')).toEqual({ ok: true, order: { kind: 'markTarget', bearing: 245 } });
    expect(parseCommand('mål s1')).toEqual({ ok: true, order: { kind: 'markTarget', label: 'S1' } });
    expect(parseCommand('avstånd')).toEqual({ ok: true, order: { kind: 'rangeTarget' } });
    expect(parseCommand('avstånd 1800 m')).toEqual({ ok: true, order: { kind: 'rangeTarget', range: 1800 } });
    expect(parseCommand('skjut')).toEqual({ ok: true, order: { kind: 'fireTorpedo' } });
    expect(parseCommand('skjut tub 2')).toEqual({ ok: true, order: { kind: 'fireTorpedo', tube: 2 } });
    expect(parseCommand('spridning 3')).toEqual({ ok: true, order: { kind: 'setSpread', count: 3 } });
    expect(parseCommand('själv eldledning')).toEqual({ ok: true, order: { kind: 'crew', system: 'fireControl', crew: false } });
  });
});

describe('depth charges and the hunt', () => {
  it('a charge holes the hull, less the further away', () => {
    expect(chargeHole(5)).toBe(WEAPONS.depthCharge.lethalHole);
    expect(chargeHole(20)).toBeGreaterThan(chargeHole(30));
    expect(chargeHole(50)).toBe(0);
    const c = game({ depth: 60, designTrim: true }, [corvette('k', 'K', [[0, 0], [1, 0]])]);
    c.world.vessels[0]!.state.speed = 0;
    c.world.dropCharges(c.world.vessels[0]!, 60);
    run(c, 25);
    expect(c.sim.systems.flooding.compartments.some((x) => x.holeArea > 0 || x.water > 0)).toBe(true);
    expect(c.log.some((e) => e.text.startsWith('Sjunkbomber i vattnet'))).toBe(true);
  });

  it('a loud boat near a corvette is heard, searched for, pinged and attacked', () => {
    const c = game({ depth: 30, designTrim: true, speed: 12 * KN, heading: 0 }, [corvette('k', 'korvetten K', [[1500, -3000], [1500, 3000]])]);
    c.submit({ kind: 'setSpeed', knots: 12 }, 'keyboard');
    const seen = new Set<string>();
    for (let i = 0; i < 400; i++) {
      run(c, 1);
      seen.add(c.hunter.state('k'));
    }
    // Search and the first ping's echo can fall in the same second.
    expect([...seen]).toEqual(expect.arrayContaining(['suspicion', 'attack']));
    expect(c.log.some((e) => e.text === 'Sonar: korvetten K söker med aktiv sonar!')).toBe(true);
    expect(c.hunter.pings).toBeGreaterThan(0);
    expect(c.log.some((e) => e.text.startsWith('Sjunkbomber i vattnet från korvetten K'))).toBe(true);
  });

  it('a launch is heard: a nearby corvette starts searching', () => {
    const c = game({ depth: 13, neutral: true, speed: 3 * KN, heading: 0 }, [corvette('k', 'K', [[2500, -3000], [2500, 3000]])]);
    run(c, 2);
    expect(c.hunter.state('k')).toBe('patrol');
    c.world.launch({ course: 0, depth: 4, seekAfter: 1e9 });
    run(c, 2);
    expect(['search', 'attack']).toContain(c.hunter.state('k'));
  });

  it('a corvette with its depth charges spent breaks off for good (no back and forth)', () => {
    const c = game({ depth: 60, neutral: true, speed: 4 * KN, heading: 180 * DEG }, [corvette('k', 'K', [[1500, 0], [1500, 4000]])]);
    c.sonar.alert('k', 0.9);
    run(c, 2);
    (c.hunter as unknown as { hunt(id: string): { charges: number } }).hunt('k').charges = 0;
    run(c, 120);
    expect(c.hunter.state('k')).toBe('patrol');
    const breaks = c.log.filter((e) => /bryter anfallet/.test(e.text));
    expect(breaks.length).toBeLessThanOrEqual(1);
    const lines = c.log.length;
    run(c, 60);
    expect(c.hunter.state('k')).toBe('patrol');
    expect(c.log.slice(lines).filter((e) => /Jägaren|korvetten K/.test(e.text))).toHaveLength(0);
  });

  it('a quiet boat far away and deep is lost: the corvette gives up', () => {
    // The corvette 9 km away cannot reach the boat before it gives up.
    const c = game({ depth: 200, designTrim: true, speed: 4 * KN, heading: 180 * DEG }, [corvette('k', 'K', [[9000, -3000], [9000, 3000]])]);
    c.submit({ kind: 'setSpeed', knots: 4 }, 'keyboard');
    c.submit({ kind: 'setHeading', heading: 180 }, 'keyboard');
    c.sonar.alert('k', 0.85);
    run(c, 2);
    expect(c.hunter.state('k')).not.toBe('patrol');
    run(c, WEAPONS.corvette.giveUp + 120);
    expect(c.hunter.state('k')).toBe('patrol');
    expect(c.sonar.detectedBy).toBeNull();
  });
});

describe('observations kept for the analysis', () => {
  const obs = (times: number[], own: (t: number) => [number, number] = (t) => [2 * t, 0]): Observation[] =>
    times.map((t) => ({ t, own: own(t), bearing: 0, sigma: DEG }));

  it('a full list loses its most crowded bearing, never the first, the last or a range', () => {
    const o = obs([0, 10, 20, 25, 30, 40]);
    expect(crowdedObservation(o)).toBe(3); // 20–30 around t = 25: the closest neighbours
    o[3]!.range = 1000;
    expect(crowdedObservation(o)).toBe(2); // the range stays; 10–25 is the next closest
  });

  it('a course change of 25° or more is a second leg', () => {
    expect(hasSecondLeg(obs([0, 60, 120, 180]))).toBe(false); // due north all the way
    const turn = (t: number): [number, number] => (t <= 120 ? [2 * t, 0] : [240 + 2 * (t - 120) * Math.cos(DEG * 60), 2 * (t - 120) * Math.sin(DEG * 60)]);
    expect(hasSecondLeg(obs([0, 60, 120, 180, 240], turn))).toBe(true);
  });
});
