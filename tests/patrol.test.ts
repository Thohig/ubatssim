import { afterEach, describe, expect, it } from 'vitest';
import { AREA_INFO, AREA_ORDER } from '../src/control/areas';
import { MISSIONS } from '../src/control/missions';
import { PATROL, conditionsAt, patrolShips, tonnage } from '../src/control/patrol';
import { WEAPONS } from '../src/sim/config/weapons';
import { GameSession } from '../src/game/session';
import { TIP_GAP, Tips } from '../src/game/tips';
import { missionLine } from '../src/ui/missionBar';
import type { InitialConditions } from '../src/sim/simulation';
import type { ThreatId } from '../src/control/patrol';

const KN = 1852 / 3600;
const saved = { patrol: structuredClone(PATROL), missions: { ...MISSIONS } };
afterEach(() => {
  Object.assign(PATROL, structuredClone(saved.patrol));
  Object.assign(MISSIONS, saved.missions);
});

const session = (initial: InitialConditions, threat: ThreatId = 'tension', missions = false, conditions: 'day' | 'dusk' | 'night' | 'fog' = 'day') =>
  new GameSession({ initial, intro: '', conditions, helpHint: '', threat, missions });

const run = (s: GameSession, seconds: number) => {
  for (let i = 0; i < seconds * 100; i++) s.step();
};

const said = (s: GameSession, re: RegExp) => s.ctrl.log.some((e) => re.test(e.text));

describe('the clock', () => {
  it('goes round day, dusk, night and dawn from where the game started; fog stays', () => {
    const { day, dusk, night } = PATROL.clock;
    expect(conditionsAt('day', 0)).toBe('day');
    expect(conditionsAt('day', day + 1)).toBe('dusk');
    expect(conditionsAt('day', day + dusk + 1)).toBe('night');
    expect(conditionsAt('day', day + dusk + night + 1)).toBe('dusk');
    expect(conditionsAt('day', day + 2 * dusk + night + 1)).toBe('day');
    expect(conditionsAt('night', 1)).toBe('night');
    expect(conditionsAt('dusk', dusk + 1)).toBe('night');
    expect(conditionsAt('fog', day + dusk + 1)).toBe('fog');
  });

  it('moves the light in the game and the night in the world, and says so', () => {
    PATROL.clock = { day: 2, dusk: 2, night: 2 };
    const s = session({ depth: 13, neutral: true }, 'peace');
    expect(s.conditions).toBe('day');
    run(s, 3);
    expect(s.conditions).toBe('dusk');
    expect(s.ctrl.world.night).toBe(true);
    run(s, 2);
    expect(s.conditions).toBe('night');
    run(s, 4);
    expect(s.conditions).toBe('day');
    expect(s.ctrl.world.night).toBe(false);
    expect(said(s, /^Det skymmer\./) && said(s, /^Det är natt\./) && said(s, /^Det gryr\./) && said(s, /^Det är dag\./)).toBe(true);
  });
});

