/**
 * Small life near the camera under water: kelp and wrack swaying on the
 * shallow bottom, and jellyfish drifting and pulsing. Graphics only, around
 * the camera; the kelp is placed on the terrain's height function so it
 * stands on the bottom the boat can touch.
 */
import * as THREE from 'three';
import type { AreaId } from '../sim/config/areas';
import type { HeightFn } from '../sim/terrain';

const KELP_MAX = 1800;
/** Kelp grows from the bottom down to this depth [m], around the camera within this radius [m], on a grid [m]. */
const KELP_DEPTH = 22;
const KELP_RADIUS = 110;
const KELP_CELL = 4;
const KELP_RECENTRE = 30;
const JELLY_COUNT = 36;
const JELLY_BOX = 120;

/** Per area: how much kelp and how many jellyfish (0…1), and the jellies' colour. */
const AREA_LIFE: Record<AreaId, { kelp: number; jelly: number; jellyColour: number }> = {
  westCoast: { kelp: 0.8, jelly: 1, jellyColour: 0xe9d6ff },
  baltic: { kelp: 0.5, jelly: 0.8, jellyColour: 0xf2eaff },
  fjord: { kelp: 0.6, jelly: 0.6, jellyColour: 0xffc6a8 },
  atlantic: { kelp: 0, jelly: 0.3, jellyColour: 0xd8f0ff },
  shelf: { kelp: 0.6, jelly: 0.6, jellyColour: 0xffd0c0 },
};

