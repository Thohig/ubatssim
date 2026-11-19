/**
 * Terrain parameters: the transition from open sea in the west to an
 * archipelago in the east, in the style of the Bohuslän coast (west Sweden):
 * rounded bare granite (hällar), many low skerries and islets, islands up
 * to ~50 m high, and narrow sounds following the roughly N–S bedrock
 * fracture zones. Depths are illustrative, chosen to resemble typical
 * charted depths there (inner archipelago 10–40 m, sounds 30–60 m, open
 * sea towards the Skagerrak 100–400 m). Units: metres; world frame NED
 * (north, east). The coast runs north–south east of the start position.
 */
export const TERRAIN = {
  /** Sea bed depth far offshore at the western edge of the transition [m]. */
  offshoreDepth: 300,
  /** Additional depth per metre further west of `offshoreEast` [m/m]. */
  offshoreSlope: 0.03,
  /** Mean sea bed depth inside the archipelago before islands are added [m]. */
  archipelagoDepth: 32,
  /** East coordinates where the shelf starts rising and where the archipelago begins [m]. */
  offshoreEast: -500,
  archipelagoEast: 2500,
  /** Where islands start to appear and reach full size [m east]. */
  islandsStart: 1200,
  islandsFull: 2800,
  /** Island relief amplitude [m]: height = amplitude·shape − depth. */
  islandAmplitude: 70,
  /** Horizontal scale of islands [m]. */
  islandScale: 420,
  /** Shifts the island noise up: larger = more land. */
  islandBias: 0.34,
  /** Skerries: horizontal scale [m] and height scale [m]. */
  skerryScale: 110,
  skerryHeight: 30,
  /** Heights above the knee [m] are scaled by `peakCompression`, so the highest hills reach ~50 m. */
  peakKnee: 30,
  peakCompression: 0.3,
  /** Small-scale roughness of rock and sea bed [m]. */
  roughness: 2.5,
  /** Fracture-valley sounds: depth [m], spacing [m], half-width factor, strike [rad from north]. */
  soundDepth: 42,
  soundSpacing: 640,
  soundWidth: 0.11,
  /** Lateral meander of the sounds [m]. */
  soundWarp: 320,
  soundStrike: (12 * Math.PI) / 180,
  /** Seed for the deterministic noise. */
  seed: 1729,
} as const;
