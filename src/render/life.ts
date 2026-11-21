/**
 * Life in the 3D views: whales (and a killer whale pod) that swim, dive and
 * blow at the surface, herring schools milling as one, patrol aircraft with
 * their lights, and gulls circling the fishing boats and the lighthouses
 * that take off when a periscope breaks the surface near them. The animals
 * and aircraft follow the simulation's state; the gulls and the fish within
 * a school are graphics only (random numbers allowed here).
 */
import * as THREE from 'three';
import type { AircraftDef, AircraftState } from '../sim/aircraft';
import type { CreatureDef, CreatureState } from '../sim/life';
import type { VesselDef, VesselState } from '../sim/vessel';
import { nedToThree } from './coords';
import { disposeTree } from './dispose';

export interface LifeInput {
  t: number;
  creatures: readonly CreatureState[];
  aircraft: readonly AircraftState[];
  vessels: readonly VesselState[];
  /** Where a periscope (or the boat) shows above the water [north, east], or null. */
  showing: [number, number] | null;
  /** Lamps lit (dusk, night, fog). */
  lamps: boolean;
  /** Dark: no gulls about. */
  night: boolean;
  camera: THREE.Vector3;
}

interface WhaleModel {
  root: THREE.Group;
  /** One animal or a pod, each with a tail to beat. */
  tails: THREE.Object3D[];
  blow: THREE.Sprite;
  lastDepth: number;
  pitch: number;
}

interface School {
  mesh: THREE.InstancedMesh;
  seeds: Float32Array;
  size: number;
}

interface Plane {
  root: THREE.Group;
  nav: THREE.Sprite[];
  strobe: THREE.Sprite;
}

interface Flock {
  /** Where it circles: a vessel (by index) or a fixed point [north, east]. */
  anchor: number | [number, number];
  phase: number;
  /** Startled: until when [s], and the direction it flies off [rad]. */
  startled: number;
  away: number;
  offset: THREE.Vector3;
}

const FISH_PER_SCHOOL = 140;
const BIRDS_PER_FLOCK = 12;
const MAX_FLOCKS = 12;
/** Gulls take off when a periscope shows within this distance [m], and stay away this long [s]. */
const STARTLE_RANGE = 450;
const STARTLE_TIME = 90;

const WHALE_COLOUR: Record<string, number> = { clicks: 0x4a4744, song: 0x2b3036, pulse: 0x3b434b, whistle: 0x0f1012 };

export class LifeView {
  private readonly group = new THREE.Group();
  private whales: (WhaleModel | null)[] = [];
  private schools: (School | null)[] = [];
  private planes: Plane[] = [];
  private flocks: Flock[] = [];
  private readonly birds: THREE.InstancedMesh;
  private readonly m4 = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly e = new THREE.Euler();
  private readonly v = new THREE.Vector3();
  private readonly s = new THREE.Vector3(1, 1, 1);

