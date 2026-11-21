/**
 * How a session feeds the sound and the view overlay. Plain functions of
 * the session and the view state, so they can be tested without a browser.
 */
import type { AudioInput } from '../audio/levels';
import type { EffectsInput } from '../render/effects';
import { quatToMat3 } from '../sim/math/quat';
import { getQuat } from '../sim/rigidBody';
import { IDX_SHAFT } from '../sim/simulation';
import type { World } from '../sim/world';
import type { ViewMode } from '../ui/views';
import type { GameSession } from './session';

/** The nearest other vessel, for the sound. */
export function nearestShip(world: World): { range: number; bladeRate: number } | undefined {
  const k = world.contacts()[0];
  return k ? { range: k.range, bladeRate: k.vessel.def.propellerRps * k.vessel.def.blades } : undefined;
}

export function audioInput(s: GameSession, view: ViewMode, cameraUnderwater: boolean): AudioInput {
  const sim = s.sim;
  return {
    t: sim.telemetry(),
    maxPower: sim.cfg.propulsion.maxPower,
    lpBlower: sim.commands.lpBlower,
    // The cutaway camera stands outside the boat, as the external one; in the control room it is inside, as at the periscope (no wind).
    view: view === 'cutaway' ? 'external' : view === 'control' ? 'periscope' : view,
    cameraUnderwater,
    conditions: s.conditions,
    seaHs: sim.sea.hs,
    coastal: sim.areaId !== 'atlantic',
    ship: nearestShip(s.ctrl.world),
    bio: nearestCall(s),
  };
}

/** The nearest whale or school making sound now, with its range. */
function nearestCall(s: GameSession): AudioInput['bio'] {
  const w = s.ctrl.world;
  let best: AudioInput['bio'];
  for (const c of w.creatures) {
    if (c.sourceLevel(s.sim.t, w.night) === null) continue;
    const range = Math.hypot(c.state.north - s.sim.y[0]!, c.state.east - s.sim.y[1]!);
    if (!best || range < best.range) best = { sound: c.def.sound, range };
  }
  return best;
}

/** What the particle effects need from the boat, every frame (cheap: no force evaluation). */
export function effectsInput(s: GameSession): EffectsInput {
  const sim = s.sim;
  const a = sim.actuators;
  return {
    t: sim.t,
    position: [sim.y[0]!, sim.y[1]!, sim.y[2]!],
    rotation: quatToMat3(getQuat(sim.y)),
    speed: sim.kinematics().u,
    rps: sim.y[IDX_SHAFT]!,
    propeller: sim.cfg.propulsion.position,
    tanks: sim.tankDefs.flatMap((d, i) => {
      if (d.kind !== 'mainBallast') return [];
      const st = sim.tanks[i]!;
      const radius = d.shape.type === 'cylinder' ? d.shape.radius : d.shape.size[2] / 2;
      return [{ position: d.position, radius, vent: st.ventOpen, blow: st.blowOpen, fill: st.water / d.volume }];
    }),
    periscopeHead: a.periscope > 0.5 ? sim.periscopeHead() : null,
    snorkelHead: a.snorkel > 0.5 ? sim.snorkelHead() : null,
    dieselRunning: sim.systems.electrics.dieselRunning,
    torpedoes: s.ctrl.world.torpedoes.map((t) => [t.state.north, t.state.east, t.state.depth] as [number, number, number]),
    blasts: s.ctrl.blasts,
    night: s.conditions === 'night' || s.conditions === 'dusk',
    halfLength: sim.cfg.hull.length / 2,
  };
}

export interface OverlayInput {
  mode: ViewMode;
  /** Look direction relative to the bow [rad]. */
  relative: number;
  zoom: number;
  fov: number;
}

/** The overlay's state: true bearing of the look, the buoy, magnification, periscope under water. */
export function overlayState(s: GameSession, v: OverlayInput) {
  const sim = s.sim;
  const k = sim.kinematics();
  const wp = s.runner?.scenario.waypoint;
  return {
    mode: v.mode,
    bearing: ((k.heading + v.relative) * 180) / Math.PI,
    waypointBearing: wp ? ((Math.atan2(wp[1] - sim.y[1]!, wp[0] - sim.y[0]!) * 180) / Math.PI + 360) % 360 : null,
    zoom: v.zoom,
    underwater: v.mode === 'periscope' && sim.bodyPointDepth(sim.periscopeHead()) > 0,
    fov: v.fov,
  };
}
