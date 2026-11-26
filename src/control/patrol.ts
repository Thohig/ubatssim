/**
 * The patrol: free play as it goes on. Deterministic, once a second, driven
 * by the game session (no DOM):
 *
 *  - the threat level (peace, tension, war) sets who is at sea: at peace
 *    only the civil traffic; in tension a corvette patrols and aircraft and
 *    coastal radar look for the boat; at war two corvettes hunt together
 *    and a convoy with an escort goes by.
 *  - a hunt calls in reinforcements: `reinforceDelay` seconds after the
 *    corvettes start searching, a fresh corvette comes in from the edge of
 *    the area and searches where they believe the boat is (never its true
 *    position). At most `maxReinforce` per threat level, one per alert.
 *  - the clock goes round (day, dusk, night, dawn; fog stays), which moves
 *    the scattering layer and the herring (`World.night`) and the light.
 *  - new civil traffic comes in on the area's lanes now and then.
 *  - alongside the depot ship, surfaced and stopped, the boat takes on
 *    torpedoes and decoys.
 *  - the patrol's tally: ships sunk and their tonnage, distance, time hunted.
 */
import { WEAPONS } from '../sim/config/weapons';
import type { AreaId } from '../sim/config/areas';
import { DT } from '../sim/simulation';
import type { VesselDef } from '../sim/vessel';
import { AREA_INFO, corvette, freighter, type ConditionsId } from './areas';
import type { Controller } from './controller';

const KN = 1852 / 3600;

export type ThreatId = 'peace' | 'tension' | 'war';

export const THREATS: { id: ThreatId; title: string; description: string }[] = [
  { id: 'peace', title: 'Fred', description: 'Bara civil trafik. Ingen letar efter dig.' },
  { id: 'tension', title: 'Spänt', description: 'En korvett patrullerar, och flyg och kustradar spanar efter master.' },
  { id: 'war', title: 'Krig', description: 'Två korvetter jagar tillsammans, och en konvoj med eskort går förbi.' },
];

export const PATROL = {
  /** Seconds from the start of a hunt to a reinforcement arriving at the edge of the area. */
  reinforceDelay: 600,
  /** Seconds after a hunt before a new one can call in another reinforcement. */
  alertTime: 1800,
  maxReinforce: { peace: 0, tension: 1, war: 2 } as Record<ThreatId, number>,
  /** A new civil ship every this many seconds, at most `trafficMax`. */
  trafficEvery: 1200,
  trafficMax: 3,
  /** Within this distance [m] of the depot ship, surfaced and stopped, the boat is alongside. */
  alongside: 400,
  /** Seconds alongside to take over torpedoes and decoys. */
  restockTime: 300,
  /** The day [s]: day, dusk, night, dawn. */
  clock: { day: 7200, dusk: 1200, night: 7200 },
};

/** The light at sim time `t` for a game that started at `start` (fog does not change). */
export function conditionsAt(start: ConditionsId, t: number): ConditionsId {
  if (start === 'fog') return 'fog';
  const { day, dusk, night } = PATROL.clock;
  const phases: [ConditionsId, number][] = [['day', day], ['dusk', dusk], ['night', night], ['dusk', dusk]];
  const startAt = start === 'day' ? 0 : start === 'dusk' ? day : day + dusk;
  let x = (startAt + t) % (2 * dusk + day + night);
  for (const [c, len] of phases) {
    if (x < len) return c;
    x -= len;
  }
  return 'day';
}

/** Gross tonnage of a ship, roughly from its length. APPROX: of the right size for each kind. */
export function tonnage(d: VesselDef): number {
  const k = d.kind === 'freighter' || d.kind === 'ferry' ? 0.005 : d.kind === 'patrol' ? 0.003 : d.kind === 'fishing' ? 0.02 : 0.005;
  return Math.round(k * d.length ** 3);
}

/** A route moved `d` metres to the right of its direction of travel. */
function offset(route: [number, number][], d: number): [number, number][] {
  const a = route[0]!;
  const b = route[route.length - 1]!;
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
  // Right of north is east: the normal (−de, dn)/len rotated clockwise.
  const n = [-(b[1] - a[1]) / len, (b[0] - a[0]) / len];
  return route.map((p) => [p[0] - n[0]! * d, p[1] - n[1]! * d]);
}

