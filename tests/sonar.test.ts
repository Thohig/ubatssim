import { describe, expect, it } from 'vitest';
import { corvette, freighter } from '../src/control/areas';
import { Controller } from '../src/control/controller';
import { CLASSIFY_AFTER } from '../src/control/sonar';
import { cavitationSpeed, subSourceLevel, transmissionLoss } from '../src/sim/acoustics';
import { ACOUSTICS } from '../src/sim/config/acoustics';
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

  it('a raised snorkel within sight gives the boat away, slowly', () => {
    const c = game({ depth: 13, neutral: true, speed: 3 * KN }, [patrol()]);
    c.submit({ kind: 'snorkel', up: true }, 'keyboard');
    run(c, 30);
    const r = c.sonar.risk;
    expect(r).toBeGreaterThan(0.5);
    expect(c.log.some((e) => e.text.startsWith('Varning: korvetten K kan ha hört eller sett något.'))).toBe(true);
  });
});
