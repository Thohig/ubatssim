/**
 * The submarine simulation: owns the full plant state and advances it with
 * a fixed time step. Pure TypeScript – no rendering, DOM or wall clock.
 *
 * Per step:
 *  1. actuators move toward their commands (rate-limited),
 *  2. tanks, pumps and the air system advance (explicit, at dt),
 *  3. mass properties are recomputed from the tanks and frozen,
 *  4. rigid body + shaft speed are integrated with RK4.
 *
 * Momentum flux of water flowing in and out of tanks is neglected.
 */
import { ENVIRONMENT as E } from './config/environment';
import { SUBMARINE, type SubmarineConfig, type TankDef } from './config/submarine';
import { waterDensity } from './environment';
import { addedMassMatrix, hullDamping } from './hydrodynamics';
import { buildHull, type HullGeometry } from './hull';
import { airForFill, updateMainBallast, type AirState } from './airSystem';
import { finForce } from './controlSurfaces';
import { contactForces, hullContactPoints, type ContactResult, type GroundDepth } from './contact';
import { seabedDepth } from './terrain';
import { TerrainGrid } from './terrainGrid';

/** Shared terrain cache for the default archipelago ground. */
let defaultGround: TerrainGrid | null = null;
export function archipelagoGround(): GroundDepth {
  defaultGround ??= new TerrainGrid(seabedDepth);
  return defaultGround.depth;
}
import { restoringForces, type HydrostaticResult } from './hydrostatics';
import { computeMassProperties, type DryMass } from './massProperties';
import { mat3Diag, mat3MulVec, type MatN } from './math/mat';
import { quatFromEuler, quatToEuler, quatToMat3 } from './math/quat';
import type { Vec3 } from './math/vec3';
import { propellerForces } from './propulsion';
import { rk4Step } from './rk4';
import {
  IDX,
  RIGID_STATE_SIZE,
  RigidBody,
  getPos,
  getQuat,
  normalizeQuatInState,
  rigidBodyMassMatrix,
  type MassProperties,
} from './rigidBody';
import { initialTankState, type TankState } from './tanks';

export const DT = 0.01;
/** Index of shaft speed n [rev/s] in the state vector. */
export const IDX_SHAFT = RIGID_STATE_SIZE;
export const STATE_SIZE = RIGID_STATE_SIZE + 1;

/** Plant-level commands written by the controller each step. */
export interface Commands {
  /** Rudder command [rad], positive = starboard. */
  rudder: number;
  /** Stern planes command [rad], positive = dive. */
  sternPlanes: number;
  /** Shaft speed command [rev/s]. */
  rps: number;
}

export interface InitialConditions {
  /** CO depth [m]. Default: floating equilibrium on the surface. */
  depth?: number;
  /** Heading [rad]. */
  heading?: number;
  /** Forward speed [m/s]; the shaft starts at the matching speed. */
  speed?: number;
  /** Main ballast fill 0..1. Default 0 (surfaced) or 1 if depth is given. */
  mainBallastFill?: number;
  /** Start trim and compensating tanks at their design fill (exactly neutral at the design depth). */
  designTrim?: boolean;
  /** Override the fill fraction of individual trim/compensating tanks (by id), applied after designTrim. */
  tankFills?: Record<string, number>;
  /** Start position [m] north and east of the origin. */
  north?: number;
  east?: number;
  /** Ground model (sea bed depth at north/east). Defaults to the archipelago terrain. */
  ground?: GroundDepth;
}

/**
 * Dry mass and CG chosen so that, in the design condition (MBT full,
 * other tanks at their initial fill, level, at the design depth), the boat is
 * neutrally buoyant with CG directly below CB by BG.
 */
export function deriveDryMass(cfg: SubmarineConfig, hull: HullGeometry): DryMass {
  const z = cfg.design.neutralDepth;
  const hs = restoringForces(hull, [0, 0, z], mat3Diag(1, 1, 1), 0, [0, 0, 0], cfg.hull.compressibility);
  const totalMass = hs.buoyancy / E.g;
  const cgTotal: Vec3 = [hs.cb[0], 0, hs.cb[2] + cfg.design.bg];
  let m = totalMass;
  const mom: Vec3 = [totalMass * cgTotal[0], 0, totalMass * cgTotal[2]];
  for (const def of cfg.tanks) {
    const fill = def.kind === 'mainBallast' ? 1 : (def.designFill ?? def.initialFill);
    const rho = def.kind === 'mainBallast' ? waterDensity(z) : E.rhoSurface;
    const mw = def.volume * fill * rho;
    const h = def.shape.type === 'box' ? def.shape.size[2] : 2 * def.shape.radius;
    const r: Vec3 = [def.position[0], def.position[1], def.position[2] + (h / 2) * (1 - fill)];
    m -= mw;
    for (let k = 0; k < 3; k++) mom[k]! -= mw * r[k]!;
  }
  const cg: Vec3 = [mom[0] / m, mom[1] / m, mom[2] / m];
  const [kx, ky, kz] = cfg.design.radiiOfGyration;
  return { mass: m, cg, inertiaCg: mat3Diag(m * kx * kx, m * ky * ky, m * kz * kz) };
}

