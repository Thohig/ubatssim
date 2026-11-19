import type { TankDef } from './config/submarine';
import type { Mat3 } from './math/mat';
import type { Vec3 } from './math/vec3';
import type { MassProperties } from './rigidBody';
import { waterCentroid, type TankState } from './tanks';

export interface DryMass {
  mass: number;
  cg: Vec3;
  /** Inertia of the dry boat about its own CG [kg m^2]. */
  inertiaCg: Mat3;
}

/**
 * Combines the dry boat with the water in all tanks (as point masses) into
 * total mass, CG and inertia about the combined CG.
 */
export function computeMassProperties(
  dry: DryMass,
  defs: readonly TankDef[],
  states: readonly TankState[],
  waterDensityOf: (def: TankDef) => number,
): MassProperties {
  const items: { m: number; r: Vec3 }[] = [{ m: dry.mass, r: dry.cg }];
  defs.forEach((def, i) => {
    const s = states[i]!;
    if (s.water > 0) items.push({ m: s.water * waterDensityOf(def), r: waterCentroid(def, s.water) });
  });
  let mass = 0;
  const cg: Vec3 = [0, 0, 0];
  for (const it of items) {
    mass += it.m;
    for (let k = 0; k < 3; k++) cg[k]! += it.m * it.r[k]!;
  }
  for (let k = 0; k < 3; k++) cg[k]! /= mass;

  const I = [...dry.inertiaCg] as Mat3;
  for (const it of items) {
    const d: Vec3 = [it.r[0] - cg[0], it.r[1] - cg[1], it.r[2] - cg[2]];
    const d2 = d[0] * d[0] + d[1] * d[1] + d[2] * d[2];
    for (let r = 0; r < 3; r++) {
      for (let c = 0; c < 3; c++) I[r * 3 + c]! += it.m * ((r === c ? d2 : 0) - d[r]! * d[c]!);
    }
  }
  return { mass, cg, inertiaCg: I };
}
