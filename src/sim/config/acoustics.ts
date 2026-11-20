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
  vesselLevel: { freighter: 172, ferry: 168, fishing: 150, patrol: 158 } as Record<string, number>,
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
  layerLoss: 14,

  /** Ambient noise in a calm sea, and the rise per metre of significant wave height [dB]. APPROX [U83]. */
  ambient: 55,
  ambientPerWave: 4,
  /** Flow noise at the submarine's own hydrophones: at 4 knots, rising 40 log10(speed / 4 knots) [dB]. APPROX. */
  selfNoise: 48,
  selfNoiseExponent: 40,
  /** The submarine's bow array: array gain and detection threshold [dB]. APPROX. */
  subArrayGain: 18,
  subThreshold: 6,

  /** A patrol vessel's hull sonar: own noise at its speed, array gain, threshold [dB]. APPROX. */
  patrolNoise: 66,
  patrolArrayGain: 15,
  patrolThreshold: 5,
  /** Ranges at which a patrol vessel's lookouts and radar find a raised periscope, a snorkel and a surfaced boat [m]. APPROX. */
  sightPeriscope: 3500,
  sightSnorkel: 6000,
  sightSurfaced: 12000,
} as const;
