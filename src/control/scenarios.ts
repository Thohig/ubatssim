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

export const SCENARIOS: Scenario[] = [
  {
    id: 'first-dive',
    title: 'Första dykningen',
    description: 'Guidad övning: fyll huvudballasten, dyk till 30 m, trimma ubåten neutral och gå sedan till ytläge igen.',
    difficulty: 'lätt',
    initial: {},
    autopilotAllowed: true,
    objectives: [
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
    const fail = (t.grounded ? 'Ubåten gick på grund.' : null) ?? this.scenario.failure?.(t, c) ?? null;
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
