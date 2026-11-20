/**
 * Scenarios are data: a starting condition, a list of objectives that must
 * be met in order (each optionally held for some time) and failure
 * conditions. The runner checks them against simulation telemetry, so it is
 * deterministic and testable without any UI.
 */
import { ENVIRONMENT } from '../sim/config/environment';
import type { InitialConditions, Telemetry } from '../sim/simulation';
import type { Controller } from './controller';
import { GAME_MODES, type GameMode } from './gameMode';
import { AREA_INFO, freighter, type ConditionsId } from './areas';
import type { VesselDef } from '../sim/vessel';

const G = ENVIRONMENT.g;
const KN = 1852 / 3600;

export type Difficulty = 'lätt' | 'medel' | 'svår';

export interface Objective {
  /** Short goal shown in the banner. */
  text: string;
  /** Longer instruction, e.g. which command to type. */
  hint: string;
  /** Hint for the simplified simulation, when it differs. */
  hintSimplified?: string;
  check: (t: Telemetry, c: Controller) => boolean;
  /** Seconds the condition must hold continuously. */
  holdSeconds?: number;
}

export interface Scenario {
  id: string;
  title: string;
  description: string;
  difficulty: Difficulty;
  initial: InitialConditions;
  /** Realistic mode: whether depth/heading autopilots may be used. */
  autopilotAllowed: boolean;
  /** Game modes the scenario can be played in (default: both). */
  modes?: readonly GameMode[];
  /** Simplified mode: whether the safety net is active (default true). */
  safetyNet?: boolean;
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
}

/** Distance [m] and true bearing [deg] from the boat to the scenario waypoint. */
export function waypointInfo(t: Telemetry, wp: [number, number]): { distance: number; bearing: number } {
  const dn = wp[0] - t.position[0];
  const de = wp[1] - t.position[1];
  const bearing = ((Math.atan2(de, dn) * 180) / Math.PI + 360) % 360;
  return { distance: Math.hypot(dn, de), bearing };
}

/** The game modes a scenario allows. */
export const scenarioModes = (s: Scenario): readonly GameMode[] => s.modes ?? GAME_MODES;

/** The mode to play a scenario in: the preferred one if allowed, else the first allowed. */
export const scenarioMode = (s: Scenario, preferred: GameMode): GameMode => {
  const modes = scenarioModes(s);
  return modes.includes(preferred) ? preferred : modes[0]!;
};

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
/** The freighter in "Fartyget": northbound west of the boat. */
const RECCE_SHIP = freighter('skagerack', 'M/S Skagerack', [[-2500, -1500], [6000, -1500]]);

