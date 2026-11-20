/**
 * The world: the player's submarine and the other vessels, stepped together
 * in a fixed order (deterministic). The submarine is a full `Simulation`;
 * other vessels are kinematic (`Vessel`). Collisions between the
 * submarine and a ship's hull are detected here.
 */
import type { Simulation } from './simulation';
import { DT } from './simulation';
import { Vessel, type VesselDef } from './vessel';

export interface Contact {
  vessel: Vessel;
  /** Horizontal range [m] and true bearing [rad, 0..2π] from the submarine. */
  range: number;
  bearing: number;
}

export class World {
  readonly vessels: Vessel[] = [];
  /** The vessel the submarine is touching, if any (from the last step). */
  collision: Vessel | null = null;

  constructor(readonly sub: Simulation) {}

  add(defs: readonly VesselDef[]): void {
    for (const d of defs) this.vessels.push(new Vessel(d));
  }

  step(dt = DT): void {
    this.sub.step(dt);
    for (const v of this.vessels) v.step(dt);
    const hit = this.vessels.find((v) => this.touches(v)) ?? null;
    // A new collision holes the hull under the sail (the control room).
    if (hit && hit !== this.collision) this.sub.systems.flooding.damage('control', this.sub.cfg.damage.collisionHole, 'collision');
    this.collision = hit;
  }

  /** Range and bearing to every vessel, nearest first. */
  contacts(): Contact[] {
    const [n, e] = [this.sub.y[0]!, this.sub.y[1]!];
    return this.vessels
      .map((vessel) => {
        const dn = vessel.state.north - n;
        const de = vessel.state.east - e;
        return { vessel, range: Math.hypot(dn, de), bearing: (Math.atan2(de, dn) + 2 * Math.PI) % (2 * Math.PI) };
      })
      .sort((a, b) => a.range - b.range);
  }

  /**
   * True if the submarine's hull or sail overlaps a ship's hull: inside the
   * ship's footprint (plus the submarine's half length and radius) and with
   * the top of the sail above the ship's keel.
   */
  private touches(v: Vessel): boolean {
    const sub = this.sub;
    const dn = sub.y[0]! - v.state.north;
    const de = sub.y[1]! - v.state.east;
    const along = dn * Math.cos(v.state.heading) + de * Math.sin(v.state.heading);
    const across = -dn * Math.sin(v.state.heading) + de * Math.cos(v.state.heading);
    // Conservative footprint of the submarine around its CO: half its length along any heading.
    const half = sub.cfg.hull.length / 2;
    if (Math.abs(along) > v.def.length / 2 + half || Math.abs(across) > v.def.beam / 2 + half) return false;
    // A finer test with the submarine's axis: sample points along the hull.
    const R = sub.kinematics();
    const ch = Math.cos(R.heading);
    const sh = Math.sin(R.heading);
    const sailTop = sub.y[2]! + sub.cfg.hull.sail.position[2] - sub.cfg.hull.sail.height / 2;
    if (sailTop > v.def.draft) return false;
    for (let x = -half; x <= half; x += 5) {
      const pn = sub.y[0]! + x * ch - v.state.north;
      const pe = sub.y[1]! + x * sh - v.state.east;
      const a = pn * Math.cos(v.state.heading) + pe * Math.sin(v.state.heading);
      const c = -pn * Math.sin(v.state.heading) + pe * Math.cos(v.state.heading);
      if (Math.abs(a) < v.def.length / 2 && Math.abs(c) < v.def.beam / 2 + sub.cfg.hull.radius) return true;
    }
    return false;
  }
}
