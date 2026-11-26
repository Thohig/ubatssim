/**
 * Patrol aircraft and coastal radar stations (control/lookouts.ts). A
 * maritime patrol aircraft's search radar finds a periscope at ~10 km in a
 * calm sea, a snorkel further, a surfaced boat at its radar horizon; a
 * coastal radar on a hill sees to its own horizon. APPROX (illustrative,
 * chosen for play within published orders of magnitude).
 */
export const LOOKOUTS = {
  /** Ranges at which an aircraft finds what shows above the water [m]. */
  aircraftSight: { periscope: 9000, snorkel: 15000, surfaced: 35000 },
  /** Awareness per second while it sees it. */
  sightRate: { periscope: 0.04, snorkel: 0.08, surfaced: 0.3 },
  /** Its ESM hears the boat's radar within this range [m], adding `esmRate` per second. */
  aircraftEsm: 60000,
  esmRate: 0.04,
  /** How far the boat's radar warner hears an aircraft's radar [m]. */
  aircraftRadarReach: 70000,
  /**
   * A coastal station: largest range [m], and awareness per second close by, falling to nothing at
   * `stationSight` [m] (a small echo weakens with the range and drowns in the sea clutter). The same rate at
   * 2,5 and 30 km put a corvette on the boat half a minute after the periscope came up at the start of a game.
   */
  stationRange: 40000,
  stationRate: { periscope: 0.014, snorkel: 0.03, surfaced: 0.05 },
  stationSight: { periscope: 10000, snorkel: 18000, surfaced: 40000 },
  /** Awareness lost per second when nothing shows. */
  decay: 0.005,
  /** A report's position error [m], and the awareness it gives each corvette. */
  reportError: 600,
  cueAlert: 0.45,
} as const;
