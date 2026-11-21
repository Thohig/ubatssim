/**
 * The world: the player's submarine, the other vessels, the torpedoes and
 * the depth charges, stepped together in a fixed order (deterministic). The
 * submarine is a full `Simulation`; the rest are kinematic. Collisions
 * between the submarine and a ship's hull, torpedo hits and depth charge
 * damage are worked out here; what happened is collected in `events` for
 * the control layer (the log, the sound, the scenarios).
 */
import { Aircraft, type AircraftDef } from './aircraft';
import { SNAG } from './config/hazards';
import { WEAPONS } from './config/weapons';
import { Creature, type CreatureDef } from './life';
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
  | { kind: 'charge'; distance: number; hole: number; compartment: string | null; at: [number, number, number] }
  | { kind: 'snagged'; vesselId: string; vessel: string }
  | { kind: 'freed'; vesselId: string; vessel: string };

/** Range and bearing to a creature (as `Contact` for a vessel). */
export interface BioContact {
  creature: Creature;
  range: number;
  bearing: number;
}

export interface Contact {
  vessel: Vessel;
  /** Horizontal range [m] and true bearing [rad, 0..2π] from the submarine. */
  range: number;
  bearing: number;
}

/** A decoy in the water (see WEAPONS.decoy). */
export interface Decoy {
  id: number;
  north: number;
  east: number;
  depth: number;
  heading: number;
  /** Seconds since launch. */
  age: number;
}

export class World {
  readonly vessels: Vessel[] = [];
  /** Whales and fish schools (life.ts). */
  readonly creatures: Creature[] = [];
  /** Patrol aircraft (aircraft.ts). */
  readonly aircraft: Aircraft[] = [];
  /**
   * Night: the deep scattering layer and the schools in it are near the
   * surface, and herring tick. Set before the life is added.
   */
  night = false;
  /** Decoys running (spent ones are removed). */
  decoys: Decoy[] = [];
  private nextDecoy = 1;
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

  addLife(defs: readonly CreatureDef[]): void {
    for (const d of defs) this.creatures.push(new Creature(d, this.night, this.sub.acousticGround));
  }

  addAircraft(defs: readonly AircraftDef[]): void {
    for (const d of defs) this.aircraft.push(new Aircraft(d));
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

  /** Launches a decoy on a course [rad] at the boat's depth. */
  launchDecoy(course: number): Decoy {
    const sub = this.sub;
    const d: Decoy = { id: this.nextDecoy++, north: sub.y[0]!, east: sub.y[1]!, depth: Math.max(2, sub.y[2]!), heading: course, age: 0 };
    this.decoys.push(d);
    return d;
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
    for (const c of this.creatures) c.step(dt, this.sub.t, this.night, this.sub.acousticGround);
    for (const a of this.aircraft) a.step(dt);
    this.checkTrawls();
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
        // The rest of its convoy speeds up and zigzags (corvettes hunt instead: control/hunter.ts).
        if (hit.def.group) for (const o of this.vessels) if (o !== hit && o.def.group === hit.def.group && o.def.kind !== 'patrol') o.alarm();
        t.state.phase = 'done';
        t.state.result = 'hit';
        this.events.push({ kind: 'hit', torpedo: t.state.id, vesselId: hit.def.id, vessel: hit.def.name, at: [t.state.north, t.state.east, t.state.depth] });
      } else if (t.state.result === 'miss') this.events.push({ kind: 'miss', torpedo: t.state.id });
    }
    this.torpedoes = this.torpedoes.filter((t) => t.state.phase !== 'done');
    if (this.decoys.length) {
      const D = WEAPONS.decoy;
      for (const d of this.decoys) {
        d.age += dt;
        d.north += D.speed * Math.cos(d.heading) * dt;
        d.east += D.speed * Math.sin(d.heading) * dt;
        d.depth += D.sinkRate * dt;
      }
      this.decoys = this.decoys.filter((d) => d.age < D.life);
    }
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

  /**
   * Trawls: a boat inside the mouth of a towed net is caught (systems/snag.ts),
   * and the trawler stops; going astern slips it off again.
   */
  private checkTrawls(): void {
    const snag = this.sub.systems.snag;
    // The boat may have backed out of it during the step (systems/snag.ts).
    const before = this.heldBy;
    const held = snag.holder;
    if (before !== null && held === null) {
      const v = this.vessels.find((x) => x.def.id === before);
      if (v) v.goalSpeed = null;
      // The net is torn or slipped off: that trawl cannot catch the boat again for a while.
      this.trawlClear[before] = this.sub.t + SNAG.clearTime;
      this.events.push({ kind: 'freed', vesselId: before, vessel: v?.def.name ?? '' });
    }
    if (held !== null) {
      const v = this.vessels.find((x) => x.def.id === held);
      if (!v || v.state.sinking) snag.release();
    } else {
      for (const v of this.vessels) {
        if (!v.def.trawl || v.state.sinking || this.sub.t < (this.trawlClear[v.def.id] ?? -Infinity)) continue;
        if (this.inTrawl(v)) {
          snag.catch(v.def.id);
          v.goalSpeed = 0;
          this.events.push({ kind: 'snagged', vesselId: v.def.id, vessel: v.def.name });
          break;
        }
      }
    }
    this.heldBy = snag.holder;
  }

  /** Whose trawl held the boat after the last step. */
  private heldBy: string | null = null;
  /** Until when a vessel's trawl cannot catch the boat again [s], by vessel id. */
  private trawlClear: Record<string, number> = {};

  /** True if a point of the boat's hull is inside the mouth of a vessel's trawl. */
  private inTrawl(v: Vessel): boolean {
    const tr = v.def.trawl!;
    const sub = this.sub;
    const ch = Math.cos(v.state.heading);
    const sh = Math.sin(v.state.heading);
    // Mouth centre, `distance` astern of the vessel.
    const mn = v.state.north - tr.distance * ch;
    const me = v.state.east - tr.distance * sh;
    const half = sub.cfg.hull.length / 2;
    const r = sub.cfg.hull.radius;
    if (Math.hypot(sub.y[0]! - mn, sub.y[1]! - me) > half + SNAG.mouthLength + tr.width) return false;
    const depth = sub.y[2]!;
    if (depth + r < tr.top || depth - r > tr.bottom) return false;
    const k = sub.kinematics();
    const bh = Math.cos(k.heading);
    const bs = Math.sin(k.heading);
    for (let x = -half; x <= half; x += 4) {
      const pn = sub.y[0]! + x * bh - mn;
      const pe = sub.y[1]! + x * bs - me;
      const along = pn * ch + pe * sh;
      const across = -pn * sh + pe * ch;
      if (Math.abs(along) < SNAG.mouthLength / 2 && Math.abs(across) < tr.width / 2 + r) return true;
    }
    return false;
  }

  /** Range and bearing to every creature, nearest first. */
  bioContacts(): BioContact[] {
    const [n, e] = [this.sub.y[0]!, this.sub.y[1]!];
    return this.creatures
      .map((creature) => {
        const dn = creature.state.north - n;
        const de = creature.state.east - e;
        return { creature, range: Math.hypot(dn, de), bearing: (Math.atan2(de, dn) + 2 * Math.PI) % (2 * Math.PI) };
      })
      .sort((a, b) => a.range - b.range);
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
