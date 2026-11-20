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
  /**
   * Decks, top first: name and floor height (body z [m], down positive).
   * Only for the cutaway view; the physics uses the tanks, not the decks.
   */
  decks: { name: string; floor: number }[];
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

  /**
   * Snorkel (induction) mast in the sail, beside the periscope. Raised, the
   * head reaches about as high as the periscope's, so the boat snorkels at
   * periscope depth. The head valve shuts when a wave covers the head. APPROX.
   */
  snorkel: {
    base: [6.4, 0, -7.7] as Vec3,
    extension: 7.2,
    raiseTime: 10,
    diameter: 0.5,
    dragCoefficient: 1.0,
    /** The head valve stays open while the head is at least this far above the local water surface [m]. */
    headClearance: 0.15,
    /** The diesels run on the boat's own air for this long when the head valve shuts [s]. */
    airGrace: 4,
  },

  /**
   * Batteries, diesel generators and the electrical load. A 60 m
   * diesel-electric boat carries ~4–8 MWh in lead-acid cells and two diesel
   * generators of ~0.5–0.8 MW. APPROX (typical of the class).
   */
  electrics: {
    /** Usable battery energy [J] (6 MWh). APPROX. */
    batteryCapacity: 6 * 3.6e9,
    /** Start state of charge (0…1) when nothing else is given: charged in port. */
    initialCharge: 1,
    /** Hotel load: lights, ventilation, electronics, galley [W]. APPROX. */
    hotelLoad: 60e3,
    /** Motor and converter efficiency, shaft power / electrical power. APPROX. */
    motorEfficiency: 0.92,
    /** Two diesel generators together [W]. APPROX. */
    generatorPower: 1.2e6,
    /** Generator output ramps up at this rate after a start [W/s]. APPROX. */
    generatorRamp: 80e3,
    /**
     * Charge acceptance of lead-acid cells: full charging current up to this
     * state of charge, then falling linearly to `acceptAtFull` of it at 100 %. APPROX.
     */
    taperFrom: 0.8,
    acceptAtFull: 0.1,
    /** Below this state of charge the motor's power falls to what the generators give [0…1]. */
    lowCharge: 0.02,
    /** Power of the drain (bilge) pump while it runs [W]. APPROX. */
    drainPumpPower: 25e3,
  },

  /**
   * Flooding and damage. Leaks are holes in a compartment of the pressure
   * hull: Q = Cd·A·√(2Δp/ρ). The drain pump empties the compartments; the
   * crew seals the holes over time. APPROX (values chosen for play, of the
   * right order for a 60 m boat).
   */
  damage: {
    /** Discharge coefficient of a hole. */
    holeCd: 0.6,
    /** Drain pump capacity at the surface [m^3/s] (20 l/s), falling linearly to 0 at `drainMaxDepth`. APPROX. */
    drainRate: 0.02,
    drainMaxDepth: 250,
    /** The crew seals a hole with this time constant [s] (damage control). APPROX. */
    sealTime: 150,
    /** A hole smaller than this is counted as sealed [m^2]. */
    sealedArea: 2e-5,
    /** Grounding faster than this gives a hole [m/s] (~2 knots). */
    groundingSpeed: 1.0,
    /** Hole area of a grounding at `groundingSpeed`; it grows with the speed squared [m^2]. APPROX. */
    groundingHole: 4e-4,
    /** Hole area of a collision with a ship [m^2]. APPROX. */
    collisionHole: 1.5e-3,
    /** Crush depth [m]; below it the hull leaks, more the deeper. */
    crushDepth: 300,
    /** Hole growth below crush depth [m^2 per s per m]. APPROX. */
    crushLeakGrowth: 1e-5,
    /** The hull collapses at this depth [m]. APPROX (~1.2 × crush depth). */
    collapseDepth: 360,
    /** Fraction of a compartment's volume that water can fill (machinery and decks take the rest). APPROX. */
    floodableFraction: 0.75,
    /** A compartment flooded beyond this fraction stops what is in it (motor, diesels). */
    disableFill: 0.3,
  },

  /** The open bridge in the top of the sail. */
  bridge: {
    /** Eye point of the officer of the watch, body frame [m]. */
    eye: [10, 0, -8.6] as Vec3,
    /** Bridge deck (cockpit floor), body frame [m]. */
    deck: [10, 0, -7.4] as Vec3,
    /** Height of the bridge coaming above the deck [m]; water over it floods the bridge. */
    coaming: 1.1,
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

  /**
   * The pressure hull's compartments, bulkheads at x = 13, 3, −6 and −14 m.
   * The two middle ones have two decks; the trim and compensating tanks lie
   * under the floors. Layout typical of a 60 m diesel-electric boat. APPROX.
   */
  compartments: [
    { id: 'torpedo', name: 'Torpedrum', xRange: [13, 21], decks: [{ name: 'Torpeddäck', floor: 1.2 }] },
    {
      id: 'control', name: 'Manöverrum', xRange: [3, 13],
      decks: [{ name: 'Övre däck: manövercentral, sonar och radio', floor: -0.3 }, { name: 'Nedre däck: pumprum och HP-luft', floor: 1.7 }],
    },
    {
      id: 'living', name: 'Bostäder och batterier', xRange: [-6, 3],
      decks: [{ name: 'Övre däck: mäss, kabyss och kojer', floor: -0.3 }, { name: 'Nedre däck: batterirum', floor: 1.7 }],
    },
    { id: 'engine', name: 'Maskinrum', xRange: [-14, -6], decks: [{ name: 'Maskindäck', floor: 1.2 }] },
    { id: 'motor', name: 'Elmotorrum', xRange: [-20, -14], decks: [{ name: 'Motordäck', floor: 1.2 }] },
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
    /**
     * Low-pressure blower used on the surface to keep the main ballast tanks
     * dry (waves pump air out through the flood ports). Free-air flow
     * [m^3/s] and the overpressure it can deliver [Pa]. APPROX.
     */
    lpBlowerFlow: 1.5,
    lpBlowerOverpressure: 0.7e5,
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
    /**
     * Wave-radiation damping of the surfaced hull per m² of water plane
     * [N s/m³]. Gives ζ ≈ 0.2 in heave at zero speed. APPROX.
     */
    surfaceDamping: 4000,
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
    /**
     * Astern (n < 0): the coefficients above are scaled by this factor. A
     * fixed-pitch propeller running astern meets the water with the back of
     * its blades and gives roughly 55–70 % of the ahead thrust at the same
     * shaft speed [C12 ch. 6, four-quadrant data]. APPROX.
     */
    asternFactor: 0.6,
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
    /**
     * Max shaft speed astern [rev/s]. The drive limits astern speed: going
     * stern first the boat is directionally unstable and the fins lose much
     * of their effect, so astern is for manoeuvring only. APPROX.
     */
    maxRpsAstern: 1.8,
    /** Speed-loop gain of the motor drive [Nm per rev/s]. */
    speedGain: 2.0e5,
  },
} as const;

export type SubmarineConfig = typeof SUBMARINE;
