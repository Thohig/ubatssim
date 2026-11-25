/**
 * The situations the long tests play: the game's former scenarios, kept as
 * test data. A starting condition, objectives that must be met in order
 * (each optionally held for some time) and failure conditions. The runner
 * checks them against telemetry, so it is deterministic and needs no UI.
 * The game itself has only free play.
 */
import { ENVIRONMENT } from '../src/sim/config/environment';
import { AREAS } from '../src/sim/config/areas';
import { canyonAt } from '../src/sim/terrain';
import { WEAPONS } from '../src/sim/config/weapons';
import { Simulation, type InitialConditions, type Telemetry } from '../src/sim/simulation';
import { Controller } from '../src/control/controller';
import { twoLegs } from '../src/control/fireControl';
import { CREW_NAME, CREW_SYSTEMS, type CrewLocks } from '../src/control/crew';
import { AREA_INFO, corvette, freighter, type ConditionsId } from '../src/control/areas';
import type { VesselDef } from '../src/sim/vessel';
import type { AircraftDef } from '../src/sim/aircraft';
import type { CreatureDef } from '../src/sim/life';
import type { RadarStation } from '../src/control/lookouts';

const G = ENVIRONMENT.g;
const KN = 1852 / 3600;

export interface Objective {
  /** Short goal (logged when met). */
  text: string;
  check: (t: Telemetry, c: Controller) => boolean;
  /** Seconds the condition must hold continuously. */
  holdSeconds?: number;
}

export interface Scenario {
  id: string;
  title: string;
  description: string;
  initial: InitialConditions;
  /**
   * Systems fixed for this scenario (true = the crew, false = the player);
   * the player chooses the rest. Every game starts with the crew handling
   * all unlocked systems.
   */
  locks?: CrewLocks;
  objectives: Objective[];
  /** Returns a failure message, or null while the scenario is still alive. */
  failure?: (t: Telemetry, c: Controller) => string | null;
  /** Optional overall time limit [s]. */
  timeLimit?: number;
  /** Optional target position [north, east] in metres, shown as a buoy. */
  waypoint?: [number, number];
  /** Light and visibility (default: day). The sea area is `initial.area` and the sea state `initial.sea`. */
  conditions?: ConditionsId;
  /** Other vessels in the scenario (default: none; free play has the area's traffic). */
  traffic?: VesselDef[];
  /** Whales and fish schools (default: none). */
  life?: CreatureDef[];
  /** Patrol aircraft and coastal radar stations (default: none). */
  aircraft?: AircraftDef[];
  stations?: RadarStation[];
  /** The scenario fails when a patrol vessel finds the boat (sonar.ts). */
  failWhenDetected?: boolean;
  /** Called once after the traffic is added (e.g. a corvette already hunting). */
  setup?: (c: Controller) => void;
}

/** Water inside the hull [m^3] at which the boat is lost (it can no longer be kept up). */
export const FLOODED = 120;

/** Distance [m] and true bearing [deg] from the boat to the scenario waypoint. */
export function waypointInfo(t: Telemetry, wp: [number, number]): { distance: number; bearing: number } {
  const dn = wp[0] - t.position[0];
  const de = wp[1] - t.position[1];
  const bearing = ((Math.atan2(de, dn) * 180) / Math.PI + 360) % 360;
  return { distance: Math.hypot(dn, de), bearing };
}

const mbt = (t: Telemetry) => t.tanks.filter((x) => x.kind === 'mainBallast');

const DEG = Math.PI / 180;

/** True bearing [deg] from a position to a point. */
const bearingTo = (from: [number, number], to: [number, number]) =>
  (((Math.atan2(to[1] - from[1], to[0] - from[0]) * 180) / Math.PI) + 360) % 360;

/** Smallest difference between two bearings [deg]. */
const bearingDiff = (a: number, b: number) => Math.abs(((((a - b) % 360) + 540) % 360) - 180);

const lighthouse = (area: keyof typeof AREA_INFO, name: string): [number, number] =>
  AREA_INFO[area].lighthouses.find((l) => l.name === name)!.position;

const WEST_LIGHT = lighthouse('westCoast', 'Västra fyren');
const SOUTH_LIGHT = lighthouse('westCoast', 'Södra fyren');
/** Most time the periscope may show above the water in one go [s]. */
export const PERISCOPE_EXPOSURE_LIMIT = 60;
const FJORD_BUOY: [number, number] = [2400, 120];
/** "Back": the boat starts heading north; the buoy is straight astern. */
const ASTERN_START: [number, number] = [0, -3000];
const ASTERN_BUOY: [number, number] = [-450, -3000];
/** Most the heading may differ from north in "Back" [deg]. */
const ASTERN_MAX_YAW = 45;
/** "Övningsskott": a slow target ship crossing 3 km ahead, east-bound. */
const PRACTICE_TARGET: VesselDef = { ...freighter('ovning', 'målfartyget Övning', [[3000, -4000], [3000, 7000]]), speed: 6 * KN };
/** "Nattanfall": a freighter 6 km off, west-bound across the bow. */
const NIGHT_TARGET: VesselDef = { ...freighter('nordstjarnan', 'M/S Nordstjärnan', [[6000, 5000], [6000, -9000]]), speed: 9 * KN };
/** "Jagad": a corvette already hunting, 1.5 km north. */
const HUNTER = corvette('jagaren', 'korvetten Jägaren', [[1500, 0], [1500, 4000]]);
/** "Konvojen": a freighter with a corvette escorting on its seaward side, both west-bound. */
const CONVOY_SHIP: VesselDef = { ...freighter('lastaren', 'M/S Lastaren', [[4000, 4000], [4000, -12000]]), speed: 8 * KN };
const ESCORT = corvette('eskorten', 'korvetten Eskort', [[4800, 4000], [4800, -12000]], 8);
/** A corvette is shaken off when it is back on patrol and has lost the boat, or has no depth charges left, or is sunk. */
const shaken = (c: Controller, id: string) =>
  sunk(c, id) || (c.hunter.state(id) === 'patrol' && ((c.sonar.awareness[id] ?? 0) < 0.5 || c.hunter.spent(id)));