describe('the threat level', () => {
  it('peace: the depot ship only; tension: a corvette; war: two hunting together and a convoy with an escort', () => {
    const ids = (t: ThreatId) => patrolShips('westCoast', t).map((d) => d.id);
    expect(ids('peace')).toEqual(['depot']);
    expect(ids('tension')).toEqual(['depot', 'vakten']);
    const war = patrolShips('westCoast', 'war');
    expect(war.filter((d) => d.group === 'patrullen').map((d) => d.id)).toEqual(['vakten', 'hoken']);
    expect(war.filter((d) => d.group === 'konvojen').map((d) => d.kind)).toEqual(['freighter', 'freighter', 'patrol']);
  });

  it('the patrol\'s routes keep to deep water and the depot ship lies where a boat can come alongside', async () => {
    const { AREAS } = await import('../src/sim/config/areas');
    const { heightFunction } = await import('../src/sim/terrain');
    for (const a of AREA_ORDER) {
      const h = heightFunction(AREAS[a].terrain);
      for (const d of patrolShips(a, 'war')) {
        const pts = d.route.length === 1 ? [d.route[0]!, d.route[0]!] : d.route;
        for (let i = 0; i + 1 < pts.length; i++) {
          for (let k = 0; k <= 50; k++) {
            const f = k / 50;
            expect(-h(pts[i]![0] + (pts[i + 1]![0] - pts[i]![0]) * f, pts[i]![1] + (pts[i + 1]![1] - pts[i]![1]) * f), `${a}/${d.id}`).toBeGreaterThan(d.draft + 3);
          }
        }
      }
      for (const lane of AREA_INFO[a].patrol.lanes) {
        for (let k = 0; k <= 50; k++) {
          const f = k / 50;
          expect(-h(lane[0]![0] + (lane[1]![0] - lane[0]![0]) * f, lane[0]![1] + (lane[1]![1] - lane[0]![1]) * f), `${a} lane`).toBeGreaterThan(12);
        }
      }
    }
  });

  it('a hunt calls in a reinforcement, which searches where the hunters believe the boat is', () => {
    PATROL.reinforceDelay = 5;
    const s = session({ area: 'atlantic', depth: 13, neutral: true });
    const vakten = s.ctrl.world.vessels.find((v) => v.def.id === 'vakten')!;
    s.ctrl.hunter.cue(vakten, [200, 100]);
    run(s, 2);
    expect(s.ctrl.hunter.hunting).toBe(true);
    expect(said(s, /anropar förstärkning/)).toBe(true);
    const before = s.ctrl.world.vessels.length;
    run(s, 6);
    expect(s.ctrl.world.vessels.length).toBe(before + 1);
    const fresh = s.ctrl.world.vessels[before]!;
    expect(fresh.def.kind).toBe('patrol');
    expect(s.ctrl.hunter.state(fresh.def.id)).toBe('search');
    expect(s.patrol.hunts).toBe(1);
    expect(s.patrol.hunted).toBeGreaterThan(5);
  });

  it('at peace no reinforcement comes', () => {
    PATROL.reinforceDelay = 1;
    const s = session({ area: 'atlantic', depth: 13, neutral: true }, 'peace');
    const n = s.ctrl.world.vessels.length;
    run(s, 5);
    expect(s.ctrl.world.vessels.length).toBe(n);
  });
});

describe('the patrol goes on', () => {
  it('new civil ships come in on the lanes, at most a few', () => {
    PATROL.trafficEvery = 2;
    const s = session({ area: 'atlantic', depth: 13, neutral: true }, 'peace');
    const n = s.ctrl.world.vessels.length;
    run(s, 12);
    expect(s.ctrl.world.vessels.length).toBe(n + PATROL.trafficMax);
    expect(s.ctrl.world.vessels.slice(n).every((v) => v.def.kind === 'freighter')).toBe(true);
  });

  it('alongside the depot ship, surfaced and stopped, the boat takes on torpedoes and decoys', () => {
    PATROL.restockTime = 3;
    const [n, e] = AREA_INFO.atlantic.patrol.depot.position;
    const s = session({ area: 'atlantic', north: n - 200, east: e }, 'peace');
    s.ctrl.fire.room.reserve = 2;
    s.ctrl.decoys = 1;
    run(s, 6);
    expect(said(s, /^Långsides depåfartyget Thule/)).toBe(true);
    expect(s.ctrl.fire.room.reserve).toBe(WEAPONS.tubes.reserve);
    expect(s.ctrl.decoys).toBe(WEAPONS.decoy.count);
    expect(said(s, /^Lastat från depåfartyget: 6 torpeder och 3 lockmål\./)).toBe(true);
    // Full: said once, not every `restockTime` for as long as the boat lies there.
    run(s, 12);
    expect(s.ctrl.log.filter((x) => x.text === 'Fullt med torpeder och lockmål.')).toHaveLength(1);
  });

  it('nothing is taken on dived or under way', () => {
    PATROL.restockTime = 2;
    const [n, e] = AREA_INFO.atlantic.patrol.depot.position;
    const s = session({ area: 'atlantic', north: n - 250, east: e, depth: 30, neutral: true }, 'peace');
    s.ctrl.fire.room.reserve = 2;
    run(s, 5);
    expect(s.ctrl.fire.room.reserve).toBe(2);
  });

  it('counts ships sunk with their tonnage', () => {
    const s = session({ area: 'atlantic', depth: 13, neutral: true }, 'war');
    const ship = s.ctrl.world.vessels.find((v) => v.def.id === 'lastaren')!;
    ship.state.sinking = true;
    run(s, 2);
    expect(s.patrol.sunk).toEqual([{ name: 'M/S Lastaren', tonnage: tonnage(ship.def), t: expect.any(Number) }]);
    expect(s.patrol.tonnage).toBeGreaterThan(5000);
  });

  it('measures the distance over the ground', () => {
    const s = session({ area: 'atlantic', depth: 50, neutral: true, speed: 8 * KN }, 'peace');
    run(s, 30);
    expect(s.patrol.distance).toBeGreaterThan(100);
    expect(s.patrol.distance).toBeLessThan(150);
  });
});

