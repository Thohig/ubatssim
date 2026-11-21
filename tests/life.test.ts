import { describe, expect, it } from 'vitest';
import { AREA_INFO, AREA_ORDER } from '../src/control/areas';
import { Controller } from '../src/control/controller';
import { AREAS } from '../src/sim/config/areas';
import { SHELF_TERRAIN as S } from '../src/sim/config/terrain';
import { Creature, type CreatureDef } from '../src/sim/life';
import { bottomMask, bottomType, terrainBlocks } from '../src/sim/seabed';
import { areaAcousticGround, Simulation } from '../src/sim/simulation';
import { canyonAt, heightFunction, shelfHeight } from '../src/sim/terrain';
import type { VesselDef } from '../src/sim/vessel';

const KN = 1852 / 3600;
const DEG = Math.PI / 180;

const still = (id: string, at: [number, number], kind: VesselDef['kind'] = 'patrol'): VesselDef => ({
  id, name: `fartyget ${id}`, kind, length: 72, beam: 10, draft: 3.5, speed: 0, turnRate: 0.04, route: [at], repeat: 'loop', propellerRps: 4, blades: 5,
});

const run = (c: Controller, seconds: number) => {
  for (let i = 0; i < seconds * 100; i++) c.step();
};

describe('the shelf edge (Eggakanten)', () => {
  it('has a shelf, a slope down to the basin, land in the east', () => {
    expect(-shelfHeight(-1500, 3000, S)).toBeGreaterThan(135);
    expect(-shelfHeight(-1500, 3000, S)).toBeLessThan(165);
    expect(-shelfHeight(0, -12000, S)).toBeGreaterThan(1450);
    expect(shelfHeight(0, 11000, S)).toBeGreaterThan(20);
  });

  it('the canyon is cut far below the shelf, and widens down the slope', () => {
    for (const e of [4000, 3000, 2000, 1000]) {
      const c = canyonAt(e, S)!;
      const floor = -shelfHeight(c.centre, e, S);
      const beside = -shelfHeight(c.centre + 3 * c.halfWidth, e, S);
      expect(floor - beside, `east ${e}`).toBeGreaterThan(100);
    }
    expect(canyonAt(-4000, S)!.halfWidth).toBeGreaterThan(canyonAt(2000, S)!.halfWidth);
  });

  it('seamounts rise from the deep to their summits', () => {
    for (const m of S.seamounts) {
      let top = Infinity;
      for (let dn = -200; dn <= 200; dn += 20) for (let de = -200; de <= 200; de += 20) top = Math.min(top, -shelfHeight(m.at[0] + dn, m.at[1] + de, S));
      expect(top, m.name).toBeGreaterThan(m.top - 25);
      expect(top, m.name).toBeLessThan(m.top + 25);
      expect(-shelfHeight(m.at[0] + m.radius * 1.2, m.at[1], S), m.name).toBeGreaterThan(m.top + 300);
    }
  });

  it('a wreck stands up from the bottom', () => {
    for (const w of S.wrecks) {
      const on = -shelfHeight(w.at[0], w.at[1], S);
      const off = -shelfHeight(w.at[0] + 60 * Math.sin(w.heading), w.at[1] - 60 * Math.cos(w.heading), S);
      expect(off - on, w.name).toBeGreaterThan(w.height - 3);
    }
  });
});

describe('the sea bed and sound', () => {
  it('bottom types: rock where steep, sand on the shelf, mud in the deep', () => {
    expect(bottomType('shelf', -150, 0.4, 0, 0)).toBe('rock');
    expect(['sand', 'gravel']).toContain(bottomType('shelf', -150, 0.01, 0, 3000));
    expect(bottomType('ocean', -1800, 0.01, 0, 0)).toBe('mud');
  });

  it('the bottom masks an echo close above it, rock most, and nothing higher up', () => {
    expect(bottomMask('rock', 5)).toBeGreaterThan(bottomMask('mud', 5));
    expect(bottomMask('rock', 5)).toBeGreaterThan(bottomMask('rock', 40));
    expect(bottomMask('rock', 50)).toBe(0);
    expect(bottomMask('mud', 200)).toBe(0);
  });

  it('the canyon walls block the sound between the canyon floor and the shelf above', () => {
    const g = areaAcousticGround('shelf');
    const c = canyonAt(3000, S)!;
    expect(terrainBlocks(g, [c.centre, 3000, 250], [c.centre + 2000, 3000, 5])).toBe(true);
    expect(terrainBlocks(g, [c.centre, 3000, 60], [c.centre + 2000, 3000, 5])).toBe(false);
    // In the deep ocean nothing is in the way.
    expect(terrainBlocks(areaAcousticGround('atlantic'), [0, 0, 250], [0, 8000, 5])).toBe(false);
  });

  it('a ship on the shelf is heard from the canyon near the rim, not from deep inside it', () => {
    const c0 = canyonAt(3000, S)!;
    const heard = (depth: number) => {
      const c = new Controller(new Simulation({ area: 'shelf', north: c0.centre, east: 3000, depth, speed: 3 * KN, neutral: true, heading: 270 * DEG }));
      c.setpoints.depth = depth;
      c.world.add([{ ...still('fartyg', [c0.centre + 5000, 3000], 'freighter'), speed: 6, route: [[c0.centre + 5000, 3000], [c0.centre + 5000, -30000]] }]);
      run(c, 3);
      return c.sonar.contacts.some((k) => k.vesselId === 'fartyg');
    };
    expect(heard(60)).toBe(true);
    expect(heard(250)).toBe(false);
  });
});