const sunk = (c: Controller, id: string): boolean => c.world.vessels.find((v) => v.def.id === id)?.state.sinking === true;
const lookoutUp = (t: Telemetry) => t.periscope > 0.99 && t.periscopeHeadDepth < 0;

/** "Smyg förbi": the corvette shuttles east–west across the way to the buoy. */
/** "Sväva": most speed through the water [m/s] (1 knot). */
const HOVER_FAIL_SPEED = 1 * KN;
const STEALTH_BUOY: [number, number] = [2500, 0];
const STEALTH_CORVETTE = corvette('vaktaren', 'korvetten Väktaren', [[1300, -3000], [1300, 3000]]);
/** The freighter in "Fartyget": northbound west of the boat. */
const RECCE_SHIP = freighter('skagerack', 'M/S Skagerack', [[-2500, -1500], [6000, -1500]]);
/** "Radar i dimman": a freighter 6 km north going west, and a corvette patrolling 9 km to the east. */
const FOG_SHIP: VesselDef = { ...freighter('dimman', 'M/S Dimman', [[6000, 3000], [6000, -12000]]), speed: 8 * KN };
const FOG_CORVETTE = corvette('lyssnaren', 'korvetten Lyssnaren', [[0, 9000], [8000, 9000]]);
/** "Ekot": a freighter 4,5 km off to the north-west going east, and a corvette 11 km south that hears pings. */
const ECHO_SHIP: VesselDef = { ...freighter('ekot', 'M/S Ekot', [[3500, -3000], [3500, 9000]]), speed: 7 * KN };
const ECHO_CORVETTE = corvette('hornet', 'korvetten Hornet', [[-11000, -3000], [-11000, 3000]]);
/** "Klart för eld": two target ships in line, 3,5 km north, east-bound. */
const FIRE_SHIP_A: VesselDef = { ...freighter('mal-a', 'målfartyget Alfa', [[3500, -3000], [3500, 9000]]), speed: 5 * KN };
const FIRE_SHIP_B: VesselDef = { ...freighter('mal-b', 'målfartyget Bravo', [[3500, -4500], [3500, 9000]]), speed: 5 * KN };
/** "Två jägare": one corvette already hunting 1,5 km north, its partner patrolling 5 km east; they hunt together. */
const PAIR_A: VesselDef = { ...corvette('falken', 'korvetten Falken', [[1500, 0], [1500, 4000]]), group: 'paret' };
const PAIR_B: VesselDef = { ...corvette('hoken', 'korvetten Höken', [[0, 5000], [4000, 5000]]), group: 'paret' };
/** "Stora konvojen": three freighters west-bound in line abreast, with an escort; hit one and the others zigzag. */
const BIG_CONVOY: VesselDef[] = [
  { ...freighter('ettan', 'M/S Ettan', [[3500, 3000], [3500, -14000]]), speed: 7 * KN, group: 'konvojen' },
  { ...freighter('tvaan', 'M/S Tvåan', [[4300, 3200], [4300, -14000]]), speed: 7 * KN, group: 'konvojen' },
  { ...freighter('trean', 'M/S Trean', [[5100, 3000], [5100, -14000]]), speed: 7 * KN, group: 'konvojen' },
];
const BIG_ESCORT: VesselDef = { ...corvette('vakten', 'korvetten Vakten', [[5900, 3400], [5900, -14000]], 7), group: 'konvojen' };
/** "Lockmålet": a corvette already hunting, 1,2 km north. */
const DECOY_HUNTER = corvette('spejaren', 'korvetten Spejaren', [[1200, 0], [1200, 4000]]);
const ready = (c: Controller) => c.fire.tubes.filter((x) => x.loaded && x.flooded && x.open && x.plan.length === 0).length;
const good = (c: Controller, id: string) => {
  const t = c.fire.targets.find((x) => x.vesselId === id);
  return t?.solution?.quality === 'bra';
};

/** "Kanjonen": the canyon's centre where the boat starts and where the buoy is (sim/terrain.ts). */
const CANYON_START = 800;
const CANYON_END = 4200;
const SHELF_TERRAIN = AREAS.shelf.terrain;
const canyonCentre = (east: number): [number, number] => [canyonAt(east, SHELF_TERRAIN.params)!.centre, east];
/** Two corvettes pinging as they patrol the shelf on either side of the canyon (a sonar barrier). */
const EGG_A: VesselDef = { ...corvette('eggen', 'korvetten Eggen', [[-650, 1400], [-650, 4600]], 6), group: 'sockeln', activeSonar: true };
const EGG_B: VesselDef = { ...corvette('banken', 'korvetten Banken', [[750, 4600], [750, 1400]], 6), group: 'sockeln', activeSonar: true };

