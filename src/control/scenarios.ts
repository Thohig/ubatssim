/**
 * Scenarios are data: a starting condition, a list of objectives that must
 * be met in order (each optionally held for some time) and failure
 * conditions. The runner checks them against simulation telemetry, so it is
 * deterministic and testable without any UI.
 */
import { ENVIRONMENT } from '../sim/config/environment';
import { WEAPONS } from '../sim/config/weapons';
import type { InitialConditions, Telemetry } from '../sim/simulation';
import type { Controller } from './controller';
import { CREW_NAME, CREW_SYSTEMS, PERISCOPE_DEPTH, type CrewLocks, type CrewSystem } from './crew';

const PERISCOPE_DEPTH_TEXT = `${PERISCOPE_DEPTH} m`;
import { AREA_INFO, corvette, freighter, type ConditionsId } from './areas';
import type { VesselDef } from '../sim/vessel';

const G = ENVIRONMENT.g;
const KN = 1852 / 3600;

export type Difficulty = 'lätt' | 'medel' | 'svår';

export interface Objective {
  /** Short goal shown in the banner. */
  text: string;
  /** What to do, with the screen controls. */
  hint: string;
  /**
   * The system the objective is about. While the crew handles it, `hintCrew`
   * is shown instead of `hint` (which tells a player handling it what to do).
   */
  system?: CrewSystem;
  hintCrew?: string;
  check: (t: Telemetry, c: Controller) => boolean;
  /** Seconds the condition must hold continuously. */
  holdSeconds?: number;
}

/** What a scenario practises: the tabs of the scenario list, in this order. */
export type ScenarioGroup = 'basics' | 'water' | 'navigation' | 'recce' | 'attack';

export const SCENARIO_GROUPS: readonly { id: ScenarioGroup; title: string; description: string }[] = [
  { id: 'basics', title: 'Grunderna', description: 'Lär känna båten: dyka, backa, trimma, sväva och snorkla.' },
  { id: 'water', title: 'Vatten och nöd', description: 'Språngskikten, salthalten och när något går fel.' },
  { id: 'navigation', title: 'Navigering', description: 'Sund, trösklar och fyrar: terrängen under och omkring dig.' },
  { id: 'recce', title: 'Spaning', description: 'Se och mät utan att själv synas eller höras.' },
  { id: 'attack', title: 'Anfall', description: 'Torpeder, eldledning och korvetter som jagar.' },
];

/** Difficulties in the order the list shows them. */
export const DIFFICULTY_ORDER: readonly Difficulty[] = ['lätt', 'medel', 'svår'];

/** A group's scenarios, easiest first (the order of SCENARIOS within a difficulty). */
export function scenariosIn(group: ScenarioGroup): Scenario[] {
  return SCENARIOS.filter((s) => s.group === group).sort((a, b) => DIFFICULTY_ORDER.indexOf(a.difficulty) - DIFFICULTY_ORDER.indexOf(b.difficulty));
}

