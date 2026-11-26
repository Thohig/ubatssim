import { describe, expect, it } from 'vitest';
import { corvette, freighter } from '../src/control/areas';
import { Controller } from '../src/control/controller';
import { BIO_LOSE_AFTER, CLASSIFY_AFTER, LOSE_AFTER } from '../src/control/sonar';
import { cavitationSpeed, subSourceLevel, transmissionLoss } from '../src/sim/acoustics';
import { ACOUSTICS } from '../src/sim/config/acoustics';
import { WEAPONS } from '../src/sim/config/weapons';
import { WATERS } from '../src/sim/config/waters';
import { Simulation, type InitialConditions } from '../src/sim/simulation';
import type { VesselDef } from '../src/sim/vessel';

const KN = 1852 / 3600;
const game = (init: InitialConditions, traffic: VesselDef[]) => {
  const c = new Controller(new Simulation({ area: 'atlantic', ...init }));
  c.world.add(traffic);
  c.crewTakesAll();
  return c;
};
const run = (c: Controller, seconds: number) => {
  for (let i = 0; i < seconds * 100; i++) c.step();
};

describe('acoustics', () => {
  it('spherical spreading, absorption and a layer between source and receiver', () => {
    const w = WATERS.atlantic; // layer 50–150 m
    expect(transmissionLoss(1000, 20, 0, w)).toBeCloseTo(60 + ACOUSTICS.absorption, 1);
    expect(transmissionLoss(10000, 20, 0, w) - transmissionLoss(1000, 20, 0, w)).toBeCloseTo(20 + 9 * ACOUSTICS.absorption, 1);
    expect(transmissionLoss(1000, 200, 0, w) - transmissionLoss(1000, 20, 0, w)).toBeGreaterThan(ACOUSTICS.layerLoss - 0.5);
  });

  it('the boat is louder when fast, when it cavitates and with the diesels running', () => {
    const at = (kn: number, depth = 50, dieselRunning = false) => subSourceLevel({ speed: kn * KN, depth, dieselRunning });
    expect(at(8) - at(4)).toBeCloseTo(30 * Math.log10(2), 3);
    expect(cavitationSpeed(0)).toBe(ACOUSTICS.cavitationSpeed);
    expect(at(8, 0) - at(8, 100)).toBeCloseTo(ACOUSTICS.cavitationLevel, 3);
    expect(at(4, 13, true) - at(4, 13)).toBe(ACOUSTICS.dieselLevel);
  });
});

describe('passive sonar', () => {
  it('hears a ship, gives its bearing and classifies it by its propeller', () => {
    const ship = freighter('f', 'M/S F', [[0, 4000], [1, 4000]]);
    ship.speed = 3; // due east, steaming north slowly
    const c = game({ depth: 40, designTrim: true, speed: 4 * KN }, [ship]);
    run(c, 2);
    const k = c.sonar.contacts[0]!;
    expect(k.label).toBe('S1');
    expect(Math.abs(k.bearing - 90)).toBeLessThan(2);
    expect(k.classified).toBeNull();
    run(c, CLASSIFY_AFTER + 1);
    expect(c.sonar.contacts[0]!.classified).toBe('lastfartyg');
    expect(c.log.some((e) => e.text === 'Sonar: S1 är troligen ett lastfartyg (4 blad, 120 rpm).')).toBe(true);
    expect(c.sonar.history.length).toBeGreaterThan(10);
    expect(c.sonar.history.at(-1)!.marks[0]!.relative).toBeCloseTo(90, -1);
  });

  it('a ship lying stopped is classified without a propeller count', () => {
    const ship = { ...freighter('d', 'M/S D', [[0, 3000]]), speed: 0, propellerRps: 0 };
    const c = game({ depth: 40, designTrim: true, speed: 4 * KN }, [ship]);
    run(c, CLASSIFY_AFTER + 2);
    expect(c.log.some((e) => e.text === 'Sonar: S1 är troligen ett lastfartyg (propellern står still, bara maskinljud).')).toBe(true);
  });

  it('a whale between its calls keeps its contact, and a ship heard again gets its old label back', () => {
    // A minke whale calls 60 s of every 240: it used to be a new contact (S2, S3 …) and a new classification every 4 min.
    const c = game({ depth: 40, designTrim: true, speed: 2 * KN }, []);
    c.world.addLife([{ id: 'w', name: 'en vikval', kind: 'whale', sound: 'pulse', route: [[0, 1500]], speed: 0, depth: 30, dive: 300, surface: 60, callPeriod: 240, callOn: 60, size: 8 }]);
    run(c, 600);
    expect(c.sonar.contacts.filter((k) => k.bio).map((k) => k.label)).toEqual(['S1']);
    expect(c.log.filter((e) => /^Sonar: ny kontakt/.test(e.text))).toHaveLength(1);
    expect(c.log.filter((e) => /är biologisk/.test(e.text))).toHaveLength(1);
    expect(BIO_LOSE_AFTER).toBeGreaterThan(240 - 60);

    const ship = freighter('f', 'M/S F', [[0, 4000], [1, 4000]]);
    ship.speed = 3;
    const d = game({ depth: 40, designTrim: true, speed: 4 * KN }, [ship]);
    run(d, CLASSIFY_AFTER + 2);
    const v = d.world.vessels[0]!;
    const east = v.state.east;
    v.state.east = 80000; // out of hearing
    run(d, LOSE_AFTER + 2);
    expect(d.sonar.contacts).toHaveLength(0);
    v.state.east = east;
    run(d, 2);
    expect(d.sonar.contacts[0]?.label).toBe('S1');
    expect(d.sonar.contacts[0]?.classified).toBe('lastfartyg');
    expect(d.log.some((e) => /^Sonar: S1 hörs igen, bäring/.test(e.text))).toBe(true);
  });

  it('does not hear a quiet boat far away', () => {
    const boat: VesselDef = { ...freighter('x', 'X', [[60000, 0], [60001, 0]]), kind: 'fishing' };
    const c = game({ depth: 200, designTrim: true, speed: 4 * KN }, [boat]);
    run(c, 3);
    expect(c.sonar.contacts).toHaveLength(0);
  });
});

