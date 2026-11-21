/**
 * The control room view (Manöverrum): the room seen from inside, as its own
 * small scene in the model's local frame (scene.ts renders it instead of
 * the world, so neither the sea surface, the fog nor the particles get in).
 * The equipment is the control room's from interior.ts (the same data as
 * the cutaway), with the pressure hull's inside, the two bulkheads with
 * their doors (open or shut after the simulation), pipes and lamps under
 * the deckhead, the screens (controlScreens.ts) as textures, a lamp hanging
 * on its cord (it shows which way is down when the boat pitches and rolls),
 * an alarm lamp, and water on the deck when the room floods.
 *
 * No lights: the materials are unlit with the shading baked into vertex
 * colours from a lamp in the deckhead, and the light's colour (white, or
 * red at night, in quiet running and with the periscope up) is the
 * materials' colour. Built on first use. Only reads from the simulation.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { SubmarineConfig, TankDef } from '../sim/config/submarine';
import type { Vec3 } from '../sim/math/vec3';
import { bodyToLocal } from './coords';
import { controlStations, screenFaces, type Station, type StationPanel } from './controlRoom.data';
import { ControlScreens, type ControlScreensState } from './controlScreens';
import { interiorItems, type Item, type Material } from './interior';
import { tankSamples, waterLevel } from './tankLevel';

export type ControlLighting = 'white' | 'red';

/** What the room shows, every frame. */
export interface ControlRoomFrame {
  lighting: ControlLighting;
  /** The alarm lamp turning. */
  alarm: boolean;
  /** How hard the room shakes now (depth charges, grounding), 0…1. */
  shake: number;
  /** Water in the control room, fraction of its whole volume (0…1). */
  water: number;
  /** The watertight doors from forward, 0 open … 1 shut. */
  doors: readonly number[];
  /** New screen contents (a new object when they should be drawn again), or null to keep them. */
  screens: ControlScreensState | null;
}

const BASE: Record<Material, number> = {
  steel: 0x9aa6ad,
  deck: 0x55606a,
  furniture: 0xa98a63,
  console: 0x4f5f6b,
  screen: 0x1d2a31,
  torpedo: 0x5d7a4a,
  battery: 0x2f3a40,
  engine: 0x7a4a3a,
  electric: 0x5b6f8f,
  pipe: 0xb08d57,
  air: 0x8fb0c4,
  fabric: 0x5d5070,
};
const TINT: Record<ControlLighting, THREE.Color> = { white: new THREE.Color(1, 0.96, 0.9), red: new THREE.Color(0.95, 0.24, 0.17) };

export interface ControlRoom {
  scene: THREE.Scene;
  stations: readonly Station[];
  /** Updates the room for a frame: `up` is true up in the body frame, `t` the time [s]. */
  update(frame: ControlRoomFrame, up: Vec3, t: number): void;
  /** The screen under a ray (from the camera through a tapped point), or null. */
  pick(ray: THREE.Raycaster): StationPanel | null;
}

