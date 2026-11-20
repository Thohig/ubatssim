/**
 * Water density profiles of the sea areas. Density at the surface comes
 * from salinity and temperature (UNESCO EOS-80); layers add a smooth rise
 * in density between `top` and `bottom` (thermocline, halocline, or the
 * bottom of a fresh surface layer). Compressibility is added on top, see
 * environment.ts.
 */
export interface DensityLayer {
  /** Density increase across the layer [kg/m^3]. */
  delta: number;
  /** Depth range of the layer [m]. */
  top: number;
  bottom: number;
}

export interface WaterProfile {
  /** Surface density [kg/m^3]. */
  rhoSurface: number;
  layers: readonly DensityLayer[];
}

export const WATERS = {
  /**
   * Skagerrak/Kattegat coast in summer: ~31 PSU, ~14 °C at the surface → 1025 kg/m³
   * (EOS-80), with a thermocline at 40–70 m. APPROX (illustrative profile).
   */
  westCoast: { rhoSurface: 1025.0, layers: [{ delta: 0.8, top: 40, bottom: 70 }] },
  /**
   * Baltic Proper: ~7 PSU, ~10 °C → 1005.4 kg/m³ (EOS-80). Summer thermocline
   * 20–40 m and the permanent halocline at 60–80 m (to ~10 PSU). APPROX.
   */
  baltic: {
    rhoSurface: 1005.4,
    layers: [
      { delta: 0.6, top: 20, bottom: 40 },
      { delta: 2.4, top: 60, bottom: 80 },
    ],
  },
  /**
   * West Norwegian fjord in the melt season: a brackish surface layer from
   * the river (~15 PSU → ~1012 kg/m³) over Atlantic water (~34 PSU,
   * ~1026.5 kg/m³). APPROX.
   */
  fjord: { rhoSurface: 1012.0, layers: [{ delta: 14.5, top: 3, bottom: 9 }] },
  /** North Atlantic: ~35 PSU, ~11 °C → 1026.6 kg/m³ (EOS-80), seasonal thermocline 50–150 m. APPROX. */
  atlantic: { rhoSurface: 1026.6, layers: [{ delta: 0.6, top: 50, bottom: 150 }] },
} as const satisfies Record<string, WaterProfile>;

export type WaterId = keyof typeof WATERS;

/** The water the boat's fixed ballast and the tests were designed for. */
export const DESIGN_WATER: WaterProfile = WATERS.westCoast;