export interface Telemetry {
  t: number;
  /** CO position NED [m]. */
  position: Vec3;
  depth: number;
  /** Euler angles [rad]. */
  roll: number;
  pitch: number;
  /** Heading 0..2π [rad]. */
  heading: number;
  /** Body velocities [m/s] and rates [rad/s]. */
  u: number;
  v: number;
  w: number;
  p: number;
  q: number;
  r: number;
  /** Vertical speed in world frame [m/s], positive down. */
  depthRate: number;
  rudder: number;
  rudderCmd: number;
  sternPlanes: number;
  sternPlanesCmd: number;
  rps: number;
  rpsCmd: number;
  thrust: number;
  shaftPower: number;
  tanks: { id: string; name: string; kind: TankDef['kind']; fill: number; water: number; volume: number; ventOpen: boolean; blowOpen: boolean }[];
  /** HP air bottle pressure [Pa]. */
  airPressure: number;
  mass: number;
  buoyancy: number;
  /** Buoyancy minus weight [N]; positive = light. */
  netBuoyancy: number;
  submergedFraction: number;
  trimRemaining: number;
  compRemaining: number;
  /** True while any part of the hull touches the ground. */
  grounded: boolean;
  /** Sea bed depth below the boat [m] (negative over land). */
  seabedDepth: number;
  /** Echo sounder: water depth below the keel [m]. */
  depthUnderKeel: number;
}

export class Simulation {
  readonly cfg: SubmarineConfig;
  readonly hull: HullGeometry;
  readonly dry: DryMass;
  readonly tankDefs: readonly TankDef[];
  readonly MA: MatN;
  readonly ground: GroundDepth;
  readonly contactPoints: Vec3[];

  t = 0;
  y: Float64Array = new Float64Array(STATE_SIZE);
  tanks: TankState[];
  air: AirState;
  actuators = { rudder: 0, sternPlanes: 0 };
  commands: Commands = { rudder: 0, sternPlanes: 0, rps: 0 };
  /** Remaining trim transfer [m^3], positive = aft → forward. */
  trimRemaining = 0;
  /** Remaining compensating transfer [m^3], positive = flood from sea. */
  compRemaining = 0;

  private massProps!: MassProperties;
  private body!: RigidBody;
  private lastHydrostatics: HydrostaticResult | null = null;

  constructor(init: InitialConditions = {}, cfg: SubmarineConfig = SUBMARINE) {
    this.cfg = cfg;
    this.ground = init.ground ?? archipelagoGround();
    this.contactPoints = hullContactPoints(cfg);
    this.hull = buildHull(cfg.hull);
    this.dry = deriveDryMass(cfg, this.hull);
    this.tankDefs = cfg.tanks;
    this.MA = addedMassMatrix(cfg, this.hull, E.rhoSurface, this.dry.inertiaCg[0]);
    this.tanks = cfg.tanks.map(initialTankState);
    if (init.designTrim) {
      cfg.tanks.forEach((def, i) => {
        if (def.kind !== 'mainBallast') this.tanks[i]!.water = def.volume * (def.designFill ?? def.initialFill);
      });
    }
    if (init.tankFills) {
      cfg.tanks.forEach((def, i) => {
        const fill = init.tankFills![def.id];
        if (fill !== undefined && def.kind !== 'mainBallast') this.tanks[i]!.water = def.volume * Math.min(1, Math.max(0, fill));
      });
    }
    this.air = { bottlePV: cfg.air.bottlePressure * cfg.air.bottleVolume };

    const mbtFill = init.mainBallastFill ?? (init.depth !== undefined ? 1 : 0);
    this.y[IDX.QUAT] = 1;
    const q = quatFromEuler(0, 0, init.heading ?? 0);
    this.y.set(q, IDX.QUAT);
    this.y[0] = init.north ?? 0;
    this.y[1] = init.east ?? 0;
    this.y[2] = init.depth ?? 0;
    this.setMainBallastFill(mbtFill);
    if (init.depth === undefined) this.y[2] = this.floatingDepth();
    this.setMainBallastFill(mbtFill); // re-equilibrate air at the final depth
    if (init.speed) {
      this.y[IDX.NU] = init.speed;
      const rps = this.rpsForSpeed(init.speed);
      this.y[IDX_SHAFT] = rps;
      this.commands.rps = rps;
    }
    this.refreshMass();
  }

