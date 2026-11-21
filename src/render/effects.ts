/**
 * Life under (and on) the water in the 3D views: bubbles when the main
 * ballast vents or the blown tanks spill air, the propeller's wake, the
 * feather of spray behind a mast cutting the surface, and the diesels'
 * exhaust at the snorkel head. Particles only: they follow the state they
 * are given and never touch the simulation. Random numbers are fine here
 * (the render layer is not deterministic).
 */
import * as THREE from 'three';
import type { Mat3 } from '../sim/math/mat';
import type { Vec3 } from '../sim/math/vec3';
import { nedToThree } from './coords';

export interface EffectsInput {
  t: number;
  position: Vec3;
  /** Rotation body → NED (row-major). */
  rotation: Mat3;
  /** Speed through the water [m/s] and shaft speed [rev/s]. */
  speed: number;
  rps: number;
  /** Propeller position, body frame [m]. */
  propeller: Vec3;
  /** The main ballast tanks: centre and radius (body frame), vents and blow valves, fill. */
  tanks: { position: Vec3; radius: number; vent: boolean; blow: boolean; fill: number }[];
  /** Body-frame heads of the raised masts (null when housed). */
  periscopeHead: Vec3 | null;
  snorkelHead: Vec3 | null;
  dieselRunning: boolean;
  /** Torpedoes running (NED position). */
  torpedoes: Vec3[];
  /** Recent explosions (NED), by increasing id: each one bursts once. */
  blasts: { id: number; kind: 'hit' | 'charge'; at: Vec3 }[];
  /** Night: plankton lights up where the hull and the propeller stir the water (bioluminescence). */
  night?: boolean;
  /** Half the hull's length [m]. */
  halfLength?: number;
}

interface Pool {
  points: THREE.Points;
  pos: Float32Array;
  vel: Float32Array;
  life: Float32Array;
  next: number;
  size: number;
}

/** Off-screen parking for dead particles. */
const PARK = -1e6;

function pool(size: number, material: THREE.PointsMaterial): Pool {
  const pos = new Float32Array(size * 3).fill(PARK);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const points = new THREE.Points(geo, material);
  points.frustumCulled = false;
  return { points, pos, vel: new Float32Array(size * 3), life: new Float32Array(size), next: 0, size };
}

export interface Effects {
  update(input: EffectsInput | null, dt: number, surfaceAt: (x: number, z: number) => number): void;
  setEnabled(on: boolean): void;
}

