/**
 * Flooding and damage: leaks into the pressure hull's compartments.
 *
 *   inflow  Q = Cd·A·√(2Δp/ρ)   Δp = sea pressure at the compartment − atmospheric
 *   drain pump: `drainRate` at the surface, falling linearly to 0 at `drainMaxDepth`
 *   damage control seals each hole: A ← A·exp(−dt/sealTime)
 *
 * Holes come from a hard grounding (at the bow, the stern or the keel, after
 * the direction of travel), a collision with a ship (`damage`, from World)
 * and from going below crush depth (the engine room, growing the deeper the
 * boat goes). At collapse depth the hull fails. The water is a point mass in
 * each compartment (Simulation adds it to the mass properties); a
 * compartment flooded beyond `disableFill` stops its machinery (electrics.ts).
 */
import type { CompartmentDef } from '../config/submarine';
import { ENVIRONMENT as E } from '../config/environment';
import { pressureAt, waterDensity } from '../environment';
import { mat3MulVec } from '../math/mat';
import { quatToMat3 } from '../math/quat';
import { getQuat, IDX } from '../rigidBody';
import type { Vec3 } from '../math/vec3';
import type { Simulation } from '../simulation';
import type { Subsystem } from './types';

export interface CompartmentFlood {
  id: string;
  name: string;
  /** Floodable volume [m^3]. */
  volume: number;
  /** Water inside [m^3]. */
  water: number;
  /** Area of the open holes [m^2]. */
  holeArea: number;
  /** Inflow at the last step [m^3/s]. */
  inflow: number;
}

/** What happened, for the log (the controller collects them). */
export interface DamageEvent {
  kind: 'leak' | 'sealed' | 'pumpedOut' | 'collapse';
  compartment: string;
  cause?: 'grounding' | 'collision' | 'depth' | 'charge';
}

export class Flooding implements Subsystem {
  readonly name = 'flooding';
  readonly compartments: CompartmentFlood[];
  /** True once the hull has collapsed below collapse depth. */
  collapsed = false;
  /** True while the drain pump runs. */
  drainRunning = false;
  private readonly defs: readonly CompartmentDef[];
  private wasGrounded = false;
  private events: DamageEvent[] = [];

  constructor(private readonly sim: Simulation) {
    const cfg = sim.cfg;
    this.defs = cfg.compartments;
    const r = cfg.hull.pressureHullRadius;
    this.compartments = cfg.compartments.map((c) => ({
      id: c.id,
      name: c.name,
      volume: Math.PI * r * r * (c.xRange[1] - c.xRange[0]) * cfg.damage.floodableFraction,
      water: 0,
      holeArea: 0,
      inflow: 0,
    }));
  }

  /** Water as a fraction of the floodable volume of a compartment (0 if unknown). */
  fill(id: string): number {
    const c = this.compartments.find((x) => x.id === id);
    return c ? c.water / c.volume : 0;
  }

  /** Total water inside [m^3]. */
  get water(): number {
    return this.compartments.reduce((s, c) => s + c.water, 0);
  }

  /** Opens a hole in a compartment (adds to any hole there). */
  damage(id: string, area: number, cause: DamageEvent['cause']): void {
    const c = this.compartments.find((x) => x.id === id);
    if (!c || area <= 0) return;
    const wasOpen = c.holeArea > 0;
    c.holeArea += area;
    if (!wasOpen) this.events.push({ kind: 'leak', compartment: c.id, cause });
  }

  /** Events since the last call (for the log). */
  drainEvents(): DamageEvent[] {
    const e = this.events;
    this.events = [];
    return e;
  }

