/**
 * Parameters for a generic modern diesel-electric submarine, ~60 m, ~1 500 t
 * submerged. All values in SI units unless stated otherwise.
 *
 * Body frame (FRD): x forward from midships, y starboard, z down from the hull
 * centre line.
 *
 * Sources:
 *  [F21] T. I. Fossen, Handbook of Marine Craft Hydrodynamics and Motion
 *        Control, 2nd ed., Wiley 2021 (equations of motion, added mass of
 *        prolate spheroids, cross-flow drag).
 *  [R90] R. F. Roddy, DTRC/SHD-1298-08, 1990 (DARPA SUBOFF captive-model
 *        coefficients) – order of magnitude of the linear coefficients.
 *  [P01] T. Prestero, MIT MSc thesis 2001 (REMUS model) – structure of the
 *        fin lift model and propeller model.
 *  [WB]  Wageningen B-series open-water diagrams (linearised).
 *
 * Values marked `APPROX` are engineering estimates for this hull size that
 * have not been checked against the cited source. They are chosen so that the
 * linear manoeuvring model is straight-line stable and passive (the
 * symmetric part of the linear damping matrix is positive definite); tests
 * check both.
 */
import type { Vec3 } from '../math/vec3';

export type TankKind = 'mainBallast' | 'trim' | 'compensating';

export type Shape =
  | { type: 'box'; size: Vec3 }
  /** Cylinder with its axis along body x. */
  | { type: 'cylinder'; length: number; radius: number };

export interface TankDef {
  id: string;
  /** Swedish display name. */
  name: string;
  kind: TankKind;
  /** Geometric centre in body frame [m]. */
  position: Vec3;
  shape: Shape;
  /** Usable water volume [m^3]. Authoritative; `shape` is for centroid and rendering. */
  volume: number;
  /** Initial fill fraction 0..1. */
  initialFill: number;
  /** Fill in the design (neutral) condition; defaults to initialFill (MBT: full). */
  designFill?: number;
}

export interface CompartmentDef {
  id: string;
  name: string;
  /** Extent along body x [m]: [aft, fwd]. */
  xRange: [number, number];
}

export interface FinDef {
  id: string;
  /** 'horizontal' fins produce Z force (pitch), 'vertical' produce Y force (yaw/roll). */
  orientation: 'horizontal' | 'vertical';
  /** Centre of pressure in body frame [m]. */
  position: Vec3;
  /** Planform area [m^2] (all fins of the pair together). */
  area: number;
  /** Lift slope [1/rad]. APPROX: low aspect-ratio fin with hull image, 2πA/(A+2), A≈1.6. */
  liftSlope: number;
  /** Effective aspect ratio for induced drag. APPROX. */
  aspectRatio: number;
  /** Stall angle [rad]. APPROX. */
  stallAngle: number;
  /** Which actuator moves this fin, or null for fixed fins (sail). */
  actuator: 'rudder' | 'sternPlanes' | null;
}

const L = 60;
const R = 3.1;

