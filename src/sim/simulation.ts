/**
 * The submarine simulation: owns the full plant state and advances it with
 * a fixed time step. Pure TypeScript – no rendering, DOM or wall clock.
 *
 * Per step:
 *  1. actuators move toward their commands (rate-limited),
 *  2. tanks, pumps, the air system, flooding and the electrics advance (explicit, at dt),
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
import type { AirState } from './airSystem';
import { finForce } from './controlSurfaces';
import { contactForces, hullContactPoints, type ContactResult, type GroundDepth } from './contact';
import { heightFunction, seabedDepth } from './terrain';
import { AREAS, type AreaId, type CurrentDef } from './config/areas';
import { DESIGN_WATER, type WaterProfile } from './config/waters';
import { TerrainGrid } from './terrainGrid';

/** Shared terrain cache for the default archipelago ground. */
const grounds = new Map<AreaId, TerrainGrid>();

/** Cached sea bed of an area (shared by all simulations of that area). */
export function areaGround(area: AreaId): GroundDepth {
  let g = grounds.get(area);
  if (!g) {
    const h = area === 'westCoast' ? null : heightFunction(AREAS[area].terrain);
    g = new TerrainGrid(h ? (n, e) => -h(n, e) : seabedDepth);
    grounds.set(area, g);
  }
  return g.depth;
}

/** Coarse terrain caches for the sound paths (seabed.ts, `terrainBlocks`), per area. */
const acousticGrounds = new Map<AreaId, TerrainGrid>();

/**
 * The sea bed of an area on a 50 m grid, for acoustic shadows over many
 * kilometres: the 4 m grid of the contact model would fill thousands of
 * tiles along one sound path. Deterministic like the fine grid.
 */
export function areaAcousticGround(area: AreaId): GroundDepth {
  let g = acousticGrounds.get(area);
  if (!g) {
    const h = heightFunction(AREAS[area].terrain);
    g = new TerrainGrid((n, e) => -h(n, e), 50, 32, 600);
    acousticGrounds.set(area, g);
  }
  return g.depth;
}

/** The west coast archipelago (the default area). */
export const archipelagoGround = (): GroundDepth => areaGround('westCoast');
import { restoringForces, sliceSurface, surfaceDamping, type HydrostaticResult } from './hydrostatics';
import { computeMassProperties, type DryMass } from './massProperties';
import { mat3Diag, mat3MulVec, type Mat3, type MatN } from './math/mat';
import { quatFromEuler, quatToEuler, quatToMat3 } from './math/quat';
import { cross, type Vec3 } from './math/vec3';
import { SEA_STATES, type SeaState, type SeaStateId } from './config/seaStates';
import { waveComponents, waveElevation, waveVelocity, type WaveComponent } from './waves';
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
import { Actuators, type ActuatorState } from './systems/actuators';
import { MainBallast } from './systems/mainBallast';
import { Mast } from './systems/masts';
import { Pumps } from './systems/pumps';
import { Electrics } from './systems/electrics';
import { Compressor } from './systems/compressor';
import { Flooding, type CompartmentFlood } from './systems/flooding';
import { Snag } from './systems/snag';
import type { ForceContext, Subsystem } from './systems/types';

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
  /** Raise (true) or lower the periscope. */
  periscopeUp: boolean;
  /** Run the low-pressure blower that keeps surfaced main ballast tanks dry. */
  lpBlower: boolean;
  /** Raise (true) or lower the snorkel mast. */
  snorkelUp: boolean;
  /** Run the diesel generators (they run only with air: surfaced or snorkelling). */
  diesel: boolean;
  /** Raise (true) or lower the radar mast. */
  radarUp: boolean;
  /** Shut the watertight doors between the compartments (true) or open them. */
  doorsShut: boolean;
}

/**
 * A point mass [kg] at a body-frame point [m], added to the boat: what has
 * moved or gone from the design loadout (torpedoes fired or moved from the
 * racks into the tubes, water in the tubes). Negative for mass gone.
 */
export interface PayloadMass {
  m: number;
  r: Vec3;
}

