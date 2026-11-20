/**
 * The water surface in a tank for the cutaway view: level whatever the
 * boat's attitude. Pure functions (no Three.js), tested in tests/cutaway.test.ts.
 *
 * A tank is sampled with points spread evenly through its volume (body
 * frame). The water level is the height, along the true vertical, below
 * which a fraction `fill` of the points lie: for any shape and attitude the
 * water then fills that fraction of the volume.
 */
import type { TankDef } from '../sim/config/submarine';
import type { Vec3 } from '../sim/math/vec3';

/** Points spread evenly through a tank's volume, body frame [m]. Deterministic. */
export function tankSamples(def: TankDef, perAxis = 14): Vec3[] {
  const out: Vec3[] = [];
  const c = def.position;
  const t = (i: number) => (i + 0.5) / perAxis - 0.5; // −0.5 … 0.5, cell centres
  if (def.shape.type === 'box') {
    const [sx, sy, sz] = def.shape.size;
    for (let i = 0; i < perAxis; i++)
      for (let j = 0; j < perAxis; j++)
        for (let k = 0; k < perAxis; k++) out.push([c[0] + t(i) * sx, c[1] + t(j) * sy, c[2] + t(k) * sz]);
  } else {
    const { length, radius } = def.shape;
    for (let i = 0; i < perAxis; i++)
      for (let j = 0; j < perAxis; j++)
        for (let k = 0; k < perAxis; k++) {
          const y = t(j) * 2 * radius;
          const z = t(k) * 2 * radius;
          if (y * y + z * z <= radius * radius) out.push([c[0] + t(i) * length, c[1] + y, c[2] + z]);
        }
  }
  return out;
}

/**
 * The water level in a tank: the height along `up` (true up, a unit vector
 * in the body frame) below which the fraction `fill` (0…1) of the samples lie.
 */
export function waterLevel(samples: readonly Vec3[], up: Vec3, fill: number): number {
  const h = samples.map((p) => p[0] * up[0] + p[1] * up[1] + p[2] * up[2]).sort((a, b) => a - b);
  if (h.length === 0) return 0;
  const f = Math.max(0, Math.min(1, fill));
  if (f <= 0) return h[0]! - 1e-3;
  if (f >= 1) return h[h.length - 1]! + 1e-3;
  // Between the samples on either side of the fraction.
  const i = f * h.length;
  const lo = h[Math.max(0, Math.floor(i) - 1)]!;
  const hi = h[Math.min(h.length - 1, Math.floor(i))]!;
  return (lo + hi) / 2;
}