function cellRand(ix: number, iy: number, salt: number): number {
  let h = (ix * 73856093) ^ (iy * 19349663) ^ (salt * 83492791);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

export interface SeaLifeView {
  setArea(area: AreaId, height: HeightFn): void;
  update(camera: THREE.Vector3, cameraDepth: number, t: number, night: boolean): void;
  setEnabled(on: boolean): void;
}

export function createSeaLife(scene: THREE.Scene): SeaLifeView {
  // Kelp: a ribbon bent by a sway in the vertex shader, stronger towards the tip.
  const kelpGeo = new THREE.PlaneGeometry(0.5, 1, 1, 8);
  kelpGeo.translate(0, 0.5, 0);
  const kelpMat = new THREE.MeshStandardMaterial({ color: 0x5c5a22, roughness: 0.9, side: THREE.DoubleSide });
  const uTime = { value: 0 };
  kelpMat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = uTime;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uTime;')
      .replace(
        '#include <begin_vertex>',
        `vec3 transformed = vec3(position);
        float ph = instanceMatrix[3].x * 0.37 + instanceMatrix[3].z * 0.23;
        float bend = transformed.y * transformed.y;
        transformed.x += bend * 0.35 * sin(uTime * 0.8 + ph);
        transformed.z += bend * 0.2 * cos(uTime * 0.6 + ph * 1.3);`,
      );
  };
  kelpMat.customProgramCacheKey = () => 'kelp-sway';
  const kelp = new THREE.InstancedMesh(kelpGeo, kelpMat, KELP_MAX);
  kelp.count = 0;
  kelp.frustumCulled = false;
  scene.add(kelp);

  const jellyGeo = new THREE.SphereGeometry(0.35, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2);
  const jellyMat = new THREE.MeshStandardMaterial({ color: 0xe9d6ff, transparent: true, opacity: 0.45, roughness: 0.2, emissive: 0x000000, depthWrite: false, side: THREE.DoubleSide });
  const jellies = new THREE.InstancedMesh(jellyGeo, jellyMat, JELLY_COUNT);
  jellies.frustumCulled = false;
  scene.add(jellies);
  const jellySeeds = new Float32Array(JELLY_COUNT * 4);
  for (let i = 0; i < jellySeeds.length; i++) jellySeeds[i] = Math.random();

  let height: HeightFn | null = null;
  let life = AREA_LIFE.westCoast;
  let kelpAt: [number, number] | null = null;
  let enabled = true;
  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const v = new THREE.Vector3();
  const s = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0);

  const placeKelp = (x: number, z: number) => {
    kelpAt = [x, z];
    if (!height || life.kelp <= 0) {
      kelp.count = 0;
      return;
    }
    let n = 0;
    const gx0 = Math.round((x - KELP_RADIUS) / KELP_CELL);
    const gz0 = Math.round((z - KELP_RADIUS) / KELP_CELL);
    const cells = Math.round((2 * KELP_RADIUS) / KELP_CELL);
    for (let j = 0; j <= cells && n < KELP_MAX; j++) {
      for (let i = 0; i <= cells && n < KELP_MAX; i++) {
        const gx = gx0 + i;
        const gz = gz0 + j;
        if (cellRand(gx, gz, 11) > life.kelp * 0.5) continue;
        const wx = gx * KELP_CELL + (cellRand(gx, gz, 12) - 0.5) * KELP_CELL;
        const wz = gz * KELP_CELL + (cellRand(gx, gz, 13) - 0.5) * KELP_CELL;
        if (Math.hypot(wx - x, wz - z) > KELP_RADIUS) continue;
        const h = height(-wz, wx);
        if (h > -1.5 || h < -KELP_DEPTH) continue;
        // Tall in the shallows, short deeper down.
        const tall = Math.min(-h - 0.5, (2 + 4 * cellRand(gx, gz, 14)) * (1 - (-h / KELP_DEPTH) * 0.6));
        v.set(wx, h, wz);
        q.setFromAxisAngle(up, cellRand(gx, gz, 15) * Math.PI);
        m4.compose(v, q, s.set(1, tall, 1));
        kelp.setMatrixAt(n++, m4);
      }
    }
    kelp.count = n;
    kelp.instanceMatrix.needsUpdate = true;
  };

  return {
    setArea(area, h) {
      height = h;
      life = AREA_LIFE[area];
      jellyMat.color.setHex(life.jellyColour);
      kelpAt = null;
    },
    setEnabled(on) {
      enabled = on;
    },
    update(cam, depth, t, night) {
      uTime.value = t;
      const under = enabled && depth > 0;
      kelp.visible = under && life.kelp > 0;
      jellies.visible = under && life.jelly > 0;
      if (!under) return;
      if (!kelpAt || Math.hypot(cam.x - kelpAt[0], cam.z - kelpAt[1]) > KELP_RECENTRE) placeKelp(cam.x, cam.z);
      // Jellyfish wrap in a box around the camera, at 1–35 m depth, pulsing as they swim.
      const half = JELLY_BOX / 2;
      const count = Math.round(JELLY_COUNT * life.jelly);
      jellyMat.emissive.setHex(night ? 0x103a3a : 0x000000);
      for (let i = 0; i < count; i++) {
        const a = jellySeeds[i * 4]!;
        const b = jellySeeds[i * 4 + 1]!;
        const c = jellySeeds[i * 4 + 2]!;
        const x = cam.x - half + ((((a * JELLY_BOX + t * 0.05 - cam.x) % JELLY_BOX) + JELLY_BOX) % JELLY_BOX);
        const z = cam.z - half + ((((b * JELLY_BOX - cam.z) % JELLY_BOX) + JELLY_BOX) % JELLY_BOX);
        const y = -(1 + c * 34) + 0.6 * Math.sin(t * 0.5 + i);
        const pulse = 1 + 0.18 * Math.sin(t * 2.2 + i * 1.3);
        const size = 0.6 + 1.2 * jellySeeds[i * 4 + 3]!;
        v.set(x, y, z);
        q.identity();
        m4.compose(v, q, s.set(size * pulse, size / pulse, size * pulse));
        jellies.setMatrixAt(i, m4);
      }
      jellies.count = count;
      jellies.instanceMatrix.needsUpdate = true;
    },
  };
}
