/**
 * Visual surroundings: terrain, water surface, drifting particles and
 * depth-dependent fog/colour, so that motion is visible.
 */
import * as THREE from 'three';
import type { HeightFn } from '../sim/terrain';
import { nedToThree } from './coords';
import { createTerrain } from './terrain';

/** A lighthouse as the renderer needs it (see src/control/areas.ts). */
export interface LightMark {
  position: [number, number];
  color: 'white' | 'red' | 'green';
  /** Flash period and lit part [s]. */
  period: number;
  lit: number;
}

export type ConditionsId = 'day' | 'night' | 'fog';

interface Palette {
  sky: number;
  /** Water colour just below the surface and in the deep. */
  shallow: number;
  deep: number;
  /** FogExp2 density in air: visibility ≈ 2 / density. */
  airFog: number;
  /** Extra fog density under water. */
  waterFog: number;
  hemi: number;
  sun: number;
  surface: number;
  /** Lamp glow shown (in daylight the lamps are not seen). */
  lamps: boolean;
}

const PALETTES: Record<ConditionsId, Palette> = {
  day: { sky: 0x9cc9e4, shallow: 0x2a7fa8, deep: 0x020a12, airFog: 0.0006, waterFog: 0, hemi: 1.4, sun: 1.6, surface: 0x3c8fb5, lamps: false },
  night: { sky: 0x060b16, shallow: 0x06202e, deep: 0x01050a, airFog: 0.0009, waterFog: 0.004, hemi: 0.14, sun: 0.08, surface: 0x0c2433, lamps: true },
  fog: { sky: 0xb4c0c4, shallow: 0x2f6f88, deep: 0x020a12, airFog: 0.01, waterFog: 0.002, hemi: 1.0, sun: 0.5, surface: 0x6d8d99, lamps: true },
};

const LAMP_COLOURS = { white: 0xfff4d6, red: 0xff4030, green: 0x40ff70 } as const;

export interface SeaEnvironment {
  update(subNed: [number, number, number], camera: THREE.Camera, t: number): void;
  setParticles(on: boolean): void;
  /** Area terrain, lighthouses and light/visibility. */
  setArea(height: HeightFn, lighthouses: readonly LightMark[], conditions: ConditionsId): void;
}

/** Soft round glow, drawn once. */
function glowTexture(): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.25, 'rgba(255,255,255,0.6)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}

const PARTICLE_BOX = 160;
const PARTICLE_COUNT = 4000;

const surfaceColor = new THREE.Color(0x2a7fa8);
const deepColor = new THREE.Color(0x020a12);
const skyColor = new THREE.Color(0x9cc9e4);

export function createEnvironment(scene: THREE.Scene, hemi: THREE.HemisphereLight, sun: THREE.DirectionalLight): SeaEnvironment {
  let palette = PALETTES.day;
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

  // Lighthouses: white tower with a red band and a lamp that flashes.
  const lighthouseGroup = new THREE.Group();
  scene.add(lighthouseGroup);
  const glowTex = glowTexture();
  const towerMat = new THREE.MeshStandardMaterial({ color: 0xf2f2ee, roughness: 0.7 });
  const bandMat = new THREE.MeshStandardMaterial({ color: 0xb02020, roughness: 0.7 });
  let lamps: { mark: LightMark; glow: THREE.Sprite; lamp: THREE.Mesh }[] = [];

  let particlesOn = true;
  return {
    setParticles(on) {
      particlesOn = on;
    },
    setArea(height, lighthouses, conditions) {
      terrain.setHeight(height);
      palette = PALETTES[conditions];
      skyColor.setHex(palette.sky);
      surfaceColor.setHex(palette.shallow);
      deepColor.setHex(palette.deep);
      surfMat.color.setHex(palette.surface);
      hemi.intensity = palette.hemi;
      sun.intensity = palette.sun;
      lighthouseGroup.clear();
      lamps = [];
      for (const mark of lighthouses) {
        const base = Math.max(0.5, height(mark.position[0], mark.position[1]));
        const g = new THREE.Group();
        nedToThree([mark.position[0], mark.position[1], -base], g.position);
        const tower = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 1.6, 12, 12), towerMat);
        tower.position.y = 6;
        const band = new THREE.Mesh(new THREE.CylinderGeometry(1.25, 1.35, 2, 12), bandMat);
        band.position.y = 8;
        const lamp = new THREE.Mesh(
          new THREE.SphereGeometry(0.9, 12, 8),
          new THREE.MeshBasicMaterial({ color: LAMP_COLOURS[mark.color] }),
        );
        lamp.position.y = 13;
        const glow = new THREE.Sprite(
          new THREE.SpriteMaterial({ map: glowTex, color: LAMP_COLOURS[mark.color], blending: THREE.AdditiveBlending, depthWrite: false, sizeAttenuation: false }),
        );
        glow.scale.setScalar(0.05);
        glow.position.y = 13;
        g.add(tower, band, lamp, glow);
        lighthouseGroup.add(g);
        lamps.push({ mark, glow, lamp });
      }
    },
    update(sub, camera, t) {
      terrain.update(sub[0], sub[1]);
      for (const l of lamps) {
        const on = t % l.mark.period < l.mark.lit;
        l.glow.visible = palette.lamps && on && camera.position.y > -0.5;
        (l.lamp.material as THREE.MeshBasicMaterial).color.setHex(on ? LAMP_COLOURS[l.mark.color] : 0x333333);
      }

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
        fog.density = palette.airFog;
      } else {
        const k = Math.min(1, depth / 250);
        bg.copy(surfaceColor).lerp(deepColor, k);
        fog.color.copy(bg);
        fog.density = 0.006 + palette.waterFog + 0.012 * k;
      }
    },
  };
}
