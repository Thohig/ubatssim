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
    /** Radiated noise while running [dB re 1 µPa at 1 m] and the launch transient. APPROX. */
    noise: 150,
    launchNoise: 165,
  },
  /** The bow tubes and the torpedo room's racks. */
  tubes: { count: 4, reserve: 8, reloadTime: 120 },
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
    /** Seconds between attacks, and without contact before giving up. */
    attackInterval: 45,
    /** Depth charges carried. */
    charges: 24,
    giveUp: 300,
  },
} as const;