const DEPOT_ID = 'depot';
const NEW_SHIPS = ['M/S Frej', 'M/S Gerda', 'M/S Hedda', 'M/S Idun', 'M/S Jorunn'];
const REINFORCEMENTS = ['korvetten Gripen', 'korvetten Tärnan'];

/** The ships a patrol starts with besides the area's civil traffic: corvettes, a convoy and the depot ship. */
export function patrolShips(area: AreaId, threat: ThreatId): VesselDef[] {
  const p = AREA_INFO[area].patrol;
  const ships: VesselDef[] = [
    { ...freighter(DEPOT_ID, p.depot.name, [p.depot.position], 90), speed: 0, propellerRps: 0, repeat: 'loop' },
  ];
  if (threat === 'peace') return ships;
  ships.push({ ...corvette('vakten', 'korvetten Vakten', p.line, 10), ...(threat === 'war' ? { group: 'patrullen' } : {}) });
  if (threat === 'war') {
    ships.push({ ...corvette('hoken', 'korvetten Höken', [...p.line].reverse(), 10), group: 'patrullen' });
    ships.push({ ...freighter('lastaren', 'M/S Lastaren', p.convoy), speed: 8 * KN, group: 'konvojen' });
    ships.push({ ...freighter('balder', 'M/S Balder', offset(p.convoy, -700)), speed: 8 * KN, group: 'konvojen' });
    ships.push({ ...corvette('eskorten', 'korvetten Eskort', offset(p.convoy, 900), 8), group: 'konvojen' });
  }
  return ships;
}

/** A ship sunk on the patrol. */
export interface Sinking {
  name: string;
  tonnage: number;
  /** Sim time [s]. */
  t: number;
}

export class Patrol {
  /** The light now (changes with the clock). */
  conditions: ConditionsId;
  readonly sunk: Sinking[] = [];
  /** Distance over the ground [m]. */
  distance = 0;
  /** Seconds while a corvette searched for or attacked the boat. */
  hunted = 0;
  /** Times the corvettes started a hunt. */
  hunts = 0;
  /** Torpedoes and decoys taken over at the depot ship. */
  restocked = 0;
  private reinforced = 0;
  private traffic = 0;
  private huntStart: number | null = null;
  private lastAlert = -Infinity;
  private reinforceAt: number | null = null;
  private alongsideFor = 0;
  /** "Full" said once per stay alongside (it came every five minutes). */
  private saidFull = false;
  private last: [number, number];
  private steps = 0;

  constructor(
    private readonly ctrl: Controller,
    readonly area: AreaId,
    readonly threat: ThreatId,
    readonly startConditions: ConditionsId,
    /** False behind the start page: no new ships, no reinforcements. */
    private readonly live = true,
  ) {
    this.conditions = startConditions;
    this.last = [ctrl.sim.y[0]!, ctrl.sim.y[1]!];
  }

  /** The depot ship's position [north, east]. */
  get depot(): [number, number] {
    return AREA_INFO[this.area].patrol.depot.position;
  }

  get tonnage(): number {
    return this.sunk.reduce((s, x) => s + x.tonnage, 0);
  }

  /** Call once per simulation step; works once a second. */
  update(): void {
    if (this.steps++ % Math.round(1 / DT) !== 0) return;
    const c = this.ctrl;
    const t = c.sim.t;
    const here: [number, number] = [c.sim.y[0]!, c.sim.y[1]!];
    this.distance += Math.hypot(here[0] - this.last[0], here[1] - this.last[1]);
    this.last = here;

    const light = conditionsAt(this.startConditions, t);
    if (light !== this.conditions) {
      const before = this.conditions;
      this.conditions = light;
      c.world.night = light === 'night' || light === 'dusk';
      c.addLog(light === 'dusk' ? (before === 'day' ? 'Det skymmer.' : 'Det gryr.') : light === 'night' ? 'Det är natt.' : 'Det är dag.', 'info');
    }

    for (const v of c.world.vessels) {
      if (!v.state.sinking || v.def.id === DEPOT_ID || this.sunk.some((s) => s.name === v.def.name)) continue;
      this.sunk.push({ name: v.def.name, tonnage: tonnage(v.def), t });
    }

    this.watchHunt(t);
    if (this.live) this.newTraffic(t);
    this.watchDepot();
  }

