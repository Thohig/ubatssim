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
  /** Lit windows in the houses. */
  setNight(on: boolean): void;
}

const MAX_TREES = 7000;
const MAX_HOUSES = 900;
const HOUSE_COLOURS = [0x8b2e22, 0x7a2a20, 0xeeeae0] as const;

/** Trees and houses on the land around the boat (placed in terrainBuild.ts). */
function createScatter(scene: THREE.Scene) {
  const treeGeo = new THREE.ConeGeometry(2.2, 9, 7);
  treeGeo.translate(0, 4.5, 0);
  const trees = new THREE.InstancedMesh(treeGeo, new THREE.MeshStandardMaterial({ roughness: 1 }), MAX_TREES);
  trees.count = 0;
  trees.frustumCulled = false;
  const bodyGeo = new THREE.BoxGeometry(6, 4, 9);
  bodyGeo.translate(0, 2, 0);
  const roofGeo = new THREE.CylinderGeometry(3.6, 3.6, 9.4, 3, 1);
  roofGeo.rotateX(Math.PI / 2);
  roofGeo.rotateZ(Math.PI / 2);
  roofGeo.scale(1, 0.55, 1);
  roofGeo.translate(0, 4.9, 0);
  const winGeo = new THREE.BoxGeometry(6.1, 1, 1.2);
  winGeo.translate(0, 2.1, 0);
  const bodies = new THREE.InstancedMesh(bodyGeo, new THREE.MeshStandardMaterial({ roughness: 0.85 }), MAX_HOUSES);
  const roofs = new THREE.InstancedMesh(roofGeo, new THREE.MeshStandardMaterial({ color: 0x2d2b2a, roughness: 0.9 }), MAX_HOUSES);
  const windows = new THREE.InstancedMesh(winGeo, new THREE.MeshBasicMaterial({ color: 0xffd58a }), MAX_HOUSES);
  for (const m of [bodies, roofs, windows]) {
    m.count = 0;
    m.frustumCulled = false;
  }
  windows.visible = false;
  scene.add(trees, bodies, roofs, windows);
  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const v = new THREE.Vector3();
  const sc = new THREE.Vector3();
  const col = new THREE.Color();
  const up = new THREE.Vector3(0, 1, 0);
  return {
    apply(d: PatchData, centre: [number, number], kind: string) {
      const ox = centre[1];
      const oz = -centre[0];
      const nt = Math.min(MAX_TREES, d.trees.length / 4);
      for (let i = 0; i < nt; i++) {
        const s = d.trees[i * 4 + 3]!;
        v.set(d.trees[i * 4]! + ox, d.trees[i * 4 + 1]!, d.trees[i * 4 + 2]! + oz);
        q.setFromAxisAngle(up, s * 17);
        m4.compose(v, q, sc.set(s, s * (0.8 + 0.4 * ((s * 7) % 1)), s));
        trees.setMatrixAt(i, m4);
        // Pine dark; on the Norwegian coast some lighter birch among them.
        col.setHex(kind !== 'archipelago' && (s * 13) % 1 > 0.6 ? 0x56703a : 0x2a3a22);
        trees.setColorAt(i, col);
      }
      trees.count = nt;
      trees.instanceMatrix.needsUpdate = true;
      if (trees.instanceColor) trees.instanceColor.needsUpdate = true;
      const nh = Math.min(MAX_HOUSES, d.houses.length / 5);
      for (let i = 0; i < nh; i++) {
        const style = d.houses[i * 5 + 4]!;
        const k = style === 1 ? 0.65 : 1;
        v.set(d.houses[i * 5]! + ox, d.houses[i * 5 + 1]!, d.houses[i * 5 + 2]! + oz);
        q.setFromAxisAngle(up, d.houses[i * 5 + 3]!);
        m4.compose(v, q, sc.set(k, k, k));
        bodies.setMatrixAt(i, m4);
        roofs.setMatrixAt(i, m4);
        // Boathouses have no lit windows.
        if (style === 1) m4.scale(sc.set(0, 0, 0));
        windows.setMatrixAt(i, m4);
        bodies.setColorAt(i, col.setHex(HOUSE_COLOURS[style as 0 | 1 | 2] ?? HOUSE_COLOURS[0]));
      }
      for (const m of [bodies, roofs, windows]) {
        m.count = nh;
        m.instanceMatrix.needsUpdate = true;
      }
      if (bodies.instanceColor) bodies.instanceColor.needsUpdate = true;
    },
    clear() {
      trees.count = bodies.count = roofs.count = windows.count = 0;
    },
    setNight(on: boolean) {
      windows.visible = on;
    },
  };
}

export function createTerrain(scene: THREE.Scene): TerrainView {
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0 });
  const near = makePatch(1600, 200, 0, 250, mat); // 8 m cells
  const far = makePatch(24000, 200, 760, 1200, mat); // 120 m cells out to where the day haze hides land, sunk under the near patch
  scene.add(near.mesh, far.mesh);
  const scattered = createScatter(scene);

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
    // Into the existing buffers: a new attribute each time would leave the old one on the graphics card.
    for (const [name, data] of [['normal', d.normals], ['color', d.colors]] as const) {
      const attr = p.geo.attributes[name] as THREE.BufferAttribute;
      (attr.array as Float32Array).set(data);
      attr.needsUpdate = true;
    }
    p.mesh.position.set(centre[1], 0, -centre[0]);
    p.centre = centre;
    if (p === near) scattered.apply(d, centre, AREAS[area].terrain.kind);
  };

  worker?.addEventListener('message', (ev: MessageEvent<PatchData & { id: number }>) => {
    const job = jobs.get(ev.data.id);
    jobs.delete(ev.data.id);
    if (!job || job.area !== area) return; // stale: another area since
    if (job.patch.pending && job.patch.pending[0] === job.centre[0] && job.patch.pending[1] === job.centre[1]) job.patch.pending = null;
    apply(job.patch, ev.data, job.centre);
  });

  const build = (p: Patch, cn: number, ce: number, now: boolean) => {
    const req: PatchRequest = { size: p.size, segments: p.segments, holeHalf: p.holeHalf, cn, ce, kind: AREAS[area].terrain.kind, scatter: p === near };
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
      scattered.clear();
    },
    setNight(on) {
      scattered.setNight(on);
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
