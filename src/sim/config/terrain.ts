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

export type ArchipelagoParams = { readonly [K in keyof typeof TERRAIN]: number };

/**
 * Baltic Proper archipelago in the style of the Stockholm outer
 * archipelago: shallower open sea (100–130 m, below the halocline),
 * lower and smoother islands, many skerries. APPROX (illustrative).
 */
export const BALTIC_TERRAIN: ArchipelagoParams = {
  ...TERRAIN,
  offshoreDepth: 115,
  offshoreSlope: 0.004,
  archipelagoDepth: 22,
  archipelagoEast: 2800,
  islandsStart: 1400,
  islandsFull: 3200,
  islandAmplitude: 45,
  skerryHeight: 18,
  soundDepth: 26,
  peakKnee: 16,
  seed: 2718,
};

/**
 * A west Norwegian fjord running north from the coast: a shallow sill at
 * the mouth, a deep basin inside and steep mountain sides. The open sea
 * lies to the south. APPROX (illustrative; real fjords: sills 20–200 m,
 * basins to 1 300 m).
 */
export const FJORD_TERRAIN = {
  seed: 4242,
  /** Open sea depth south of the coast [m]. */
  seaDepth: 220,
  /** Coast line (north coordinate) where the mountains begin [m]. */
  coastNorth: -500,
  /** Depth over the sill at the fjord mouth (north = 0) [m] and its half length along the fjord [m]. */
  sillDepth: 55,
  sillLength: 250,
  /** Basin depth inside the fjord [m]. */
  basinDepth: 380,
  /** Half width of the fjord at the water line [m]. */
  halfWidth: 420,
  /** Height of the mountain sides [m] and the horizontal distance they rise over [m]. */
  mountainHeight: 320,
  mountainRise: 600,
  /** Meander of the centre line: amplitude and wavelength [m]. */
  meanderAmplitude: 450,
  meanderLength: 5200,
};

export type FjordParams = typeof FJORD_TERRAIN;

/** Open North Atlantic: a deep, gently undulating sea bed. APPROX. */
export const OCEAN_TERRAIN = { seed: 977, depth: 1800, undulation: 60 };

export type OceanParams = typeof OCEAN_TERRAIN;

export type TerrainSpec =
  | { kind: 'archipelago'; params: ArchipelagoParams }
  | { kind: 'fjord'; params: FjordParams }
  | { kind: 'ocean'; params: OceanParams };