  // ---------------------------------------------------------------- commands

  setVents(open: boolean, ids?: string[]): void {
    this.forMbt(ids, (s) => {
      s.ventOpen = open;
      if (open) s.blowOpen = false;
    });
  }

  setBlow(open: boolean, ids?: string[]): void {
    this.forMbt(ids, (s) => {
      s.blowOpen = open;
      if (open) s.ventOpen = false;
    });
  }

  /** Queue a trim transfer [m^3]; positive moves water aft → forward. Replaces any pending transfer. */
  requestTrimTransfer(volume: number): void {
    this.trimRemaining = volume;
  }

  /** Queue a compensating transfer [m^3]; positive floods from sea, negative pumps out. */
  requestCompensation(volume: number): void {
    this.compRemaining = volume;
  }

  // ------------------------------------------------------------------- state

  get massProperties(): MassProperties {
    return this.massProps;
  }

  tankWorldDepths(def: TankDef): { bottom: number; top: number; centre: number } {
    const R = quatToMat3(getQuat(this.y));
    const pos = getPos(this.y);
    const h = def.shape.type === 'box' ? def.shape.size[2] : 2 * def.shape.radius;
    const depthOf = (p: Vec3) => pos[2] + mat3MulVec(R, p)[2];
    const [x, y, z] = def.position;
    return { bottom: depthOf([x, y, z + h / 2]), top: depthOf([x, y, z - h / 2]), centre: depthOf(def.position) };
  }

  // -------------------------------------------------------------------- step

  step(dt = DT): void {
    this.updateActuators(dt);
    this.updateTanks(dt);
    this.refreshMass();
    const f = (_t: number, y: Float64Array) => this.derivative(y);
    this.y = rk4Step(f, this.t, this.y, dt);
    normalizeQuatInState(this.y);
    this.t += dt;
  }

  /** Total generalized external force on the hull in body frame at state y. */
  externalForces(y: Float64Array): {
    tau: Float64Array;
    hydrostatics: HydrostaticResult;
    contact: ContactResult;
    propThrust: number;
    propTorque: number;
    motorTorque: number;
  } {
    const cfg = this.cfg;
    const pos = getPos(y);
    const R = quatToMat3(getQuat(y));
    const nu = y.subarray(IDX.NU, IDX.NU + 6);
    const rho = waterDensity(Math.max(0, pos[2]));
    const tau = new Float64Array(6);
    const add = (f: ArrayLike<number>) => {
      for (let i = 0; i < 6; i++) tau[i]! += f[i]!;
    };

    const hs = restoringForces(this.hull, pos, R, this.massProps.mass, this.massProps.cg, cfg.hull.compressibility);
    add(hs.tau);
    add(hullDamping(cfg, this.hull, nu, rho));
    for (const fin of cfg.fins) {
      const delta = fin.actuator === null ? 0 : this.actuators[fin.actuator];
      add(finForce(fin, nu, delta, rho));
    }
    const prop = propellerForces(cfg.propulsion, y[IDX_SHAFT]!, nu[0]!, this.commands.rps, rho);
    tau[0]! += prop.thrust;
    tau[3]! -= prop.torque; // reaction torque on the hull
    const contact = contactForces(this.contactPoints, pos, R, nu, this.ground, cfg.contact);
    add(contact.tau);
    return { tau, hydrostatics: hs, contact, propThrust: prop.thrust, propTorque: prop.torque, motorTorque: prop.motorTorque };
  }

  /** Number of hull points touching the ground at the last force evaluation. */
  groundContacts = 0;

  private derivative(y: Float64Array): Float64Array {
    const out = new Float64Array(STATE_SIZE);
    const ext = this.externalForces(y);
    this.groundContacts = ext.contact.points;
    this.body.derivative(y, ext.tau, out);
    out[IDX_SHAFT] = (ext.motorTorque - ext.propTorque) / (2 * Math.PI * this.cfg.propulsion.shaftInertia);
    return out;
  }

