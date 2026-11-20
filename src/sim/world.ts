/**
 * The world: the player's submarine, the other vessels, the torpedoes and
 * the depth charges, stepped together in a fixed order (deterministic). The
 * submarine is a full `Simulation`; the rest are kinematic. Collisions
 * between the submarine and a ship's hull, torpedo hits and depth charge
 * damage are worked out here; what happened is collected in `events` for
 * the control layer (the log, the sound, the scenarios).
 */
import { WEAPONS } from './config/weapons';
import { chargeHole, DepthCharge } from './depthCharge';
import { mat3MulVec } from './math/mat';
import { quatToMat3 } from './math/quat';
import { getQuat } from './rigidBody';
import type { Simulation } from './simulation';
import { DT } from './simulation';
import { Torpedo, type TorpedoOrders } from './torpedo';
import { Vessel, type VesselDef } from './vessel';

export type WorldEvent =
  | { kind: 'launch'; torpedo: number }
  | { kind: 'hit'; torpedo: number; vesselId: string; vessel: string; at: [number, number, number] }
  | { kind: 'miss'; torpedo: number }
  | { kind: 'sunk'; vesselId: string; vessel: string }
  | { kind: 'drop'; by: string; count: number }
  | { kind: 'charge'; distance: number; hole: number; compartment: string | null; at: [number, number, number] };

export interface Contact {
  vessel: Vessel;
  /** Horizontal range [m] and true bearing [rad, 0..2π] from the submarine. */
  range: number;
  bearing: number;
}

export class World {
  readonly vessels: Vessel[] = [];
  /** Torpedoes in the water (spent ones are removed). */
  torpedoes: Torpedo[] = [];
  /** Depth charges sinking (exploded ones are removed). */
  charges: DepthCharge[] = [];
  /** The vessel the submarine is touching, if any (from the last step). */
  collision: Vessel | null = null;
  /** What happened since the last `drainEvents()`. */
  private events: WorldEvent[] = [];
  private nextTorpedo = 1;
  private sunkReported = new Set<string>();

  constructor(readonly sub: Simulation) {}

  add(defs: readonly VesselDef[]): void {
    for (const d of defs) this.vessels.push(new Vessel(d));
  }

  /** Events since the last call. */
  drainEvents(): WorldEvent[] {
    const e = this.events;
    this.events = [];
    return e;
  }

  /** Launches a torpedo from the bow on the boat's heading; it turns to its gyro course. */
  launch(orders: TorpedoOrders): Torpedo {
    const sub = this.sub;
    const R = quatToMat3(getQuat(sub.y));
    const p = mat3MulVec(R, WEAPONS.torpedo.launch);
    const k = sub.kinematics();
    const t = new Torpedo(this.nextTorpedo++, { north: sub.y[0]! + p[0], east: sub.y[1]! + p[1], depth: Math.max(1, sub.y[2]! + p[2]), heading: k.heading }, orders);
    this.torpedoes.push(t);
    this.events.push({ kind: 'launch', torpedo: t.state.id });
    return t;
  }

  /** A corvette drops a pattern of depth charges along its track, set to a depth [m]. */
  dropCharges(by: Vessel, setDepth: number): void {
    const D = WEAPONS.depthCharge;
    const h = by.state.heading;
    for (let i = 0; i < D.pattern; i++) {
      const back = (i - (D.pattern - 1) / 2) * D.spacing;
      this.charges.push(new DepthCharge(by.state.north - back * Math.cos(h), by.state.east - back * Math.sin(h), setDepth));
    }
    this.events.push({ kind: 'drop', by: by.def.name, count: D.pattern });
  }

  step(dt = DT): void {
    this.sub.step(dt);
    for (const v of this.vessels) v.step(dt);
    for (const v of this.vessels) {
      if (v.state.sunk >= 1 && !this.sunkReported.has(v.def.id)) {
        this.sunkReported.add(v.def.id);
        this.events.push({ kind: 'sunk', vesselId: v.def.id, vessel: v.def.name });
      }
    }
    for (const t of this.torpedoes) {
      t.step(dt, this.vessels, this.sub.water);
      const hit = this.vessels.find((v) => !v.state.sinking && t.hits(v));
      if (hit) {
        hit.sink();
        t.state.phase = 'done';
        t.state.result = 'hit';
        this.events.push({ kind: 'hit', torpedo: t.state.id, vesselId: hit.def.id, vessel: hit.def.name, at: [t.state.north, t.state.east, t.state.depth] });
      } else if (t.state.result === 'miss') this.events.push({ kind: 'miss', torpedo: t.state.id });
    }
    this.torpedoes = this.torpedoes.filter((t) => t.state.phase !== 'done');
    for (const c of this.charges) if (c.step(dt)) this.explode(c);
    this.charges = this.charges.filter((c) => !c.state.exploded);
    const hit = this.vessels.find((v) => this.touches(v)) ?? null;
    // A new collision holes the hull under the sail (the control room).
    if (hit && hit !== this.collision) this.sub.systems.flooding.damage('control', this.sub.cfg.damage.collisionHole, 'collision');
    this.collision = hit;
  }

  /** A depth charge goes off: a hole in the compartment nearest it, smaller the further away. */
  private explode(c: DepthCharge): void {
    const sub = this.sub;
    const R = quatToMat3(getQuat(sub.y));
    const half = sub.cfg.hull.length / 2;
    let best = Infinity;
    let bestX = 0;
    for (let x = -half; x <= half; x += 2) {
      const p = mat3MulVec(R, [x, 0, 0]);
      const d = Math.hypot(sub.y[0]! + p[0] - c.state.north, sub.y[1]! + p[1] - c.state.east, sub.y[2]! + p[2] - c.state.depth);
      if (d < best) {
        best = d;
        bestX = x;
      }
    }
    // The distance to the hull's surface, not its axis.
    const distance = Math.max(0, best - sub.cfg.hull.radius);
    const hole = chargeHole(distance);
    const comps = sub.cfg.compartments;
    const comp = comps.find((k) => bestX >= k.xRange[0] && bestX <= k.xRange[1]) ?? (bestX > 0 ? comps[0]! : comps[comps.length - 1]!);
    if (hole > 0) sub.systems.flooding.damage(comp.id, hole, 'charge');
    this.events.push({ kind: 'charge', distance, hole, compartment: hole > 0 ? comp.id : null, at: [c.state.north, c.state.east, c.state.depth] });
  }

  /** Range and bearing to every vessel still afloat, nearest first. */
  contacts(): Contact[] {
    const [n, e] = [this.sub.y[0]!, this.sub.y[1]!];
    return this.vessels
      .filter((v) => v.state.sunk < 1)
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
