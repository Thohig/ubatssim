/**
 * Terrain rendering: a detailed patch around the submarine and a coarse
 * far patch out to the horizon, both re-centred in whole cells as the boat
 * moves. Vertex colours follow height and slope: dark mud in deep water,
 * silt and sand in the shallows, the black lichen band at the water line,
 * pink-grey granite above it and patches of heather and juniper in hollows
 * on the higher islands.
 */
import * as THREE from 'three';
import { fbm, terrainHeight, type HeightFn } from '../sim/terrain';

interface Patch {
  mesh: THREE.Mesh;
  geo: THREE.PlaneGeometry;
  cell: number;
  /** Drop applied to vertices inside the near patch (far patch only). */
  holeHalf: number;
  centre: [number, number] | null;
  recentre: number;
}

const C = {
  deepMud: new THREE.Color(0x29332f),
  silt: new THREE.Color(0x4f5a45),
  sand: new THREE.Color(0x857a5c),
  wetRock: new THREE.Color(0x2e2a28),
  lichen: new THREE.Color(0x1d1b1a),
  granite: new THREE.Color(0xa38e84),
  graniteLight: new THREE.Color(0xc0aaa0),
  heather: new THREE.Color(0x5b6143),
  rockUnder: new THREE.Color(0x5e5650),
};

const tmp = new THREE.Color();

function colourFor(h: number, slope: number, n: number, e: number, out: THREE.Color): THREE.Color {
  const vary = fbm(n / 60, e / 60, 2, 991);
  if (h > 1.2) {
    out.copy(C.granite).lerp(C.graniteLight, 0.5 + 0.5 * vary);
    // Vegetation in gentle hollows higher up.
    if (h > 8 && slope < 0.5 && vary < -0.05) out.lerp(C.heather, Math.min(1, (-vary - 0.05) * 4));
    return out;
  }
  if (h > -0.6) return out.copy(C.lichen).lerp(C.wetRock, (h + 0.6) / 1.8);
  // Under water: steep faces are rock, flatter areas sediment by depth.
  const d = -h;
  if (d < 15) out.copy(C.sand).lerp(C.silt, d / 15);
  else out.copy(C.silt).lerp(C.deepMud, Math.min(1, (d - 15) / 60));
  if (slope > 0.35) out.lerp(C.rockUnder, Math.min(1, (slope - 0.35) * 2.5));
  return out;
}

function makePatch(size: number, segments: number, holeHalf: number, recentre: number, mat: THREE.Material): Patch {
  const geo = new THREE.PlaneGeometry(size, size, segments, segments);
  geo.rotateX(-Math.PI / 2);
  geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(geo.attributes.position!.count * 3), 3));
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  return { mesh, geo, cell: size / segments, holeHalf, centre: null, recentre };
}

function rebuild(p: Patch, cn: number, ce: number, height: HeightFn): void {
  const pos = p.geo.attributes.position as THREE.BufferAttribute;
  const col = p.geo.attributes.color as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    // Three: x = east, z = −north.
    let h = height(cn - z, ce + x);
    if (p.holeHalf > 0 && Math.abs(x) < p.holeHalf && Math.abs(z) < p.holeHalf) h -= 6;
    pos.setY(i, h);
  }
  pos.needsUpdate = true;
  p.geo.computeVertexNormals();
  const nrm = p.geo.attributes.normal as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const slope = 1 - nrm.getY(i);
    colourFor(pos.getY(i), slope, cn - pos.getZ(i), ce + pos.getX(i), tmp);
    col.setXYZ(i, tmp.r, tmp.g, tmp.b);
  }
  col.needsUpdate = true;
  p.mesh.position.set(ce, 0, -cn);
  p.centre = [cn, ce];
}

export interface TerrainView {
  update(north: number, east: number): void;
  /** Switch to another area's height function (rebuilds on the next update). */
  setHeight(fn: HeightFn): void;
}

export function createTerrain(scene: THREE.Scene): TerrainView {
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0 });
  const near = makePatch(1600, 200, 0, 250, mat); // 8 m cells
  const far = makePatch(9000, 150, 760, 1200, mat); // 60 m cells, sunk under the near patch
  scene.add(near.mesh, far.mesh);

  const maybeRebuild = (p: Patch, n: number, e: number) => {
    // Snap to whole cells (of the coarser grid) so vertices do not swim.
    const snap = p.cell * 2;
    const cn = Math.round(n / snap) * snap;
    const ce = Math.round(e / snap) * snap;
    if (!p.centre || Math.abs(cn - p.centre[0]) > p.recentre || Math.abs(ce - p.centre[1]) > p.recentre) rebuild(p, cn, ce, height);
  };
  let height: HeightFn = terrainHeight;

  return {
    setHeight(fn) {
      if (fn === height) return;
      height = fn;
      near.centre = null;
      far.centre = null;
    },
    update(n, e) {
      maybeRebuild(near, n, e);
      // The far patch must stay aligned with the near patch's hole.
      if (!far.centre || far.centre[0] !== near.centre![0] || far.centre[1] !== near.centre![1]) {
        if (!far.centre || Math.abs(near.centre![0] - far.centre[0]) > far.recentre || Math.abs(near.centre![1] - far.centre[1]) > far.recentre) {
          rebuild(far, near.centre![0], near.centre![1], height);
        }
      }
    },
  };
}