  constructor(
    scene: THREE.Scene,
    private readonly glow: THREE.Texture,
  ) {
    scene.add(this.group);
    // A gull: two thin wings in a shallow V.
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array([0, 0, -0.3, -0.9, 0.25, 0.1, 0, 0, 0.35, 0, 0, -0.3, 0.9, 0.25, 0.1, 0, 0, 0.35]), 3));
    g.computeVertexNormals();
    this.birds = new THREE.InstancedMesh(g, new THREE.MeshBasicMaterial({ color: 0xf2f2ee, side: THREE.DoubleSide }), MAX_FLOCKS * BIRDS_PER_FLOCK);
    this.birds.count = 0;
    this.birds.frustumCulled = false;
    scene.add(this.birds);
  }

  /** The animals, aircraft and the vessels and lighthouses the gulls follow. */
  set(creatures: readonly CreatureDef[], aircraft: readonly AircraftDef[], vessels: readonly VesselDef[], coast: readonly [number, number][]): void {
    disposeTree(this.group);
    this.whales = creatures.map((c) => (c.kind === 'whale' ? this.whale(c) : null));
    this.schools = creatures.map((c) => (c.kind === 'school' ? this.school(c) : null));
    this.planes = aircraft.map(() => this.plane());
    this.flocks = [];
    vessels.forEach((v, i) => {
      if (v.kind === 'fishing' && this.flocks.length < MAX_FLOCKS) this.flocks.push(this.flock(i));
    });
    for (const p of coast) if (this.flocks.length < MAX_FLOCKS) this.flocks.push(this.flock(p));
  }

  update(inp: LifeInput, surfaceAt: (x: number, z: number) => number): void {
    const { t } = inp;
    inp.creatures.forEach((st, i) => {
      const w = this.whales[i];
      if (w) this.placeWhale(w, st, t, surfaceAt);
      const s = this.schools[i];
      if (s) this.placeSchool(s, st, t, inp.camera);
    });
    inp.aircraft.forEach((st, i) => {
      const p = this.planes[i];
      if (!p) return;
      p.root.visible = st.present;
      if (!st.present) return;
      nedToThree([st.north, st.east, -st.altitude], p.root.position);
      p.root.rotation.set(0, -st.heading, 0);
      p.root.rotateZ(0.12 * Math.sin(t * 0.05));
      for (const l of p.nav) l.visible = inp.lamps;
      p.strobe.visible = t % 1.3 < 0.08;
    });
    this.placeBirds(inp, surfaceAt);
  }

  private whale(c: CreatureDef): WhaleModel {
    const root = new THREE.Group();
    const L = c.size;
    const mat = new THREE.MeshStandardMaterial({ color: WHALE_COLOUR[c.sound] ?? 0x30343a, roughness: 0.6 });
    const white = new THREE.MeshStandardMaterial({ color: 0xe8e8e4, roughness: 0.6 });
    const tails: THREE.Object3D[] = [];
    // A pod of killer whales: four animals side by side.
    const count = c.sound === 'whistle' ? 4 : 1;
    for (let k = 0; k < count; k++) {
      const a = new THREE.Group();
      const body = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 10), mat);
      // Sperm whales have the big square head.
      body.scale.set(0.11 * L, 0.11 * L, 0.5 * L);
      a.add(body);
      if (c.sound === 'clicks') {
        const head = new THREE.Mesh(new THREE.BoxGeometry(0.2 * L, 0.2 * L, 0.32 * L), mat);
        head.position.z = -0.3 * L;
        a.add(head);
      }
      const fin = new THREE.Mesh(new THREE.ConeGeometry(0.03 * L, c.sound === 'whistle' ? 0.22 * L : 0.06 * L, 6), mat);
      fin.position.set(0, 0.12 * L, 0.08 * L);
      a.add(fin);
      if (c.sound === 'whistle') {
        const patch = new THREE.Mesh(new THREE.SphereGeometry(0.04 * L, 8, 6), white);
        patch.position.set(0.09 * L, 0.04 * L, -0.28 * L);
        a.add(patch);
      }
      const tail = new THREE.Group();
      const flukes = new THREE.Mesh(new THREE.BoxGeometry(0.3 * L, 0.015 * L, 0.08 * L), mat);
      flukes.position.z = 0.04 * L;
      tail.add(flukes);
      tail.position.z = 0.48 * L;
      a.add(tail);
      tails.push(tail);
      a.position.set((k - (count - 1) / 2) * 0.9 * L, 0, (k % 2) * 0.6 * L);
      root.add(a);
    }
    const blow = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.glow, color: 0xffffff, transparent: true, opacity: 0.6, depthWrite: false }));
    blow.visible = false;
    root.add(blow);
    this.group.add(root);
    return { root, tails, blow, lastDepth: NaN, pitch: 0 };
  }

  private placeWhale(w: WhaleModel, st: CreatureState, t: number, surfaceAt: (x: number, z: number) => number): void {
    nedToThree([st.north, st.east, st.depth], w.root.position);
    if (st.depth < 2) w.root.position.y = Math.max(w.root.position.y, surfaceAt(w.root.position.x, w.root.position.z) - 1.2);
    // Nose down when diving, up when coming up.
    if (!Number.isNaN(w.lastDepth)) w.pitch += (Math.max(-0.5, Math.min(0.5, (w.lastDepth - st.depth) * 2)) - w.pitch) * 0.05;
    w.lastDepth = st.depth;
    w.root.rotation.set(0, 0, 0);
    w.root.rotation.order = 'YXZ';
    w.root.rotation.y = -st.heading;
    w.root.rotation.x = w.pitch;
    w.tails.forEach((tail, i) => (tail.rotation.x = 0.35 * Math.sin(t * 1.6 + i)));
    // The blow: a puff of spray every few seconds while at the surface.
    const puff = (t % 6) / 6;
    w.blow.visible = st.blowing && puff < 0.5;
    if (w.blow.visible) {
      w.blow.position.set(0, 2 + puff * 8, -0.3 * 10);
      w.blow.scale.setScalar(2 + puff * 10);
      (w.blow.material as THREE.SpriteMaterial).opacity = 0.7 * (1 - puff * 2);
    }
  }

  private school(c: CreatureDef): School {
    const geo = new THREE.ConeGeometry(0.12, 0.55, 4);
    geo.rotateX(-Math.PI / 2); // nose along −Z
    const mesh = new THREE.InstancedMesh(geo, new THREE.MeshStandardMaterial({ color: 0xbfcad2, metalness: 0.7, roughness: 0.3 }), FISH_PER_SCHOOL);
    mesh.frustumCulled = false;
    const seeds = new Float32Array(FISH_PER_SCHOOL * 4);
    for (let i = 0; i < seeds.length; i++) seeds[i] = Math.random();
    this.group.add(mesh);
    return { mesh, seeds, size: c.size };
  }

  private placeSchool(s: School, st: CreatureState, t: number, cam: THREE.Vector3): void {
    nedToThree([st.north, st.east, st.depth], this.v);
    // Only drawn close by: the water hides it further off anyway.
    s.mesh.visible = this.v.distanceTo(cam) < 350;
    if (!s.mesh.visible) return;
    const cx = this.v.x;
    const cy = this.v.y;
    const cz = this.v.z;
    for (let i = 0; i < FISH_PER_SCHOOL; i++) {
      const a = s.seeds[i * 4]! * Math.PI * 2 + t * (0.25 + 0.1 * s.seeds[i * 4 + 1]!);
      const r = (s.size / 2) * (0.25 + 0.75 * s.seeds[i * 4 + 2]!);
      const y = (s.seeds[i * 4 + 3]! - 0.5) * (s.size / 3) + Math.sin(t * 0.7 + i) * 0.5;
      this.v.set(cx + Math.cos(a) * r, cy + y, cz + Math.sin(a) * r);
      // Swimming round the circle: heading along the tangent.
      this.q.setFromEuler(this.e.set(0, -a, 0));
      this.m4.compose(this.v, this.q, this.s.set(1, 1, 1));
      s.mesh.setMatrixAt(i, this.m4);
    }
    s.mesh.instanceMatrix.needsUpdate = true;
  }

  private plane(): Plane {
    const root = new THREE.Group();
    const grey = new THREE.MeshStandardMaterial({ color: 0xa9adb2, roughness: 0.6 });
    const body = new THREE.Mesh(new THREE.CylinderGeometry(1.4, 1.1, 34, 12), grey);
    body.rotation.x = Math.PI / 2;
    const wing = new THREE.Mesh(new THREE.BoxGeometry(32, 0.4, 4.5), grey);
    wing.position.set(0, 0.6, -2);
    const tailplane = new THREE.Mesh(new THREE.BoxGeometry(12, 0.3, 3), grey);
    tailplane.position.set(0, 0.8, 15);
    const fin = new THREE.Mesh(new THREE.BoxGeometry(0.3, 5, 4), grey);
    fin.position.set(0, 3, 15);
    root.add(body, wing, tailplane, fin);
    for (const x of [-10, -5, 5, 10]) {
      const eng = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.6, 4, 8), grey);
      eng.rotation.x = Math.PI / 2;
      eng.position.set(x, 0.3, -3.5);
      root.add(eng);
    }
    const lamp = (color: number, at: [number, number, number], size: number) => {
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.glow, color, blending: THREE.AdditiveBlending, depthWrite: false, sizeAttenuation: false, fog: false }));
      sp.scale.setScalar(size);
      sp.position.set(...at);
      root.add(sp);
      return sp;
    };
    const nav = [lamp(0xff3020, [-16, 0.6, -2], 0.012), lamp(0x30ff60, [16, 0.6, -2], 0.012)];
    const strobe = lamp(0xffffff, [0, -1.5, 0], 0.02);
    this.group.add(root);
    return { root, nav, strobe };
  }

  private flock(anchor: number | [number, number]): Flock {
    return { anchor, phase: Math.random() * 100, startled: -Infinity, away: 0, offset: new THREE.Vector3() };
  }

  private placeBirds(inp: LifeInput, surfaceAt: (x: number, z: number) => number): void {
    const { t } = inp;
    let n = 0;
    if (inp.night) {
      this.birds.count = 0;
      return;
    }
    const centre = new THREE.Vector3();
    for (const f of this.flocks) {
      let north: number;
      let east: number;
      if (typeof f.anchor === 'number') {
        const st = inp.vessels[f.anchor];
        if (!st || st.sunk > 0) continue;
        // Gulls trail a fishing boat, behind it.
        north = st.north - 40 * Math.cos(st.heading);
        east = st.east - 40 * Math.sin(st.heading);
      } else [north, east] = f.anchor;
      if (inp.showing && t > f.startled && Math.hypot(inp.showing[0] - north, inp.showing[1] - east) < STARTLE_RANGE) {
        f.startled = t + STARTLE_TIME;
        f.away = Math.atan2(east - inp.showing[1], north - inp.showing[0]);
      }
      // Startled: up and away, then back.
      const k = t < f.startled ? Math.sin((Math.PI * (STARTLE_TIME - (f.startled - t))) / STARTLE_TIME) : 0;
      north += Math.cos(f.away) * 350 * k;
      east += Math.sin(f.away) * 350 * k;
      nedToThree([north, east, 0], centre);
      if (centre.distanceTo(inp.camera) > 3000) continue;
      const sea = surfaceAt(centre.x, centre.z);
      for (let b = 0; b < BIRDS_PER_FLOCK && n < this.birds.instanceMatrix.count; b++) {
        const a = f.phase + b * 0.53 + t * (0.25 + 0.03 * (b % 4));
        const r = 18 + (b % 5) * 7;
        const y = sea + 12 + (b % 3) * 6 + 40 * k + 3 * Math.sin(t * 0.4 + b);
        this.v.set(centre.x + Math.cos(a) * r, y, centre.z + Math.sin(a) * r);
        const flap = 0.6 + 0.4 * Math.sin(t * 9 + b * 1.7);
        this.q.setFromEuler(this.e.set(0, -a + Math.PI, 0.25));
        this.m4.compose(this.v, this.q, this.s.set(1.4, 1.4 * flap, 1.4));
        this.birds.setMatrixAt(n++, this.m4);
      }
    }
    this.birds.count = n;
    this.birds.instanceMatrix.needsUpdate = true;
  }
}
