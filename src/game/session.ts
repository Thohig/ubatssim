/**
 * One game session: the simulation, the controller (with its world), the
 * scenario if any and how to start it again. No DOM, so the game flow can
 * be tested without a browser.
 */
import { AREA_INFO, type ConditionsId } from '../control/areas';
import { Controller } from '../control/controller';
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
    // The scenario's locks first: every game then starts with the crew handling the rest.
    this.runner = scenario ? new ScenarioRunner(scenario, this.ctrl) : null;
    this.ctrl.crewTakesAll();
    if (spec.intro) this.ctrl.addLog(spec.intro, 'info');
    const self = lockText(scenario?.locks);
    if (self.length) this.ctrl.addLog(`${self.join('. ')}.`, 'info');
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

  /** The same start again (the crew handles everything again). */
  restart(): GameSession {
    return new GameSession(this.spec);
  }
}

/** Free play: an area's start position with light, visibility and sea state. */
export function freePlaySpec(
  area: AreaId,
  startId: string,
  conditions: ConditionsId,
  sea: SeaStateId,
  helpHint: string,
): SessionSpec | null {
  const f = AREA_INFO[area].starts.find((s) => s.id === startId);
  if (!f) return null;
  return { initial: { ...f.initial, sea }, scenario: null, intro: f.text, conditions, helpHint };
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