export function createEffects(scene: THREE.Scene): Effects {
  const bubbles = pool(1600, new THREE.PointsMaterial({ color: 0xe8f6ff, size: 0.22, transparent: true, opacity: 0.75, depthWrite: false }));
  const spray = pool(500, new THREE.PointsMaterial({ color: 0xffffff, size: 0.6, transparent: true, opacity: 0.6, depthWrite: false }));
  const smoke = pool(240, new THREE.PointsMaterial({ color: 0x55585a, size: 1.6, transparent: true, opacity: 0.35, depthWrite: false }));
  // Bioluminescence: blue-green sparks that glow briefly where the water is stirred.
  const sparks = pool(900, new THREE.PointsMaterial({ color: 0x5fffd8, size: 0.35, transparent: true, opacity: 0.85, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }));
  scene.add(bubbles.points, spray.points, smoke.points, sparks.points);
  let enabled = true;
  const world = new THREE.Vector3();
  /** Fractional particles carried over between frames, per emitter. */
  const carry = new Map<string, number>();
  let lastBlast = 0;

  const toWorld = (inp: EffectsInput, p: Vec3, out: THREE.Vector3) => {
    const R = inp.rotation;
    const n = inp.position[0] + R[0] * p[0] + R[1] * p[1] + R[2] * p[2];
    const e = inp.position[1] + R[3] * p[0] + R[4] * p[1] + R[5] * p[2];
    const d = inp.position[2] + R[6] * p[0] + R[7] * p[1] + R[8] * p[2];
    return nedToThree([n, e, d], out);
  };

  /** Emits `rate` particles per second into a pool around a point, with a velocity and a life [s]. */
  const emit = (key: string, p: Pool, rate: number, dt: number, at: THREE.Vector3, spread: number, vel: [number, number, number], jitter: number, life: number) => {
    const want = (carry.get(key) ?? 0) + rate * dt;
    let n = Math.floor(want);
    carry.set(key, want - n);
    while (n-- > 0) {
      const i = p.next;
      p.next = (p.next + 1) % p.size;
      const j = i * 3;
      p.pos[j] = at.x + (Math.random() - 0.5) * spread;
      p.pos[j + 1] = at.y + (Math.random() - 0.5) * spread * 0.5;
      p.pos[j + 2] = at.z + (Math.random() - 0.5) * spread;
      p.vel[j] = vel[0] + (Math.random() - 0.5) * jitter;
      p.vel[j + 1] = vel[1] * (0.7 + Math.random() * 0.6);
      p.vel[j + 2] = vel[2] + (Math.random() - 0.5) * jitter;
      p.life[i] = life * (0.6 + Math.random() * 0.8);
    }
  };

  /** Moves a pool on; bubbles die at the surface, spray falls back into it, smoke drifts and fades. */
  const step = (p: Pool, dt: number, surfaceAt: (x: number, z: number) => number, kind: 'bubble' | 'spray' | 'smoke') => {
    for (let i = 0; i < p.size; i++) {
      if (p.life[i]! <= 0) continue;
      const j = i * 3;
      p.life[i]! -= dt;
      if (kind === 'spray') p.vel[j + 1]! -= 9.81 * dt;
      p.pos[j]! += p.vel[j]! * dt;
      p.pos[j + 1]! += p.vel[j + 1]! * dt;
      p.pos[j + 2]! += p.vel[j + 2]! * dt;
      const surf = surfaceAt(p.pos[j]!, p.pos[j + 2]!);
      const dead = p.life[i]! <= 0 || (kind === 'bubble' && p.pos[j + 1]! > surf) || (kind === 'spray' && p.pos[j + 1]! < surf - 0.2);
      if (dead) {
        p.life[i] = 0;
        p.pos[j + 1] = PARK;
      }
    }
    (p.points.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
  };

  return {
    setEnabled(on) {
      enabled = on;
      for (const p of [bubbles, spray, smoke, sparks]) p.points.visible = on;
    },
    update(inp, dt, surfaceAt) {
      if (!enabled) return;
      const d = Math.min(0.1, Math.max(0, dt));
      if (inp && d > 0) {
        const under = (v: THREE.Vector3) => v.y < surfaceAt(v.x, v.z);
        // Main ballast: air out of the vents on top while flooding; air spilling from the flood holes below when blown dry.
        inp.tanks.forEach((tk, k) => {
          if (tk.vent && tk.fill < 0.995) {
            toWorld(inp, [tk.position[0], 0, tk.position[2] - tk.radius], world);
            const rate = 260 * (1 - tk.fill);
            if (under(world)) emit(`vent${k}`, bubbles, rate, d, world, 1.6, [0, 1.4, 0], 0.4, 12);
            // Vented shallow, the air boils up on the surface above the boat (anyone looking sees it).
            const surf = surfaceAt(world.x, world.z);
            if (under(world) && surf - world.y < 30) {
              const top = world.clone();
              top.y = surf;
              emit(`boil${k}`, spray, rate * 0.4, d, top, 6, [0, 2.5, 0], 1.5, 1.5);
            }
            else emit(`ventspray${k}`, spray, rate * 0.5, d, world, 1.2, [0, 5, 0], 1.2, 1.2);
          }
          if (tk.blow && tk.fill < 0.08) {
            toWorld(inp, [tk.position[0], 0, tk.position[2] + tk.radius], world);
            if (under(world)) emit(`blow${k}`, bubbles, 220, d, world, tk.radius * 1.6, [0, 1.1, 0], 0.6, 14);
          }
        });
        // The propeller's wake: bubbles left behind, more at high shaft speed (and cavitation near the surface).
        const rps = Math.abs(inp.rps);
        if (rps > 0.3) {
          toWorld(inp, inp.propeller, world);
          const shallow = Math.max(0, 1 - inp.position[2] / 60);
          if (under(world)) emit('wake', bubbles, 25 * rps * (0.3 + shallow), d, world, 2.4, [0, 0.15, 0], 0.15, 9);
        }
        // Torpedoes leave a stream of bubbles.
        inp.torpedoes.forEach((p, k) => {
          nedToThree(p, world);
          if (under(world)) emit(`torpedo${k}`, bubbles, 60, d, world, 0.6, [0, 0.4, 0], 0.3, 6);
        });
        // Explosions: a burst of bubbles under water and a plume of spray where it reaches the surface.
        for (const b of inp.blasts) {
          if (b.id <= lastBlast) continue;
          lastBlast = b.id;
          nedToThree(b.at, world);
          const surf = surfaceAt(world.x, world.z);
          const big = b.kind === 'hit' ? 1 : 0.6;
          if (world.y < surf) emit(`blast${b.id}`, bubbles, 400 * big / d, d, world, 6, [0, 3, 0], 2.5, 10);
          if (surf - world.y < 80) {
            const top = world.clone();
            top.y = surf;
            emit(`plume${b.id}`, spray, 420 * big / d, d, top, b.kind === 'hit' ? 10 : 5, [0, b.kind === 'hit' ? 22 : 16, 0], 5, 3);
            if (b.kind === 'hit') emit(`smoke${b.id}`, smoke, 120 / d, d, top, 8, [0, 3, 0], 2, 12);
          }
        }
        // At night the stirred water glows: along the hull, more at the bow, and in the propeller's wash.
        if (inp.night && Math.abs(inp.speed) > 0.4) {
          const L = inp.halfLength ?? 30;
          const rate = 40 * Math.abs(inp.speed);
          for (const [key, x] of [['bow', L * 0.9], ['mid', 0], ['aft', -L * 0.6]] as const) {
            toWorld(inp, [x, 0, 0], world);
            if (under(world)) emit(`glow-${key}`, sparks, rate * (key === 'bow' ? 1.5 : 0.7), d, world, 8, [0, 0.05, 0], 0.1, 1.6);
          }
          toWorld(inp, inp.propeller, world);
          if (under(world)) emit('glow-wake', sparks, rate * 2, d, world, 3, [0, 0.05, 0], 0.2, 2.5);
        }
        // A raised mast cutting the surface throws a feather of spray; the snorkel also smokes with the diesels running.
        const masts: [string, Vec3 | null][] = [['per', inp.periscopeHead], ['snork', inp.snorkelHead]];
        for (const [key, head] of masts) {
          if (!head) continue;
          toWorld(inp, head, world);
          const surf = surfaceAt(world.x, world.z);
          if (world.y > surf && inp.speed > 0.8) {
            world.y = surf;
            emit(`feather-${key}`, spray, 30 * inp.speed, d, world, 0.4, [0, 1.2 + inp.speed * 0.4, 0], 0.8, 0.9);
          }
          if (key === 'snork' && inp.dieselRunning) {
            toWorld(inp, head, world);
            if (world.y > surf) emit('exhaust', smoke, 18, d, world, 0.5, [0.4, 1.2, 0.3], 0.6, 4);
          }
        }
      }
      step(bubbles, d, surfaceAt, 'bubble');
      step(spray, d, surfaceAt, 'spray');
      step(smoke, d, surfaceAt, 'smoke');
      step(sparks, d, surfaceAt, 'smoke');
    },
  };
}
