import { describe, expect, it } from 'vitest';
import { corvette } from '../src/control/areas';
import { CONN } from '../src/control/conn';
import { Controller } from '../src/control/controller';
import { PERISCOPE_DEPTH } from '../src/control/crew';
import { Simulation, type InitialConditions } from '../src/sim/simulation';

const KN = 1852 / 3600;
const DEG = Math.PI / 180;

const game = (init: InitialConditions) => {
  const c = new Controller(new Simulation({ area: 'atlantic', designTrim: true, ...init }));
  c.crewTakesAll();
  return c;
};
const run = (c: Controller, seconds: number, each?: () => void) => {
  for (let i = 0; i < seconds * 100; i++) {
    c.step();
    each?.();
  }
};

describe('the conn: speed', () => {
  it('a lower bell lets the way run off without backing, and says so on the plan line', () => {
    const c = game({ depth: 60, speed: 12 * KN });
    c.submit({ kind: 'setSpeed', knots: 12 }, 'touch');
    run(c, 5);
    c.submit({ kind: 'setSpeed', knots: 4 }, 'touch');
    let rpsMin = Infinity;
    let coasting = false;
    run(c, 60, () => {
      rpsMin = Math.min(rpsMin, c.sim.commands.rps);
      coasting ||= c.conn.plan().mode === 'coasting';
    });
    expect(rpsMin).toBeGreaterThanOrEqual(0);
    expect(coasting).toBe(true);
    expect(c.sim.kinematics().u / KN).toBeLessThan(9);
  });

  it('with ground rising ahead a lower bell brakes astern', () => {
    const c = game({ depth: 60, speed: 12 * KN });
    c.submit({ kind: 'setSpeed', knots: 4 }, 'touch');
    run(c, 0.01);
    c.assist.shoalDanger = true;
    const k = c.sim.kinematics();
    const input = { depth: k.depth, depthRate: k.depthRate, pitch: k.pitch, pitchRate: k.q, heading: k.heading, yawRate: k.r, speed: k.u };
    expect(c.conn.drive(k, input)).toBeLessThan(0);
  });

  it('coming up to periscope depth the crew keeps under 6 knots, but not at full ahead', () => {
    const c = game({ depth: 32, speed: 8 * KN });
    c.submit({ kind: 'setSpeed', knots: 8 }, 'touch');
    c.submit({ kind: 'setDepth', depth: PERISCOPE_DEPTH }, 'touch');
    run(c, 2);
    expect(c.crewSpeed()).toEqual({ knots: CONN.periscopeSpeed, reason: 'periskopdjup' });
    c.submit({ kind: 'setSpeed', knots: 19 }, 'touch');
    run(c, 1);
    expect(c.crewSpeed()).toBeNull();
  });
});

describe('the conn: course', () => {
  const turn = (depth: number) => {
    const c = game({ depth, speed: 6 * KN, heading: 0 });
    c.submit({ kind: 'setSpeed', knots: 6 }, 'touch');
    c.submit({ kind: 'setDepth', depth }, 'touch');
    c.submit({ kind: 'setHeading', heading: 120 }, 'touch');
    let most = 0;
    run(c, 30, () => (most = Math.max(most, Math.abs(c.sim.commands.rudder))));
    return { most, c };
  };

  it('near the surface the rudder is gentler, so the sail stays under', () => {
    const shallow = turn(PERISCOPE_DEPTH);
    expect(shallow.most).toBeLessThanOrEqual(CONN.gentleRudder + 1e-9);
    expect(shallow.c.conn.plan().details.some((d) => /tornet inte bryter ytan/.test(d))).toBe(true);
    expect(turn(60).most).toBeGreaterThan(20 * DEG);
  });
});

describe('the conn: bow-down limit', () => {
  const limit = (c: Controller) => c.conn.diveLimit(c.sim.kinematics());

  it('dives at most ~1 m/s: 12° slow, less fast, none at full ahead', () => {
    const slow = game({ depth: 60, speed: 6 * KN });
    expect(limit(slow) / DEG).toBeGreaterThanOrEqual(12);
    const fast = game({ depth: 60, speed: 12 * KN });
    fast.submit({ kind: 'setSpeed', knots: 12 }, 'touch');
    run(fast, 1);
    expect(Math.sin(limit(fast)) * fast.sim.kinematics().u).toBeCloseTo(CONN.diveRate, 1);
    fast.submit({ kind: 'setSpeed', knots: 19 }, 'touch');
    run(fast, 1);
    expect(limit(fast)).toBe(Infinity);
  });

  it('close to the bottom and deep down at most 5°, full ahead too', () => {
    const deep = game({ depth: 260, speed: 19 * KN });
    deep.submit({ kind: 'setSpeed', knots: 19 }, 'touch');
    run(deep, 1);
    expect(limit(deep)).toBe(CONN.minDivePitch);
    const shoal = game({ depth: 60, speed: 19 * KN });
    shoal.submit({ kind: 'setSpeed', knots: 19 }, 'touch');
    run(shoal, 1);
    // 25 m under the keel (hull radius 3.1 m).
    Object.defineProperty(shoal.sim, 'ground', { value: () => 60 + 3.1 + 25 });
    expect(limit(shoal)).toBe(CONN.minDivePitch);
  });

  it('12 knots from 13 to 100 m: sinks at about 1 m/s and arrives without overshoot', () => {
    const c = game({ depth: 13, speed: 12 * KN });
    c.submit({ kind: 'setSpeed', knots: 12 }, 'touch');
    c.submit({ kind: 'setDepth', depth: 13 }, 'touch');
    run(c, 20);
    c.submit({ kind: 'setDepth', depth: 100 }, 'touch');
    let sink = 0;
    let deepest = 0;
    run(c, 240, () => {
      const k = c.sim.kinematics();
      sink = Math.max(sink, k.depthRate);
      deepest = Math.max(deepest, k.depth);
    });
    expect(sink).toBeLessThan(1.1);
    expect(deepest).toBeLessThan(102);
    expect(Math.abs(c.sim.y[2]! - 100)).toBeLessThan(1);
  });
});

