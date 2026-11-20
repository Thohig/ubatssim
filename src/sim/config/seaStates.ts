/**
 * Sea states: significant wave height Hs [m], peak period Tp [s] and the
 * direction the waves travel towards [rad, true]. Values follow the WMO
 * sea state code and typical fully developed seas (Pierson–Moskowitz).
 * APPROX (illustrative).
 */
export interface SeaState {
  hs: number;
  tp: number;
  toward: number;
}

const DEG = Math.PI / 180;

export const SEA_STATES = {
  /** WMO 0–1: calm, rippled. */
  calm: { hs: 0, tp: 4, toward: 70 * DEG },
  /** WMO 3: slight to moderate sea. */
  moderate: { hs: 1.25, tp: 6, toward: 70 * DEG },
  /** WMO 5: rough sea. */
  rough: { hs: 3, tp: 8.5, toward: 70 * DEG },
} as const satisfies Record<string, SeaState>;

export type SeaStateId = keyof typeof SEA_STATES;
