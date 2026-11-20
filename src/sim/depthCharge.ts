/**
 * Depth charges: dropped by a corvette, they sink at a fixed rate and go off
 * at their set depth. The world (world.ts) applies the damage to the
 * submarine: within `lethal` the hull is ruptured, within `damage` a hole
 * opens that is smaller the further away, in the compartment nearest the
 * explosion. Deterministic.
 */
import { WEAPONS } from './config/weapons';

const D = WEAPONS.depthCharge;

export interface DepthChargeState {
  north: number;
  east: number;
  depth: number;
  setDepth: number;
  exploded: boolean;
}

export class DepthCharge {
  readonly state: DepthChargeState;

  constructor(north: number, east: number, setDepth: number) {
    this.state = { north, east, depth: 0, setDepth, exploded: false };
  }

  /** Sinks; returns true in the step it goes off. */
  step(dt: number): boolean {
    const s = this.state;
    if (s.exploded) return false;
    s.depth = Math.min(s.setDepth, s.depth + D.sinkRate * dt);
    if (s.depth >= s.setDepth) {
      s.exploded = true;
      return true;
    }
    return false;
  }
}

/** Hole area [m^2] for an explosion at a distance [m] from the hull (0 beyond the damage radius). */
export function chargeHole(distance: number): number {
  if (distance <= D.lethal) return D.lethalHole;
  if (distance >= D.damage) return 0;
  return D.hole * (1 - (distance - D.lethal) / (D.damage - D.lethal)) ** 2;
}