describe('the conn: quiet', () => {
  const hunted = () => {
    const c = game({ depth: 30, speed: 4 * KN });
    const hunter = corvette('k', 'korvetten Vakten', [[9000, 0], [9000, 4000]]);
    c.world.add([hunter]);
    c.sonar.alert('k', 0.6);
    c.submit({ kind: 'setSpeed', knots: 4 }, 'touch');
    run(c, 2);
    return c;
  };

  it('asked for the surface while a corvette is on to it, the crew waits at periscope depth without blowing', () => {
    const c = hunted();
    expect(c.conn.quiet).toBe(true);
    c.submit({ kind: 'setDepth', depth: 0 }, 'touch');
    let blew = false;
    // 30 m → 13 m at 4 knots takes ~4 min; the corvette gives up after ~4,5 min.
    run(c, 240, () => (blew ||= c.sim.tanks.some((t) => t.blowOpen)));
    expect(blew).toBe(false);
    expect(c.conn.surfaceHeld).toBe(true);
    expect(c.conn.plan().mode).toBe('waiting');
    expect(Math.abs(c.sim.kinematics().depth - PERISCOPE_DEPTH)).toBeLessThan(2);
    expect(c.log.some((e) => /stannar på periskopdjup/.test(e.text))).toBe(true);

    // Asked again: up anyway.
    c.submit({ kind: 'setDepth', depth: 0 }, 'touch');
    run(c, 20, () => (blew ||= c.sim.tanks.some((t) => t.blowOpen)));
    expect(c.conn.surfaceHeld).toBe(false);
    expect(blew).toBe(true);
  });

  it('with nobody hunting it goes straight on up as before', () => {
    const c = game({ depth: 30, speed: 4 * KN });
    c.submit({ kind: 'setSpeed', knots: 4 }, 'touch');
    c.submit({ kind: 'setDepth', depth: 0 }, 'touch');
    let blew = false;
    run(c, 150, () => (blew ||= c.sim.tanks.some((t) => t.blowOpen)));
    expect(c.conn.surfaceHeld).toBe(false);
    expect(blew).toBe(true);
  });
});

describe('the conn: trim ahead of a depth change', () => {
  it('pumps for the water below the halocline at once', () => {
    const c = new Controller(new Simulation({ area: 'baltic', depth: 40, speed: 5 * KN, neutral: true, east: -2500 }));
    c.crewTakesAll();
    c.submit({ kind: 'setSpeed', knots: 5 }, 'touch');
    run(c, 1);
    const heavier = c.sim.heavinessChange(40, 90);
    // Denser water below the layer: much lighter there.
    expect(heavier).toBeLessThan(-1000);
    c.submit({ kind: 'setDepth', depth: 90 }, 'touch');
    run(c, 1);
    expect(c.log.some((e) => /Trimmet förbereds för 90 m: lättare där/.test(e.text))).toBe(true);
    // Lighter there → water in.
    expect(c.sim.compRemaining).toBeGreaterThan(0.5);
  });

  it('heavinessChange is pure and zero for no change', () => {
    const sim = new Simulation({ area: 'westCoast', depth: 50 });
    const y = sim.y.slice();
    expect(sim.heavinessChange(50, 50)).toBe(0);
    // The hull is squeezed deeper down: heavier in water without layers below 70 m.
    expect(sim.heavinessChange(100, 200)).toBeGreaterThan(0);
    expect(Array.from(sim.y)).toEqual(Array.from(y));
  });
});

describe('the conn: plan line', () => {
  it('names the manoeuvre', () => {
    const c = game({ depth: 60, speed: 6 * KN, heading: 0 });
    c.submit({ kind: 'setSpeed', knots: 6 }, 'touch');
    c.submit({ kind: 'setDepth', depth: 100 }, 'touch');
    run(c, 3);
    expect(c.conn.plan().mode).toBe('changeDepth');
    expect(c.conn.plan().text).toMatch(/^Går ned till 100 m/);
    c.submit({ kind: 'setSpeed', knots: 0 }, 'touch');
    run(c, 1);
    expect(c.conn.plan().mode).toBe('stopping');
    c.submit({ kind: 'autopilot', axis: 'all', on: false }, 'touch');
    run(c, 0.01);
    expect(c.conn.plan().mode).toBe('hand');
  });
});
