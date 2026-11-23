/**
 * One game session: the simulation, the controller (with its world), the
 * scenario if any and how to start it again. No DOM, so the game flow can
 * be tested without a browser.
 */
import { AREA_INFO, type ConditionsId } from '../control/areas';
import { Controller } from '../control/controller';
import { MANOEUVRE_SYSTEMS, needsExpert } from '../control/crew';
import { ScenarioRunner, lockText, type Scenario } from '../control/scenarios';
import type { AreaId } from '../sim/config/areas';
import type { SeaStateId } from '../sim/config/seaStates';
import { DT, IDX_SHAFT, Simulation, type InitialConditions } from '../sim/simulation';

const KN = 1852 / 3600;

/** Everything needed to start a session, and to start it again. */
export interface SessionSpec {
  initial: InitialConditions;
  scenario: Scenario | null;
  /** First log line (the start position or the scenario). */
  intro: string;
  conditions: ConditionsId;
  /** Log line on where the controls are. */
  helpHint: string;
  /** Free play without the area's corvettes (peaceful). */
  noPatrols?: boolean;
}

export class GameSession {
  readonly sim: Simulation;
  readonly ctrl: Controller;
  readonly runner: ScenarioRunner | null;
  /** Accumulated propeller angle for the 3D model [rad]. */
  propellerAngle = 0;

  constructor(readonly spec: SessionSpec) {
    const { initial, scenario } = spec;
    this.sim = new Simulation(initial);
    this.ctrl = new Controller(this.sim);
    this.ctrl.world.night = spec.conditions === 'night' || spec.conditions === 'dusk';
    // The scenario's locks first: every game then starts with the crew handling the rest.
    this.runner = scenario ? new ScenarioRunner(scenario, this.ctrl) : null;
    this.ctrl.crewTakesAll();
    if (spec.intro) this.ctrl.addLog(spec.intro, 'info');
    const self = lockText(scenario?.locks);
    if (self.length) this.ctrl.addLog(`${self.join('. ')}.`, 'info');
    if (spec.helpHint) this.ctrl.addLog(spec.helpHint, 'info');
    // Free play and the demo behind the menu have the area's traffic; scenarios bring their own.
    if (!scenario) {
      const area = AREA_INFO[this.sim.areaId];
      this.ctrl.world.add(spec.noPatrols ? area.traffic.filter((v) => v.kind !== 'patrol') : area.traffic);
      this.ctrl.world.addLife(area.life ?? []);
      this.ctrl.world.addAircraft(area.aircraft ?? []);
      this.ctrl.lookouts.stations = area.stations ?? [];
      this.ctrl.lookouts.watching = false;
    }
  }

  get scenario(): Scenario | null {
    return this.spec.scenario;
  }

  get conditions(): ConditionsId {
    return this.spec.conditions;
  }

  /** One fixed time step of the whole game (controller, world, scenario check). */
  step(): void {
    this.ctrl.step();
    this.runner?.update();
    this.propellerAngle += 2 * Math.PI * this.sim.y[IDX_SHAFT]! * DT;
  }

  /** True if the scenario makes the player handle part of the manoeuvre: always expert mode then. */
  get expertForced(): boolean {
    return needsExpert(this.spec.scenario?.locks);
  }

  /**
   * Expert mode on or off (the player's setting). Off, the crew takes the manoeuvre back: ordinary
   * `crew` orders, acknowledged in the log when the game goes on.
   */
  setExpert(on: boolean): void {
    const c = this.ctrl;
    c.options.expert = on || this.expertForced;
    if (c.options.expert) return;
    for (const s of MANOEUVRE_SYSTEMS) if (!c.duty(s) && c.options.locks[s] === undefined) c.submit({ kind: 'crew', system: s, crew: true }, 'touch');
  }

  /** The same start again (the crew handles everything again). */
  restart(): GameSession {
    return new GameSession(this.spec);
  }
}

/** Free play: an area's start position with light, visibility and sea state, with or without the area's corvettes. */
export function freePlaySpec(
  area: AreaId,
  startId: string,
  conditions: ConditionsId,
  sea: SeaStateId,
  helpHint: string,
  patrols = true,
): SessionSpec | null {
  const f = AREA_INFO[area].starts.find((s) => s.id === startId);
  if (!f) return null;
  return { initial: { ...f.initial, sea }, scenario: null, intro: f.text, conditions, helpHint, ...(patrols ? {} : { noPatrols: true }) };
}

/** A scenario. */
export function scenarioSpec(sc: Scenario, helpHint: string): SessionSpec {
  return {
    initial: sc.initial,
    scenario: sc,
    intro: `Scenario: ${sc.title}. ${sc.description}`,
    conditions: sc.conditions ?? 'day',
    helpHint,
  };
}

/** Depth of the demo behind the start page [m]: shallow enough for the daylight's rays to show around it. */
export const DEMO_DEPTH = 16;

/**
 * The session behind the main menu: dived off the archipelago in daylight,
 * cruising slowly north on autopilot, with the area's peaceful traffic. The
 * camera stands still in the water and the boat glides past (`flyby` in scene.ts).
 */
export function demoSession(): GameSession {
  const s = new GameSession({
    initial: { east: 1700, depth: DEMO_DEPTH, neutral: true, speed: 4 * KN },
    scenario: null,
    intro: '',
    conditions: 'day',
    helpHint: '',
  });
  s.ctrl.hunter.enabled = false;
  s.ctrl.submit({ kind: 'setHeading', heading: 0 }, 'console');
  s.ctrl.submit({ kind: 'setDepth', depth: DEMO_DEPTH }, 'console');
  s.ctrl.submit({ kind: 'setSpeed', knots: 4 }, 'console');
  return s;
}