describe('being found', () => {
  const patrol = () => corvette('k', 'korvetten K', [[800, -3000], [800, 3000]]);

  it('a fast, cavitating boat near the surface is heard by a corvette', () => {
    const c = game({ depth: 20, designTrim: true, speed: 12 * KN }, [patrol()]);
    c.submit({ kind: 'setSpeed', knots: 12 }, 'keyboard');
    run(c, 120);
    expect(c.sonar.detectedBy).toBe('korvetten K');
    expect(c.log.some((e) => e.text === 'Korvetten K har upptäckt ubåten!')).toBe(true);
  });

  it('a slow boat under the layer is not', () => {
    const c = game({ depth: 200, designTrim: true, speed: 4 * KN }, [patrol()]);
    c.submit({ kind: 'setSpeed', knots: 4 }, 'keyboard');
    run(c, 120);
    expect(c.sonar.detectedBy).toBeNull();
    expect(c.sonar.risk).toBeLessThan(0.5);
  });

  it('a spent corvette is not put back into the attack by its partner\'s echoes', () => {
    // At war a spent corvette went "in to attack", "no depth charges left" and "back to patrol" every ping, for an hour.
    const a = { ...corvette('a', 'korvetten A', [[800, -3000], [800, 3000]]), group: 'paret' };
    const b = { ...corvette('b', 'korvetten B', [[1200, 3000], [1200, -3000]]), group: 'paret' };
    const c = game({ depth: 20, designTrim: true, speed: 4 * KN }, [a, b]);
    const hunts = (c.hunter as unknown as { hunt(id: string): { charges: number } });
    hunts.hunt('b').charges = 0;
    c.hunter.cue(c.world.vessels[0]!, [c.sim.y[0]!, c.sim.y[1]!]);
    run(c, 120);
    expect(c.hunter.state('a')).toBe('attack');
    expect(c.hunter.state('b')).toBe('patrol');
    expect(c.log.some((e) => e.text === 'Sonar: korvetten B går in för anfall!')).toBe(false);
  });

  it('a corvette drops its pattern over where it believes the boat is, not 150 m short', () => {
    // Dropping as soon as it was within 150 m put the pattern ~140 m short: 24 charges at a boat lying still, none closer than 68 m.
    const c = game({ depth: 60, designTrim: true }, [corvette('k', 'korvetten K', [[3000, 0], [3000, 1]])]);
    c.submit({ kind: 'setSpeed', knots: 0 }, 'keyboard');
    c.hunter.cue(c.world.vessels[0]!, [c.sim.y[0]!, c.sim.y[1]!]);
    for (let i = 0; i < 600 && c.world.charges.length === 0; i++) run(c, 1);
    expect(c.world.charges.length).toBeGreaterThan(0);
    const nearest = Math.min(...c.world.charges.map((ch) => Math.hypot(ch.state.north - c.sim.y[0]!, ch.state.east - c.sim.y[1]!)));
    expect(nearest).toBeLessThan(WEAPONS.depthCharge.damage);
  });

  it('a raised snorkel within sight gives the boat away, slowly', () => {
    const c = game({ depth: 13, neutral: true, speed: 3 * KN }, [patrol()]);
    c.submit({ kind: 'snorkel', up: true }, 'keyboard');
    run(c, 30);
    const r = c.sonar.risk;
    expect(r).toBeGreaterThan(0.5);
    expect(c.log.some((e) => e.text.startsWith('Varning: korvetten K kan ha hört eller sett något.'))).toBe(true);
  });
});
