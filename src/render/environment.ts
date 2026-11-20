/**
 * Visual surroundings: terrain, water surface, drifting particles and
 * depth-dependent fog/colour, so that motion is visible.
 */
import * as THREE from 'three';
import { heightFunction, type HeightFn } from '../sim/terrain';
import { AREAS, type AreaId } from '../sim/config/areas';
import { waveElevation, type WaveComponent } from '../sim/waves';
import { WAVE_GLSL, createPacked, packWaves } from './waveShader';
import { nedToThree } from './coords';
import { disposeTree } from './dispose';
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
  /** FogExp2 density in air: visibility ≈ 2 / density (day ~15 km, night ~5 km, fog ~200 m). */
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
  day: { sky: 0x9cc9e4, shallow: 0x2a7fa8, deep: 0x020a12, airFog: 0.00013, waterFog: 0, hemi: 1.4, sun: 1.6, surface: 0x3c8fb5, lamps: false },
  night: { sky: 0x060b16, shallow: 0x06202e, deep: 0x01050a, airFog: 0.0004, waterFog: 0.004, hemi: 0.14, sun: 0.08, surface: 0x0c2433, lamps: true },
  fog: { sky: 0xb4c0c4, shallow: 0x2f6f88, deep: 0x020a12, airFog: 0.01, waterFog: 0.002, hemi: 1.0, sun: 0.5, surface: 0x6d8d99, lamps: true },
};

const LAMP_COLOURS = { white: 0xfff4d6, red: 0xff4030, green: 0x40ff70 } as const;

/**
 * How the water of each area looks under the surface: its tint (mixed
 * half-and-half into the light's water colour) and extra fog. The Baltic
 * is green and murky with plankton and humus, the fjord green-brown from
 * the river, the Atlantic clear and blue. APPROX (illustrative).
 */
export const WATER_LOOK: Record<AreaId, { tint: number; fog: number }> = {
  westCoast: { tint: 0x2a8a8a, fog: 0.002 },
  baltic: { tint: 0x4f7d4f, fog: 0.01 },
  fjord: { tint: 0x355f4c, fog: 0.005 },
  atlantic: { tint: 0x1a5fb0, fog: -0.002 },
};
/** Light rays: how many, how far around the camera [m], how long [m], and the camera depth where they are gone [m]. */
const RAY_COUNT = 22;
const RAY_SPREAD = 45;
const RAY_LENGTH = 70;
export const RAY_FADE_DEPTH = 70;
/** Light under water falls off with this depth scale [m]: the colour turns to the deep colour (1 − e^(−depth/scale)). */
const LIGHT_DEPTH = 90;

export interface SeaEnvironment {
  update(subNed: [number, number, number], camera: THREE.Camera, t: number): void;
  setParticles(on: boolean): void;
  /** Light rays under the surface in daylight (a setting: they cost a little on weak phones). */
  setLightRays(on: boolean): void;
  /** Area terrain, lighthouses, light/visibility and the waves. */
  setArea(area: AreaId, lighthouses: readonly LightMark[], conditions: ConditionsId, waves: readonly WaveComponent[]): void;
  /** Water surface elevation [m, up] at a Three.js (x, z) point now. */
  surfaceAt(x: number, z: number): number;
}

/** Wave grid around the camera: size [m] and segments; outside it a flat frame reaches the horizon. The GPU displaces it. */
const WAVE_SIZE = 560;
const WAVE_SEGMENTS = 160;
const FAR_SIZE = 40000;

