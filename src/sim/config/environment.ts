/**
 * Sea environment parameters. SI units.
 */
export const ENVIRONMENT = {
  /** Standard gravity [m/s^2]. */
  g: 9.80665,
  /** Atmospheric pressure at the surface [Pa]. */
  pAtm: 101325,
  /**
   * Reference sea water density at the surface [kg/m^3] (the design water,
   * equal to WATERS.westCoast in waters.ts, where each area's profile is).
   */
  rhoSurface: 1025.0,
  /** Isothermal compressibility of sea water [1/Pa]. ~4.4e-10 at 10 °C (UNESCO EOS-80). */
  waterCompressibility: 4.4e-10,
  /** Air temperature used for isothermal gas law [K]. */
  airTemperature: 283.15,
  /** Specific gas constant of dry air [J/(kg K)]. */
  airGasConstant: 287.05,
} as const;