export interface InitialConditions {
  /** CO depth [m]. Default: floating equilibrium on the surface. */
  depth?: number;
  /** Heading [rad]. */
  heading?: number;
  /** Forward speed through the water [m/s]; the shaft starts at the matching speed. The boat also drifts with the current. */
  speed?: number;
  /** Main ballast fill 0..1. Default 0 (surfaced) or 1 if depth is given. */
  mainBallastFill?: number;
  /** Start trim and compensating tanks at their design fill (exactly neutral at the design depth). */
  designTrim?: boolean;
  /**
   * Start neutrally buoyant at the start depth: trim tanks at their design
   * fill, compensating tank adjusted for the water and compression there.
   */
  neutral?: boolean;
  /** Override the fill fraction of individual trim/compensating tanks (by id), applied after designTrim. */
  tankFills?: Record<string, number>;
  /** Start position [m] north and east of the origin. */
  north?: number;
  east?: number;
  /** Sea area (terrain, water and current). Default: the west coast. */
  area?: AreaId;
  /** Override the area's current (e.g. none in a test). */
  current?: CurrentDef;
  /** Sea state (waves). Default: calm. */
  sea?: SeaStateId | SeaState;
  /** Ground model (sea bed depth at north/east). Defaults to the area's terrain. */
  ground?: GroundDepth;
  /** Battery state of charge 0…1 (default `electrics.initialCharge`). */
  battery?: number;
  /** Open holes at the start: compartment id → hole area [m^2]. */
  leaks?: Record<string, number>;
}

/**
 * Dry mass and CG chosen so that, in the design condition (MBT full,
 * other tanks at their initial fill, level, at the design depth), the boat is
 * neutrally buoyant with CG directly below CB by BG.
 */
