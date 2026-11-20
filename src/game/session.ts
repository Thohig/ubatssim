/**
 * One game session: the simulation, the controller (with its world), the
 * scenario if any and how to start it again. No DOM, so the game flow can
 * be tested without a browser.
 */
import { AREA_INFO, type ConditionsId } from '../control/areas';
import { Controller } from '../control/controller';
import type { GameMode } from '../control/gameMode';
import { ScenarioRunner, scenarioMode, type Scenario } from '../control/scenarios';
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
  mode: GameMode;
  conditions: ConditionsId;
  /** Realistic mode: depth/heading autopilots allowed in free play (scenarios decide for themselves). */
  autopilotAllowed: boolean;
  /** Log line on where the commands are (differs for touch screens). */
  helpHint: string;
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
    this.ctrl.options.autopilotAllowed = spec.autopilotAllowed;
    this.runner = scenario ? new ScenarioRunner(scenario, this.ctrl) : null;
    if (spec.intro) this.ctrl.addLog(spec.intro, 'info');
    this.ctrl.setMode(spec.mode);
    if (spec.mode === 'realistic' && !this.ctrl.options.autopilotAllowed) this.ctrl.addLog('Autopilot för djup och kurs är avstängd.', 'info');
    if (spec.helpHint) this.ctrl.addLog(spec.helpHint, 'info');
    // Free play and the demo behind the menu have the area's traffic; scenarios bring their own.
    if (!scenario) this.ctrl.world.add(AREA_INFO[this.sim.areaId].traffic);
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

  /** The same start again, in the mode the game is in now. */
  restart(): GameSession {
    return new GameSession({ ...this.spec, mode: this.ctrl.options.mode });
  }
}

/** Free play: an area's start position with light, visibility and sea state. */
export function freePlaySpec(
  area: AreaId,
  startId: string,
  conditions: ConditionsId,
  sea: SeaStateId,
  mode: GameMode,
  autopilotAllowed: boolean,
  helpHint: string,
): SessionSpec | null {
  const f = AREA_INFO[area].starts.find((s) => s.id === startId);
  if (!f) return null;
  return { initial: { ...f.initial, sea }, scenario: null, intro: f.text, mode, conditions, autopilotAllowed, helpHint };
}

/** A scenario, in the preferred mode if it allows it. */
export function scenarioSpec(sc: Scenario, preferred: GameMode, autopilotAllowed: boolean, helpHint: string): SessionSpec {
  return {
    initial: sc.initial,
    scenario: sc,
    intro: `Scenario: ${sc.title}. ${sc.description}`,
    mode: scenarioMode(sc, preferred),
    conditions: sc.conditions ?? 'day',
    autopilotAllowed,
    helpHint,
  };
}

/** The session behind the main menu: surfaced off the archipelago, cruising north on autopilot. */
export function demoSession(): GameSession {
  const s = new GameSession({
    initial: { east: 1700, speed: 5 * KN },
    scenario: null,
    intro: '',
    mode: 'realistic',
    conditions: 'day',
    autopilotAllowed: true,
    helpHint: '',
  });
  s.ctrl.submit({ kind: 'setHeading', heading: 0 }, 'console');
  s.ctrl.submit({ kind: 'setSpeed', knots: 5 }, 'console');
  return s;
}