/** A large square with a square hole in the middle (the far water). */
function frameGeometry(outer: number, inner: number): THREE.BufferGeometry {
  const o = outer / 2;
  const i = inner / 2;
  // Outer corners 0–3, inner corners 4–7, counter-clockwise seen from above (+Y).
  const v = [-o, -o, o, -o, o, o, -o, o, -i, -i, i, -i, i, i, -i, i];
  const pos = new Float32Array(24);
  for (let k = 0; k < 8; k++) {
    pos[k * 3] = v[k * 2]!;
    pos[k * 3 + 1] = 0;
    pos[k * 3 + 2] = v[k * 2 + 1]!;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setIndex([0, 4, 1, 1, 4, 5, 1, 5, 2, 2, 5, 6, 2, 6, 3, 3, 6, 7, 3, 7, 0, 0, 7, 4]);
  g.computeVertexNormals();
  return g;
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
  let areaFog = 0;
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
  const surface = new THREE.Mesh(frameGeometry(FAR_SIZE, WAVE_SIZE - 2), surfMat);
  scene.add(surface);
  const waveGeo = new THREE.PlaneGeometry(WAVE_SIZE, WAVE_SIZE, WAVE_SEGMENTS, WAVE_SEGMENTS);
  waveGeo.rotateX(-Math.PI / 2);
  // The same material, with the waves added in the vertex shader (waveShader.ts).
  const waveMat = surfMat.clone();
  const packed = createPacked();
  const waveUniforms = {
    uWaveAmp: { value: packed.amp },
    uWaveK: { value: packed.k },
    uWaveDirN: { value: packed.dirN },
    uWaveDirE: { value: packed.dirE },
    uWavePhase0: { value: packed.phase0 },
    uWaveHalf: { value: WAVE_SIZE / 2 },
  };
  waveMat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, waveUniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${WAVE_GLSL}`)
      .replace(
        '#include <beginnormal_vertex>',
        // Local x = east offset, local z = −north offset from the grid centre.
        'vec3 seaW = seaWave(-position.z, position.x);\nvec3 objectNormal = normalize(vec3(-seaW.z, 1.0, seaW.y));',
      )
      .replace('#include <begin_vertex>', 'vec3 transformed = vec3(position);\ntransformed.y += seaW.x;');
  };
  waveMat.customProgramCacheKey = () => 'sea-waves';
  const waveMesh = new THREE.Mesh(waveGeo, waveMat);
  waveMesh.frustumCulled = false;
  scene.add(waveMesh);
  let waves: readonly WaveComponent[] = [];
  let waveTime = 0;
  /** Elevation at a Three point (x = east, z = −north), tapered to zero at the grid edge. */
  const elevation = (x: number, z: number) => (waves.length ? waveElevation(waves, -z, x, waveTime) : 0);

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
  const sharedLighthouse = new Set<THREE.Material>([towerMat, bandMat]);
  let lamps: { mark: LightMark; glow: THREE.Sprite; lamp: THREE.Mesh }[] = [];

  // Light rays: tall planes hanging from the surface, bright at the top and fading down, facing the
  // camera, swaying slowly. Only in daylight with the camera under the surface; they fade out by ~40 m.
  const rayTex = (() => {
    const c = document.createElement('canvas');
    c.width = 16;
    c.height = 128;
    const g = c.getContext('2d');
    if (g) {
      const grad = g.createLinearGradient(0, 0, 0, 128);
      grad.addColorStop(0, 'rgba(255,255,255,0.9)');
      grad.addColorStop(0.35, 'rgba(255,255,255,0.35)');
      grad.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = grad;
      g.fillRect(0, 0, 16, 128);
      const side = g.createLinearGradient(0, 0, 16, 0);
      side.addColorStop(0, 'rgba(0,0,0,1)');
      side.addColorStop(0.5, 'rgba(0,0,0,0)');
      side.addColorStop(1, 'rgba(0,0,0,1)');
      g.globalCompositeOperation = 'destination-out';
      g.fillStyle = side;
      g.fillRect(0, 0, 16, 128);
    }
    return new THREE.CanvasTexture(c);
  })();
  const rayMat = new THREE.MeshBasicMaterial({ map: rayTex, color: 0xcfefff, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, fog: false, side: THREE.DoubleSide });
  const rays = new THREE.Group();
  const rayGeo = new THREE.PlaneGeometry(1, RAY_LENGTH);
  rayGeo.translate(0, -RAY_LENGTH / 2, 0); // hangs down from y = 0
  const raySeeds: [number, number, number, number][] = [];
  for (let i = 0; i < RAY_COUNT; i++) {
    const m = new THREE.Mesh(rayGeo, rayMat);
    m.frustumCulled = false;
    rays.add(m);
    raySeeds.push([rnd() * 2 - 1, rnd() * 2 - 1, 2.5 + rnd() * 6, rnd() * Math.PI * 2]);
  }
  rays.visible = false;
  scene.add(rays);
  let raysOn = true;

  let particlesOn = true;
  return {
    setParticles(on) {
      particlesOn = on;
    },
    setLightRays(on) {
      raysOn = on;
    },
    surfaceAt(x, z) {
      return elevation(x, z);
    },
    setArea(area, lighthouses, conditions, w) {
      terrain.setArea(area);
      const height: HeightFn = heightFunction(AREAS[area].terrain);
      waves = w;
      palette = PALETTES[conditions];
      skyColor.setHex(palette.sky);
      const look = WATER_LOOK[area];
      surfaceColor.setHex(palette.shallow).lerp(new THREE.Color(look.tint), 0.5);
      areaFog = look.fog;
      deepColor.setHex(palette.deep);
      surfMat.color.setHex(palette.surface);
      waveMat.color.setHex(palette.surface);
      hemi.intensity = palette.hemi;
      sun.intensity = palette.sun;
      disposeTree(lighthouseGroup, sharedLighthouse);
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
          new THREE.MeshBasicMaterial({ color: LAMP_COLOURS[mark.color], fog: false }),
        );
        lamp.position.y = 13;
        const glow = new THREE.Sprite(
          // Lights carry much further than the land can be seen: no fog on the glow.
          new THREE.SpriteMaterial({ map: glowTex, color: LAMP_COLOURS[mark.color], blending: THREE.AdditiveBlending, depthWrite: false, sizeAttenuation: false, fog: false }),
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

      // Water: the wave grid follows the camera in whole cells so the vertices do not swim.
      waveTime = t;
      const cell = WAVE_SIZE / WAVE_SEGMENTS;
      const gx = Math.round(camera.position.x / cell) * cell;
      const gz = Math.round(camera.position.z / cell) * cell;
      waveMesh.position.set(gx, 0, gz);
      surface.position.set(gx, 0, gz);
      // Phases at the grid centre in double precision; the GPU does the rest.
      packWaves(waves, -gz, gx, t, packed);

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
      const camDepth = elevation(c.x, c.z) - c.y;
      particles.visible = particlesOn && camDepth > 0;

      // Light rays near the surface, around the camera, in daylight.
      const rayStrength = raysOn && camDepth > 0 ? palette.sun / 1.6 * Math.max(0, 1 - camDepth / RAY_FADE_DEPTH) * (1 - Math.min(1, areaFog * 60)) : 0;
      rays.visible = rayStrength > 0.02;
      if (rays.visible) {
        rayMat.opacity = 0.4 * rayStrength;
        rays.children.forEach((m, i) => {
          const [a, b, w, ph] = raySeeds[i]!;
          const x = c.x + a * RAY_SPREAD + Math.sin(t * 0.21 + ph) * 3;
          const z = c.z + b * RAY_SPREAD + Math.cos(t * 0.17 + ph) * 3;
          m.position.set(x, elevation(x, z), z);
          m.scale.set(w * (0.8 + 0.2 * Math.sin(t * 0.5 + ph)), 1, 1);
          // Face the camera around the vertical, and lean a little with the sun.
          m.rotation.set(0, Math.atan2(c.x - x, c.z - z), 0.12);
        });
      }

      // Fog and colour by camera depth below the (wavy) surface.
      const depth = camDepth;
      if (depth < 0) {
        bg.copy(skyColor);
        fog.color.copy(skyColor);
        fog.density = palette.airFog;
      } else {
        // Darker with depth as the daylight is absorbed; each area's water has its own tint and clarity.
        const k = 1 - Math.exp(-depth / LIGHT_DEPTH);
        bg.copy(surfaceColor).lerp(deepColor, k);
        fog.color.copy(bg);
        fog.density = Math.max(0.002, 0.006 + palette.waterFog + areaFog + 0.012 * k);
      }
    },
  };
}
