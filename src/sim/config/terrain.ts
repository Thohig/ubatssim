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

/** An undersea mountain: a cone, or with `flat` a guyot (a cone cut off flat at the top). */
export interface SeamountDef {
  name: string;
  /** Centre [north, east] [m]. */
  at: [number, number];
  /** Depth of the summit [m] and the radius at the foot [m]. */
  top: number;
  radius: number;
  /** Flat-topped (a guyot, eroded at the surface long ago). */
  flat: boolean;
}

/** A wreck on the sea bed: a hull lying on the bottom, part of the ground (you can run into it). */
export interface WreckDef {
  name: string;
  /** Centre [north, east] [m] and heading of its bow [rad]. */
  at: [number, number];
  heading: number;
  /** Length, beam and height above the bottom [m]. */
  length: number;
  beam: number;
  height: number;
  /** Lying over on its side [rad] (only the look). */
  list: number;
}

/**
 * The edge of the Norwegian continental shelf (Eggakanten), in the style of
 * the mid-Norwegian margin: a shelf ~150 m deep, the shelf break, a slope
 * down to the deep Norwegian Sea basin (~1 600 m), a submarine canyon cut
 * into the shelf and the slope, seamounts in the deep, sand waves on the
 * shelf and a rocky coast far to the east. APPROX (illustrative; the real
 * margin: shelf 100–300 m, slope 2–6°, canyons several hundred metres deep).
 */
export const SHELF_TERRAIN = {
  seed: 6180,
  /** Shelf depth [m], deep basin depth [m]. */
  shelfDepth: 150,
  basinDepth: 1600,
  /** East coordinate of the shelf break [m] and the width of the slope [m]. */
  breakEast: 0,
  slopeWidth: 8000,
  /** Meander of the shelf break [m]. */
  breakWarp: 900,
  /** Coast: land starts rising at this east coordinate [m] and reaches `landHeight` [m] over `landRise` [m]. */
  coastEast: 8500,
  landHeight: 140,
  landRise: 1800,
  /**
   * The canyon: its head on the shelf (east) and mouth in the deep (west),
   * its floor depth at the head, at the shelf break and at the mouth [m],
   * half width on the shelf and in the deep [m], and its meander [m].
   */
  canyonHead: 5600,
  canyonMouth: -9000,
  canyonNorth: 0,
  canyonHeadDepth: 165,
  canyonBreakDepth: 420,
  canyonMouthDepth: 1650,
  canyonHalfWidthShelf: 260,
  canyonHalfWidthDeep: 1100,
  canyonMeander: 450,
  canyonMeanderLength: 3600,
  /** Sand waves on the shelf: height [m] and wavelength [m]. */
  sandWaveHeight: 1.6,
  sandWaveLength: 140,
  seamounts: [
    { name: 'Draugen', at: [6000, -9500], top: 85, radius: 2200, flat: false },
    { name: 'Havbåen', at: [-7000, -11000], top: 190, radius: 3000, flat: true },
    { name: 'Skarvbåen', at: [-2600, -5000], top: 360, radius: 1400, flat: false },
  ] as readonly SeamountDef[],
  wrecks: [
    { name: 'D/S Kvitholmen', at: [1400, 3100], heading: 0.6, length: 78, beam: 11, height: 9, list: 0.35 },
    { name: 'trålaren Senja', at: [-2600, 4300], heading: 2.3, length: 34, beam: 7, height: 6, list: -0.6 },
  ] as readonly WreckDef[],
};

export type ShelfParams = typeof SHELF_TERRAIN;

export type TerrainSpec =
  | { kind: 'archipelago'; params: ArchipelagoParams }
  | { kind: 'fjord'; params: FjordParams }
  | { kind: 'ocean'; params: OceanParams }
  | { kind: 'shelf'; params: ShelfParams };