export const SCENARIOS: Scenario[] = [
  {
    id: 'first-dive',
    title: 'Första dykningen',
    description: 'Guidad övning: klara bryggan, fyll huvudballasten, dyk till 30 m, trimma ubåten neutral och gå sedan till ytläge igen.',
    initial: {},
    objectives: [
      {
        text: 'Klara bryggan',
        check: (_t, c) => !c.bridgeManned,
      },
      {
        text: 'Öppna ventilerna till huvudballasten',
        check: (t) => mbt(t).every((x) => x.ventOpen || x.fill > 0.95),
      },
      {
        text: 'Gå framåt med minst 3 knop',
        check: (t) => t.u > 3 * KN,
      },
      {
        text: 'Dyk till 30 meter och håll djupet',
        check: (t) => Math.abs(t.depth - 30) < 2,
        holdSeconds: 10,
      },
      {
        text: 'Trimma ubåten neutral (±300 kg)',
        check: (t) => Math.abs(t.netBuoyancy / G) < 300 && t.compRemaining === 0,
        holdSeconds: 5,
      },
      {
        text: 'Gå till ytläge',
        // Air blown at depth expands and partly escapes on the way up, so some water remains when surfaced.
        check: (t) => t.depth < 3 && mbt(t).every((x) => x.fill < 0.4),
        holdSeconds: 5,
      },
    ],
    failure: (t) => (t.depth > 150 ? 'Ubåten gick för djupt (150 m).' : null),
  },
  {
    id: 'trim-drill',
    title: 'Trimövning',
    description: 'Håll 50 m (±2 m) i tre minuter utan djupautopilot. Ubåten är lite tung från start, så den behöver kompenseras.',
    initial: { depth: 50, speed: 4 * KN, tankFills: { comp: 0.54 } },
    locks: { depth: false, trim: false },
    objectives: [
      {
        text: 'Håll 50 m ±2 m i 3 minuter',
        check: (t) => Math.abs(t.depth - 50) < 2,
        holdSeconds: 180,
      },
    ],
    failure: (t) => (Math.abs(t.depth - 50) > 15 ? 'Djupet avvek mer än 15 m från 50 m.' : null),
  },
  {
    id: 'thermocline',
    title: 'Språngskiktet',
    description: 'Dyk genom språngskiktet till 90 m. Under det är vattnet tätare och ubåten blir lättare. Håll 90 m ±3 m i en minut.',
    initial: { depth: 25, speed: 6 * KN, designTrim: true },
    objectives: [
      {
        text: 'Dyk till 90 m',
        check: (t) => t.depth > 85,
      },
      {
        text: 'Håll 90 m ±3 m i en minut med neutral trim (±300 kg)',
        check: (t) => Math.abs(t.depth - 90) < 3 && Math.abs(t.netBuoyancy / G) < 300,
        holdSeconds: 60,
      },
    ],
    failure: (t) => (t.depth > 250 ? 'Ubåten gick för djupt (250 m).' : null),
  },
  {
    id: 'hover',
    title: 'Sväva',
    description: 'Gå från 30 m ned till 80 m, under språngskiktet, utan fart: propellern får inte gå över 1 knop. Bara kompenseringen ändrar djupet. Håll sedan 80 m i två minuter.',
    initial: { depth: 30, speed: 0, neutral: true },
    objectives: [
      {
        text: 'Gå ned till 80 m utan fart',
        check: (t) => t.depth > 78,
      },
      {
        text: 'Håll 80 m ±2 m i två minuter',
        check: (t) => Math.abs(t.depth - 80) < 2,
        holdSeconds: 120,
      },
    ],
    failure: (t) =>
      Math.abs(t.u) > HOVER_FAIL_SPEED ? 'Farten gick över 1 knop. Propellern hördes.' : t.depth > 150 ? 'Ubåten sjönk för djupt (150 m).' : null,
    timeLimit: 1800,
  },
  {
    id: 'astern',
    title: 'Back',
    description: `Ett nät spärrar vägen framåt. Backa ubåten 450 m till den gula bojen rakt akterut och stanna vid den, på 30 m djup. Ubåten får inte vända: kursen ska hållas inom ${ASTERN_MAX_YAW}° från 000.`,
    initial: { depth: 30, speed: 3 * KN, neutral: true, north: ASTERN_START[0], east: ASTERN_START[1], heading: 0 },
    waypoint: ASTERN_BUOY,
    objectives: [
      {
        text: 'Slå back',
        check: (t) => t.u < -0.5 * KN,
      },
      {
        text: 'Backa till den gula bojen',
        check: (t) => waypointInfo(t, ASTERN_BUOY).distance < 60,
      },
      {
        text: 'Stanna vid bojen',
        check: (t) => Math.abs(t.u) < 0.3 * KN && waypointInfo(t, ASTERN_BUOY).distance < 100,
        holdSeconds: 5,
      },
    ],
    failure: (t) => {
      const yaw = Math.abs(((((t.heading * 180) / Math.PI) % 360) + 540) % 360 - 180);
      if (yaw > ASTERN_MAX_YAW) return 'Ubåten vände. Uppdraget var att backa.';
      if (t.depth < 15 || t.depth > 60) return 'Djupet avvek för mycket (15–60 m).';
      return null;
    },
    timeLimit: 1200,
  },
  {
    id: 'sound-transit',
    title: 'Genom sundet',
    description: 'Ta ubåten i ytläge norrut genom ett smalt sund i skärgården till den gula bojen, utan att gå på grund. Håll koll på ekolodet (Under köl).',
    initial: { east: 2560, heading: (20 * Math.PI) / 180 },
    waypoint: [1200, 2848],
    objectives: [
      {
        text: 'Gå genom sundet till den gula bojen',
        check: (t) => waypointInfo(t, [1200, 2848]).distance < 60,
      },
    ],
  },
  {
    id: 'emergency-blow',
    title: 'Nödblåsning',
    description: 'Kompenseringstanken har vattenfyllts på 200 m och ubåten är flera ton för tung. Ta dig till ytan innan den når krossdjupet 300 m.',
    initial: { depth: 200, speed: 4 * KN, tankFills: { comp: 1 }, east: -3000 },
    locks: { safetyNet: false },
    objectives: [
      {
        text: 'Nå ytan',
        check: (t) => t.depth < 10,
      },
    ],
    failure: (t) => (t.depth > 300 ? 'Ubåten nådde krossdjupet 300 m.' : null),
    timeLimit: 600,
  },
  {
    id: 'periscope-recce',
    title: 'Periskopspaning',
    description: `Gå på periskopdjup, hissa periskopet och ta ut bäringen till Västra fyren (vitt torn med rött band på en ö i nordost). Periskopet får inte synas mer än ${PERISCOPE_EXPOSURE_LIMIT} s i taget.`,
    initial: { depth: 13, speed: 4 * KN, neutral: true, east: 700, heading: 60 * DEG },
    objectives: [
      {
        text: 'Hissa periskopet',
        check: (t) => t.periscope > 0.99 && t.periscopeHeadDepth < 0,
      },
      {
        text: 'Rapportera bäringen till Västra fyren (±3°)',
        check: (_t, c) => {
          const r = c.lastBearing;
          return r !== null && r.lookout && bearingDiff(r.bearing, bearingTo(r.position, WEST_LIGHT)) <= 3;
        },
      },
      {
        text: 'Sänk periskopet',
        check: (t) => t.periscope < 0.01,
      },
    ],
    failure: (t, c) =>
      c.periscopeExposure > PERISCOPE_EXPOSURE_LIMIT
        ? `Periskopet var uppe i mer än ${PERISCOPE_EXPOSURE_LIMIT} s och upptäcktes.`
        : t.depth < 8
          ? 'Ubåten bröt ytan och upptäcktes.'
          : null,
    timeLimit: 900,
  },
  {
    id: 'ship-recce',
    title: 'Fartyget',
    description: `Ett lastfartyg, M/S Skagerack, går norrut väster om dig. Hissa periskopet, ta ut bäringen till fartyget (±3°) och sänk periskopet igen. Periskopet får inte synas mer än ${PERISCOPE_EXPOSURE_LIMIT} s i taget, och kom inte i vägen för fartyget.`,
    initial: { depth: 13, speed: 3 * KN, neutral: true, east: -800, heading: 330 * DEG },
    traffic: [RECCE_SHIP],
    objectives: [
      {
        text: 'Hissa periskopet',
        check: (t) => t.periscope > 0.99 && t.periscopeHeadDepth < 0,
      },
      {
        text: 'Rapportera bäringen till M/S Skagerack (±3°)',
        check: (_t, c) => {
          const r = c.lastBearing;
          const truth = r?.contacts[RECCE_SHIP.id];
          return r !== null && r.lookout && truth !== undefined && bearingDiff(r.bearing, truth) <= 3;
        },
      },
      {
        text: 'Sänk periskopet',
        check: (t) => t.periscope < 0.01,
      },
    ],
    failure: (t, c) =>
      c.periscopeExposure > PERISCOPE_EXPOSURE_LIMIT
        ? `Periskopet var uppe i mer än ${PERISCOPE_EXPOSURE_LIMIT} s och upptäcktes.`
        : t.depth < 8
          ? 'Ubåten bröt ytan och upptäcktes.'
          : null,
    timeLimit: 900,
  },
  {
    id: 'halocline',
    title: 'Saltsprånget',
    description: 'Östersjön: dyk genom saltsprångskiktet (60–80 m) till 90 m. Under det är vattnet saltare och tätare, och ubåten blir flera ton lättare. Håll 90 m ±3 m i en minut med högst 1 ton över- eller undervikt.',
    initial: { area: 'baltic', depth: 40, speed: 5 * KN, neutral: true, east: -2500 },
    objectives: [
      {
        text: 'Dyk till 90 m',
        check: (t) => t.depth > 86,
      },
      {
        text: 'Håll 90 m ±3 m i en minut, neutral inom ±1 000 kg',
        check: (t) => Math.abs(t.depth - 90) < 3 && Math.abs(t.netBuoyancy / G) < 1000,
        holdSeconds: 60,
      },
    ],
    failure: (t) => (t.depth > 110 ? 'Ubåten gick för djupt (110 m).' : null),
    timeLimit: 2400,
  },
  {
    id: 'fjord-entry',
    title: 'Fjordinloppet',
    description: 'Ta dig i undervattensläge in i fjorden till den gula bojen, 2,4 km innanför mynningen. Tröskeln vid mynningen är bara 55 m djup och fjorden slingrar sig mellan branta berg. Gå inte grundare än 15 m.',
    initial: { area: 'fjord', depth: 30, speed: 5 * KN, neutral: true, north: -2200, east: 0 },
    waypoint: FJORD_BUOY,
    objectives: [
      {
        text: 'Passera tröskeln',
        check: (t) => t.position[0] > 350,
      },
      {
        text: 'Gå till den gula bojen',
        check: (t) => waypointInfo(t, FJORD_BUOY).distance < 120,
      },
    ],
    failure: (t) => (t.depth < 15 ? 'Ubåten gick grundare än 15 m och kunde ses från land.' : null),
    timeLimit: 2400,
  },
  {
    id: 'night-light',
    title: 'Fyrljuset',
    description: 'Det är natt. Gå i ytläge österut mot Södra fyren (rött sken var 3:e sekund) tills du är 700 m från den. Se ut från bryggan (V) och håll koll på "Under köl".',
    conditions: 'night',
    initial: { north: -800, east: 0, heading: 90 * DEG },
    objectives: [
      {
        text: 'Gå mot Södra fyren tills den är 700 m bort',
        check: (t) => waypointInfo(t, SOUTH_LIGHT).distance < 700,
      },
    ],
    timeLimit: 1500,
  },
  {
    id: 'snorkel',
    title: 'Snorkling',
    description: 'Batteriet är nere på 25 %. Gå upp på periskopdjup, hissa snorkeln och ladda batteriet till 28 % med dieslarna. Bryt inte ytan.',
    initial: { area: 'atlantic', depth: 40, speed: 4 * KN, neutral: true, battery: 0.25 },
    objectives: [
      {
        text: 'Gå upp på periskopdjup',
        check: (t) => t.depth < 15,
        holdSeconds: 10,
      },
      {
        text: 'Hissa snorkeln',
        check: (t) => t.snorkel > 0.99 && t.inductionAir,
      },
      {
        text: 'Ladda batteriet till 28 %',
        check: (t) => t.battery >= 0.28,
      },
      {
        text: 'Sänk snorkeln',
        check: (t) => t.snorkel < 0.01,
      },
    ],
    failure: (t) => (t.depth < 8 ? 'Ubåten bröt ytan och upptäcktes.' : t.battery <= 0 ? 'Batteriet tog slut.' : null),
    timeLimit: 2400,
  },
  {
    id: 'stealth',
    title: 'Smyg förbi',
    description: 'En korvett patrullerar fram och tillbaka mellan dig och bojen 2,5 km norrut. Lyssna efter den på sonaren, gå under språngskiktet och smyg fram till bojen utan att bli upptäckt.',
    initial: { area: 'atlantic', depth: 40, speed: 4 * KN, neutral: true, heading: 0 },
    waypoint: STEALTH_BUOY,
    traffic: [STEALTH_CORVETTE],
    failWhenDetected: true,
    objectives: [
      {
        text: 'Hör korvetten på sonaren',
        check: (_t, c) => c.sonar.contacts.some((x) => x.vesselId === STEALTH_CORVETTE.id && x.classified !== null),
      },
      {
        text: 'Gå djupare än 150 m, under språngskiktet',
        check: (t) => t.depth > 150,
      },
      {
        text: 'Nå bojen 2,5 km norrut utan att bli upptäckt',
        check: (t) => waypointInfo(t, STEALTH_BUOY).distance < 120,
      },
    ],
    failure: (t) => (t.depth > 300 ? 'Ubåten nådde krossdjupet 300 m.' : null),
    timeLimit: 2700,
  },
  {
    id: 'practice-shot',
    title: 'Övningsskott',
    description: 'Ett målfartyg går österut 3 km norr om dig i 6 knop. Hissa periskopet, markera målet, mät avståndet och skjut. Följ torpeden på sjökortet.',
    initial: { area: 'atlantic', depth: 13, speed: 3 * KN, neutral: true, heading: 0 },
    traffic: [PRACTICE_TARGET],
    objectives: [
      {
        text: 'Hissa periskopet',
        check: (t) => lookoutUp(t),
      },
      {
        text: 'Markera målfartyget',
        check: (_t, c) => c.fire.target?.vesselId === PRACTICE_TARGET.id,
      },
      {
        text: 'Få en lösning som är ok eller bra',
        check: (_t, c) => c.fire.target?.solution?.quality === 'ok' || c.fire.target?.solution?.quality === 'bra',
      },
      {
        text: 'Skjut och träffa',
        check: (_t, c) => sunk(c, PRACTICE_TARGET.id),
      },
    ],
    timeLimit: 1500,
  },
  {
    id: 'night-attack',
    title: 'Nattanfall',
    description: 'Natt. Ett lastfartyg går västerut 6 km norr om dig, och periskopet ser inget i mörkret. Gör sonarkontakten till mål, byt kurs så att eldledningen får avstånd ur bäringarna, och skjut.',
    conditions: 'night',
    initial: { area: 'atlantic', depth: 40, speed: 5 * KN, neutral: true, heading: 0 },
    traffic: [NIGHT_TARGET],
    objectives: [
      {
        text: 'Gör sonarkontakten till mål',
        check: (_t, c) => c.fire.target?.vesselId === NIGHT_TARGET.id,
      },
      {
        text: 'Få en lösning ur två ben',
        // Bearings alone over one change of course give the range only roughly ("ok" was an artefact of a fit
        // that put the target on the boat's own track); two legs are the analysis done.
        check: (_t, c) => {
          const t = c.fire.target;
          return !!t?.solution && (t.solution.quality !== 'dålig' || twoLegs(t.obs));
        },
      },
      {
        text: 'Skjut och träffa',
        check: (_t, c) => sunk(c, NIGHT_TARGET.id),
      },
    ],
    failure: (t) => (t.depth < 8 ? 'Ubåten bröt ytan och syntes i fartygets lanternor.' : null),
    timeLimit: 2700,
  },
  {
    id: 'hunted',
    title: 'Jagad',
    description: 'En korvett har hittat dig och går in för anfall. Gå djupt, under språngskiktet, sakta och tyst, och byt kurs. Klara dig tills den tappar dig eller har slut på sjunkbomber. Sjunkbomberna ger läckor.',
    initial: { area: 'atlantic', depth: 60, speed: 4 * KN, neutral: true, heading: 180 * DEG },
    traffic: [HUNTER],
    setup: (c) => {
      c.sonar.alert(HUNTER.id, 0.9);
    },
    objectives: [
      {
        text: 'Gå djupare än 150 m',
        check: (t) => t.depth > 150,
      },
      {
        text: 'Skaka av dig korvetten',
        check: (_t, c) => shaken(c, HUNTER.id),
        holdSeconds: 30,
      },
    ],
    failure: (t) => (t.depth > 300 ? 'Ubåten nådde krossdjupet 300 m.' : null),
    timeLimit: 1500,
  },
  {
    id: 'convoy',
    title: 'Konvojen',
    description: 'Ett lastfartyg går västerut med en korvett som eskort på havssidan. Sänk lastfartyget och ta dig undan eskorten.',
    initial: { area: 'atlantic', depth: 13, speed: 3 * KN, neutral: true, heading: 0 },
    traffic: [CONVOY_SHIP, ESCORT],
    objectives: [
      {
        text: 'Sänk M/S Lastaren',
        check: (_t, c) => sunk(c, CONVOY_SHIP.id),
      },
      {
        text: 'Ta dig undan eskorten',
        check: (_t, c) => shaken(c, ESCORT.id),
        holdSeconds: 30,
      },
    ],
    failure: (t) => (t.depth > 300 ? 'Ubåten nådde krossdjupet 300 m.' : t.depth < 8 ? 'Ubåten bröt ytan och upptäcktes av eskorten.' : null),
    timeLimit: 3000,
  },
  {
    id: 'decoy',
    title: 'Lockmålet',
    description: 'En korvett jagar dig på nära håll. Skjut ut ett lockmål som låter som ubåten, smyg åt ett annat håll och låt korvetten jaga lockmålet tills den tappar bort dig.',
    initial: { area: 'atlantic', depth: 60, speed: 4 * KN, neutral: true, heading: 180 * DEG },
    traffic: [DECOY_HUNTER],
    setup: (c) => {
      c.sonar.alert(DECOY_HUNTER.id, 0.9);
    },
    objectives: [
      {
        text: 'Skjut ut ett lockmål',
        check: (_t, c) => c.decoys < WEAPONS.decoy.count,
      },
      {
        text: 'Skaka av dig korvetten',
        check: (_t, c) => shaken(c, DECOY_HUNTER.id),
        holdSeconds: 30,
      },
    ],
    failure: (t) => (t.depth > 300 ? 'Ubåten nådde krossdjupet 300 m.' : null),
    timeLimit: 1800,
  },
  {
    id: 'hunting-pair',
    title: 'Två jägare',
    description: 'Två korvetter jagar tillsammans: den ena lyssnar och pingar på avstånd medan den andra går in och fäller. Gå djupt under skiktet, sakta och tyst, och skaka av dig båda.',
    initial: { area: 'atlantic', depth: 60, speed: 4 * KN, neutral: true, heading: 180 * DEG },
    traffic: [PAIR_A, PAIR_B],
    setup: (c) => {
      c.sonar.alert(PAIR_A.id, 0.9);
    },
    objectives: [
      {
        text: 'Gå djupare än 150 m',
        check: (t) => t.depth > 150,
      },
      {
        text: 'Skaka av dig båda korvetterna',
        check: (_t, c) => shaken(c, PAIR_A.id) && shaken(c, PAIR_B.id),
        holdSeconds: 30,
      },
    ],
    failure: (t) => (t.depth > 300 ? 'Ubåten nådde krossdjupet 300 m.' : null),
    timeLimit: 2400,
  },
  {
    id: 'big-convoy',
    title: 'Stora konvojen',
    description: 'Tre lastfartyg går västerut med en korvett som eskort. Sänk ett av dem. Då ökar de andra farten och sicksackar, och eskorten söker efter dig. Ta dig undan.',
    initial: { area: 'atlantic', depth: 13, speed: 3 * KN, neutral: true, heading: 0 },
    traffic: [...BIG_CONVOY, BIG_ESCORT],
    objectives: [
      {
        text: 'Sänk ett lastfartyg',
        check: (_t, c) => BIG_CONVOY.some((v) => sunk(c, v.id)),
      },
      {
        text: 'Ta dig undan eskorten',
        check: (_t, c) => shaken(c, BIG_ESCORT.id),
        holdSeconds: 30,
      },
    ],
    failure: (t) => (t.depth > 300 ? 'Ubåten nådde krossdjupet 300 m.' : t.depth < 8 ? 'Ubåten bröt ytan och upptäcktes av eskorten.' : null),
    timeLimit: 3000,
  },
  {
    id: 'radar-fog',
    title: 'Radar i dimman',
    description: 'Tät dimma på periskopdjup. Ett lastfartyg hörs norrut, men periskopet ser inget. Hissa radarmasten, ta en bra lösning med några svep och gå tyst igen. En korvett patrullerar i öster, och dess radarvarnare hör din radar långt bort.',
    conditions: 'fog',
    initial: { area: 'atlantic', depth: 13, speed: 4 * KN, neutral: true, heading: 0 },
    traffic: [FOG_SHIP, FOG_CORVETTE],
    failWhenDetected: true,
    objectives: [
      {
        text: 'Gör lastfartyget till mål',
        check: (_t, c) => c.fire.target?.vesselId === FOG_SHIP.id,
      },
      {
        text: 'Hissa radarmasten',
        check: (t) => t.radar > 0.99 && t.radarHeadDepth < 0,
      },
      {
        text: 'Få en bra lösning med radarn',
        check: (_t, c) => good(c, FOG_SHIP.id),
      },
      {
        text: 'Radarn tyst och masten nere',
        check: (t, c) => !c.radar.transmitting && t.radar < 0.01,
        holdSeconds: 5,
      },
    ],
    timeLimit: 900,
  },
  {
    id: 'echo',
    title: 'Ekot',
    description: 'Ett lastfartyg går österut några kilometer norr om dig. Sonaren ger bara bäringen. En enda ping ger avståndet direkt, men hörs långt: en korvett i söder kommer. Sänk fartyget och ta dig undan.',
    initial: { area: 'atlantic', depth: 40, speed: 4 * KN, neutral: true, heading: 0 },
    traffic: [ECHO_SHIP, ECHO_CORVETTE],
    objectives: [
      {
        text: 'Gör sonarkontakten till mål',
        check: (_t, c) => c.fire.target?.vesselId === ECHO_SHIP.id,
      },
      {
        text: 'Pinga och få en bra lösning',
        // Sunk from bearings alone (or with a ping on the way) is past this too: it stayed here for good.
        check: (_t, c) => (c.sonar.pings > 0 && good(c, ECHO_SHIP.id)) || sunk(c, ECHO_SHIP.id),
      },
      {
        text: 'Skjut och träffa',
        check: (_t, c) => sunk(c, ECHO_SHIP.id),
      },
      {
        text: 'Ta dig undan korvetten',
        check: (_t, c) => shaken(c, ECHO_CORVETTE.id),
        holdSeconds: 30,
      },
    ],
    failure: (t) => (t.depth > 300 ? 'Ubåten nådde krossdjupet 300 m.' : null),
    timeLimit: 3000,
  },
  {
    id: 'tubes',
    title: 'Klart för eld',
    description: 'Två målfartyg går österut 3,5 km norr om dig. Här sköter du torpedrummet själv: gör tuberna klara, sänk båda fartygen och ladda om.',
    initial: { area: 'atlantic', depth: 13, speed: 3 * KN, neutral: true, heading: 0 },
    traffic: [FIRE_SHIP_A, FIRE_SHIP_B],
    locks: { torpedoRoom: false },
    objectives: [
      {
        text: 'Gör två tuber klara',
        check: (_t, c) => ready(c) >= 2,
      },
      {
        text: 'Sänk målfartyget Alfa',
        check: (_t, c) => sunk(c, FIRE_SHIP_A.id),
      },
      {
        text: 'Sänk målfartyget Bravo',
        check: (_t, c) => sunk(c, FIRE_SHIP_B.id),
      },
      {
        text: 'Ladda om två tuber',
        check: (_t, c) => c.fire.tubes.every((x) => x.loaded),
      },
    ],
    timeLimit: 1800,
  },
  {
    id: 'leak',
    title: 'Läckan',
    description: 'En rörgenomföring i maskinrummet har sprungit läck på 120 m. Gå upp så att länspumpen hinner med, medan besättningen tätar läckan, och länsa maskinrummet. Krossdjupet är 300 m.',
    initial: { area: 'atlantic', depth: 120, speed: 4 * KN, neutral: true, leaks: { engine: 2e-3 } },
    objectives: [
      {
        text: 'Gå upp till 40 m eller grundare',
        check: (t) => t.depth <= 40,
      },
      {
        text: 'Läckan tätad och maskinrummet länsat',
        check: (t) => t.compartments.every((x) => x.water === 0 && x.holeArea === 0),
      },
    ],
    failure: (t) => (t.depth > 300 ? 'Ubåten nådde krossdjupet 300 m.' : null),
    timeLimit: 1500,
  },
  {
    id: 'canyon',
    title: 'Kanjonen',
    description:
      'Eggakanten. Två korvetter patrullerar sockeln på var sin sida om en undervattenskanjon och pingar med aktiv sonar. Ta dig genom kanjonen upp till bojen vid dess början. Nere i kanjonen skyddar väggarna dig mot pingarna; uppe på sockeln hittar de dig.',
    initial: { area: 'shelf', north: canyonCentre(CANYON_START)[0], east: CANYON_START, depth: 220, speed: 5 * KN, neutral: true, heading: 90 * DEG },
    traffic: [EGG_A, EGG_B],
    waypoint: canyonCentre(CANYON_END),
    failWhenDetected: true,
    objectives: [
      {
        text: 'Följ kanjonen till bojen',
        check: (t) => waypointInfo(t, canyonCentre(CANYON_END)).distance < 250,
      },
    ],
    failure: (t) => (t.depth > 300 ? 'Ubåten nådde krossdjupet 300 m.' : t.depth < 8 ? 'Ubåten bröt ytan och syntes från korvetterna.' : null),
    timeLimit: 2400,
  },
];

