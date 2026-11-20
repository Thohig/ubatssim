/// <reference lib="webworker" />
/**
 * Builds terrain patches off the main thread, so the game does not stall
 * when the terrain around the boat is rebuilt. Same code as the fallback
 * on the main thread (terrainBuild.ts) and the same height functions as
 * the physics.
 */
import { AREAS, type AreaId } from '../sim/config/areas';
import { heightFunction } from '../sim/terrain';
import { buildPatch, type PatchRequest } from './terrainBuild';

export interface WorkerRequest extends PatchRequest {
  id: number;
  area: AreaId;
}

const fns = new Map<AreaId, ReturnType<typeof heightFunction>>();

self.onmessage = (ev: MessageEvent<WorkerRequest>) => {
  const r = ev.data;
  let fn = fns.get(r.area);
  if (!fn) {
    fn = heightFunction(AREAS[r.area].terrain);
    fns.set(r.area, fn);
  }
  const d = buildPatch(fn, r);
  (self as unknown as Worker).postMessage({ id: r.id, ...d }, [d.heights.buffer, d.normals.buffer, d.colors.buffer]);
};
