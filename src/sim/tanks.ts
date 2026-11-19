/**
 * Tanks as data. A tank's state is its water volume; main ballast tanks also
 * carry the amount of air inside (as p·V at the reference temperature, which
 * is proportional to the number of moles under the isothermal assumption).
 */
import type { TankDef } from './config/submarine';
import { add, type Vec3 } from './math/vec3';

export interface TankState {
  id: string;
  /** Water volume [m^3]. */
  water: number;
  /** Air content as p·V [Pa·m^3] (main ballast only; 0 otherwise). */
  airPV: number;
  /** Vent valve open (main ballast). */
  ventOpen: boolean;
  /** HP air blow valve open (main ballast). */
  blowOpen: boolean;
}

export function initialTankState(def: TankDef): TankState {
  return { id: def.id, water: def.volume * def.initialFill, airPV: 0, ventOpen: false, blowOpen: false };
}

/** Height of a tank in body z [m]. */
export function tankHeight(def: TankDef): number {
  return def.shape.type === 'box' ? def.shape.size[2] : 2 * def.shape.radius;
}

/**
 * Centroid of the water in a tank, body frame [m]. The tank is treated as
 * filling from the bottom along body z (free-surface shift with heel/trim is
 * neglected).
 */
export function waterCentroid(def: TankDef, water: number): Vec3 {
  const h = tankHeight(def);
  const fill = def.volume > 0 ? Math.min(1, Math.max(0, water / def.volume)) : 0;
  return add(def.position, [0, 0, (h / 2) * (1 - fill)]);
}

export const fillFraction = (def: TankDef, s: TankState): number => (def.volume > 0 ? s.water / def.volume : 0);
