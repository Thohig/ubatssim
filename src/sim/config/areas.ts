/**
 * Sea areas: terrain and water. The boat's fixed ballast is adjusted in
 * port for the area (as navies do when moving a boat between seas), so it
 * is neutral at the design depth in every area; the differences show in
 * the layers: thermocline, halocline and fresh surface water.
 */
import { BALTIC_TERRAIN, FJORD_TERRAIN, OCEAN_TERRAIN, TERRAIN, type TerrainSpec } from './terrain';
import { WATERS, type WaterProfile } from './waters';

export interface AreaDef {
  terrain: TerrainSpec;
  water: WaterProfile;
}

export const AREAS = {
  westCoast: { terrain: { kind: 'archipelago', params: TERRAIN }, water: WATERS.westCoast },
  baltic: { terrain: { kind: 'archipelago', params: BALTIC_TERRAIN }, water: WATERS.baltic },
  fjord: { terrain: { kind: 'fjord', params: FJORD_TERRAIN }, water: WATERS.fjord },
  atlantic: { terrain: { kind: 'ocean', params: OCEAN_TERRAIN }, water: WATERS.atlantic },
} as const satisfies Record<string, AreaDef>;

export type AreaId = keyof typeof AREAS;
export const AREA_IDS = Object.keys(AREAS) as AreaId[];