  /** Point masses of the water inside, body frame (for the mass properties). */
  masses(): { m: number; r: Vec3 }[] {
    const out: { m: number; r: Vec3 }[] = [];
    const R = this.sim.cfg.hull.pressureHullRadius;
    const rho = this.sim.water.rhoSurface;
    this.compartments.forEach((c, i) => {
      if (c.water <= 0) return;
      const d = this.defs[i]!;
      const f = Math.min(1, c.water / c.volume);
      // The water lies in the bottom of the compartment: its centroid rises as it fills. APPROX (level-boat geometry).
      out.push({ m: c.water * rho, r: [(d.xRange[0] + d.xRange[1]) / 2, 0, R * (1 - f)] });
    });
    return out;
  }

  /** World depth [m] of a body-frame point (no waves: the leak is deep enough for them not to matter). */
  private depthOf(p: Vec3): number {
    const y = this.sim.y;
    return y[2]! + mat3MulVec(quatToMat3(getQuat(y)), p)[2];
  }

  update(dt: number): void {
    const sim = this.sim;
    const dmg = sim.cfg.damage;
    const depth = sim.y[2]!;

    // A hard grounding: the bow, the stern or the keel, after the direction of travel.
    const grounded = sim.groundContacts > 0;
    if (grounded && !this.wasGrounded) {
      const u = sim.y[IDX.NU]!;
      const w = sim.y[IDX.NU + 2]!;
      const speed = Math.hypot(u, sim.y[IDX.NU + 1]!, w);
      if (speed > dmg.groundingSpeed) {
        const where = Math.abs(w) > Math.abs(u) ? 'living' : u > 0 ? 'torpedo' : 'motor';
        this.damage(where, dmg.groundingHole * (speed / dmg.groundingSpeed) ** 2, 'grounding');
      }
    }
    this.wasGrounded = grounded;

    // Below crush depth the hull leaks in the engine room (most penetrations), more the deeper.
    if (depth > dmg.crushDepth && !this.collapsed) this.damage('engine', dmg.crushLeakGrowth * (depth - dmg.crushDepth) * dt, 'depth');
    if (depth > dmg.collapseDepth && !this.collapsed) {
      this.collapsed = true;
      for (const c of this.compartments) c.holeArea = Math.max(c.holeArea, 0.5);
      this.events.push({ kind: 'collapse', compartment: 'engine' });
    }

    // Inflow through the holes, and damage control sealing them.
    this.compartments.forEach((c, i) => {
      c.inflow = 0;
      if (c.holeArea <= 0) return;
      const d = this.defs[i]!;
      const at = this.depthOf([(d.xRange[0] + d.xRange[1]) / 2, 0, 0]);
      if (at > 0 && c.water < c.volume) {
        const rho = waterDensity(at, sim.water);
        const dp = pressureAt(at, sim.water) - E.pAtm;
        c.inflow = dmg.holeCd * c.holeArea * Math.sqrt((2 * dp) / rho);
        c.water = Math.min(c.volume, c.water + c.inflow * dt);
      }
      // Below crush depth the hull keeps working open: damage control cannot seal it there.
      if (!this.collapsed && depth < dmg.crushDepth) {
        c.holeArea *= Math.exp(-dt / dmg.sealTime);
        if (c.holeArea < dmg.sealedArea) {
          c.holeArea = 0;
          this.events.push({ kind: 'sealed', compartment: c.id });
        }
      }
    });

    // The drain pump: the wettest compartment first.
    const capacity = dmg.drainRate * Math.max(0, 1 - Math.max(0, depth) / dmg.drainMaxDepth) * dt;
    const wet = this.compartments.filter((c) => c.water > 0).sort((a, b) => b.water - a.water);
    this.drainRunning = wet.length > 0 && capacity > 0 && !this.collapsed;
    if (this.drainRunning) {
      let left = capacity;
      for (const c of wet) {
        const dv = Math.min(left, c.water);
        c.water -= dv;
        left -= dv;
        if (c.water <= 1e-6) {
          c.water = 0;
          if (c.holeArea === 0) this.events.push({ kind: 'pumpedOut', compartment: c.id });
        }
        if (left <= 0) break;
      }
    }
  }
}
