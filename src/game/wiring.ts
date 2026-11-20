/**
 * How a session feeds the sound and the view overlay. Plain functions of
 * the session and the view state, so they can be tested without a browser.
 */
import type { AudioInput } from '../audio/levels';
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
    view,
    cameraUnderwater,
    conditions: s.conditions,
    seaHs: sim.sea.hs,
    coastal: sim.areaId !== 'atlantic',
    ship: nearestShip(s.ctrl.world),
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