export type ScenarioStatus = 'running' | 'completed' | 'failed';

export interface ScenarioProgress {
  status: ScenarioStatus;
  index: number;
  total: number;
  objective: Objective | null;
  /** Seconds held so far for the current objective. */
  held: number;
  message: string | null;
  /** Sim time when completed or failed. */
  endTime: number | null;
}

/** Evaluates a scenario against the controller's simulation. Call `update()` after each sim step. */
export class ScenarioRunner {
  private index = 0;
  private heldSince: number | null = null;
  status: ScenarioStatus = 'running';
  message: string | null = null;
  endTime: number | null = null;
  private listeners: ((p: ScenarioProgress) => void)[] = [];

  constructor(
    readonly scenario: Scenario,
    readonly ctrl: Controller,
  ) {
    ctrl.options.locks = { ...scenario.locks };
    ctrl.world.night = scenario.conditions === 'night' || scenario.conditions === 'dusk';
    ctrl.world.add(scenario.traffic ?? []);
    ctrl.world.addLife(scenario.life ?? []);
    ctrl.world.addAircraft(scenario.aircraft ?? []);
    ctrl.lookouts.stations = scenario.stations ?? [];
    scenario.setup?.(ctrl);
  }

  onChange(fn: (p: ScenarioProgress) => void): void {
    this.listeners.push(fn);
  }

