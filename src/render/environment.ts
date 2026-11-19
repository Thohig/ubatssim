/**
 * Visual surroundings: terrain, water surface, drifting particles and
 * depth-dependent fog/colour, so that motion is visible.
 */
import * as THREE from 'three';
import { createTerrain } from './terrain';

export interface SeaEnvironment {
  update(subNed: [number, number, number], camera: THREE.Camera, t: number): void;
  setParticles(on: boolean): void;
}

const PARTICLE_BOX = 160;
const PARTICLE_COUNT = 4000;

const surfaceColor = new THREE.Color(0x2a7fa8);
const deepColor = new THREE.Color(0x020a12);
const skyColor = new THREE.Color(0x9cc9e4);

export function createEnvironment(scene: THREE.Scene): SeaEnvironment {
  scene.fog = new THREE.FogExp2(surfaceColor.getHex(), 0.006);
  scene.background = surfaceColor.clone();

  const terrain = createTerrain(scene);

  // Water surface, visible from above and below.
  const surfMat = new THREE.MeshStandardMaterial({
    color: 0x3c8fb5,
    transparent: true,
    opacity: 0.55,
    side: THREE.DoubleSide,
    roughness: 0.3,
    metalness: 0.1,
  });
  const surface = new THREE.Mesh(new THREE.PlaneGeometry(12000, 12000, 1, 1), surfMat);
  surface.rotation.x = -Math.PI / 2;
  scene.add(surface);

  // Particles (marine snow) wrapping around the camera. Deterministic layout.
  const pGeo = new THREE.BufferGeometry();
  const base = new Float32Array(PARTICLE_COUNT * 3);
  let seed = 12345;
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  for (let i = 0; i < base.length; i++) base[i] = rnd() * PARTICLE_BOX;
  const pos = new Float32Array(base.length);
  pGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const particles = new THREE.Points(
    pGeo,
    new THREE.PointsMaterial({ color: 0xd8eef7, size: 0.25, transparent: true, opacity: 0.7, sizeAttenuation: true }),
  );
  particles.frustumCulled = false;
  scene.add(particles);

  const fog = scene.fog as THREE.FogExp2;
  const bg = scene.background as THREE.Color;

  let particlesOn = true;
  return {
    setParticles(on) {
      particlesOn = on;
    },
    update(sub, camera, t) {
      terrain.update(sub[0], sub[1]);

      surface.position.x = camera.position.x;
      surface.position.z = camera.position.z;

      // Wrap particles into a box centred on the camera, with slow drift.
      const c = camera.position;
      const half = PARTICLE_BOX / 2;
      const drift = t * 0.05;
      for (let i = 0; i < PARTICLE_COUNT; i++) {
        const j = i * 3;
        pos[j] = c.x - half + ((((base[j]! - c.x) % PARTICLE_BOX) + PARTICLE_BOX) % PARTICLE_BOX);
        pos[j + 1] = c.y - half + ((((base[j + 1]! - drift - c.y) % PARTICLE_BOX) + PARTICLE_BOX) % PARTICLE_BOX);
        pos[j + 2] = c.z - half + ((((base[j + 2]! - c.z) % PARTICLE_BOX) + PARTICLE_BOX) % PARTICLE_BOX);
      }
      (pGeo.attributes.position as THREE.BufferAttribute).needsUpdate = true;
      particles.visible = particlesOn && c.y < 0;

      // Fog and colour by camera depth.
      const depth = -c.y;
      if (depth < 0) {
        bg.copy(skyColor);
        fog.color.copy(skyColor);
        fog.density = 0.0006;
      } else {
        const k = Math.min(1, depth / 250);
        bg.copy(surfaceColor).lerp(deepColor, k);
        fog.color.copy(bg);
        fog.density = 0.006 + 0.012 * k;
      }
    },
  };
}
