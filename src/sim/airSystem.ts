/**
 * Main ballast tanks and the high-pressure air system.
 *
 * Air is treated as an ideal gas at constant temperature (Boyle's law), so
 * the product p·V is proportional to the amount of air. A main ballast tank
 * is open to the sea at the bottom (flood ports), so the air inside is at
 * the hydrostatic pressure of the internal water line:
 *
 *   p_air = p(z_bottom) − ρ g H f,      V_air = (1 − f) V_tank
 *
 * where f is the fill fraction and H the vertical height of the tank. With
 * the vent shut the air content is fixed and f follows from p_air·V_air = PV
 * (a quadratic in f): the tank floods as the boat dives and the air expands
 * – blowing the tank further – as it rises. Excess air escapes through the
 * flood ports. Opening the vent lets air out (orifice flow), so the tank
 * floods; blowing transfers air from the bottles.
 */
import { ENVIRONMENT as E } from './config/environment';
import type { SubmarineConfig, TankDef } from './config/submarine';
import { DESIGN_WATER, type WaterProfile } from './config/waters';
import { pressureAt } from './environment';
import type { TankState } from './tanks';

const SPEED_OF_SOUND_AIR = 340;

export interface AirState {
  /** Bottle air content p·V [Pa·m^3]. */
  bottlePV: number;
}

/** Fill fraction of a main ballast tank in equilibrium with its air content. */
export function equilibriumFill(airPV: number, volume: number, pBottom: number, rhoGH: number): number {
  const target = airPV / volume;
  let f: number;
  if (rhoGH < 1e-6) {
    f = 1 - target / pBottom;
  } else {
    const a = pBottom;
    const k = rhoGH;
    const disc = (a + k) * (a + k) - 4 * k * (a - target);
    f = ((a + k) - Math.sqrt(Math.max(0, disc))) / (2 * k);
  }
  return Math.min(1, Math.max(0, f));
}

/**
 * Advances one main ballast tank by dt.
 * @param zBottom world depth of the tank bottom (flood ports) [m]
 * @param zTop    world depth of the tank top (vent) [m]
 * @param rho     local water density [kg/m^3]
 */
export function updateMainBallast(
  def: TankDef,
  s: TankState,
  air: AirState,
  cfg: SubmarineConfig['air'],
  zBottom: number,
  zTop: number,
  rho: number,
  dt: number,
  water: WaterProfile = DESIGN_WATER,
): void {
  const H = Math.max(0, zBottom - zTop);
  const pBottom = Math.max(E.pAtm, pressureAt(zBottom, water));
  const rhoGH = rho * E.g * H;

  let f = equilibriumFill(s.airPV, def.volume, pBottom, rhoGH);
  let pAir = pBottom - rhoGH * f;

  // Blow: HP bottles → tank.
  if (s.blowOpen && air.bottlePV > 0) {
    const pB = air.bottlePV / cfg.bottleVolume;
    const flow = cfg.blowConductance * Math.sqrt(Math.max(0, pB * pB - pAir * pAir));
    const dPV = Math.min(flow * dt, air.bottlePV);
    air.bottlePV -= dPV;
    s.airPV += dPV;
  }

  // Vent: tank → outside at the vent's depth.
  if (s.ventOpen && s.airPV > 0) {
    const pOut = pressureAt(zTop, water);
    const dp = pAir - pOut;
    if (dp > 0) {
      const rhoAir = pAir / (E.airGasConstant * E.airTemperature);
      const v = Math.min(SPEED_OF_SOUND_AIR, Math.sqrt((2 * dp) / rhoAir));
      const q = cfg.ventDischargeCoefficient * cfg.ventArea * v; // m^3/s at p_air
      s.airPV = Math.max(0, s.airPV - pAir * q * dt);
    }
  }

  f = equilibriumFill(s.airPV, def.volume, pBottom, rhoGH);
  pAir = pBottom - rhoGH * f;
  // Air that no longer fits escapes through the flood ports.
  const maxPV = pAir * (1 - f) * def.volume;
  if (s.airPV > maxPV) s.airPV = maxPV;
  // Low-level switch: shut the blow valve when the tank is dry.
  if (f <= 0 && s.blowOpen) s.blowOpen = false;
  s.water = f * def.volume;
}

/** Air content that corresponds to a given fill fraction at the given depths. */
export function airForFill(
  def: TankDef,
  fill: number,
  zBottom: number,
  zTop: number,
  rho: number,
  water: WaterProfile = DESIGN_WATER,
): number {
  const H = Math.max(0, zBottom - zTop);
  const pBottom = Math.max(E.pAtm, pressureAt(zBottom, water));
  const pAir = pBottom - rho * E.g * H * fill;
  return pAir * (1 - fill) * def.volume;
}
