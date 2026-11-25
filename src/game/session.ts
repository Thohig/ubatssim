/**
 * One game session: the simulation, the controller (with its world) and
 * how to start it again. No DOM, so the game flow can
 * be tested without a browser.
 */
import { AREA_INFO, type ConditionsId } from '../control/areas';
import { Controller } from '../control/controller';
import { MANOEUVRE_SYSTEMS } from '../control/crew';
import { Missions } from '../control/missions';
import { Patrol, patrolShips, type ThreatId } from '../control/patrol';
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
  /** Who is at sea (control/patrol.ts); default tension. */
  threat?: ThreatId;
  /** Optional missions by radio (control/missions.ts). */
  missions?: boolean;
  /** The demo behind the start page: no new ships or reinforcements. */
  demo?: boolean;
  /** A buoy to steer for [north, east] [m] (on the compass, the chart and in the view); default the depot ship. */
  waypoint?: [number, number];
}

export class GameSession {
  readonly sim: Simulation;
  readonly ctrl: Controller;
  readonly patrol: Patrol;
  readonly missions: Missions;
  /** Accumulated propeller angle for the 3D model [rad]. */
  propellerAngle = 0;

  constructor(readonly spec: SessionSpec) {
    this.sim = new Simulation(spec.initial);
    this.ctrl = new Controller(this.sim);
    this.ctrl.world.night = spec.conditions === 'night' || spec.conditions === 'dusk';
    this.ctrl.crewTakesAll();
    if (spec.intro) this.ctrl.addLog(spec.intro, 'info');
    if (spec.helpHint) this.ctrl.addLog(spec.helpHint, 'info');
    // The area's traffic, life, aircraft and coastal radar, and the patrol's ships by the threat.
    const threat = spec.threat ?? 'tension';
    const area = AREA_INFO[this.sim.areaId];
    this.ctrl.world.add(threat === 'peace' ? area.traffic.filter((v) => v.kind !== 'patrol') : area.traffic);
    this.ctrl.world.add(patrolShips(this.sim.areaId, threat));
    this.ctrl.world.addLife(area.life ?? []);
    this.ctrl.world.addAircraft(area.aircraft ?? []);
    this.ctrl.lookouts.stations = area.stations ?? [];
    this.ctrl.lookouts.watching = threat !== 'peace';
    this.patrol = new Patrol(this.ctrl, this.sim.areaId, threat, spec.conditions, !spec.demo);
    this.missions = new Missions(this.ctrl, this.sim.areaId, threat, spec.missions === true && !spec.demo);
  }

  get waypoint(): [number, number] | null {
    return this.spec.waypoint ?? this.missions.current?.waypoint ?? this.patrol.depot;
  }

  /** The light now: it changes with the clock. */
  get conditions(): ConditionsId {
    return this.patrol.conditions;
  }

  /** One fixed time step of the whole game (controller and world). */
  step(): void {
    this.ctrl.step();
    this.patrol.update();
    this.missions.update();
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

/** A patrol: an area's start position with light, visibility, sea state, threat and whether missions come by radio. */
export function freePlaySpec(
  area: AreaId,
  startId: string,
  conditions: ConditionsId,
  sea: SeaStateId,
  helpHint: string,
  threat: ThreatId = 'tension',
  missions = false,
): SessionSpec | null {
  const f = AREA_INFO[area].starts.find((s) => s.id === startId);
  if (!f) return null;
  return { initial: { ...f.initial, sea }, intro: f.text, conditions, helpHint, threat, missions };
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
    threat: 'peace',
    demo: true,
  });
  s.ctrl.hunter.enabled = false;
  s.ctrl.submit({ kind: 'setHeading', heading: 0 }, 'console');
  s.ctrl.submit({ kind: 'setDepth', depth: DEMO_DEPTH }, 'console');
  s.ctrl.submit({ kind: 'setSpeed', knots: 4 }, 'console');
  return s;
}
