// Unit conversions. The simulation works in SI units internally.
export const KNOT = 1852 / 3600; // m/s per knot
export const DEG = Math.PI / 180; // rad per degree
export const G = 9.80665; // standard gravity [m/s^2]
export const P_ATM = 101325; // standard atmosphere [Pa]

export const knotsToMs = (kn: number): number => kn * KNOT;
export const msToKnots = (ms: number): number => ms / KNOT;
export const degToRad = (deg: number): number => deg * DEG;
export const radToDeg = (rad: number): number => rad / DEG;
