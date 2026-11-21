/**
 * Underwater sound for the passive sonar and for being heard: broadband
 * levels in dB re 1 µPa (at 1 m for sources), as in the sonar equation
 *
 *   SE = SL − TL − NL + AG − DT    (signal excess; > 0 = heard)
 *
 * Sources:
 *  [U83] R. J. Urick, Principles of Underwater Sound, 3rd ed., 1983
 *        (sonar equation, spherical spreading, ambient noise vs sea state).
 *  [R04] D. Ross, Mechanics of Underwater Noise, 1987/2004 (ship radiated
 *        noise of the order 150–180 dB, rising ~30–60 log(speed)).
 * Values marked APPROX are chosen for play within those orders of magnitude.
 */
export const ACOUSTICS = {
  /** Radiated noise of other vessels at their reference speed [dB]. APPROX [R04]. */
  vesselLevel: { freighter: 172, ferry: 168, fishing: 150, patrol: 158, sail: 118 } as Record<string, number>,
  /** A vessel's level rises with 50 log10(speed / reference speed). APPROX [R04]. */
  vesselSpeedExponent: 50,
  vesselReferenceSpeed: 6, // m/s (~12 knots)

  /** The submarine on the battery at 4 knots [dB]; rises with 30 log10(speed / 4 knots). APPROX. */
  subLevel: 112,
  subSpeedExponent: 30,
  /** Cavitation: above this speed [knots] (+1 knot per 10 m of depth) the propeller adds this [dB]. APPROX. */
  cavitationSpeed: 6,
  cavitationLevel: 18,
  /** Diesels running (snorkelling or surfaced) add this [dB]. APPROX. */
  dieselLevel: 24,

  /** Absorption at ~1–2 kHz [dB/km]. APPROX [U83]. */
  absorption: 1,
  /** A layer (thermocline, halocline) between source and receiver bends the sound away [dB]. APPROX [U83]. */
  layerLoss: 20,

  /** Ambient noise in a calm sea, and the rise per metre of significant wave height [dB]. APPROX [U83]. */
  ambient: 55,
  ambientPerWave: 4,
  /** Flow noise at the submarine's own hydrophones: at 4 knots, rising 40 log10(speed / 4 knots) [dB]. APPROX. */
  selfNoise: 48,
  selfNoiseExponent: 40,
  /** The submarine's bow array: array gain and detection threshold [dB]. APPROX. */
  subArrayGain: 18,
  subThreshold: 6,

  /** A patrol vessel's hull sonar: own noise up to 10 knots, rising 60 log10(speed / 10 knots) above it (flow noise over the dome), array gain, threshold [dB]. APPROX. */
  patrolNoise: 66,
  patrolQuietSpeed: 5.1,
  patrolNoiseExponent: 60,
  patrolArrayGain: 15,
  patrolThreshold: 5,
  /** Ranges at which a patrol vessel's lookouts and radar find a raised periscope, a snorkel and a surfaced boat [m]. APPROX. */
  sightPeriscope: 3500,
  sightSnorkel: 6000,
  sightSurfaced: 12000,

  /**
   * Sound in the terrain's shadow: the sea bed or land between source and
   * receiver blocks the direct path; what gets round (diffraction, bottom
   * bounces) is this much weaker [dB]. APPROX [U83].
   */
  terrainShadowLoss: 35,
  /** The ground must rise this far [m] above the straight path to block it. */
  shadowClearance: 2,

  /**
   * Bottom reverberation of an active ping: the bottom's backscatter
   * strength [dB] by type (Lambert's law at grazing angles ~10–20°), the
   * reference below which it masks nothing, and the height [m] above the
   * bottom where it no longer matters. APPROX [U83 ch. 8].
   */
  bottomBackscatter: { mud: -40, sand: -31, gravel: -27, rock: -21 } as Record<string, number>,
  bottomReference: -45,
  bottomReverbHeight: 50,

  /**
   * Biological sound and echoes. APPROX: sperm whale clicks ~200 dB peak,
   * here a broadband average while clicking [R04, Møhl 2003]; humpback song
   * ~170 dB, minke whale pulse trains and killer whale calls ~155–165 dB; herring schools are silent by day and release gas with a fast
   * ticking (FRT) at night, ~120 dB [Wilson 2004]; a large herring school's
   * target strength ~20 dB, a whale's ~5–15 dB.
   */
  bioLevel: { clicks: 175, song: 168, pulse: 158, whistle: 160, frt: 118 } as Record<string, number>,
  bioTargetStrength: { whale: 12, school: 22 } as Record<string, number>,
  /**
   * The deep scattering layer (zooplankton and small fish): its middle by day
   * and by night [m], half thickness [m], how much it masks a hull echo inside
   * it [dB], and the least water depth where it forms [m]. APPROX [U83 ch. 8].
   */
  dslDay: 400,
  dslNight: 50,
  dslHalf: 35,
  dslMask: 14,
  dslMinWater: 300,
} as const;