describe('missions by radio', () => {
  it('are off unless chosen', () => {
    MISSIONS.firstAt = 1;
    const s = session({ depth: 13, neutral: true }, 'tension', false);
    run(s, 3);
    expect(s.missions.current).toBeNull();
  });

  it('wait for an antenna above the water, then come one at a time with the buoy', () => {
    MISSIONS.firstAt = 1;
    const s = session({ area: 'atlantic', depth: 60, neutral: true }, 'tension', true);
    run(s, 3);
    expect(s.missions.current).toBeNull();
    expect(said(s, /^Radio: ett meddelande väntar/)).toBe(true);
    const up = session({ area: 'atlantic' }, 'tension', true);
    run(up, 3);
    const m = up.missions.current!;
    expect(m.kind).toBe('recce');
    expect(said(up, /^Radio: Spana efter trafik/)).toBe(true);
    expect(up.waypoint).toEqual(m.waypoint);
  });

  it('are optional: one not done in time only goes out, and the next comes later', () => {
    MISSIONS.firstAt = 1;
    MISSIONS.limit = 3;
    MISSIONS.gap = 2;
    // In peace: surfaced, the corvette sees the boat at once, and no mission comes during a hunt.
    const s = session({ area: 'atlantic' }, 'peace', true);
    run(s, 6);
    expect(s.missions.missed).toBe(1);
    expect(said(s, /^Uppdraget gick ut: .*Inget straff/)).toBe(true);
    expect(s.sim.systems.flooding.water).toBe(0);
    run(s, 3);
    expect(s.missions.current?.kind).toBe('transit');
  });

  it('a recce is done by looking with the periscope near the point', () => {
    MISSIONS.firstAt = 1;
    MISSIONS.recceHold = 2;
    const lane = AREA_INFO.atlantic.patrol.lanes[0]!;
    const mid: [number, number] = [(lane[0]![0] + lane[1]![0]) / 2, (lane[0]![1] + lane[1]![1]) / 2];
    // Lane 0 just outside the range when the order comes, so that it is the one chosen; then the usual range.
    MISSIONS.recceRange = 900;
    const s = session({ area: 'atlantic', north: mid[0] + 1000, east: mid[1], depth: 13, neutral: true }, 'peace', true);
    s.ctrl.submit({ kind: 'periscope', up: true }, 'keyboard');
    // The periscope takes 8 s to come up, and the order comes when it is.
    run(s, 10);
    expect(s.missions.current?.waypoint).toEqual(mid);
    MISSIONS.recceRange = saved.missions.recceRange;
    run(s, 5);
    expect(s.missions.done).toBe(1);
    expect(said(s, /^Uppdrag utfört: spana i farleden/)).toBe(true);
  });

  it('a recce goes to a lane the boat is not already watching', () => {
    MISSIONS.firstAt = 1;
    const lane = AREA_INFO.atlantic.patrol.lanes[0]!;
    const mid: [number, number] = [(lane[0]![0] + lane[1]![0]) / 2, (lane[0]![1] + lane[1]![1]) / 2];
    const s = session({ area: 'atlantic', north: mid[0] + 1000, east: mid[1], depth: 13, neutral: true }, 'peace', true);
    s.ctrl.submit({ kind: 'periscope', up: true }, 'keyboard');
    run(s, 10);
    const w = s.missions.current!.waypoint!;
    expect(Math.hypot(w[0] - s.sim.y[0]!, w[1] - s.sim.y[1]!)).toBeGreaterThan(MISSIONS.recceRange);
  });

  it('an attack has a buoy at the convoy, moved when the radio reports it again', () => {
    MISSIONS.firstAt = 1;
    MISSIONS.limit = 3;
    MISSIONS.gap = 2;
    MISSIONS.convoyReport = 20;
    const s = session({ area: 'atlantic', depth: 13, neutral: true }, 'war', true);
    s.ctrl.hunter.enabled = false;
    s.ctrl.submit({ kind: 'periscope', up: true }, 'keyboard');
    for (let i = 0; i < 40 && s.missions.current?.kind !== 'attack'; i++) run(s, 1);
    const m = s.missions.current!;
    expect(m.kind).toBe('attack');
    const convoy = () => s.ctrl.world.vessels.find((v) => v.def.id === 'lastaren')!.state;
    const first = [...m.waypoint!];
    expect(Math.hypot(first[0]! - convoy().north, first[1]! - convoy().east)).toBeLessThan(200);
    expect(s.waypoint).toEqual(m.waypoint);
    MISSIONS.limit = 7200;
    m.deadline = s.sim.t + 7200;
    run(s, 25);
    expect(said(s, /^Radio: konvojen är nu .* Bojen flyttad\./)).toBe(true);
    expect(s.missions.current!.waypoint).not.toEqual(first);
  });

  it('no new mission comes in the middle of a hunt', () => {
    MISSIONS.firstAt = 1;
    const s = session({ area: 'atlantic' }, 'tension', true);
    const v = s.ctrl.world.vessels.find((x) => x.def.kind === 'patrol')!;
    s.ctrl.hunter.cue(v, [s.sim.y[0]!, s.sim.y[1]!]);
    run(s, 3);
    expect(s.ctrl.hunter.hunting).toBe(true);
    expect(s.missions.current).toBeNull();
  });

  it('the mission bar gives the goal, the way to the buoy and the time left', () => {
    const line = missionLine({ kind: 'recce', order: '', goal: 'spana i farleden (bojen)', waypoint: [1000, 1000], start: 0, deadline: 6300 }, [0, 0, 0], 0);
    expect(line).toBe('Uppdrag: spana i farleden (bojen) · 1,4 km 045° · 1 h 45 min kvar');
  });
});

describe('tips', () => {
  it('one tip at a time, each once, and none when they are off', () => {
    const s = session({ area: 'atlantic', depth: 100, neutral: true }, 'peace');
    const tips = new Tips([], true);
    expect(tips.update(s)).toBe('deep');
    expect(said(s, /^Tips: Under språngskiktet/)).toBe(true);
    s.ctrl.fire.room.reserve = 0;
    expect(tips.update(s)).toBeNull(); // too soon
    run(s, TIP_GAP + 1);
    expect(['torpedoes', 'contact']).toContain(tips.update(s));
    expect(new Tips(['deep'], true).update(session({ area: 'atlantic', depth: 100, neutral: true }, 'peace'))).not.toBe('deep');
    expect(new Tips([], false).update(s)).toBeNull();
  });
});