export const SCENARIOS: Scenario[] = [
  {
    id: 'first-dive',
    title: 'Första dykningen',
    description: 'Guidad övning: klara bryggan, fyll huvudballasten, dyk till 30 m, trimma ubåten neutral och gå sedan till ytläge igen.',
    difficulty: 'lätt',
    initial: {},
    autopilotAllowed: true,
    objectives: [
      {
        text: 'Klara bryggan',
        hint: 'Skriv "klart bryggan". Ingen får vara kvar på bryggan när ubåten dyker.',
        hintSimplified: 'Tryck D (eller Dyk). Bryggan utryms automatiskt.',
        check: (_t, c) => !c.bridgeManned,
      },
      {
        text: 'Öppna ventilerna till huvudballasten',
        hint: 'Skriv "fyll huvudballast" i konsolen.',
        hintSimplified: 'Tryck D (eller Dyk). Ventilerna stängs själva när tankarna är fulla.',
        check: (t) => mbt(t).every((x) => x.ventOpen || x.fill > 0.95),
      },
      {
        text: 'Gå framåt med 5 knop',
        hint: 'Skriv "fart 5 knop". Djuprodren behöver fart för att verka.',
        hintSimplified: 'Öka farten till 5 knop med Shift + ↑ (eller +). Djuprodren behöver fart för att verka.',
        check: (t) => t.u > 3 * KN,
      },
      {
        text: 'Dyk till 30 meter och håll djupet',
        hint: 'Skriv "djup 30". Autopiloten styr djuprodren.',
        hintSimplified: 'Tryck ↓ (eller ▼) tills djupmålet visar 30 m.',
        check: (t) => Math.abs(t.depth - 30) < 2,
        holdSeconds: 10,
      },
      {
        text: 'Trimma ubåten neutral (±300 kg)',
        hint: 'Se "Flytkraftsöverskott" under "Mer". Är den tung (minus)? Skriv t.ex. "kompensera ut 600".',
        hintSimplified: 'Assistenten pumpar ut vatten tills ubåten är neutral. Följ "Trim" och loggen.',
        check: (t) => Math.abs(t.netBuoyancy / G) < 300 && t.compRemaining === 0,
        holdSeconds: 5,
      },
      {
        text: 'Gå till ytläge',
        hint: 'Skriv "blås huvudballast" och "djup 0". Lite vatten blir kvar i tankarna när luften trycks ihop i ytläget.',
        hintSimplified: 'Tryck S (eller Ytläge). Huvudballasten blåses och djupmålet sätts till 0 m.',
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
    initial: { depth: 50, speed: 4 * KN, tankFills: { comp: 0.54 } },
    autopilotAllowed: false,
    modes: ['realistic'],
    objectives: [
      {
        text: 'Håll 50 m ±2 m i 3 minuter',
        hint: 'Styr med ↑/↓ (djuproder) och använd "kompensera ut <liter>" för att bli neutral.',
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
    initial: { depth: 25, speed: 6 * KN, designTrim: true },
    autopilotAllowed: true,
    objectives: [
      {
        text: 'Dyk till 90 m',
        hint: 'Skriv "djup 90".',
        hintSimplified: 'Tryck ↓ (eller ▼) tills djupmålet visar 90 m.',
        check: (t) => t.depth > 85,
      },
      {
        text: 'Håll 90 m ±3 m i en minut med neutral trim (±300 kg)',
        hint: 'Ubåten är lätt här. Ta in vatten: "kompensera in <liter>".',
        hintSimplified: 'Ubåten blir lätt under språngskiktet. Assistenten tar in vatten, följ "Trim" och loggen.',
        check: (t) => Math.abs(t.depth - 90) < 3 && Math.abs(t.netBuoyancy / G) < 300,
        holdSeconds: 60,
      },
    ],
    failure: (t) => (t.depth > 250 ? 'Ubåten gick för djupt (250 m).' : null),
  },
  {
    id: 'sound-transit',
    title: 'Genom sundet',
    description: 'Ta ubåten i ytläge norrut genom ett smalt sund i skärgården till den gula bojen, utan att gå på grund. Håll koll på ekolodet (Under köl).',
    difficulty: 'medel',
    initial: { east: 2560, heading: (20 * Math.PI) / 180 },
    waypoint: [1200, 2848],
    autopilotAllowed: true,
    objectives: [
      {
        text: 'Gå genom sundet till den gula bojen',
        hint: 'Skriv "fart 4 knop" och styr med ←/→ eller "kurs <grader>". Sundet slingrar sig mot nordost.',
        hintSimplified: 'Öka farten till 4 knop och styr med ←/→ (10° per tryck) mot bojens bäring. Sundet slingrar sig mot nordost.',
        check: (t) => waypointInfo(t, [1200, 2848]).distance < 60,
      },
    ],
  },
  {
    id: 'emergency-blow',
    title: 'Nödblåsning',
    description: 'Kompenseringstanken har vattenfyllts på 200 m och ubåten är flera ton för tung. Ta dig till ytan innan den når krossdjupet 300 m.',
    difficulty: 'svår',
    initial: { depth: 200, speed: 4 * KN, tankFills: { comp: 1 }, east: -3000 },
    autopilotAllowed: true,
    safetyNet: false,
    objectives: [
      {
        text: 'Nå ytan',
        hint: 'Blås huvudballasten ("blås huvudballast"), öka farten och styr uppåt med djuprodren.',
        hintSimplified: 'Tryck S (ytläge) och öka farten. Här finns ingen automatisk nödblåsning.',
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
    initial: { depth: 13, speed: 4 * KN, neutral: true, east: 700, heading: 60 * DEG },
    autopilotAllowed: true,
    objectives: [
      {
        text: 'Hissa periskopet',
        hint: 'Skriv "periskop upp" eller tryck P. Håll farten under 6 knop, annars vibrerar bilden.',
        check: (t) => t.periscope > 0.99 && t.periscopeHeadDepth < 0,
      },
      {
        text: 'Rapportera bäringen till Västra fyren (±3°)',
        hint: 'Vrid periskopet med ←/→ tills fyren står i hårkorset och tryck B, eller skriv "bäring <grader>".',
        hintSimplified: 'Vrid periskopet med ←/→ (eller dra) tills fyren står i hårkorset och tryck B (Brg).',
        check: (_t, c) => {
          const r = c.lastBearing;
          return r !== null && r.lookout && bearingDiff(r.bearing, bearingTo(r.position, WEST_LIGHT)) <= 3;
        },
      },
      {
        text: 'Sänk periskopet',
        hint: 'Skriv "periskop ned" eller tryck P.',
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
    initial: { depth: 13, speed: 3 * KN, neutral: true, east: -800, heading: 330 * DEG },
    traffic: [RECCE_SHIP],
    autopilotAllowed: true,
    objectives: [
      {
        text: 'Hissa periskopet',
        hint: 'Skriv "periskop upp" eller tryck P.',
        check: (t) => t.periscope > 0.99 && t.periscopeHeadDepth < 0,
      },
      {
        text: 'Rapportera bäringen till M/S Skagerack (±3°)',
        hint: 'Fartyget är sydväst om dig. Vrid periskopet med ←/→ tills det står i hårkorset och tryck B, eller skriv "bäring <grader>".',
        hintSimplified: 'Fartyget är sydväst om dig. Vrid periskopet med ←/→ (eller dra) tills det står i hårkorset och tryck B (Brg).',
        check: (_t, c) => {
          const r = c.lastBearing;
          const truth = r?.contacts[RECCE_SHIP.id];
          return r !== null && r.lookout && truth !== undefined && bearingDiff(r.bearing, truth) <= 3;
        },
      },
      {
        text: 'Sänk periskopet',
        hint: 'Skriv "periskop ned" eller tryck P.',
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
    initial: { area: 'baltic', depth: 40, speed: 5 * KN, neutral: true, east: -2500 },
    autopilotAllowed: true,
    objectives: [
      {
        text: 'Dyk till 90 m',
        hint: 'Skriv "djup 90". Följ "Flytkraftsöverskott" under "Mer" på vägen ner.',
        hintSimplified: 'Tryck ↓ (eller ▼) tills djupmålet visar 90 m.',
        check: (t) => t.depth > 86,
      },
      {
        text: 'Håll 90 m ±3 m i en minut, neutral inom ±1 000 kg',
        hint: 'Ubåten är lätt under skiktet. Ta in vatten: "kompensera in <liter>" (1 liter ≈ 1 kg).',
        hintSimplified: 'Assistenten tar in vatten, men pumpen klarar bara 6 liter i sekunden. Ha tålamod, eller öka tidskomprimeringen.',
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
    initial: { area: 'fjord', depth: 30, speed: 5 * KN, neutral: true, north: -2200, east: 0 },
    waypoint: FJORD_BUOY,
    autopilotAllowed: true,
    objectives: [
      {
        text: 'Passera tröskeln',
        hint: 'Håll 30–40 m djup och följ "Under köl". Tröskeln ligger kring mynningen (bojens bäring rakt norrut).',
        hintSimplified: 'Håll 30–40 m med ↑/↓ och styr med ←/→. Följ "Under köl".',
        check: (t) => t.position[0] > 350,
      },
      {
        text: 'Gå till den gula bojen',
        hint: 'Fjorden svänger österut och sedan tillbaka. Styr mot bojens bäring men håll avstånd till bergväggarna.',
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
    conditions: 'night',
    initial: { north: -800, east: 0, heading: 90 * DEG },
    autopilotAllowed: true,
    objectives: [
      {
        text: 'Gå mot Södra fyren tills den är 700 m bort',
        hint: 'Skriv "fart 6 knop", tryck V för bryggan och styr mot det röda skenet.',
        hintSimplified: 'Öka farten, tryck V för bryggan och styr med ←/→ mot det röda skenet.',
        check: (t) => waypointInfo(t, SOUTH_LIGHT).distance < 700,
      },
    ],
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
    ctrl.options.autopilotAllowed = scenario.autopilotAllowed;
    ctrl.options.safetyNet = scenario.safetyNet ?? true;
    ctrl.world.add(scenario.traffic ?? []);
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