  private updateActuators(dt: number): void {
    const a = this.cfg.actuators;
    const maxStep = a.slewRate * dt;
    const move = (cur: number, cmd: number, lim: number) => {
      const target = Math.max(-lim, Math.min(lim, cmd));
      return cur + Math.max(-maxStep, Math.min(maxStep, target - cur));
    };
    this.actuators.rudder = move(this.actuators.rudder, this.commands.rudder, a.rudderMax);
    this.actuators.sternPlanes = move(this.actuators.sternPlanes, this.commands.sternPlanes, a.planesMax);
    const p = this.cfg.propulsion;
    this.commands.rps = Math.max(-p.maxRps, Math.min(p.maxRps, this.commands.rps));
  }

  private updateTanks(dt: number): void {
    this.tankDefs.forEach((def, i) => {
      const s = this.tanks[i]!;
      if (def.kind !== 'mainBallast') return;
      const d = this.tankWorldDepths(def);
      updateMainBallast(def, s, this.air, this.cfg.air, d.bottom, d.top, waterDensity(Math.max(0, d.centre)), dt);
    });

    const fwd = this.tankById('trim_fwd');
    const aft = this.tankById('trim_aft');
    if (fwd && aft && this.trimRemaining !== 0) {
      const dir = Math.sign(this.trimRemaining);
      const [from, to] = dir > 0 ? [aft, fwd] : [fwd, aft];
      const room = to.def.volume - to.s.water;
      const dv = Math.min(this.cfg.pumps.trimRate * dt, Math.abs(this.trimRemaining), from.s.water, room);
      from.s.water -= dv;
      to.s.water += dv;
      this.trimRemaining -= dir * dv;
      if (dv <= 0 || Math.abs(this.trimRemaining) < 1e-9) this.trimRemaining = 0;
    }

    const comp = this.tankById('comp');
    if (comp && this.compRemaining !== 0) {
      const dir = Math.sign(this.compRemaining);
      const limit = dir > 0 ? comp.def.volume - comp.s.water : comp.s.water;
      const dv = Math.min(this.cfg.pumps.compRate * dt, Math.abs(this.compRemaining), limit);
      comp.s.water += dir * dv;
      this.compRemaining -= dir * dv;
      if (dv <= 0 || Math.abs(this.compRemaining) < 1e-9) this.compRemaining = 0;
    }
  }

  private refreshMass(): void {
    this.massProps = computeMassProperties(this.dry, this.tankDefs, this.tanks, (def) =>
      def.kind === 'mainBallast' ? waterDensity(Math.max(0, this.tankWorldDepths(def).centre)) : E.rhoSurface,
    );
    const MRB = rigidBodyMassMatrix(this.massProps);
    this.body = new RigidBody(MRB.plus(this.MA), MRB);
  }

  // ----------------------------------------------------------------- helpers

  private forMbt(ids: string[] | undefined, fn: (s: TankState) => void): void {
    this.tankDefs.forEach((def, i) => {
      if (def.kind === 'mainBallast' && (!ids || ids.includes(def.id))) fn(this.tanks[i]!);
    });
  }

  private tankById(id: string): { def: TankDef; s: TankState } | null {
    const i = this.tankDefs.findIndex((d) => d.id === id);
    return i < 0 ? null : { def: this.tankDefs[i]!, s: this.tanks[i]! };
  }

  /** Sets all main ballast tanks to a fill fraction with consistent air content. */
  setMainBallastFill(fill: number): void {
    this.tankDefs.forEach((def, i) => {
      if (def.kind !== 'mainBallast') return;
      const s = this.tanks[i]!;
      const d = this.tankWorldDepths(def);
      s.water = fill * def.volume;
      s.airPV = airForFill(def, fill, d.bottom, d.top, waterDensity(Math.max(0, d.centre)));
    });
    this.refreshMass();
  }

  /** Level-attitude depth where buoyancy equals weight (bisection). */
  floatingDepth(): number {
    this.refreshMass();
    const R = quatToMat3(getQuat(this.y));
    const W = this.massProps.mass * E.g;
    let lo = -this.cfg.hull.radius;
    let hi = this.cfg.hull.radius * 1.5;
    for (let i = 0; i < 60; i++) {
      const mid = 0.5 * (lo + hi);
      const hs = restoringForces(this.hull, [0, 0, mid], R, 0, [0, 0, 0], this.cfg.hull.compressibility);
      if (hs.buoyancy > W) hi = mid;
      else lo = mid;
    }
    return 0.5 * (lo + hi);
  }

