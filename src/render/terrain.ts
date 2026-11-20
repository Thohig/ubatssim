/**
 * Terrain rendering: a detailed patch around the submarine and a coarse
 * far patch out to the horizon, both re-centred in whole cells as the boat
 * moves. The patch data (heights, normals, colours: terrainBuild.ts) is
 * built in a Web Worker so the game does not stall; the first patch of an
 * area is built at once on the main thread, and so is everything when
 * workers are not available.
 */
import * as THREE from 'three';
import { AREAS, type AreaId } from '../sim/config/areas';
import { heightFunction, type HeightFn } from '../sim/terrain';
import { buildPatch, type PatchData, type PatchRequest } from './terrainBuild';
import type { WorkerRequest } from './terrainWorker';

interface Patch {
  mesh: THREE.Mesh;
  geo: THREE.PlaneGeometry;
  size: number;
  segments: number;
  cell: number;
  /** Drop applied to vertices inside the near patch (far patch only). */
  holeHalf: number;
  /** Centre of the data shown now, and of a build in progress. */
  centre: [number, number] | null;
  pending: [number, number] | null;
  recentre: number;
}

function makePatch(size: number, segments: number, holeHalf: number, recentre: number, mat: THREE.Material): Patch {
  const geo = new THREE.PlaneGeometry(size, size, segments, segments);
  geo.rotateX(-Math.PI / 2);
  geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(geo.attributes.position!.count * 3), 3));
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  return { mesh, geo, size, segments, cell: size / segments, holeHalf, centre: null, pending: null, recentre };
}

export interface TerrainView {
  update(north: number, east: number): void;
  /** Switch to another area (rebuilds at once on the next update). */
  setArea(area: AreaId): void;
}

export function createTerrain(scene: THREE.Scene): TerrainView {
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0 });
  const near = makePatch(1600, 200, 0, 250, mat); // 8 m cells
  const far = makePatch(9000, 150, 760, 1200, mat); // 60 m cells, sunk under the near patch
  scene.add(near.mesh, far.mesh);

  let area: AreaId = 'westCoast';
  let height: HeightFn = heightFunction(AREAS[area].terrain);
  let worker: Worker | null = null;
  try {
    worker = new Worker(new URL('./terrainWorker.ts', import.meta.url), { type: 'module' });
  } catch {
    worker = null; // build on the main thread instead
  }
  let nextId = 1;
  const jobs = new Map<number, { patch: Patch; centre: [number, number]; area: AreaId }>();

  const apply = (p: Patch, d: PatchData, centre: [number, number]) => {
    const pos = p.geo.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) pos.setY(i, d.heights[i]!);
    pos.needsUpdate = true;
    p.geo.setAttribute('normal', new THREE.BufferAttribute(d.normals, 3));
    p.geo.setAttribute('color', new THREE.BufferAttribute(d.colors, 3));
    p.mesh.position.set(centre[1], 0, -centre[0]);
    p.centre = centre;
  };

  worker?.addEventListener('message', (ev: MessageEvent<PatchData & { id: number }>) => {
    const job = jobs.get(ev.data.id);
    jobs.delete(ev.data.id);
    if (!job || job.area !== area) return; // stale: another area since
    if (job.patch.pending && job.patch.pending[0] === job.centre[0] && job.patch.pending[1] === job.centre[1]) job.patch.pending = null;
    apply(job.patch, ev.data, job.centre);
  });

  const build = (p: Patch, cn: number, ce: number, now: boolean) => {
    const req: PatchRequest = { size: p.size, segments: p.segments, holeHalf: p.holeHalf, cn, ce };
    if (now || !worker) {
      apply(p, buildPatch(height, req), [cn, ce]);
      return;
    }
    if (p.pending && p.pending[0] === cn && p.pending[1] === ce) return;
    const id = nextId++;
    jobs.set(id, { patch: p, centre: [cn, ce], area });
    p.pending = [cn, ce];
    worker.postMessage({ ...req, id, area } satisfies WorkerRequest);
  };

  const maybeRebuild = (p: Patch, n: number, e: number) => {
    // Snap to whole cells (of the coarser grid) so vertices do not swim.
    const snap = p.cell * 2;
    const cn = Math.round(n / snap) * snap;
    const ce = Math.round(e / snap) * snap;
    if (!p.centre) build(p, cn, ce, true);
    else if (Math.abs(cn - p.centre[0]) > p.recentre || Math.abs(ce - p.centre[1]) > p.recentre) build(p, cn, ce, false);
  };

  return {
    setArea(a) {
      if (a === area && near.centre) return;
      area = a;
      height = heightFunction(AREAS[a].terrain);
      near.centre = far.centre = null;
      near.pending = far.pending = null;
    },
    update(n, e) {
      maybeRebuild(near, n, e);
      // The far patch follows the near patch (its hole must stay under it).
      const c = near.centre!;
      if (!far.centre) build(far, c[0], c[1], true);
      else if (Math.abs(c[0] - far.centre[0]) > far.recentre || Math.abs(c[1] - far.centre[1]) > far.recentre) build(far, c[0], c[1], false);
    },
  };
}