  get progress(): ScenarioProgress {
    const t = this.ctrl.sim.t;
    return {
      status: this.status,
      index: this.index,
      total: this.scenario.objectives.length,
      objective: this.scenario.objectives[this.index] ?? null,
      held: this.heldSince === null ? 0 : t - this.heldSince,
      message: this.message,
      endTime: this.endTime,
    };
  }

  private tick = 0;

  /** Call after every simulation step; objectives are evaluated every 10th step (10 Hz). */
  update(): void {
    if (this.status !== 'running') return;
    if (this.tick++ % 10 !== 0) return;
    const c = this.ctrl;
    const t = c.sim.telemetry();
    const fail =
      (t.grounded ? 'Ubåten gick på grund.' : null) ??
      (c.collidedWith ? `Ubåten kolliderade med ${c.collidedWith}.` : null) ??
      (t.hullCollapsed ? 'Skrovet kollapsade under krossdjupet.' : null) ??
      (c.sim.systems.flooding.water > FLOODED ? 'Ubåten tog in för mycket vatten och sjönk.' : null) ??
      (this.scenario.failWhenDetected && c.sonar.detectedBy ? `Ubåten upptäcktes av ${c.sonar.detectedBy}.` : null) ??
      this.scenario.failure?.(t, c) ??
      null;
    if (fail || (this.scenario.timeLimit !== undefined && t.t > this.scenario.timeLimit)) {
      this.finish('failed', fail ?? 'Tiden tog slut.');
      return;
    }
    const obj = this.scenario.objectives[this.index];
    if (!obj) return;
    if (obj.check(t, c)) {
      if (this.heldSince === null) this.heldSince = t.t;
      if (t.t - this.heldSince >= (obj.holdSeconds ?? 0)) {
        this.index++;
        this.heldSince = null;
        if (this.index >= this.scenario.objectives.length) {
          this.finish('completed', `Uppdraget slutfört på ${Math.round(t.t)} s.`);
          return;
        }
        c.addLog(`Mål klart: ${obj.text}`, 'info');
        this.emit();
      }
    } else if (this.heldSince !== null) {
      this.heldSince = null;
    }
  }