  /** Steady shaft speed for a forward speed (bisection on surge balance). */
  rpsForSpeed(speed: number): number {
    const p = this.cfg.propulsion;
    const rho = E.rhoSurface;
    const L = this.cfg.hull.length;
    const drag = -0.5 * rho * L * L * this.cfg.hydro.Xuu * speed * speed - this.cfg.hydro.lowSpeed.Xu * speed;
    let lo = 0;
    let hi: number = p.maxRps;
    for (let i = 0; i < 50; i++) {
      const n = 0.5 * (lo + hi);
      const t = propellerForces(p, n, speed, n, rho).thrust;
      if (t > drag) hi = n;
      else lo = n;
    }
    return 0.5 * (lo + hi);
  }

  /** Position, attitude and velocities only (no force evaluation). Cheap enough to call every step. */
  kinematics(): { depth: number; depthRate: number; pitch: number; heading: number; u: number; q: number; r: number } {
    const R = quatToMat3(getQuat(this.y));
    const [, pitch, yaw] = quatToEuler(getQuat(this.y));
    const nu = this.y.subarray(IDX.NU, IDX.NU + 6);
    const vWorld = mat3MulVec(R, [nu[0]!, nu[1]!, nu[2]!]);
    return {
      depth: this.y[2]!,
      depthRate: vWorld[2],
      pitch,
      heading: (yaw + 2 * Math.PI) % (2 * Math.PI),
      u: nu[0]!,
      q: nu[4]!,
      r: nu[5]!,
    };
  }

  telemetry(): Telemetry {
    const ext = this.externalForces(this.y);
    this.lastHydrostatics = ext.hydrostatics;
    const pos = getPos(this.y);
    const [roll, pitch, yaw] = quatToEuler(getQuat(this.y));
    const R = quatToMat3(getQuat(this.y));
    const nu = this.y.subarray(IDX.NU, IDX.NU + 6);
    const vWorld = mat3MulVec(R, [nu[0]!, nu[1]!, nu[2]!]);
    const n = this.y[IDX_SHAFT]!;
    const W = this.massProps.mass * E.g;
    return {
      t: this.t,
      position: pos,
      depth: pos[2],
      roll,
      pitch,
      heading: (yaw + 2 * Math.PI) % (2 * Math.PI),
      u: nu[0]!,
      v: nu[1]!,
      w: nu[2]!,
      p: nu[3]!,
      q: nu[4]!,
      r: nu[5]!,
      depthRate: vWorld[2],
      rudder: this.actuators.rudder,
      rudderCmd: this.commands.rudder,
      sternPlanes: this.actuators.sternPlanes,
      sternPlanesCmd: this.commands.sternPlanes,
      rps: n,
      rpsCmd: this.commands.rps,
      thrust: ext.propThrust,
      shaftPower: 2 * Math.PI * n * ext.propTorque,
      tanks: this.tankDefs.map((def, i) => {
        const s = this.tanks[i]!;
        return { id: def.id, name: def.name, kind: def.kind, fill: s.water / def.volume, water: s.water, volume: def.volume, ventOpen: s.ventOpen, blowOpen: s.blowOpen };
      }),
      airPressure: this.air.bottlePV / this.cfg.air.bottleVolume,
      mass: this.massProps.mass,
      buoyancy: ext.hydrostatics.buoyancy,
      netBuoyancy: ext.hydrostatics.buoyancy - W,
      submergedFraction: ext.hydrostatics.submergedFraction,
      trimRemaining: this.trimRemaining,
      compRemaining: this.compRemaining,
      grounded: ext.contact.points > 0,
      seabedDepth: this.ground(pos[0], pos[1]),
      depthUnderKeel: this.ground(pos[0], pos[1]) - (pos[2] + this.cfg.hull.radius),
    };
  }

  /** Mechanical energy: kinetic + gravitational/buoyant potential is not
   * closed-form for the strip model, so tests use kinetic energy at
   * neutral buoyancy. */
  kineticEnergy(): number {
    return this.body.kineticEnergy(this.y.subarray(IDX.NU, IDX.NU + 6));
  }

  get hydrostatics(): HydrostaticResult | null {
    return this.lastHydrostatics;
  }
}
