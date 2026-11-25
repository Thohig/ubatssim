/**
 * Torpedoes, depth charges and the corvettes' active sonar. A generic
 * modern heavyweight torpedo (533 mm, electric, passive homing in the end
 * phase) and a corvette with depth charges. APPROX: values of the right
 * order for the classes, chosen for play.
 */
const DEG = Math.PI / 180;

export const WEAPONS = {
  torpedo: {
    /** Running speed [m/s] (~40 knots) and range [m]. APPROX. */
    speed: 20.6,
    range: 10000,
    /** Rate of turn [rad/s] (turning circle ~300 m) and depth change [m/s]. APPROX. */
    turnRate: 8 * DEG,
    depthRate: 2,
    /** Running depth when none is set [m]: under the waterline of most ships. */
    defaultDepth: 4,
    /** Distance run before the warhead arms [m]. */
    arming: 300,
    /** The seeker wakes this far before the computed intercept point [m], and listens within ±cone. */
    seekBefore: 600,
    seekerCone: 30 * DEG,
    /** Seeker self-noise at running speed, array gain and threshold [dB]. APPROX. */
    seekerNoise: 82,
    seekerGain: 10,
    seekerThreshold: 6,
    /** Launch point in the bow, body frame [m]. */
    launch: [27, 0, 0.5] as [number, number, number],
    /**
     * The guidance wire: it parts when the boat goes faster than `wireSpeed`
     * [m/s] for `wireGrace` s, or turns more than `wireTurn` [rad] from its
     * heading at the launch (the wire fouls the hull). APPROX (typical).
     */
    wireSpeed: 4.1,
    wireGrace: 5,
    wireTurn: (120 * Math.PI) / 180,
    /** Radiated noise while running [dB re 1 µPa at 1 m] and the launch transient. APPROX. */
    noise: 150,
    launchNoise: 165,
  },
  /**
   * The bow tubes and the torpedo room's racks. A tube is fired with its
   * torpedo in, flooded and the muzzle door open; it is secured by shutting
   * the door and draining it, and reloaded (one at a time, on the loading
   * rail) when dry and shut. Times [s]. APPROX (typical of the class).
   */
  tubes: {
    count: 4,
    reserve: 8,
    reloadTime: 120,
    floodTime: 15,
    openTime: 8,
    shutTime: 6,
    drainTime: 15,
    /** Opening a muzzle door is a transient a corvette may hear, within a couple of kilometres [dB re 1 µPa at 1 m]. APPROX. */
    doorNoise: 135,
    /** A torpedo [kg]; the water in a flooded tube around a torpedo and in an empty one [kg]. APPROX. */
    torpedoMass: 1600,
    annulusWater: 300,
    tubeWater: 1750,
    /** Centre of the tubes along the boat, and of the racks (body frame [m]); the tubes' y and z as the cutaway draws them. */
    tubeX: 17.9,
    tubeY: [-0.5, 0.5] as readonly number[],
    tubeZ: [-0.3, 0.5] as readonly number[],
    rack: [16.6, 0, 0.5] as [number, number, number],
    /** The tanks round the tubes (WRT), under the torpedo room's deck [m]. */
    wrt: [17, 0, 1.8] as [number, number, number],
  },
  /** Spread: degrees between the torpedoes of a salvo. */
  spreadAngle: 3,

  depthCharge: {
    /** Sink rate [m/s]. APPROX. */
    sinkRate: 3.5,
    /** Within this distance [m] the hull is ruptured; within `damage` it leaks less the further away. APPROX. */
    lethal: 8,
    damage: 40,
    /** Hole area [m^2] at `lethal`, falling with (1 − d/damage)² outside it, and inside it. APPROX. */
    hole: 4e-3,
    lethalHole: 0.03,
    /** A pattern: charges per pass and their spacing along the track [m]. */
    pattern: 4,
    spacing: 30,
  },

  /**
   * Decoys (countermeasures): a self-propelled canister launched from a
   * signal ejector that radiates the boat's own sound for a few minutes,
   * a little louder than the boat at slow speed, on a straight course at the
   * launch depth. A corvette that hears it better than the boat takes it for
   * the boat; its echo is weaker than the hull's. APPROX (typical of the class).
   */
  decoy: {
    count: 4,
    /** Seconds it runs, and its speed [m/s] (~6 knots). */
    life: 300,
    speed: 3.1,
    /** It sinks slowly [m/s]. */
    sinkRate: 0.05,
    /** Radiated level [dB re 1 µPa at 1 m]: the boat's at ~7 knots. */
    level: 120,
    /** Target strength for an active ping [dB] (the hull's is 10). */
    targetStrength: 4,
  },

  /**
   * The submarine's own active sonar (the bow array transmitting): a ping is
   * heard by every corvette within reach of its source level, far beyond the
   * echo's range. APPROX [U83].
   */
  ping: {
    level: 215,
    threshold: 10,
    /** Least time between two pings [s]. */
    interval: 10,
    /** Echoes come back from no further than this [m]. */
    range: 12000,
    /** Target strength by vessel kind [dB]. APPROX [U83]. */
    targetStrength: { freighter: 25, ferry: 25, fishing: 10, patrol: 15, sail: 5 } as Record<string, number>,
    /** Target strength of a wreck on the bottom [dB]. APPROX. */
    wreckStrength: 20,
    /** Range error (fraction) and bearing error [rad] of an echo. APPROX. */
    rangeError: 0.004,
    bearingError: (1 * Math.PI) / 180,
  },

  /**
   * The surface-search radar on the radar mast and the radar warning
   * receiver (ESM) beside it. Radar horizon d = 4.12·(√h₁ + √h₂) km for
   * heights in metres (standard refraction). The corvettes' ESM hears the
   * boat's radar further than the radar sees them, and the boat's ESM hears
   * a corvette's radar the same way. APPROX.
   */
  radar: {
    /** Seconds per sweep, and the most it shows [m]. */
    sweep: 3,
    maxRange: 24000,
    /** Mast height above the water of other vessels [m]. APPROX. */
    targetHeight: { freighter: 25, ferry: 28, fishing: 6, patrol: 15, sail: 14 } as Record<string, number>,
    /** In a sea with waves higher than this [m], small boats hide in the clutter within `clutterRange`. */
    clutterWave: 1.5,
    clutterRange: 2500,
    /** Range error (fraction) and bearing error [rad] of an echo. APPROX. */
    rangeError: 0.003,
    bearingError: (0.5 * Math.PI) / 180,
    /** ESM hears a radar this many times further than the radar horizon between the two antennas. */
    esmFactor: 1.6,
    /** A corvette's radar antenna height [m]. */
    patrolAntenna: 18,
    /** Awareness per second a corvette gains from hearing the boat's radar: a bearing, not yet a position (found after ~40 s on the air). APPROX (game balance). */
    esmAware: 0.025,
  },

  corvette: {
    /** Speeds [m/s]: listening, searching and running in to attack. APPROX. */
    listen: 3.1,
    search: 6.2,
    attack: 11.3,
    /** Active sonar: interval [s], source level, target strength of the submarine, threshold [dB]. APPROX [U83]. */
    pingInterval: 12,
    pingLevel: 210,
    targetStrength: 10,
    pingThreshold: 10,
    /** Active sonar reaches no further than this [m], and hears nothing in its baffles astern (beyond ± this from the bow). */
    pingRange: 3000,
    baffles: (135 * Math.PI) / 180,
    /** It drops its pattern when this close to where it believes the boat is [m]. */
    dropDistance: 150,
    /** Expanding-square search: first leg [m]. */
    searchLeg: 500,
    /**
     * A search for a position within this range [m] gives up only after the corvette has got there
     * (`giveUp` counts from then); further off it gives up on the way. APPROX (game balance).
     */
    searchCommit: 6000,
    /** A torpedo hit is heard by corvettes this far from the boat [m], who search with an estimate this good (0…1). APPROX */
    hitHeard: 15000,
    hitQuality: 0.4,
    /** Seconds between attacks, and without contact before giving up. */
    attackInterval: 45,
    /** Depth charges carried. */
    charges: 24,
    giveUp: 300,
  },
} as const;