export function deriveDryMass(cfg: SubmarineConfig, hull: HullGeometry, water: WaterProfile = DESIGN_WATER): DryMass {
  const z = cfg.design.neutralDepth;
  const hs = restoringForces(hull, [0, 0, z], mat3Diag(1, 1, 1), 0, [0, 0, 0], cfg.hull.compressibility, water);
  const totalMass = hs.buoyancy / E.g;
  const cgTotal: Vec3 = [hs.cb[0], 0, hs.cb[2] + cfg.design.bg];
  let m = totalMass;
  const mom: Vec3 = [totalMass * cgTotal[0], 0, totalMass * cgTotal[2]];
  for (const def of cfg.tanks) {
    const fill = def.kind === 'mainBallast' ? 1 : (def.designFill ?? def.initialFill);
    const rho = def.kind === 'mainBallast' ? waterDensity(z, water) : water.rhoSurface;
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
  /** Body velocities through the water (the log) [m/s] and rates [rad/s]. */
  u: number;
  v: number;
  w: number;
  p: number;
  q: number;
  r: number;
  /** Vertical speed in world frame [m/s], positive down. */
  depthRate: number;
  /** Speed [m/s] and course [rad, 0..2π] over the ground. */
  speedOverGround: number;
  courseOverGround: number;
  /** Current at the boat, NED [m/s] (without the waves' orbital motion). */
  current: Vec3;
  /** Wave elevation at the boat [m, up]. */
  waveElevation: number;
  rudder: number;
  rudderCmd: number;
  sternPlanes: number;
  sternPlanesCmd: number;
  rps: number;
  rpsCmd: number;
  /** Periscope extension 0 (housed) … 1 (raised). */
  periscope: number;
  /** World depth of the periscope head [m]; negative = above the water. */
  periscopeHeadDepth: number;
  /** World depth of the bridge deck [m]; negative = above the water. */
  bridgeDeckDepth: number;
  /** Snorkel mast extension 0 … 1, and the depth of its head [m] (negative = above the water). */
  snorkel: number;
  snorkelHeadDepth: number;
  /** Radar mast extension 0 … 1, and the depth of its head [m] (negative = above the water). */
  radar: number;
  radarHeadDepth: number;
  /** Change of mass from the design loadout (torpedoes and the water in the tubes) [kg]. */
  payload: number;
  /** Battery state of charge 0…1. */
  battery: number;
  /** Electrical load [W] and battery power [W, positive = discharge, negative = charge]. */
  electricalLoad: number;
  batteryPower: number;
  /** Diesels ordered on, running, and their generators' output [W]. */
  dieselOrdered: boolean;
  dieselRunning: boolean;
  generatorPower: number;
  /** Air reaches the diesels (surfaced, or the snorkel head above the water). */
  inductionAir: boolean;
  /** What the motor may take now [W] (less than its rating with an empty battery). */
  motorPowerLimit: number;
  /** Water in the compartments of the pressure hull, open holes and inflow. */
  compartments: CompartmentFlood[];
  drainPumpRunning: boolean;
  /** The watertight doors 0 (open) … 1 (shut), one per bulkhead from forward, and the compartment the drain pump takes first (null: the wettest). */
  doors: number[];
  drainTarget: string | null;
  /** The hull has collapsed below collapse depth. */
  hullCollapsed: boolean;
  thrust: number;
  shaftPower: number;
  tanks: { id: string; name: string; kind: TankDef['kind']; fill: number; water: number; volume: number; ventOpen: boolean; blowOpen: boolean }[];
  /** HP air bottle pressure [Pa]. */
  airPressure: number;
  /** The HP air compressors run (refilling the bottles). */
  compressor: boolean;
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
  /** The sea bed on a coarse grid, for sound paths (see `areaAcousticGround`). */
  readonly acousticGround: GroundDepth;
  readonly areaId: AreaId;
  readonly water: WaterProfile;
  readonly current: CurrentDef;
  readonly sea: SeaState;
  readonly waves: readonly WaveComponent[];
  /** Scratch: wave elevation per hull slice for one force evaluation. */
  private readonly sliceElev: Float64Array;
  /** Wave elevation [m, up] at (north, east) now; undefined in a calm sea. */
  readonly surface: ((north: number, east: number) => number) | undefined;
  readonly contactPoints: Vec3[];

  t = 0;
  y: Float64Array = new Float64Array(STATE_SIZE);
  tanks: TankState[];
  air: AirState;
  commands: Commands = { rudder: 0, sternPlanes: 0, rps: 0, periscopeUp: false, lpBlower: false, snorkelUp: false, diesel: false, radarUp: false, doorsShut: false };
  /**
   * Point masses that differ from the design loadout, written by the
   * controller (the torpedo room). Replace the array to change it; empty =
   * the design loadout, which the dry mass already holds.
   */
  payload: readonly PayloadMass[] = [];

  /** The boat's subsystems (see systems/types.ts). */
  readonly systems: {
    actuators: Actuators;
    mainBallast: MainBallast;
    pumps: Pumps;
    flooding: Flooding;
    electrics: Electrics;
    /** The HP air compressors (systems/compressor.ts). */
    compressor: Compressor;
    periscopeMast: Mast;
    snorkelMast: Mast;
    radarMast: Mast;
    /** Caught in a trawl (systems/snag.ts). */
    snag: Snag;
  };
  /** Run once per step, in this order, before the integration. */
  private readonly updateOrder: Subsystem[];
  /** Add their forces at every force evaluation, in this order (after the hull, before contact). */
  private readonly forceOrder: Subsystem[];

  private massProps!: MassProperties;
  private body!: RigidBody;
  private lastHydrostatics: HydrostaticResult | null = null;
  /**
   * The force evaluation behind the last telemetry, with what it depends on.
   * Instruments, scenario checks, sound and the assistant all ask for
   * telemetry; between two steps they get the same forces (exact).
   */
  private telemetryForces: {
    y: Float64Array;
    t: number;
    mass: MassProperties;
    rudder: number;
    planes: number;
    periscope: number;
    rps: number;
    snorkel: number;
    radar: number;
    powerLimit: number;
    snag: string | null;
    ext: ReturnType<Simulation['externalForces']>;
  } | null = null;

  constructor(init: InitialConditions = {}, cfg: SubmarineConfig = SUBMARINE) {
    this.cfg = cfg;
    this.systems = {
      actuators: new Actuators(this),
      mainBallast: new MainBallast(this),
      pumps: new Pumps(this),
      flooding: new Flooding(this),
      electrics: new Electrics(this, init.battery),
      compressor: new Compressor(this),
      periscopeMast: new Mast(this, 'periscope'),
      snorkelMast: new Mast(this, 'snorkel'),
      radarMast: new Mast(this, 'radar'),
      snag: new Snag(this),
    };
    // Flooding and the compressors before the electrics: the drain pump and the compressors are part of the load.
    this.updateOrder = [this.systems.actuators, this.systems.mainBallast, this.systems.pumps, this.systems.flooding, this.systems.compressor, this.systems.electrics, this.systems.snag];
    this.forceOrder = [this.systems.periscopeMast, this.systems.snorkelMast, this.systems.radarMast, this.systems.snag];
    for (const [id, area] of Object.entries(init.leaks ?? {})) this.systems.flooding.damage(id, area, undefined);
    this.areaId = init.area ?? 'westCoast';
    this.water = AREAS[this.areaId].water;
    this.current = init.current ?? AREAS[this.areaId].current;
    this.sea = typeof init.sea === 'object' ? init.sea : SEA_STATES[init.sea ?? 'calm'];
    this.waves = waveComponents(this.sea);
    this.surface = this.waves.length > 0 ? (n, e) => waveElevation(this.waves, n, e, this.t) : undefined;
    this.sliceElev = new Float64Array(cfg.hull.slices);
    this.ground = init.ground ?? areaGround(this.areaId);
    this.acousticGround = init.ground ?? areaAcousticGround(this.areaId);
    this.contactPoints = hullContactPoints(cfg);
    this.hull = buildHull(cfg.hull);
    // Fixed ballast adjusted in port for the area's water.
    this.dry = deriveDryMass(cfg, this.hull, this.water);
    this.tankDefs = cfg.tanks;
    this.MA = addedMassMatrix(cfg, this.hull, this.water.rhoSurface, this.dry.inertiaCg[0]);
    this.tanks = cfg.tanks.map(initialTankState);
    if (init.designTrim || init.neutral) {
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
    // The start speed is through the water: the boat already drifts with the current.
    const vc = this.currentBody(getPos(this.y), quatToMat3(getQuat(this.y)));
    for (let i = 0; i < 3; i++) this.y[IDX.NU + i]! += vc[i]!;
    this.refreshMass();
    if (init.neutral) this.trimNeutral();
  }

  /** Adjusts the compensating tank so that buoyancy equals weight in the present state. */
  private trimNeutral(): void {
    const comp = this.tankById('comp');
    if (!comp) return;
    for (let i = 0; i < 4; i++) {
      const R = quatToMat3(getQuat(this.y));
      const hs = restoringForces(this.hull, getPos(this.y), R, this.massProps.mass, this.massProps.cg, this.cfg.hull.compressibility, this.water);
      const net = hs.buoyancy - this.massProps.mass * E.g;
      comp.s.water = Math.min(comp.def.volume, Math.max(0, comp.s.water + net / (E.g * this.water.rhoSurface)));
      this.refreshMass();
    }
  }

  // ---------------------------------------------------------------- commands

  setVents(open: boolean, ids?: string[]): void {
    this.systems.mainBallast.setVents(open, ids);
  }

  setBlow(open: boolean, ids?: string[]): void {
    this.systems.mainBallast.setBlow(open, ids);
  }

  /** Queue a trim transfer [m^3]; positive moves water aft → forward. Replaces any pending transfer. */
  requestTrimTransfer(volume: number): void {
    this.systems.pumps.trimRemaining = volume;
  }

  /** Queue a compensating transfer [m^3]; positive floods from sea, negative pumps out. */
  requestCompensation(volume: number): void {
    this.systems.pumps.compRemaining = volume;
  }

  /** Rudder, planes and periscope as they are now. */
  get actuators(): ActuatorState {
    return this.systems.actuators.state;
  }

  /** Remaining trim transfer [m^3], positive = aft → forward. */
  get trimRemaining(): number {
    return this.systems.pumps.trimRemaining;
  }

  /** Remaining compensating transfer [m^3], positive = flood from sea. */
  /**
   * How much heavier [kg] the boat becomes going from depth `from` to `to` [m], level, with the main
   * ballast flooded and nothing else changed: the hull is compressed and the water's density changes
   * (the layers). Positive = heavier. Pure: does not touch the state. The crew uses it to compensate
   * ahead of a depth change (trimAssist.ts).
   */
  heavinessChange(from: number, to: number): number {
    const heaviness = (z: number): number => {
      const hs = restoringForces(this.hull, [0, 0, z], mat3Diag(1, 1, 1), 0, [0, 0, 0], this.cfg.hull.compressibility, this.water);
      let mbt = 0;
      for (const d of this.tankDefs) if (d.kind === 'mainBallast') mbt += d.volume;
      return mbt * waterDensity(z, this.water) - hs.buoyancy / E.g;
    };
    return heaviness(to) - heaviness(from);
  }

  /**
   * How heavy [kg] the boat would be at depth `z` [m], level, fully submerged with the main ballast
   * flooded and everything else as now (the other tanks, flooding, payload). Positive = heavy. Pure:
   * does not touch the state. The crew uses it to compensate during a dive from the surface, before the
   * boat is down where the net buoyancy can be measured (trimAssist.ts).
   */
  heavinessAt(z: number): number {
    const hs = restoringForces(this.hull, [0, 0, z], mat3Diag(1, 1, 1), 0, [0, 0, 0], this.cfg.hull.compressibility, this.water);
    let mass = this.massProps.mass;
    this.tankDefs.forEach((d, i) => {
      if (d.kind !== 'mainBallast') return;
      const now = waterDensity(Math.max(0, this.tankWorldDepths(d).centre), this.water);
      mass += d.volume * waterDensity(z, this.water) - this.tanks[i]!.water * now;
    });
    return mass - hs.buoyancy / E.g;
  }

  get compRemaining(): number {
    return this.systems.pumps.compRemaining;
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
    for (const sys of this.updateOrder) sys.update!(dt);
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
    const rho = waterDensity(Math.max(0, pos[2]), this.water);
    const tau = new Float64Array(6);
    const add = (f: ArrayLike<number>) => {
      for (let i = 0; i < 6; i++) tau[i]! += f[i]!;
    };
    // Hydrodynamic forces act on the velocity relative to the water, ν_r = ν − ν_c [F21 §10.3].
    const vc = this.currentBody(pos, R);
    const nuR = Float64Array.from(nu);
    for (let i = 0; i < 3; i++) nuR[i]! -= vc[i]!;
    // Constant current in NED: ν̇_c = −ω × v_c in the body frame, so (M_RB + M_A)ν̇ gains M_A ν̇_c.
    const w: Vec3 = [nu[3]!, nu[4]!, nu[5]!];
    const wxv = cross(w, vc);
    for (let i = 0; i < 3; i++) tau[i]! -= this.MA.get(i, i) * wxv[i]!;

    const elev = this.surface ? sliceSurface(this.hull, pos, R, this.surface, this.sliceElev) : undefined;
    const hs = restoringForces(this.hull, pos, R, this.massProps.mass, this.massProps.cg, cfg.hull.compressibility, this.water, elev);
    add(hs.tau);
    add(hullDamping(cfg, this.hull, nuR, rho));
    add(surfaceDamping(this.hull, pos, R, nuR, cfg.hydro.surfaceDamping, elev));
    for (const fin of cfg.fins) {
      const delta = fin.actuator === null ? 0 : this.actuators[fin.actuator];
      add(finForce(fin, nuR, delta, rho));
    }
    const prop = propellerForces(cfg.propulsion, y[IDX_SHAFT]!, nuR[0]!, this.commands.rps, rho, this.systems.electrics.powerLimit);
    tau[0]! += prop.thrust;
    tau[3]! -= prop.torque; // reaction torque on the hull
    if (this.forceOrder.length) {
      const ctx: ForceContext = { y, pos, R, nu, nuR };
      for (const sys of this.forceOrder) sys.forces!(ctx, tau);
    }
    const contact = contactForces(this.contactPoints, pos, R, nu, this.ground, cfg.contact);
    add(contact.tau);
    return { tau, hydrostatics: hs, contact, propThrust: prop.thrust, propTorque: prop.torque, motorTorque: prop.motorTorque };
  }

  /** Velocity of the water in NED [m/s] at a position: current plus wave orbital velocity. */
  currentAt(pos: Vec3, withWaves = true): Vec3 {
    const c = this.current;
    const s = c.speed === 0 ? 0 : c.speed * Math.exp(-Math.max(0, pos[2]) / c.decay);
    const v: Vec3 = [s * Math.cos(c.toward), s * Math.sin(c.toward), 0];
    if (withWaves && this.waves.length > 0) {
      const w = waveVelocity(this.waves, pos[0], pos[1], pos[2], this.t);
      for (let i = 0; i < 3; i++) v[i]! += w[i]!;
    }
    return v;
  }

  /** Current velocity in body axes at a position. */
  private currentBody(pos: Vec3, R: Mat3): Vec3 {
    const v = this.currentAt(pos);
    // Rᵀ v (R is row-major body→NED).
    return [
      R[0] * v[0] + R[3] * v[1] + R[6] * v[2],
      R[1] * v[0] + R[4] * v[1] + R[7] * v[2],
      R[2] * v[0] + R[5] * v[1] + R[8] * v[2],
    ];
  }

  /** Body-frame point of the snorkel head at the present extension. */
  snorkelHead(): Vec3 {
    const p = this.cfg.snorkel;
    return [p.base[0], p.base[1], p.base[2] - p.extension * this.actuators.snorkel];
  }

  /** Body-frame point of the radar antenna at the present extension. */
  radarHead(): Vec3 {
    const p = this.cfg.radar;
    return [p.base[0], p.base[1], p.base[2] - p.extension * this.actuators.radar];
  }

  /** Body-frame point of the periscope head at the present extension. */
  periscopeHead(): Vec3 {
    const p = this.cfg.periscope;
    return [p.base[0], p.base[1], p.base[2] - p.extension * this.actuators.periscope];
  }

  /** Depth [m] of a body-frame point below the local water surface (waves included); negative above it. */
  bodyPointDepth(p: Vec3, y: Float64Array = this.y): number {
    const R = quatToMat3(getQuat(y));
    const w = mat3MulVec(R, p);
    const d = y[2]! + w[2];
    return this.surface ? d + this.surface(y[0]! + w[0], y[1]! + w[1]) : d;
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

  private refreshMass(): void {
    this.massProps = computeMassProperties(
      this.dry,
      this.tankDefs,
      this.tanks,
      (def) => (def.kind === 'mainBallast' ? waterDensity(Math.max(0, this.tankWorldDepths(def).centre), this.water) : this.water.rhoSurface),
      this.payload.length ? [...this.systems.flooding.masses(), ...this.payload] : this.systems.flooding.masses(),
    );
    const MRB = rigidBodyMassMatrix(this.massProps);
    this.body = new RigidBody(MRB.plus(this.MA), MRB);
  }

  // ----------------------------------------------------------------- helpers

  /** A tank's definition and state by id. */
  tankById(id: string): { def: TankDef; s: TankState } | null {
    const i = this.tankDefs.findIndex((d) => d.id === id);
    return i < 0 ? null : { def: this.tankDefs[i]!, s: this.tanks[i]! };
  }

  /** Sets all main ballast tanks to a fill fraction with consistent air content. */
  setMainBallastFill(fill: number): void {
    this.systems.mainBallast.setFill(fill);
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
      const hs = restoringForces(this.hull, [0, 0, mid], R, 0, [0, 0, 0], this.cfg.hull.compressibility, this.water);
      if (hs.buoyancy > W) hi = mid;
      else lo = mid;
    }
    return 0.5 * (lo + hi);
  }

  /**
   * Steady shaft speed for a speed through the water (bisection on surge
   * balance). Negative speeds give a negative (astern) shaft speed. Speeds
   * beyond what the shaft limits allow give the limit.
   */
  rpsForSpeed(speed: number): number {
    const p = this.cfg.propulsion;
    const rho = this.water.rhoSurface;
    const L = this.cfg.hull.length;
    const drag = -0.5 * rho * L * L * this.cfg.hydro.Xuu * speed * Math.abs(speed) - this.cfg.hydro.lowSpeed.Xu * speed;
    let lo: number = speed < 0 ? -p.maxRpsAstern : 0;
    let hi: number = speed < 0 ? 0 : p.maxRps;
    for (let i = 0; i < 50; i++) {
      const n = 0.5 * (lo + hi);
      const t = propellerForces(p, n, speed, n, rho).thrust;
      if (t > drag) hi = n;
      else lo = n;
    }
    return 0.5 * (lo + hi);
  }

  /** Position, attitude and velocities only (no force evaluation). Cheap enough to call every step. */
  /** `u` is the speed through the water (what the log and the autopilot use). */
  kinematics(): { depth: number; depthRate: number; pitch: number; heading: number; u: number; q: number; r: number } {
    const R = quatToMat3(getQuat(this.y));
    const [, pitch, yaw] = quatToEuler(getQuat(this.y));
    const nu = this.y.subarray(IDX.NU, IDX.NU + 6);
    const vWorld = mat3MulVec(R, [nu[0]!, nu[1]!, nu[2]!]);
    const vc = this.currentBody(getPos(this.y), R);
    return {
      depth: this.y[2]!,
      depthRate: vWorld[2],
      pitch,
      heading: (yaw + 2 * Math.PI) % (2 * Math.PI),
      u: nu[0]! - vc[0],
      q: nu[4]!,
      r: nu[5]!,
    };
  }

  telemetry(): Telemetry {
    const a = this.actuators;
    let c = this.telemetryForces;
    if (
      !c ||
      c.y !== this.y ||
      c.t !== this.t ||
      c.mass !== this.massProps ||
      c.rudder !== a.rudder ||
      c.planes !== a.sternPlanes ||
      c.periscope !== a.periscope ||
      c.snorkel !== a.snorkel ||
      c.radar !== a.radar ||
      c.powerLimit !== this.systems.electrics.powerLimit ||
      c.snag !== this.systems.snag.holder ||
      c.rps !== this.commands.rps
    ) {
      c = {
        y: this.y,
        t: this.t,
        mass: this.massProps,
        rudder: a.rudder,
        planes: a.sternPlanes,
        periscope: a.periscope,
        rps: this.commands.rps,
        snorkel: a.snorkel,
        radar: a.radar,
        powerLimit: this.systems.electrics.powerLimit,
        snag: this.systems.snag.holder,
        ext: this.externalForces(this.y),
      };
      this.telemetryForces = c;
    }
    const ext = c.ext;
    this.lastHydrostatics = ext.hydrostatics;
    const pos = getPos(this.y);
    const [roll, pitch, yaw] = quatToEuler(getQuat(this.y));
    const R = quatToMat3(getQuat(this.y));
    const nu = this.y.subarray(IDX.NU, IDX.NU + 6);
    const vWorld = mat3MulVec(R, [nu[0]!, nu[1]!, nu[2]!]);
    const vc = this.currentBody(pos, R);
    const n = this.y[IDX_SHAFT]!;
    const W = this.massProps.mass * E.g;
    return {
      t: this.t,
      position: pos,
      depth: pos[2],
      roll,
      pitch,
      heading: (yaw + 2 * Math.PI) % (2 * Math.PI),
      u: nu[0]! - vc[0],
      v: nu[1]! - vc[1],
      w: nu[2]! - vc[2],
      p: nu[3]!,
      q: nu[4]!,
      r: nu[5]!,
      depthRate: vWorld[2],
      speedOverGround: Math.hypot(vWorld[0], vWorld[1]),
      courseOverGround: (Math.atan2(vWorld[1], vWorld[0]) + 2 * Math.PI) % (2 * Math.PI),
      current: this.currentAt(pos, false),
      waveElevation: this.surface ? this.surface(pos[0], pos[1]) : 0,
      rudder: this.actuators.rudder,
      rudderCmd: this.commands.rudder,
      sternPlanes: this.actuators.sternPlanes,
      sternPlanesCmd: this.commands.sternPlanes,
      rps: n,
      rpsCmd: this.commands.rps,
      periscope: this.actuators.periscope,
      periscopeHeadDepth: this.bodyPointDepth(this.periscopeHead()),
      bridgeDeckDepth: this.bodyPointDepth(this.cfg.bridge.deck),
      snorkel: this.actuators.snorkel,
      snorkelHeadDepth: this.bodyPointDepth(this.snorkelHead()),
      radar: this.actuators.radar,
      radarHeadDepth: this.bodyPointDepth(this.radarHead()),
      payload: this.payload.reduce((s, x) => s + x.m, 0),
      battery: this.systems.electrics.soc,
      electricalLoad: this.systems.electrics.load,
      batteryPower: this.systems.electrics.batteryPower,
      dieselOrdered: this.commands.diesel,
      dieselRunning: this.systems.electrics.dieselRunning,
      generatorPower: this.systems.electrics.generator,
      inductionAir: this.systems.electrics.airAtInduction(),
      motorPowerLimit: this.systems.electrics.powerLimit,
      compartments: this.systems.flooding.compartments.map((c) => ({ ...c })),
      drainPumpRunning: this.systems.flooding.drainRunning,
      doors: [...this.systems.flooding.doors],
      drainTarget: this.systems.flooding.drainTarget,
      hullCollapsed: this.systems.flooding.collapsed,
      thrust: ext.propThrust,
      shaftPower: 2 * Math.PI * n * ext.propTorque,
      tanks: this.tankDefs.map((def, i) => {
        const s = this.tanks[i]!;
        return { id: def.id, name: def.name, kind: def.kind, fill: s.water / def.volume, water: s.water, volume: def.volume, ventOpen: s.ventOpen, blowOpen: s.blowOpen };
      }),
      airPressure: this.air.bottlePV / this.cfg.air.bottleVolume,
      compressor: this.systems.compressor.running,
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