export function createControlRoom(cfg: SubmarineConfig): ControlRoom {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x05090c);
  const stations = controlStations(cfg);
  const room = cfg.compartments.find((c) => c.id === 'control')!;
  const [x0, x1] = room.xRange;
  const up = room.decks[0]!.floor;
  const R = cfg.hull.pressureHullRadius;
  let built = false;
  const tinted: THREE.MeshBasicMaterial[] = [];
  const screenMats: THREE.MeshBasicMaterial[] = [];
  const screenMeshes = new Map<THREE.Object3D, StationPanel>();
  const screens = new ControlScreens();
  const textures: THREE.CanvasTexture[] = [];
  let doorMeshes: THREE.Mesh[] = [];
  let hanging: THREE.Group | null = null;
  let beacon: THREE.Mesh | null = null;
  let beaconMat: THREE.MeshBasicMaterial | null = null;
  let water: THREE.Mesh | null = null;
  const waterSamples = tankSamples(roomShell(), 10);
  let waterKey = '';
  let level = 0;

  function roomShell(): TankDef {
    const len = x1 - x0;
    return { id: 'control', name: room.name, kind: 'trim', position: [(x0 + x1) / 2, 0, 0], shape: { type: 'cylinder', length: len, radius: R * 0.98 }, volume: Math.PI * R * R * len, initialFill: 0 };
  }

  const material = (color: number, extra: THREE.MeshBasicMaterialParameters = {}) => {
    const m = new THREE.MeshBasicMaterial({ color: 0xffffff, vertexColors: true, side: THREE.DoubleSide, ...extra });
    m.userData.base = color;
    tinted.push(m);
    return m;
  };

  function build(): void {
    built = true;
    // Equipment on the upper deck (the lower deck lies under the floor), merged per material.
    const byMat = new Map<Material, THREE.BufferGeometry[]>();
    const add = (m: Material, g: THREE.BufferGeometry) => (byMat.get(m) ?? byMat.set(m, []).get(m)!).push(g);
    for (const item of interiorItems(cfg)) {
      if (item.space !== 'control' || item.at[2] > up + 0.2) continue;
      add(item.material, geometry(item));
    }
    // Under the deckhead: pipes and cable trays along the room, and lamps.
    for (const y of [-0.45, 0.45]) add('pipe', geometry({ space: 'control', at: [(x0 + x1) / 2, y, -2.72], shape: { type: 'cylinder', radius: 0.05, length: x1 - x0 - 0.1, axis: 'x' }, material: 'pipe' }));
    for (const y of [-0.95, 0.95]) add('electric', geometry({ space: 'control', at: [(x0 + x1) / 2, y, -2.6], shape: { type: 'box', size: [x1 - x0 - 0.1, 0.3, 0.04] }, material: 'electric' }));
    for (const m of [...byMat.keys()]) {
      const merged = mergeGeometries(byMat.get(m)!.map((g) => g.toNonIndexed()));
      bake(merged, BASE[m], false);
      scene.add(new THREE.Mesh(merged, material(BASE[m])));
    }
    // The pressure hull's inside: seen from within, so shaded as such.
    const hull = new THREE.CylinderGeometry(R - 0.03, R - 0.03, x1 - x0, 48, 1, true);
    hull.rotateX(-Math.PI / 2);
    hull.translate(0, 0, -(x0 + x1) / 2);
    const hullG = hull.toNonIndexed();
    bake(hullG, 0xc3ccd2, true);
    scene.add(new THREE.Mesh(hullG, material(0xc3ccd2, { side: THREE.BackSide })));
    // The bulkheads with a door on the port side; behind an open door the next room is dark.
    doorMeshes = [];
    for (const x of [x1, x0]) {
      const shape = new THREE.Shape().absarc(0, 0, R - 0.03, 0, Math.PI * 2, false);
      const y0 = -1.1;
      const w = 0.7;
      const hole = new THREE.Path().moveTo(y0, -up).lineTo(y0 + w, -up).lineTo(y0 + w, -up + 1.7).lineTo(y0, -up + 1.7).lineTo(y0, -up);
      shape.holes.push(hole);
      const g = new THREE.ShapeGeometry(shape, 48).toNonIndexed();
      g.translate(0, 0, -x);
      bake(g, 0x8c979e, false);
      scene.add(new THREE.Mesh(g, material(0x8c979e)));
      const beyond = x === x1 ? x + 0.4 : x - 0.4;
      const dark = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 2.2), new THREE.MeshBasicMaterial({ color: 0x020405, side: THREE.DoubleSide }));
      dark.position.set(y0 + w / 2, -up + 1.0, -beyond);
      scene.add(dark);
      const doorG = new THREE.BoxGeometry(w - 0.02, 1.68, 0.06).toNonIndexed();
      doorG.translate(y0 + w / 2, -up + 0.85, -x);
      bake(doorG, 0x7d8a92, false);
      const door = new THREE.Mesh(doorG, material(0x7d8a92));
      scene.add(door);
      doorMeshes.push(door);
    }
    // Lamps in the deckhead (always lit in the light's colour).
    const lampMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    lampMat.userData.lamp = true;
    tinted.push(lampMat);
    for (const x of [x0 + 2, x0 + 5, x0 + 8]) {
      const l = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.04, 0.9), lampMat);
      l.position.copy(bodyToLocal([x, 0, -2.78]));
      scene.add(l);
    }
    // A lamp hanging on its cord from the deckhead: it hangs towards true down.
    hanging = new THREE.Group();
    const cord = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.55, 6), new THREE.MeshBasicMaterial({ color: 0x222222 }));
    cord.position.y = -0.275;
    const shade = new THREE.Mesh(new THREE.ConeGeometry(0.13, 0.12, 16, 1, true), material(0x3d4a40));
    bake(shade.geometry, 0x3d4a40, false);
    shade.position.y = -0.58;
    const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.04, 10, 8), lampMat);
    bulb.position.y = -0.62;
    hanging.add(cord, shade, bulb);
    hanging.position.copy(bodyToLocal([x0 + 6.8, 1.15, -2.62]));
    scene.add(hanging);
    // The alarm lamp over the helm.
    beaconMat = new THREE.MeshBasicMaterial({ color: 0x3a1010 });
    beacon = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.09, 0.12, 14), beaconMat);
    beacon.position.copy(bodyToLocal([x1 - 0.5, 0.6, -2.68]));
    scene.add(beacon);
    // Water on the deck: a level surface, hidden by the deck and the walls where it should not show.
    water = new THREE.Mesh(new THREE.PlaneGeometry(30, 30), new THREE.MeshBasicMaterial({ color: 0x2f78b7, transparent: true, opacity: 0.6, side: THREE.DoubleSide, depthWrite: false }));
    water.visible = false;
    scene.add(water);
    // The screens.
    for (const { panel, center: c, right, up: upv, width: w, height: h } of screenFaces(cfg)) {
      const tex = new THREE.CanvasTexture(screens.canvases[panel]);
      tex.colorSpace = THREE.SRGBColorSpace;
      textures.push(tex);
      const m = new THREE.MeshBasicMaterial({ map: tex });
      screenMats.push(m);
      const g = new THREE.PlaneGeometry(w, h);
      const r = bodyToLocal(right);
      const u = bodyToLocal(upv);
      const n = r.clone().cross(u);
      g.applyMatrix4(new THREE.Matrix4().makeBasis(r, u, n).setPosition(bodyToLocal(c)));
      const mesh = new THREE.Mesh(g, m);
      scene.add(mesh);
      screenMeshes.set(mesh, panel);
    }
  }

  /** Bakes a lamp in the deckhead into vertex colours: tops lit, sides less, undersides dark. */
  function bake(g: THREE.BufferGeometry, color: number, inside: boolean): void {
    if (!g.getAttribute('normal')) g.computeVertexNormals();
    const nrm = g.getAttribute('normal');
    const pos = g.getAttribute('position');
    const base = new THREE.Color(color);
    const out = new Float32Array(pos.count * 3);
    for (let i = 0; i < pos.count; i++) {
      const s = inside ? -1 : 1;
      const ny = nrm.getY(i) * s;
      const nx = nrm.getX(i) * s;
      // Brighter near the deckhead lamps (local y up), darker low down.
      const height = Math.max(0, Math.min(1, (pos.getY(i) + up) / 2.55)); // local y = −z: 0 at the deck, 1 at the deckhead
      const k = 0.42 + 0.38 * Math.max(0, ny) + 0.12 * Math.abs(nx) - 0.12 * Math.max(0, -ny) + 0.18 * height;
      out[i * 3] = base.r * k;
      out[i * 3 + 1] = base.g * k;
      out[i * 3 + 2] = base.b * k;
    }
    g.setAttribute('color', new THREE.BufferAttribute(out, 3));
  }

  const tint = new THREE.Color();
  const v = new THREE.Vector3();
  const q = new THREE.Quaternion();
  const Y = new THREE.Vector3(0, 1, 0);

  function update(f: ControlRoomFrame, upBody: Vec3, t: number): void {
    if (!built) build();
    if (f.screens) {
      screens.draw(f.screens);
      for (const tx of textures) tx.needsUpdate = true;
    }
    // The light: its colour, flickering red while the alarm turns.
    const pulse = f.alarm ? 0.5 + 0.5 * Math.sin(t * 7) : 0;
    tint.copy(TINT[f.lighting]).lerp(TINT.red, 0.35 * pulse);
    for (const m of tinted) {
      if (m.userData.lamp) m.color.copy(tint).lerp(new THREE.Color(1, 1, 1), f.lighting === 'white' ? 0.6 : 0.2);
      else m.color.copy(tint);
    }
    for (const m of screenMats) m.color.setScalar(f.lighting === 'red' ? 0.7 : 1);
    if (beaconMat) beaconMat.color.setRGB(0.25 + 0.75 * pulse, 0.05 + 0.1 * pulse, 0.05);
    if (beacon) beacon.rotation.y = f.alarm ? t * 6 : 0;
    // Doors: forward is the first bulkhead (between the torpedo room and this), aft the second.
    const fwd = f.doors[0] ?? 1;
    const aft = f.doors[1] ?? 1;
    if (doorMeshes[0]) doorMeshes[0].visible = fwd > 0.5;
    if (doorMeshes[1]) doorMeshes[1].visible = aft > 0.5;
    // The hanging lamp points along true down.
    if (hanging) {
      bodyToLocal([-upBody[0], -upBody[1], -upBody[2]], v).normalize();
      q.setFromUnitVectors(Y.clone().negate(), v);
      hanging.quaternion.copy(q);
    }
    // Water: the level surface, perpendicular to true up.
    if (water) {
      water.visible = f.water > 0.0005;
      if (water.visible) {
        const key = `${f.water.toFixed(4)} ${upBody.map((x) => x.toFixed(2)).join(',')}`;
        if (key !== waterKey) {
          waterKey = key;
          level = waterLevel(waterSamples, upBody, f.water);
        }
        const xc = (x0 + x1) / 2;
        const d = level - upBody[0] * xc;
        water.position.copy(bodyToLocal([xc + upBody[0] * d, upBody[1] * d, upBody[2] * d]));
        bodyToLocal(upBody, v).normalize();
        water.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), v);
      }
    }
  }

  function pick(ray: THREE.Raycaster): StationPanel | null {
    if (!built) return null;
    const hits = ray.intersectObjects(scene.children, false);
    for (const h of hits) {
      if (h.object === water) continue;
      return screenMeshes.get(h.object) ?? null;
    }
    return null;
  }

  return { scene, stations, update, pick };
}

/** The geometry of an item in the model's local frame (as in cutaway.ts). */
function geometry(item: Item): THREE.BufferGeometry {
  let g: THREE.BufferGeometry;
  if (item.shape.type === 'box') {
    const [sx, sy, sz] = item.shape.size;
    g = new THREE.BoxGeometry(sy, sz, sx);
  } else {
    const { radius, length, axis } = item.shape;
    g = new THREE.CylinderGeometry(radius, radius, length, 20);
    if (axis === 'x') g.rotateX(Math.PI / 2);
    else if (axis === 'y') g.rotateZ(Math.PI / 2);
  }
  const at = bodyToLocal(item.at);
  g.translate(at.x, at.y, at.z);
  return g;
}