describe('life in the sea', () => {
  const whale: CreatureDef = { id: 'w', name: 'en kaskelot', kind: 'whale', sound: 'clicks', route: [[0, 0], [5000, 0]], speed: 1.5, depth: 400, dive: 600, surface: 120, callPeriod: 60, callOn: 45, size: 15 };

  it('a whale dives, clicks while down and comes up to breathe', () => {
    const w = new Creature(whale, false);
    let deepest = 0;
    let blew = false;
    let clicked = false;
    for (let t = 0; t < 720; t += 0.1) {
      w.step(0.1, t, false);
      deepest = Math.max(deepest, w.state.depth);
      blew ||= w.state.blowing;
      clicked ||= w.sourceLevel(t, false) !== null;
    }
    expect(deepest).toBeGreaterThan(350);
    expect(blew).toBe(true);
    expect(clicked).toBe(true);
  });

  it('a herring school is deep by day, shallow at night, and ticks only at night', () => {
    const school: CreatureDef = { id: 's', name: 'ett sillstim', kind: 'school', sound: 'frt', route: [[0, 0]], speed: 0, depth: 300, nightDepth: 40, size: 60 };
    expect(new Creature(school, false).state.depth).toBe(300);
    expect(new Creature(school, true).state.depth).toBe(40);
    expect(new Creature(school, false).sourceLevel(0, false)).toBeNull();
    expect(new Creature(school, true).sourceLevel(0, true)).not.toBeNull();
    // It keeps off the bottom.
    expect(new Creature(school, false, () => 150).state.depth).toBeLessThan(120);
  });

  it('the sonar hears a whale, classifies it as biological, and it cannot be made a target', () => {
    const c = new Controller(new Simulation({ area: 'atlantic', depth: 100, speed: 4 * KN, neutral: true }));
    c.setpoints.depth = 100;
    c.world.addLife([{ ...whale, route: [[3000, 0], [3000, 2000]], phase: 200 }]);
    run(c, 30);
    const k = c.sonar.contacts.find((x) => x.vesselId === 'w');
    expect(k).toBeDefined();
    expect(k!.bio).toBe(true);
    expect(k!.classified).toBe('kaskelot');
    c.submit({ kind: 'markTarget', label: k!.label }, 'console');
    run(c, 1);
    expect(c.fire.targets.length).toBe(0);
    expect(c.log.some((e) => e.text.includes('biologisk'))).toBe(true);
  });

  it('a ping gets echoes from a school and from a wreck', () => {
    const w = S.wrecks[0]!;
    const c = new Controller(new Simulation({ area: 'shelf', north: w.at[0] - 1500, east: w.at[1], depth: 60, speed: 2 * KN, neutral: true }));
    c.setpoints.depth = 60;
    c.world.addLife([{ id: 'sill', name: 'ett sillstim', kind: 'school', sound: 'frt', route: [[w.at[0] - 2500, w.at[1]]], speed: 0, depth: 80, size: 60 }]);
    c.submit({ kind: 'ping' }, 'console');
    run(c, 1);
    expect(c.sonar.echoes.some((e) => e.what === 'vrak?')).toBe(true);
    expect(c.sonar.echoes.some((e) => e.what === 'fiskstim?')).toBe(true);
  });

  it('the deep scattering layer is deep by day and shallow at night, only over deep water', () => {
    const c = new Controller(new Simulation({ area: 'atlantic', depth: 50, neutral: true }));
    expect(c.sonar.scatteringLayer()).toBe(400);
    c.world.night = true;
    expect(c.sonar.scatteringLayer()).toBe(50);
    expect(new Controller(new Simulation({ area: 'baltic' })).sonar.scatteringLayer()).toBeNull();
  });
});

