/**
 * The subsystem pattern of the simulation. A subsystem owns a part of the
 * boat's state and can take part in a time step in two ways:
 *
 *   update(dt)        explicit update once per step, before the integration
 *                     (valves, pumps, actuators, batteries …)
 *   forces(ctx, tau)  adds a generalized force in the body frame at every
 *                     force evaluation (four per RK4 step)
 *
 * Subsystems are created by `Simulation` and run in a fixed order, so the
 * simulation stays deterministic. To add a system (battery, diesel,
 * flooding …): write a class here, add it to `Simulation.systems` and to
 * the update/force lists, and expose what the controller and the
 * telemetry need.
 */
import type { Mat3 } from '../math/mat';
import type { Vec3 } from '../math/vec3';

/** What a force contribution may read at one force evaluation. */
export interface ForceContext {
  /** State vector being evaluated (an RK4 stage). */
  y: Float64Array;
  pos: Vec3;
  /** Rotation body → NED (row-major). */
  R: Mat3;
  /** Body velocities over the ground and relative to the water. */
  nu: ArrayLike<number>;
  nuR: ArrayLike<number>;
}

export interface Subsystem {
  readonly name: string;
  update?(dt: number): void;
  forces?(ctx: ForceContext, tau: Float64Array): void;
}
