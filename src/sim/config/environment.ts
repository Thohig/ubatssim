/**
 * Sea environment parameters. SI units.
 */
export const ENVIRONMENT = {
  /** Standard gravity [m/s^2]. */
  g: 9.80665,
  /** Atmospheric pressure at the surface [Pa]. */
  pAtm: 101325,
  /** Sea water density at the surface [kg/m^3]. Typical ocean value (UNESCO EOS-80, 35 PSU, ~12 °C). */
  rhoSurface: 1025.0,
  /** Isothermal compressibility of sea water [1/Pa]. ~4.4e-10 at 10 °C (UNESCO EOS-80). */
  waterCompressibility: 4.4e-10,
  /**
   * Density increase across the thermocline [kg/m^3] and its depth range [m].
   * APPROX: illustrative mid-latitude summer profile (colder water below).
   */
  thermoclineDeltaRho: 0.8,
  thermoclineTop: 40,
  thermoclineBottom: 70,
  /** Mean sea bed depth [m] and terrain relief amplitude [m]. Illustrative. */
  seabedMeanDepth: 280,
  seabedRelief: 110,
  /** Air temperature used for isothermal gas law [K]. */
  airTemperature: 283.15,
  /** Specific gas constant of dry air [J/(kg K)]. */
  airGasConstant: 287.05,
} as const;