  private finish(status: ScenarioStatus, message: string): void {
    this.status = status;
    this.message = message;
    this.endTime = this.ctrl.sim.t;
    this.ctrl.addLog(message, status === 'completed' ? 'info' : 'error');
    this.emit();
  }

  private emit(): void {
    const p = this.progress;
    for (const fn of this.listeners) fn(p);
  }
}

/** "Du sköter djup och trim själv. Utan skyddsnät": the locks, as the game logged them. */
function lockText(locks: CrewLocks | undefined): string[] {
  if (!locks) return [];
  const self = CREW_SYSTEMS.filter((x) => x !== 'safetyNet' && locks[x] === false).map((x) => CREW_NAME[x].toLowerCase());
  const parts: string[] = [];
  if (self.length) parts.push(`Du sköter ${self.join(' och ')} själv`);
  if (locks.safetyNet === false) parts.push('Utan skyddsnät');
  return parts;
}

/**
 * A scenario set up as the game did when it had them (the log lines too, so
 * the determinism test's hashes stay the same): the simulation, the
 * controller with the scenario's world, the crew on everything not locked.
 */
export class ScenarioSession {
  readonly sim: Simulation;
  readonly ctrl: Controller;
  readonly runner: ScenarioRunner;

  constructor(readonly scenario: Scenario) {
    this.sim = new Simulation(scenario.initial);
    this.ctrl = new Controller(this.sim);
    this.ctrl.world.night = scenario.conditions === 'night' || scenario.conditions === 'dusk';
    this.runner = new ScenarioRunner(scenario, this.ctrl);
    this.ctrl.crewTakesAll();
    this.ctrl.addLog(`Scenario: ${scenario.title}. ${scenario.description}`, 'info');
    const self = lockText(scenario.locks);
    if (self.length) this.ctrl.addLog(`${self.join('. ')}.`, 'info');
  }

  step(): void {
    this.ctrl.step();
    this.runner.update();
  }
}