  private watchHunt(t: number): void {
    const c = this.ctrl;
    const hunting = c.hunter.hunting;
    if (hunting) this.hunted++;
    if (hunting && this.huntStart === null) {
      this.huntStart = t;
      this.hunts++;
      if (this.live && this.reinforced < PATROL.maxReinforce[this.threat] && t - this.lastAlert > PATROL.alertTime) {
        this.lastAlert = t;
        this.reinforceAt = t + PATROL.reinforceDelay;
        c.addLog('Signalspaning: korvetten anropar förstärkning.', 'info');
      }
    } else if (!hunting) this.huntStart = null;
    if (this.reinforceAt !== null && t >= this.reinforceAt) {
      this.reinforceAt = null;
      this.reinforce();
    }
  }

  /** A fresh corvette comes in on the first lane and searches where the hunters believe the boat is. */
  private reinforce(): void {
    const c = this.ctrl;
    const p = AREA_INFO[this.area].patrol;
    const name = REINFORCEMENTS[this.reinforced % REINFORCEMENTS.length]!;
    const def: VesselDef = { ...corvette(`forstarkning-${this.reinforced}`, name, [p.lanes[0]![0]!, ...p.line], 14), group: 'patrullen' };
    this.reinforced++;
    c.world.add([def]);
    const lkp = Object.values(c.hunter.hunts).find((h) => h.lkp && (h.state === 'search' || h.state === 'attack'))?.lkp;
    const v = c.world.vessels[c.world.vessels.length - 1]!;
    if (lkp) c.hunter.cue(v, lkp);
  }

  private newTraffic(t: number): void {
    if (this.traffic >= PATROL.trafficMax || t < (this.traffic + 1) * PATROL.trafficEvery) return;
    const lanes = AREA_INFO[this.area].patrol.lanes;
    const lane = lanes[this.traffic % lanes.length]!;
    const route = this.traffic % 2 === 0 ? lane : [...lane].reverse();
    this.ctrl.world.add([{ ...freighter(`ny-${this.traffic}`, NEW_SHIPS[this.traffic % NEW_SHIPS.length]!, route, 110 + 20 * (this.traffic % 3)), speed: (9 + (this.traffic % 3) * 2) * KN, repeat: 'loop' }]);
    this.traffic++;
  }

  private watchDepot(): void {
    const c = this.ctrl;
    const k = c.sim.kinematics();
    const [dn, de] = this.depot;
    const near = Math.hypot(c.sim.y[0]! - dn, c.sim.y[1]! - de) < PATROL.alongside;
    const alongside = near && c.sim.telemetry().bridgeDeckDepth < 0 && Math.abs(k.u) < 0.5;
    if (!alongside) {
      this.alongsideFor = 0;
      this.saidFull = false;
      return;
    }
    if (this.alongsideFor === 0) c.addLog(`Långsides ${AREA_INFO[this.area].patrol.depot.name}. Lastningen tar ${PATROL.restockTime / 60} min.`, 'info');
    if (++this.alongsideFor < PATROL.restockTime) return;
    this.alongsideFor = 1;
    const torpedoes = c.fire.room.restock();
    const decoys = WEAPONS.decoy.count - c.decoys;
    c.decoys = WEAPONS.decoy.count;
    this.restocked += torpedoes + decoys;
    const what = [torpedoes ? `${torpedoes} ${torpedoes === 1 ? 'torped' : 'torpeder'}` : '', decoys ? `${decoys} lockmål` : ''].filter(Boolean);
    // Again every `restockTime` while alongside: the tubes take from the racks as they are loaded.
    if (what.length) c.addLog(`Lastat från depåfartyget: ${what.join(' och ')}.`, 'info');
    else if (!this.saidFull) c.addLog('Fullt med torpeder och lockmål.', 'info');
    this.saidFull = what.length === 0;
  }
}
