/**
 * Sea areas: terrain and water. The boat's fixed ballast is adjusted in
 * port for the area (as navies do when moving a boat between seas), so it
 * is neutral at the design depth in every area; the differences show in
 * the layers: thermocline, halocline and fresh surface water.
 */
import { BALTIC_TERRAIN, FJORD_TERRAIN, OCEAN_TERRAIN, TERRAIN, type TerrainSpec } from './terrain';
import { WATERS, type WaterProfile } from './waters';

/**
 * Surface current, constant in time: `speed` [m/s] towards `toward` [rad,
 * true], decaying with depth as exp(−depth/decay) [m].
 */
export interface CurrentDef {
  speed: number;
  toward: number;
  decay: number;
}

export interface AreaDef {
  terrain: TerrainSpec;
  water: WaterProfile;
  current: CurrentDef;
}

const DEG = Math.PI / 180;

export const AREAS = {
  // The Baltic current runs north along the Swedish west coast (0.2–0.5 m/s at the surface). APPROX.
  westCoast: { terrain: { kind: 'archipelago', params: TERRAIN }, water: WATERS.westCoast, current: { speed: 0.25, toward: 0, decay: 20 } },
  // Weak, wind-driven surface drift in the Baltic Proper. APPROX.
  baltic: { terrain: { kind: 'archipelago', params: BALTIC_TERRAIN }, water: WATERS.baltic, current: { speed: 0.1, toward: 60 * DEG, decay: 15 } },
  // Outflow of the fresh surface layer towards the sea (south), confined to the top metres. APPROX.
  fjord: { terrain: { kind: 'fjord', params: FJORD_TERRAIN }, water: WATERS.fjord, current: { speed: 0.4, toward: 180 * DEG, decay: 6 } },
  // North Atlantic Current: north-east, reaching well down. APPROX.
  atlantic: { terrain: { kind: 'ocean', params: OCEAN_TERRAIN }, water: WATERS.atlantic, current: { speed: 0.3, toward: 45 * DEG, decay: 150 } },
} as const satisfies Record<string, AreaDef>;

export type AreaId = keyof typeof AREAS;
export const AREA_IDS = Object.keys(AREAS) as AreaId[];