describe('fishing gear', () => {
  it('a boat that runs into a trawl is caught and held, and backs out of it', () => {
    const sim = new Simulation({ area: 'atlantic', depth: 40, speed: 6 * KN, neutral: true, heading: 0, current: { speed: 0, toward: 0, decay: 1 } });
    const c = new Controller(sim);
    c.setpoints.depth = 40;
    c.crewTakesAll();
    c.submit({ kind: 'setSpeed', knots: 6 }, 'console');
    // A trawler steaming south straight at the boat, its net between 25 and 55 m.
    c.world.add([{ ...still('trawl', [900, 0], 'fishing'), speed: 1.8, route: [[900, 0], [-5000, 0]], trawl: { distance: 350, width: 35, top: 25, bottom: 55 } }]);
    let caught = false;
    for (let i = 0; i < 400 * 100 && !caught; i++) {
      c.step();
      caught = sim.systems.snag.holder !== null;
    }
    expect(caught).toBe(true);
    expect(c.log.some((e) => e.text.includes('fastnat i trålen'))).toBe(true);
    // The crew backs out of it.
    run(c, 90);
    expect(sim.systems.snag.holder).toBeNull();
    expect(c.log.some((e) => e.text.includes('Vi är loss'))).toBe(true);
  });

  it('held by a trawl, the boat cannot make way ahead', () => {
    const sim = new Simulation({ area: 'atlantic', depth: 40, speed: 0, neutral: true });
    const c = new Controller(sim);
    c.setpoints.depth = 40;
    c.world.add([{ ...still('net', [5000, 5000], 'fishing'), trawl: { distance: 350, width: 35, top: 25, bottom: 55 } }]);
    sim.systems.snag.catch('net');
    c.submit({ kind: 'setRpm', rpm: 150 }, 'console');
    run(c, 60);
    expect(sim.y[7]!).toBeLessThan(0.8);
  });
});

describe('patrol aircraft and coastal radar', () => {
  it('an aircraft sees a surfaced boat, reports it and the corvettes search there', () => {
    const c = new Controller(new Simulation({ area: 'atlantic' }));
    c.world.add([still('vakt', [0, 15000])]);
    c.world.addAircraft([{ id: 'plan', name: 'spaningsplanet Ørnen', altitude: 300, speed: 80, turnRate: 0.05, route: [[-20000, 0], [20000, 0]] }]);
    run(c, 10);
    expect(c.sonar.awareness.plan ?? 0).toBeGreaterThan(0.5);
    expect(c.hunter.state('vakt')).toBe('search');
    run(c, 10);
    expect(c.sonar.detectedBy).toBe('spaningsplanet Ørnen');
  });

  it('an aircraft does not see a boat deep down with its masts lowered', () => {
    const c = new Controller(new Simulation({ area: 'atlantic', depth: 60, neutral: true }));
    c.setpoints.depth = 60;
    c.world.addAircraft([{ id: 'plan', name: 'planet', altitude: 300, speed: 80, turnRate: 0.05, route: [[-20000, 0], [20000, 0]] }]);
    run(c, 30);
    expect(c.sonar.awareness.plan ?? 0).toBe(0);
  });

  it('a coastal radar sees a surfaced boat within its horizon, not one hidden behind an island', () => {
    const st = AREA_INFO.shelf.stations![0]!;
    const seen = (north: number, east: number) => {
      const c = new Controller(new Simulation({ area: 'shelf', north, east }));
      c.lookouts.stations = [st];
      run(c, 5);
      return c.sonar.awareness[st.id] ?? 0;
    };
    expect(seen(st.position[0], 3000)).toBeGreaterThan(0.5);
    expect(seen(st.position[0], -60000)).toBe(0);
  });
});

describe('the areas’ life and traffic', () => {
  const along = (route: [number, number][], h: (n: number, e: number) => number) => {
    let m = Infinity;
    const pts = [...route, route[0]!];
    for (let i = 0; i + 1 < pts.length; i++) {
      for (let k = 0; k <= 40; k++) {
        const f = k / 40;
        m = Math.min(m, -h(pts[i]![0] + (pts[i + 1]![0] - pts[i]![0]) * f, pts[i]![1] + (pts[i + 1]![1] - pts[i]![1]) * f));
      }
    }
    return m;
  };

  it('ships and animals keep to the water, stations stand on land, buoys float', () => {
    for (const a of AREA_ORDER) {
      const h = heightFunction(AREAS[a].terrain);
      const info = AREA_INFO[a];
      for (const v of info.traffic) expect(along(v.route, h), `${a}/${v.id}`).toBeGreaterThan(v.draft + 3);
      for (const x of info.life ?? []) expect(along(x.route, h), `${a}/${x.id}`).toBeGreaterThan(20);
      for (const s of info.stations ?? []) expect(h(s.position[0], s.position[1]), `${a}/${s.id}`).toBeGreaterThan(3);
      for (const b of info.buoys ?? []) expect(-h(b.position[0], b.position[1]), `${a} buoy`).toBeGreaterThan(4);
    }
  });
});
