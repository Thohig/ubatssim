/**
 * One game session: the simulation, the controller (with its world) and
 * how to start it again. No DOM, so the game flow can
 * be tested without a browser.
 */
import { AREA_INFO, type ConditionsId } from '../control/areas';
import { Controller } from '../control/controller';
import { MANOEUVRE_SYSTEMS } from '../control/crew';
import type { AreaId } from '../sim/config/areas';
import type { SeaStateId } from '../sim/config/seaStates';
import { DT, IDX_SHAFT, Simulation, type InitialConditions } from '../sim/simulation';

const KN = 1852 / 3600;

/** Everything needed to start a session, and to start it again. */
export interface SessionSpec {
  initial: InitialConditions;
  /** First log line (the start position). */
  intro: string;
  conditions: ConditionsId;
  /** Log line on where the controls are. */
  helpHint: string;
  /** Free play without the area's corvettes (peaceful). */
  noPatrols?: boolean;
  /** A buoy to steer for [north, east] [m] (on the compass, the chart and in the view). */
  waypoint?: [number, number];
}

export class GameSession {
  readonly sim: Simulation;
  readonly ctrl: Controller;
  /** Accumulated propeller angle for the 3D model [rad]. */
  propellerAngle = 0;

  constructor(readonly spec: SessionSpec) {
    this.sim = new Simulation(spec.initial);
    this.ctrl = new Controller(this.sim);
    this.ctrl.world.night = spec.conditions === 'night' || spec.conditions === 'dusk';
    this.ctrl.crewTakesAll();
    if (spec.intro) this.ctrl.addLog(spec.intro, 'info');
    if (spec.helpHint) this.ctrl.addLog(spec.helpHint, 'info');
    // The area's traffic, life, aircraft and coastal radar.
    const area = AREA_INFO[this.sim.areaId];
    this.ctrl.world.add(spec.noPatrols ? area.traffic.filter((v) => v.kind !== 'patrol') : area.traffic);
    this.ctrl.world.addLife(area.life ?? []);
    this.ctrl.world.addAircraft(area.aircraft ?? []);
    this.ctrl.lookouts.stations = area.stations ?? [];
    this.ctrl.lookouts.watching = false;
  }

  get waypoint(): [number, number] | null {
    return this.spec.waypoint ?? null;
  }

  get conditions(): ConditionsId {
    return this.spec.conditions;
  }

  /** One fixed time step of the whole game (controller and world). */
  step(): void {
    this.ctrl.step();
    this.propellerAngle += 2 * Math.PI * this.sim.y[IDX_SHAFT]! * DT;
  }

  /**
   * Expert mode on or off (the player's setting). Off, the crew takes the manoeuvre back: ordinary
   * `crew` orders, acknowledged in the log when the game goes on.
   */
  setExpert(on: boolean): void {
    const c = this.ctrl;
    c.options.expert = on;
    if (on) return;
    for (const s of MANOEUVRE_SYSTEMS) if (!c.duty(s)) c.submit({ kind: 'crew', system: s, crew: true }, 'touch');
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
  return { initial: { ...f.initial, sea }, intro: f.text, conditions, helpHint, ...(patrols ? {} : { noPatrols: true }) };
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