export interface Scenario {
  id: string;
  title: string;
  description: string;
  difficulty: Difficulty;
  /** The tab it is listed under (SCENARIO_GROUPS). */
  group: ScenarioGroup;
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

/** "Du sköter djup och trim själv · Utan skyddsnät": the locks, for the scenario list. */
export function lockText(locks: CrewLocks | undefined): string[] {
  if (!locks) return [];
  const self = CREW_SYSTEMS.filter((x) => x !== 'safetyNet' && locks[x] === false).map((x) => CREW_NAME[x].toLowerCase());
  const parts: string[] = [];
  if (self.length) parts.push(`Du sköter ${self.join(' och ')} själv`);
  if (locks.safetyNet === false) parts.push('Utan skyddsnät');
  return parts;
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
/** What a player handling the torpedo room must do before firing. */
const TUBES_HINT = 'Tuberna måste vara klara: tryck på en tub i eldledningspanelen (eller Klar i panelen Torped) och vänta tills den lyser grönt. ';
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

export const SCENARIOS: Scenario[] = [
  {
    id: 'first-dive',
    title: 'Första dykningen',
    description: 'Guidad övning: klara bryggan, fyll huvudballasten, dyk till 30 m, trimma ubåten neutral och gå sedan till ytläge igen.',
    difficulty: 'lätt',
    group: 'basics',
    initial: {},
    objectives: [
      {
        text: 'Klara bryggan',
        system: 'ballast',
        hint: 'Öppna panelen Ballast och tryck Klart bryggan. Ingen får vara kvar på bryggan när ubåten dyker.',
        hintCrew: 'Tryck Dyk (eller D). Besättningen utrymmer bryggan.',
        check: (_t, c) => !c.bridgeManned,
      },
      {
        text: 'Öppna ventilerna till huvudballasten',
        system: 'ballast',
        hint: 'Tryck Fyll vid Båda i panelen Ballast. Stäng ventilerna först när båda visar 100 %: luft som blir kvar håller ubåten i ytan.',
        hintCrew: 'Tryck Dyk (eller D). Ventilerna stängs när tankarna är fulla.',
        check: (t) => mbt(t).every((x) => x.ventOpen || x.fill > 0.95),
      },
      {
        text: 'Gå framåt med minst 3 knop',
        system: 'speed',
        hint: 'Öka varvet i panelen Fart, eller tryck Sakta fram på telegrafen. Djuprodren behöver fart för att verka.',
        hintCrew: 'Tryck Sakta fram på telegrafen (eller Shift + ↑). Djuprodren behöver fart för att verka.',
        check: (t) => t.u > 3 * KN,
      },
      {
        text: 'Dyk till 30 meter och håll djupet',
        system: 'depth',
        hint: 'Lägg djuprodret 10° ned (▼ eller ↓ två gånger) och ta upp det före 30 m. Eller växla djupet till Auto.',
        hintCrew: 'Tryck eller dra på djupskalan till 30 m (eller ↓ tills djupmålet visar 30 m).',
        check: (t) => Math.abs(t.depth - 30) < 2,
        holdSeconds: 10,
      },
      {
        text: 'Trimma ubåten neutral (±300 kg)',
        system: 'trim',
        hint: 'Öppna panelen Trim. Är ubåten tung (minus), tryck Ut för att pumpa ut vatten. 1 liter ≈ 1 kg.',
        hintCrew: 'Trimassistenten pumpar ut vatten tills ubåten är neutral. Följ "Trim" och loggen.',
        check: (t) => Math.abs(t.netBuoyancy / G) < 300 && t.compRemaining === 0,
        holdSeconds: 5,
      },
      {
        text: 'Gå till ytläge',
        system: 'ballast',
        hint: 'Tryck Blås vid Båda i panelen Ballast och sätt djupet till 0 m. Lite vatten blir kvar i tankarna när luften trycks ihop i ytläget.',
        hintCrew: 'Tryck Yta (eller S). Djupmålet blir ytan, ubåten stiger på djuprodren och huvudballasten blåses på 15 m.',
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
    difficulty: 'medel',
    group: 'basics',
    initial: { depth: 50, speed: 4 * KN, tankFills: { comp: 0.54 } },
    locks: { depth: false, trim: false },
    objectives: [
      {
        text: 'Håll 50 m ±2 m i 3 minuter',
        hint: 'Styr djuprodret med ▲ och ▼ (↑/↓) och pumpa ut vatten i panelen Trim för att bli neutral.',
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
    difficulty: 'medel',
    group: 'water',
    initial: { depth: 25, speed: 6 * KN, designTrim: true },
    objectives: [
      {
        text: 'Dyk till 90 m',
        system: 'depth',
        hint: 'Lägg djuprodret ned och ta upp det före 90 m. Eller växla djupet till Auto.',
        hintCrew: 'Tryck eller dra på djupskalan till 90 m (eller ↓ tills djupmålet visar 90 m).',
        check: (t) => t.depth > 85,
      },
      {
        text: 'Håll 90 m ±3 m i en minut med neutral trim (±300 kg)',
        system: 'trim',
        hint: 'Ubåten är lätt här. Tryck In i panelen Trim för att ta in vatten (1 liter ≈ 1 kg).',
        hintCrew: 'Ubåten blir lätt under språngskiktet. Trimassistenten tar in vatten, följ "Trim" och loggen.',
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
    difficulty: 'medel',
    group: 'basics',
    initial: { depth: 30, speed: 0, neutral: true },
    objectives: [
      {
        text: 'Gå ned till 80 m utan fart',
        system: 'trim',
        hint: 'Ta in vatten med In 500 i panelen Trim (1 liter ≈ 1 kg). 500 kg tung sjunker ubåten ungefär 4 m i minuten. Pumpa ut i god tid före 80 m: pumpen tar 6 liter i sekunden.',
        hintCrew: 'Tryck på djupskalan vid 80 m. Utan fart svävar besättningen ned med kompenseringen. Det tar några minuter.',
        check: (t) => t.depth > 78,
      },
      {
        text: 'Håll 80 m ±2 m i två minuter',
        system: 'trim',
        hint: 'Gör ubåten neutral: sjunker den, Ut 100. Stiger den, In 100. Flytkraft i panelen Trim visar hur tung den är.',
        hintCrew: 'Besättningen håller djupet med små pumpningar. Följ loggen.',
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
    difficulty: 'lätt',
    group: 'basics',
    initial: { depth: 30, speed: 3 * KN, neutral: true, north: ASTERN_START[0], east: ASTERN_START[1], heading: 0 },
    waypoint: ASTERN_BUOY,
    objectives: [
      {
        text: 'Slå back',
        system: 'speed',
        hint: 'Sänk varvet förbi noll i panelen Fart, eller tryck Halv back på telegrafen.',
        hintCrew: 'Tryck Halv back på telegrafen (eller Shift + ↓ tre gånger).',
        check: (t) => t.u < -0.5 * KN,
      },
      {
        text: 'Backa till den gula bojen',
        system: 'heading',
        hint: 'Rodret verkar omvänt när ubåten backar: roder styrbord vrider fören åt babord. Håll kursen kring 000.',
        hintCrew: 'Rorsmannen håller kursen, också när ubåten backar. Följ avståndet till bojen.',
        check: (t) => waypointInfo(t, ASTERN_BUOY).distance < 60,
      },
      {
        text: 'Stanna vid bojen',
        system: 'speed',
        hint: 'Tryck Stopp på telegrafen, eller ge varv framåt i panelen Fart tills farten är noll.',
        hintCrew: 'Tryck Stopp på telegrafen (eller Shift + ↑ två gånger). Propellern bromsar ubåten.',
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
    difficulty: 'medel',
    group: 'navigation',
    initial: { east: 2560, heading: (20 * Math.PI) / 180 },
    waypoint: [1200, 2848],
    objectives: [
      {
        text: 'Gå genom sundet till den gula bojen',
        system: 'heading',
        hint: 'Tryck Sakta fram och styr med rodret (◀ BB och SB ▶). Bojen är den gula pricken. Sundet slingrar sig mot nordost.',
        hintCrew: 'Tryck Sakta fram och styr med kompassen eller ◀/▶. Bojen är den gula pricken på kompassen. Sundet slingrar sig mot nordost.',
        check: (t) => waypointInfo(t, [1200, 2848]).distance < 60,
      },
    ],
  },
  {
    id: 'emergency-blow',
    title: 'Nödblåsning',
    description: 'Kompenseringstanken har vattenfyllts på 200 m och ubåten är flera ton för tung. Ta dig till ytan innan den når krossdjupet 300 m.',
    difficulty: 'svår',
    group: 'water',
    initial: { depth: 200, speed: 4 * KN, tankFills: { comp: 1 }, east: -3000 },
    locks: { safetyNet: false },
    objectives: [
      {
        text: 'Nå ytan',
        system: 'ballast',
        hint: 'Tryck Nödblåsning i panelen Ballast (eller Shift + S) och styr uppåt.',
        hintCrew: 'Ubåten är för tung för att stiga på djuprodren. Tryck Nödblåsning i panelen Ballast (eller Shift + S). Här finns inget skyddsnät.',
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
    difficulty: 'medel',
    group: 'recce',
    initial: { depth: 13, speed: 4 * KN, neutral: true, east: 700, heading: 60 * DEG },
    objectives: [
      {
        text: 'Hissa periskopet',
        hint: 'Tryck periskopknappen (eller P). Håll farten under 6 knop, annars vibrerar bilden.',
        check: (t) => t.periscope > 0.99 && t.periscopeHeadDepth < 0,
      },
      {
        text: 'Rapportera bäringen till Västra fyren (±3°)',
        hint: 'Vrid periskopet genom att dra i bilden (eller ←/→) tills fyren står i hårkorset och tryck Brg (eller B).',
        check: (_t, c) => {
          const r = c.lastBearing;
          return r !== null && r.lookout && bearingDiff(r.bearing, bearingTo(r.position, WEST_LIGHT)) <= 3;
        },
      },
      {
        text: 'Sänk periskopet',
        hint: 'Tryck periskopknappen (eller P) igen.',
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
    difficulty: 'medel',
    group: 'recce',
    initial: { depth: 13, speed: 3 * KN, neutral: true, east: -800, heading: 330 * DEG },
    traffic: [RECCE_SHIP],
    objectives: [
      {
        text: 'Hissa periskopet',
        hint: 'Tryck periskopknappen (eller P). Håll farten under 6 knop, annars vibrerar bilden.',
        check: (t) => t.periscope > 0.99 && t.periscopeHeadDepth < 0,
      },
      {
        text: 'Rapportera bäringen till M/S Skagerack (±3°)',
        hint: 'Fartyget är sydväst om dig. Vrid periskopet genom att dra i bilden (eller ←/→) tills det står i hårkorset och tryck Brg (eller B).',
        check: (_t, c) => {
          const r = c.lastBearing;
          const truth = r?.contacts[RECCE_SHIP.id];
          return r !== null && r.lookout && truth !== undefined && bearingDiff(r.bearing, truth) <= 3;
        },
      },
      {
        text: 'Sänk periskopet',
        hint: 'Tryck periskopknappen (eller P) igen.',
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
    difficulty: 'svår',
    group: 'water',
    initial: { area: 'baltic', depth: 40, speed: 5 * KN, neutral: true, east: -2500 },
    objectives: [
      {
        text: 'Dyk till 90 m',
        system: 'depth',
        hint: 'Lägg djuprodret ned och ta upp det före 90 m. Eller växla djupet till Auto.',
        hintCrew: 'Tryck eller dra på djupskalan till 90 m (eller ↓ tills djupmålet visar 90 m).',
        check: (t) => t.depth > 86,
      },
      {
        text: 'Håll 90 m ±3 m i en minut, neutral inom ±1 000 kg',
        system: 'trim',
        hint: 'Ubåten är lätt under skiktet. Tryck In i panelen Trim för att ta in vatten (1 liter ≈ 1 kg). Pumpen klarar 6 liter i sekunden.',
        hintCrew: 'Trimassistenten tar in vatten, men pumpen klarar bara 6 liter i sekunden. Ha tålamod, eller öka tidskomprimeringen.',
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
    difficulty: 'svår',
    group: 'navigation',
    initial: { area: 'fjord', depth: 30, speed: 5 * KN, neutral: true, north: -2200, east: 0 },
    waypoint: FJORD_BUOY,
    objectives: [
      {
        text: 'Passera tröskeln',
        system: 'depth',
        hint: 'Håll 30–40 m med djuprodret och följ "Under köl". Tröskeln ligger kring mynningen, rakt norrut.',
        hintCrew: 'Håll 30–40 m med djupskalan och styr med kompassen eller ◀/▶. Följ "Under köl".',
        check: (t) => t.position[0] > 350,
      },
      {
        text: 'Gå till den gula bojen',
        system: 'heading',
        hint: 'Fjorden svänger österut och sedan tillbaka. Styr mot bojen med rodret, men håll avstånd till bergväggarna.',
        hintCrew: 'Fjorden svänger österut och sedan tillbaka. Styr mot bojen med kompassen, men håll avstånd till bergväggarna.',
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
    difficulty: 'medel',
    group: 'navigation',
    conditions: 'night',
    initial: { north: -800, east: 0, heading: 90 * DEG },
    objectives: [
      {
        text: 'Gå mot Södra fyren tills den är 700 m bort',
        system: 'heading',
        hint: 'Tryck Halv fram, Vy (eller V) för bryggan och styr med rodret mot det röda skenet.',
        hintCrew: 'Tryck Halv fram, Vy (eller V) för bryggan och styr med kompassen mot det röda skenet.',
        check: (t) => waypointInfo(t, SOUTH_LIGHT).distance < 700,
      },
    ],
    timeLimit: 1500,
  },
  {
    id: 'snorkel',
    title: 'Snorkling',
    description: 'Batteriet är nere på 25 %. Gå upp på periskopdjup, hissa snorkeln och ladda batteriet till 28 % med dieslarna. Bryt inte ytan.',
    difficulty: 'medel',
    group: 'basics',
    initial: { area: 'atlantic', depth: 40, speed: 4 * KN, neutral: true, battery: 0.25 },
    objectives: [
      {
        text: 'Gå upp på periskopdjup',
        system: 'depth',
        hint: 'Styr upp med djuprodret till 13 m och håll djupet där. Håll 4 knop: djuprodren behöver fart.',
        hintCrew: `Tryck ${PERISCOPE_DEPTH_TEXT} på djupskalan och håll 4 knop (Sakta fram): djuprodren behöver fart.`,
        check: (t) => t.depth < 15,
        holdSeconds: 10,
      },
      {
        text: 'Hissa snorkeln',
        hint: 'Tryck snorkelknappen (eller N). Dieslarna behöver luft genom snorkelns huvud.',
        check: (t) => t.snorkel > 0.99 && t.inductionAir,
      },
      {
        text: 'Ladda batteriet till 28 %',
        system: 'charging',
        hint: 'Starta dieslarna i panelen El (eller G). Låg fart ger mer laddning åt batteriet. Det tar några minuter: öka gärna tidskomprimeringen.',
        hintCrew: 'Maskinisten startar dieslarna när luften kommer in. Låg fart ger mer laddning åt batteriet. Det tar några minuter: öka gärna tidskomprimeringen.',
        check: (t) => t.battery >= 0.28,
      },
      {
        text: 'Sänk snorkeln',
        hint: 'Tryck snorkelknappen (eller N) igen.',
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
    difficulty: 'svår',
    group: 'recce',
    initial: { area: 'atlantic', depth: 40, speed: 4 * KN, neutral: true, heading: 0 },
    waypoint: STEALTH_BUOY,
    traffic: [STEALTH_CORVETTE],
    failWhenDetected: true,
    objectives: [
      {
        text: 'Hör korvetten på sonaren',
        hint: 'Öppna sonaren (sonarknappen eller H) och vänta tills operatören har klassat kontakten som ett örlogsfartyg.',
        check: (_t, c) => c.sonar.contacts.some((x) => x.vesselId === STEALTH_CORVETTE.id && x.classified !== null),
      },
      {
        text: 'Gå djupare än 150 m, under språngskiktet',
        system: 'depth',
        hint: 'Styr ned med djuprodret. Skiktet på 50–150 m böjer av ljudet. Håll 4 knop: tystare.',
        hintCrew: 'Tryck på djupskalan vid 200 m. Skiktet på 50–150 m böjer av ljudet. Håll 4 knop (Sakta fram): tystare.',
        check: (t) => t.depth > 150,
      },
      {
        text: 'Nå bojen 2,5 km norrut utan att bli upptäckt',
        system: 'heading',
        hint: 'Styr mot den gula pricken på kompassen. Fort är högljutt: håll farten nere.',
        hintCrew: 'Tryck Mot bojen. Fort är högljutt: håll farten nere.',
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
    difficulty: 'medel',
    group: 'attack',
    initial: { area: 'atlantic', depth: 13, speed: 3 * KN, neutral: true, heading: 0 },
    traffic: [PRACTICE_TARGET],
    objectives: [
      {
        text: 'Hissa periskopet',
        hint: 'Tryck periskopknappen (eller P).',
        check: (t) => lookoutUp(t),
      },
      {
        text: 'Markera målfartyget',
        hint: 'Vrid periskopet (dra i bilden eller ←/→) tills fartyget står i hårkorset och tryck Mål (eller T).',
        check: (_t, c) => c.fire.target?.vesselId === PRACTICE_TARGET.id,
      },
      {
        text: 'Få en lösning som är ok eller bra',
        system: 'fireControl',
        hint: 'Tryck Avst (eller R) med fartyget i hårkorset, gärna på 6× (Zoom). Mät igen efter en halv minut.',
        hintCrew: 'Eldledaren mäter avståndet genom periskopet. Håll fartyget i sikte en stund, och markera det igen med Mål.',
        check: (_t, c) => c.fire.target?.solution?.quality === 'ok' || c.fire.target?.solution?.quality === 'bra',
      },
      {
        text: 'Skjut och träffa',
        system: 'torpedoRoom',
        hint: 'Tuberna måste vara klara: tryck på en tub i eldledningspanelen (eller Klar i panelen Torped) och vänta tills den lyser grönt. Tryck sedan Fyr (eller F). Torpeden går 40 knop: följ den på sjökortet (sjökortsknappen eller K).',
        hintCrew: 'Torpedrummet gör tuberna klara när målet är markerat. Tryck Fyr (eller F). Torpeden går 40 knop: följ den på sjökortet (sjökortsknappen eller K).',
        check: (_t, c) => sunk(c, PRACTICE_TARGET.id),
      },
    ],
    timeLimit: 1500,
  },
  {
    id: 'night-attack',
    title: 'Nattanfall',
    description: 'Natt. Ett lastfartyg går västerut 6 km norr om dig, och periskopet ser inget i mörkret. Gör sonarkontakten till mål, byt kurs så att eldledningen får avstånd ur bäringarna, och skjut.',
    difficulty: 'svår',
    group: 'attack',
    conditions: 'night',
    initial: { area: 'atlantic', depth: 40, speed: 5 * KN, neutral: true, heading: 0 },
    traffic: [NIGHT_TARGET],
    objectives: [
      {
        text: 'Gör sonarkontakten till mål',
        hint: 'Öppna sonaren (sonarknappen eller H) och tryck på S1 i listan under vattenfallet.',
        check: (_t, c) => c.fire.target?.vesselId === NIGHT_TARGET.id,
      },
      {
        text: 'Få en lösning som är ok eller bra',
        hint: 'Byt kurs minst 30° och håll den några minuter. Bäringarna från två ben ger avståndet.',
        check: (_t, c) => c.fire.target?.solution?.quality === 'ok' || c.fire.target?.solution?.quality === 'bra',
      },
      {
        text: 'Skjut och träffa',
        system: 'torpedoRoom',
        hint: 'Tuberna måste vara klara: tryck på en tub i eldledningspanelen (eller Klar i panelen Torped) och vänta tills den lyser grönt. Tryck sedan Fyr (eller F). Med en sämre lösning: välj 2 eller 3 torpeder per salva.',
        hintCrew: 'Tryck Fyr (eller F). Med en sämre lösning: välj 2 eller 3 torpeder per salva.',
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
    difficulty: 'svår',
    group: 'attack',
    initial: { area: 'atlantic', depth: 60, speed: 4 * KN, neutral: true, heading: 180 * DEG },
    traffic: [HUNTER],
    setup: (c) => {
      c.sonar.alert(HUNTER.id, 0.9);
    },
    objectives: [
      {
        text: 'Gå djupare än 150 m',
        system: 'depth',
        hint: 'Djuproder ned och Halv fram tills du är under skiktet: på 50–150 m dämpar det korvettens sonar. Sakta sedan in.',
        hintCrew: 'Tryck på djupskalan vid 200 m och Halv fram tills du är under skiktet. Sakta sedan in.',
        check: (t) => t.depth > 150,
      },
      {
        text: 'Skaka av dig korvetten',
        hint: 'Håll 4 knop (tyst) och byt kurs. Sjunkbomberna ställs på det djup korvetten mätte: byt djup när den går över dig. Den ger upp när den tappat dig i fem minuter eller har slut på bomber.',
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
    difficulty: 'svår',
    group: 'attack',
    initial: { area: 'atlantic', depth: 13, speed: 3 * KN, neutral: true, heading: 0 },
    traffic: [CONVOY_SHIP, ESCORT],
    objectives: [
      {
        text: 'Sänk M/S Lastaren',
        system: 'torpedoRoom',
        hint: 'Gör tuberna klara i panelen Torped, gärna innan periskopet går upp. Periskop upp, Mål och Avst på lastfartyget (inte korvetten), Fyr. Ha periskopet uppe så kort tid som möjligt.',
        hintCrew: 'Periskop upp, Mål och Avst på lastfartyget (inte korvetten), Fyr. Ha periskopet uppe så kort tid som möjligt.',
        check: (_t, c) => sunk(c, CONVOY_SHIP.id),
      },
      {
        text: 'Ta dig undan eskorten',
        hint: 'Sänk periskopet, gå djupt under skiktet, sakta, och byt kurs. Eskorten hörde avfyrningen.',
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
    group: 'attack',
    description: 'En korvett jagar dig på nära håll. Skjut ut ett lockmål som låter som ubåten, smyg åt ett annat håll och låt korvetten jaga lockmålet tills den tappar bort dig.',
    difficulty: 'medel',
    initial: { area: 'atlantic', depth: 60, speed: 4 * KN, neutral: true, heading: 180 * DEG },
    traffic: [DECOY_HUNTER],
    setup: (c) => {
      c.sonar.alert(DECOY_HUNTER.id, 0.9);
    },
    objectives: [
      {
        text: 'Skjut ut ett lockmål',
        hint: 'Tryck Lock i eldledningspanelen (eller L). Det går akterut, mot korvetten, och låter som ubåten i fem minuter.',
        check: (_t, c) => c.decoys < WEAPONS.decoy.count,
      },
      {
        text: 'Skaka av dig korvetten',
        system: 'depth',
        hint: 'Djuproder ned under skiktet, sakta till 4 knop och sväng bort från lockmålets kurs. Skjut ut ett till om korvetten hittar dig.',
        hintCrew: 'Tryck på djupskalan vid 200 m, sakta till 4 knop och sväng bort från lockmålets kurs. Skjut ut ett till om korvetten hittar dig.',
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
    group: 'attack',
    description: 'Två korvetter jagar tillsammans: den ena lyssnar och pingar på avstånd medan den andra går in och fäller. Gå djupt under skiktet, sakta och tyst, och skaka av dig båda.',
    difficulty: 'svår',
    initial: { area: 'atlantic', depth: 60, speed: 4 * KN, neutral: true, heading: 180 * DEG },
    traffic: [PAIR_A, PAIR_B],
    setup: (c) => {
      c.sonar.alert(PAIR_A.id, 0.9);
    },
    objectives: [
      {
        text: 'Gå djupare än 150 m',
        system: 'depth',
        hint: 'Djuproder ned och Halv fram tills du är under skiktet. Sakta sedan in.',
        hintCrew: 'Tryck på djupskalan vid 200 m och Halv fram tills du är under skiktet. Sakta sedan in.',
        check: (t) => t.depth > 150,
      },
      {
        text: 'Skaka av dig båda korvetterna',
        hint: 'Håll 4 knop och byt kurs. Den som står still och lyssnar hör dig bäst: håll avståndet till den. Byt djup när den andra går över dig.',
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
    group: 'attack',
    description: 'Tre lastfartyg går västerut med en korvett som eskort. Sänk ett av dem. Då ökar de andra farten och sicksackar, och eskorten söker efter dig. Ta dig undan.',
    difficulty: 'svår',
    initial: { area: 'atlantic', depth: 13, speed: 3 * KN, neutral: true, heading: 0 },
    traffic: [...BIG_CONVOY, BIG_ESCORT],
    objectives: [
      {
        text: 'Sänk ett lastfartyg',
        system: 'torpedoRoom',
        hint: TUBES_HINT + 'Periskop upp, Mål och Avst på ett lastfartyg (inte korvetten), Fyr.',
        hintCrew: 'Periskop upp, Mål och Avst på ett lastfartyg (inte korvetten), Fyr.',
        check: (_t, c) => BIG_CONVOY.some((v) => sunk(c, v.id)),
      },
      {
        text: 'Ta dig undan eskorten',
        hint: 'Sänk periskopet, gå djupt under skiktet, sakta, och byt kurs. Konvojen sicksackar och eskorten hörde avfyrningen.',
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
    difficulty: 'medel',
    group: 'recce',
    conditions: 'fog',
    initial: { area: 'atlantic', depth: 13, speed: 4 * KN, neutral: true, heading: 0 },
    traffic: [FOG_SHIP, FOG_CORVETTE],
    failWhenDetected: true,
    objectives: [
      {
        text: 'Gör lastfartyget till mål',
        hint: 'Öppna sonaren (sonarknappen eller H) och tryck på lastfartygets kontakt i listan.',
        check: (_t, c) => c.fire.target?.vesselId === FOG_SHIP.id,
      },
      {
        text: 'Hissa radarmasten',
        hint: 'Tryck radarknappen (eller Y). Radarvarnaren lyssnar så fort antennen är över vattnet.',
        check: (t) => t.radar > 0.99 && t.radarHeadDepth < 0,
      },
      {
        text: 'Få en bra lösning med radarn',
        hint: 'Öppna sjökortet och tryck Radar (eller X). Varje svep ger avstånd och bäring. Var kort: korvetten hör radarn.',
        check: (_t, c) => good(c, FOG_SHIP.id),
      },
      {
        text: 'Radarn tyst och masten nere',
        hint: 'Tryck Radar sänder (eller X) och sedan radarknappen (eller Y).',
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
    difficulty: 'svår',
    group: 'attack',
    initial: { area: 'atlantic', depth: 40, speed: 4 * KN, neutral: true, heading: 0 },
    traffic: [ECHO_SHIP, ECHO_CORVETTE],
    objectives: [
      {
        text: 'Gör sonarkontakten till mål',
        hint: 'Öppna sonaren (sonarknappen eller H) och tryck på lastfartygets kontakt.',
        check: (_t, c) => c.fire.target?.vesselId === ECHO_SHIP.id,
      },
      {
        text: 'Pinga och få en bra lösning',
        hint: 'Tryck Ping i sonaren (eller A). Ekot ger avståndet. Pinga igen efter en halv minut, så får eldledningen kurs och fart.',
        check: (_t, c) => c.sonar.pings > 0 && good(c, ECHO_SHIP.id),
      },
      {
        text: 'Skjut och träffa',
        system: 'torpedoRoom',
        hint: TUBES_HINT + 'Tryck sedan Fyr (eller F).',
        hintCrew: 'Tryck Fyr (eller F) när tuberna lyser grönt.',
        check: (_t, c) => sunk(c, ECHO_SHIP.id),
      },
      {
        text: 'Ta dig undan korvetten',
        hint: 'Den hörde pingen och avfyrningen. Gå djupt under skiktet, sakta, och byt kurs.',
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
    difficulty: 'medel',
    group: 'attack',
    initial: { area: 'atlantic', depth: 13, speed: 3 * KN, neutral: true, heading: 0 },
    traffic: [FIRE_SHIP_A, FIRE_SHIP_B],
    locks: { torpedoRoom: false },
    objectives: [
      {
        text: 'Gör två tuber klara',
        hint: 'Öppna panelen Torped och tryck Klar vid två tuber. De vattenfylls och mynningsluckorna öppnas: drygt 20 s.',
        check: (_t, c) => ready(c) >= 2,
      },
      {
        text: 'Sänk målfartyget Alfa',
        hint: 'Periskop upp (P), Mål och Avst på det främre fartyget, och Fyr.',
        check: (_t, c) => sunk(c, FIRE_SHIP_A.id),
      },
      {
        text: 'Sänk målfartyget Bravo',
        hint: 'Mål och Avst på nästa fartyg, och Fyr från en klar tub.',
        check: (_t, c) => sunk(c, FIRE_SHIP_B.id),
      },
      {
        text: 'Ladda om två tuber',
        hint: 'Tryck Ladda vid de tomma tuberna i panelen Torped. Luckan stängs, tuben länsas och en torped från stället laddas: drygt två minuter, en tub i taget.',
        check: (_t, c) => c.fire.tubes.every((x) => x.loaded),
      },
    ],
    timeLimit: 1800,
  },
  {
    id: 'leak',
    title: 'Läckan',
    description: 'En rörgenomföring i maskinrummet har sprungit läck på 120 m. Gå upp så att länspumpen hinner med, medan besättningen tätar läckan, och länsa maskinrummet. Krossdjupet är 300 m.',
    difficulty: 'svår',
    group: 'water',
    initial: { area: 'atlantic', depth: 120, speed: 4 * KN, neutral: true, leaks: { engine: 2e-3 } },
    objectives: [
      {
        text: 'Gå upp till 40 m eller grundare',
        system: 'depth',
        hint: 'Djuproder upp och mer fart. Blås huvudballasten om ubåten blir för tung (panelen Ballast).',
        hintCrew: 'Tryck på djupskalan vid 30 m och tryck Halv fram. Ju grundare, desto mindre vatten kommer in.',
        check: (t) => t.depth <= 40,
      },
      {
        text: 'Läckan tätad och maskinrummet länsat',
        hint: 'Besättningen tätar läckan och länspumpen tömmer rummet. Panelen El visar vattnet. Håll djupet grunt.',
        check: (t) => t.compartments.every((x) => x.water === 0 && x.holeArea === 0),
      },
    ],
    failure: (t) => (t.depth > 300 ? 'Ubåten nådde krossdjupet 300 m.' : null),
    timeLimit: 1500,
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
    ctrl.world.add(scenario.traffic ?? []);
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