export const SUBMARINE = {
  name: 'Generisk dieselelektrisk ubåt',

  hull: {
    /** Length overall [m]. */
    length: L,
    /** Maximum hull radius [m] (beam 6.2 m). */
    radius: R,
    /** Elliptic bow length [m]. */
    noseLength: 9,
    /** Parabolic tail length [m]. */
    tailLength: 16,
    /** Number of slices for the hydrostatic strip model. */
    slices: 80,
    /** Pressure hull radius and extent [aft, fwd] [m], for rendering/cutaway. */
    pressureHullRadius: 2.85,
    pressureHullX: [-20, 21] as [number, number],
    /**
     * Hull volume compressibility [1/Pa]. Larger than water's, so the boat
     * gets heavier with depth (as real steel hulls do). APPROX.
     */
    compressibility: 6.0e-10,
    /** Sail (fin): centre, length, height, thickness [m]. Free-flooding: no buoyancy. */
    sail: { position: [8, 0, -5.4] as Vec3, length: 7, height: 4.6, thickness: 1.4 },
  },

  /**
   * Search periscope: a telescopic mast in the sail. Raised, the head is
   * 15.2 m above the hull centre line, so the boat can look out up to ~14 m
   * CO depth (keel ~17 m) in a calm sea. APPROX (typical of this class).
   */
  periscope: {
    /** Mast foot at the top of the sail, body frame [m]. */
    base: [8.6, 0, -7.7] as Vec3,
    /** Head height above the mast foot when fully raised [m]. */
    extension: 7.5,
    /** Time to raise or lower fully [s]. */
    raiseTime: 8,
    /** Mast diameter [m] and drag coefficient of a circular cylinder (Re > 5e5). */
    diameter: 0.35,
    dragCoefficient: 1.0,
    /** Speed above which the raised mast vibrates and leaves a visible feather [m/s] (~6 knots). */
    vibrationSpeed: 3.1,
  },

  /** The open bridge in the top of the sail. */
  bridge: {
    /** Eye point of the officer of the watch, body frame [m]. */
    eye: [10, 0, -8.6] as Vec3,
    /** Bridge deck (cockpit floor), body frame [m]; water above it floods the bridge. */
    deck: [10, 0, -7.4] as Vec3,
  },

  /**
   * Design condition: the boat is neutrally buoyant and level at this depth
   * with main ballast full and trim/compensating tanks at their initial
   * fill. Dry mass and dry CG are derived from this (as fixed lead ballast
   * would be chosen by the naval architect).
   */
  design: {
    neutralDepth: 25,
    /** Metacentric height submerged, BG = z_G − z_B [m]. Typical 0.3–0.5 m. APPROX. */
    bg: 0.35,
    /** Radii of gyration of the dry boat about its CG [m]: roll, pitch, yaw. APPROX. */
    radiiOfGyration: [2.4, 15.6, 15.6] as Vec3,
  },

  tanks: [
    {
      id: 'mbt_fwd', name: 'Huvudballast för', kind: 'mainBallast',
      position: [24, 0, 0], shape: { type: 'cylinder', length: 6, radius: 2.8 },
      volume: 110, initialFill: 0,
    },
    {
      id: 'mbt_aft', name: 'Huvudballast akter', kind: 'mainBallast',
      position: [-23.5, 0, 0], shape: { type: 'cylinder', length: 7, radius: 2.4 },
      volume: 110, initialFill: 0,
    },
    {
      id: 'trim_fwd', name: 'Trimtank för', kind: 'trim',
      position: [18, 0, 2.0], shape: { type: 'box', size: [3, 2.5, 1.0] },
      volume: 7.5, initialFill: 0.5,
    },
    {
      id: 'trim_aft', name: 'Trimtank akter', kind: 'trim',
      position: [-17, 0, 2.0], shape: { type: 'box', size: [3, 2.5, 1.0] },
      volume: 7.5, initialFill: 0.5,
    },
    {
      id: 'comp', name: 'Kompenseringstank', kind: 'compensating',
      position: [0, 0, 2.3], shape: { type: 'box', size: [6, 3, 1.2] },
      // Starts 0.6 m³ above the design fill: the boat is trimmed slightly
      // heavy for diving, as is normal practice.
      volume: 20, initialFill: 0.53, designFill: 0.5,
    },
  ] satisfies TankDef[],

  compartments: [
    { id: 'torpedo', name: 'Torpedrum', xRange: [13, 21] },
    { id: 'control', name: 'Manöverrum', xRange: [3, 13] },
    { id: 'living', name: 'Bostäder och batterier', xRange: [-6, 3] },
    { id: 'engine', name: 'Maskinrum', xRange: [-14, -6] },
    { id: 'motor', name: 'Elmotorrum', xRange: [-20, -14] },
  ] satisfies CompartmentDef[],

  /** High-pressure air system (isothermal, Boyle's law). */
  air: {
    /** Total HP bottle volume [m^3]. APPROX. */
    bottleVolume: 6,
    /** Initial bottle pressure [Pa] (250 bar). APPROX, typical HP air. */
    bottlePressure: 25e6,
    /**
     * Blow valve conductance [m^3/s]: PV-flow = k·sqrt(p_b² − p_t²).
     * Gives ~40 s to blow one MBT at 100 m from full bottles. APPROX.
     */
    blowConductance: 0.06,
    /** Vent valve area per MBT [m^2] and discharge coefficient. APPROX. */
    ventArea: 0.03,
    ventDischargeCoefficient: 0.6,
  },

  pumps: {
    /** Trim pump rate between forward and aft trim tanks [m^3/s] (5 l/s). APPROX. */
    trimRate: 0.005,
    /** Compensating pump/flood rate to/from sea [m^3/s] (6 l/s). APPROX. */
    compRate: 0.006,
  },

  /**
   * Hydrodynamic coefficients, nondimensional "prime" system [F21]:
   *   forces  / (½ρ L² U²), moments / (½ρ L³ U²), with linear velocity terms
   *   scaled by U (e.g. Z = ½ρL² Z'w U w, M = ½ρL⁴ M'q U q).
   * These describe hull + fixed fins (without the sail, which is modelled as
   * an explicit lifting surface). Signs follow FRD.
   */
  hydro: {
    // Surge resistance; C_T ≈ 0.0035 on ~1 000 m² wetted area incl. appendages. APPROX
    Xuu: -0.0011,
    // Sway / yaw (hull + stern fins). Order of magnitude from [R90]. APPROX
    Yv: -0.016,
    Yr: 0.006,
    Nv: -0.008,
    Nr: -0.004,
    // Heave / pitch (hull + stern fins). Order of magnitude from [R90]. APPROX
    Zw: -0.0145,
    Zq: -0.007,
    Mw: 0.0055,
    Mq: -0.0035,
    // Roll damping (linear, prime). APPROX
    Kp: -3e-5, // K = ½ρL⁴ K′p U p. Weak, as for real submarines (ζ ≈ 0.1–0.2). APPROX
    /** Cross-flow drag coefficient of the hull section [F21 §6.4]. APPROX (circular cylinder, Re > 5e5). */
    crossFlowCd: 0.8,
    /** Low-speed linear damping in physical units (keeps motion decaying at U≈0). APPROX. */
    lowSpeed: {
      Xu: -2.0e3, // N/(m/s)
      Yv: -4.0e4,
      Zw: -4.0e4,
      Kp: -2.0e6, // Nm/(rad/s)
      Mq: -4.0e7,
      Nr: -4.0e7,
    },
    /** Quadratic roll damping [Nm/(rad/s)^2]. APPROX (sail + fins). */
    Kpp: -1.5e6,
    /** Roll added inertia as fraction of dry roll inertia. APPROX. */
    rollAddedInertiaFraction: 0.1,
  },

  fins: [
    {
      id: 'sternPlanes', orientation: 'horizontal', position: [-26.5, 0, 0],
      area: 10, liftSlope: 2.8, aspectRatio: 1.6, stallAngle: 0.38, actuator: 'sternPlanes',
    },
    {
      id: 'rudder', orientation: 'vertical', position: [-27, 0, 0],
      area: 10, liftSlope: 2.8, aspectRatio: 1.6, stallAngle: 0.38, actuator: 'rudder',
    },
    {
      // The sail acts as a fixed vertical fin high above the CG: gives the
      // characteristic snap roll in turns.
      id: 'sail', orientation: 'vertical', position: [8, 0, -5.4],
      area: 30, liftSlope: 2.0, aspectRatio: 1.2, stallAngle: 0.35, actuator: null,
    },
  ] satisfies FinDef[],

  /** Hull–ground contact (grounding). Penalty method; values chosen for ~0.1 m penetration at rest. */
  contact: {
    /** Normal stiffness per contact point [N/m]. */
    stiffness: 2.0e7,
    /** Normal damping per contact point [N s/m]. */
    damping: 2.0e6,
    /** Coulomb friction coefficient, steel on rock/mud. APPROX. */
    friction: 0.4,
    /** Sliding speed below which friction is smoothed [m/s]. */
    frictionSmoothing: 0.1,
  },

  actuators: {
    /** Max deflection [rad] and slew rate [rad/s]. ~4°/s is typical of hydraulic planes. APPROX. */
    rudderMax: (30 * Math.PI) / 180,
    planesMax: (30 * Math.PI) / 180,
    slewRate: (4 * Math.PI) / 180,
  },

  propulsion: {
    /** Propeller diameter [m]. */
    diameter: 3.0,
    /** Propeller position in body frame [m]. */
    position: [-29.5, 0, 0] as Vec3,
    /** Linearised open-water curves K_T = kt0 − kt1·J, K_Q = kq0 − kq1·J [WB, P/D≈1.0]. APPROX. */
    kt0: 0.40,
    kt1: 0.35,
    kq0: 0.050,
    kq1: 0.035,
    /** Wake fraction w and thrust deduction t. APPROX, single-screw body of revolution. */
    wake: 0.25,
    thrustDeduction: 0.15,
    /** Shaft + motor rotor + entrained water polar inertia [kg m^2]. APPROX. */
    shaftInertia: 20000,
    /** Motor limits. 2.9 MW is typical for this class. APPROX. */
    maxTorque: 160e3, // Nm
    maxPower: 2.9e6, // W
    /** Max shaft speed [rev/s] (240 rpm). */
    maxRps: 4.0,
    /** Speed-loop gain of the motor drive [Nm per rev/s]. */
    speedGain: 2.0e5,
  },
} as const;

export type SubmarineConfig = typeof SUBMARINE;
