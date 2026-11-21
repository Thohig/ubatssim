/**
 * The cutaway view's 3D parts: the boat cut along its centre line (side) or
 * through the upper deck (top), with bulkheads, decks, the equipment from
 * interior.ts, water in the tanks (a level surface, see tankLevel.ts),
 * bubbles in the main ballast, pump flows and the HP air bottles; water
 * in leaking compartments (level as in the tanks), the battery cells lit
 * after their charge, the diesels running, and the torpedo tubes' breech
 * doors and the reserve torpedoes after the fire control. No people.
 *
 * Built on first use. Clipping planes (renderer.localClippingEnabled) cut
 * the hulls and everything inside; the cut objects are double-sided, so a
 * cut shows their inside rather than a hole. The interior is merged into
 * one mesh per material. Only read from the simulation, never written.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { SubmarineConfig, TankDef } from '../sim/config/submarine';
import type { Vec3 } from '../sim/math/vec3';
import { bodyToLocal } from './coords';
import { interiorItems, RACKS, TUBE_Y, TUBE_Z, type Item, type Material } from './interior';
import type { SubmarineModel } from './submarineModel';
import { tankSamples, waterLevel } from './tankLevel';

export type CutPlan = 'side' | 'top';

/** What the cutaway shows of the simulation, per frame. */
export interface CutawayState {
  plan: CutPlan;
  /** True up in the body frame (unit vector). */
  up: Vec3;
  tanks: readonly { id: string; fill: number; ventOpen: boolean; blowOpen: boolean }[];
  /** Pumps still to move [m³]: trim (+ = aft → forward), compensation (+ = from the sea). */
  trimRemaining: number;
  compRemaining: number;
  /** HP air, fraction of full pressure. */
  air: number;
  /** Accumulated propeller angle [rad] (turns the shaft). */
  propellerAngle: number;
  /** The tapped space, highlighted, or null. */
  selected: string | null;
  /** Water in the compartments, fraction of the compartment's whole volume (0…1). */
  compartments?: readonly { id: string; fill: number }[];
  /** Battery state of charge 0…1 and whether it is being charged; the diesels running. */
  battery?: number;
  charging?: boolean;
  dieselRunning?: boolean;
  /** Torpedo tubes (loaded, or seconds of loading left) and the torpedoes left in the racks. */
  tubes?: readonly { loaded: boolean; loading: number; ready?: boolean; busy?: boolean }[];
  reserve?: number;
  /** Time [s], for the animations. */
  t: number;
}

/** Height of the top cut above the upper decks (body z [m]). */
export const TOP_CUT_Z = -1.6;

const COLORS: Record<Material, number> = {
  steel: 0x9aa6ad,
  deck: 0x4c565c,
  furniture: 0xa98a63,
  console: 0x50606c,
  screen: 0x3fa7c9,
  torpedo: 0x5d7a4a,
  battery: 0x2f3a40,
  engine: 0x7a4a3a,
  electric: 0x5b6f8f,
  pipe: 0xb08d57,
  air: 0x8fb0c4,
  fabric: 0x6b5d7a,
};

export interface Cutaway {
  group: THREE.Group;
  setActive(on: boolean): void;
  update(s: CutawayState): void;
  /** The cut plane in world space (for picking). */
  cutPlane(): THREE.Plane;
}

export function createCutaway(model: SubmarineModel, cfg: SubmarineConfig): Cutaway {
  const group = new THREE.Group();
  group.name = 'cutaway';
  group.visible = false;
  model.root.add(group);
  const cut = new THREE.Plane();
  const clip = [cut];
  let built = false;
  let active = false;
  let plan: CutPlan = 'side';

  // Hull materials take the cut while the view is on.
  const hullMaterials = [model.materials.outerHull, model.materials.sail, model.materials.pressureHull, ...[...model.tankMeshes.values()].map((m) => m.material as THREE.Material)].filter(
    (m): m is THREE.Material => !!m,
  );

  const mat = (color: number, extra: THREE.MeshStandardMaterialParameters = {}) =>
    new THREE.MeshStandardMaterial({ color, roughness: 0.75, metalness: 0.15, side: THREE.DoubleSide, clippingPlanes: clip, fog: false, ...extra });

  // Parts that change.
  const water = new Map<string, { mesh: THREE.Mesh; plane: THREE.Plane; samples: Vec3[]; key: string }>();
  const bubbles = new Map<string, THREE.Points>();
  let shaft: THREE.Mesh | null = null;
  let airMat: THREE.MeshStandardMaterial | null = null;
  let batteryMat: THREE.MeshStandardMaterial | null = null;
  let engineMesh: THREE.Mesh | null = null;
  let engineMat: THREE.MeshStandardMaterial | null = null;
  const compWater = new Map<string, { mesh: THREE.Mesh; plane: THREE.Plane; samples: Vec3[]; key: string }>();
  const doors: THREE.MeshStandardMaterial[] = [];
  const reserves: THREE.Mesh[] = [];
  const trimArrow = arrow(0x5fd3ff);
  const compArrow = arrow(0x5fd3ff);
  const highlight = new Map<string, THREE.Mesh>();
  const extraLight = new THREE.HemisphereLight(0xffffff, 0x445566, 1.1);

  function build(): void {
    built = true;
    // Equipment, merged per material.
    const byMat = new Map<Material, THREE.BufferGeometry[]>();
    for (const item of interiorItems(cfg)) {
      const g = geometry(item);
      if (item.shaft) {
        const m = new THREE.Mesh(g, mat(COLORS.pipe, { metalness: 0.6 }));
        shaft = m;
        group.add(m);
        continue;
      }
      (byMat.get(item.material) ?? byMat.set(item.material, []).get(item.material)!).push(g);
    }
    for (const [m, list] of byMat) {
      const merged = mergeGeometries(list.map((g) => g.toNonIndexed()));
      const material = mat(COLORS[m], m === 'screen' ? { emissive: COLORS.screen, emissiveIntensity: 0.5 } : {});
      if (m === 'air') airMat = material;
      if (m === 'battery') batteryMat = material;
      const mesh = new THREE.Mesh(merged, material);
      if (m === 'engine') {
        engineMesh = mesh;
        engineMat = material;
      }
      group.add(mesh);
    }

    // The pressure hull's inside, and the bulkheads with their doors.
    const R = cfg.hull.pressureHullRadius;
    const [px0, px1] = cfg.hull.pressureHullX;
    const inner = new THREE.CylinderGeometry(R - 0.03, R - 0.03, px1 - px0, 48, 1, true);
    inner.rotateX(-Math.PI / 2);
    const innerMesh = new THREE.Mesh(inner, mat(0xc9d1d6, { side: THREE.BackSide }));
    innerMesh.position.copy(bodyToLocal([(px0 + px1) / 2, 0, 0]));
    group.add(innerMesh);
    const bulkheadMat = mat(0x8c979e);
    const ends = new Set([px0, px1]);
    const xs = [...new Set(cfg.compartments.flatMap((c) => c.xRange))];
    for (const x of xs) {
      const shape = new THREE.Shape().absarc(0, 0, R - 0.03, 0, Math.PI * 2, false);
      if (!ends.has(x)) {
        // A door on the port side, from the higher of the two floors.
        const floors = cfg.compartments.filter((c) => c.xRange.includes(x)).map((c) => c.decks[0]!.floor);
        const floor = Math.min(...floors);
        const door = new THREE.Path();
        const y0 = -1.1;
        const w = 0.7;
        door.moveTo(y0, -floor).lineTo(y0 + w, -floor).lineTo(y0 + w, -floor + 1.7).lineTo(y0, -floor + 1.7).lineTo(y0, -floor);
        shape.holes.push(door);
      }
      const g = new THREE.ShapeGeometry(shape, 48);
      // Shape XY = local X (starboard), local Y (up): the plane at local Z = −x.
      const m = new THREE.Mesh(g, bulkheadMat);
      m.position.z = -x;
      group.add(m);
    }

    // Water in the tanks: the tank's shape, cut at the level surface.
    for (const def of cfg.tanks) {
      const shell = model.tankMeshes.get(def.id);
      if (!shell) continue;
      const plane = new THREE.Plane();
      const wm = new THREE.Mesh(shell.geometry, mat(0x2f78b7, { transparent: true, opacity: 0.8, clippingPlanes: [cut, plane], depthWrite: false }));
      wm.position.copy(shell.position);
      wm.scale.setScalar(0.985);
      group.add(wm);
      water.set(def.id, { mesh: wm, plane, samples: tankSamples(def, 10), key: '' });
      // Highlight: the tank's outline when tapped.
      const edges = new THREE.LineSegments(new THREE.EdgesGeometry(shell.geometry), new THREE.LineBasicMaterial({ color: 0xffd166, clippingPlanes: clip }));
      edges.position.copy(shell.position);
      edges.visible = false;
      group.add(edges);
      highlight.set(def.id, edges as unknown as THREE.Mesh);
      if (def.kind === 'mainBallast') {
        const pts = new THREE.BufferGeometry();
        const n = 60;
        const arr = new Float32Array(n * 3);
        pts.setAttribute('position', new THREE.BufferAttribute(arr, 3));
        const p = new THREE.Points(pts, new THREE.PointsMaterial({ color: 0xe8f6ff, size: 0.18, transparent: true, opacity: 0.85, clippingPlanes: clip, fog: false }));
        p.position.copy(shell.position);
        p.visible = false;
        p.userData.seeds = Array.from({ length: n }, () => [Math.random(), Math.random(), Math.random()]);
        const shape = def.shape as TankDef['shape'];
        p.userData.extent = shape.type === 'box' ? shape.size : [shape.length, shape.radius * 1.4, shape.radius * 1.4];
        group.add(p);
        bubbles.set(def.id, p);
      }
    }

    // Water in leaking compartments: the compartment's cylinder, cut at a level surface as in the tanks.
    for (const c of cfg.compartments) {
      const len = c.xRange[1] - c.xRange[0];
      const g = new THREE.CylinderGeometry(R * 0.96, R * 0.96, len - 0.1, 40);
      g.rotateX(-Math.PI / 2);
      const plane = new THREE.Plane();
      const m = new THREE.Mesh(g, mat(0x2f78b7, { transparent: true, opacity: 0.55, clippingPlanes: [cut, plane], depthWrite: false }));
      m.position.copy(bodyToLocal([(c.xRange[0] + c.xRange[1]) / 2, 0, 0]));
      m.visible = false;
      group.add(m);
      const shell: TankDef = {
        id: c.id,
        name: c.name,
        kind: 'trim',
        position: [(c.xRange[0] + c.xRange[1]) / 2, 0, 0],
        shape: { type: 'cylinder', length: len, radius: R * 0.96 },
        volume: Math.PI * R * R * len,
        initialFill: 0,
      };
      compWater.set(c.id, { mesh: m, plane, samples: tankSamples(shell, 10), key: '' });
    }

    // Torpedo room: the tubes' breech doors (lit after their state) and the reserve torpedoes.
    const tor = cfg.compartments.find((c) => c.id === 'torpedo');
    if (tor) {
      const [tx0, tx1] = tor.xRange;
      for (const y of TUBE_Y)
        for (const z of TUBE_Z) {
          const dm = mat(0x5a4a3a, { emissive: 0x000000 });
          doors.push(dm);
          group.add(new THREE.Mesh(geometry({ space: 'torpedo', at: [tx1 - 6.15, y, z], shape: { type: 'cylinder', radius: 0.38, length: 0.12, axis: 'x' }, material: 'pipe' }), dm));
        }
      const tm = mat(COLORS.torpedo);
      for (const r of RACKS) {
        const t = new THREE.Mesh(geometry({ space: 'torpedo', at: [tx0 + 3.6, r[0], r[1]], shape: { type: 'cylinder', radius: 0.267, length: 5.8, axis: 'x' }, material: 'torpedo' }), tm);
        reserves.push(t);
        group.add(t);
      }
    }

    // Compartment highlight: a faint lit volume.
    for (const c of cfg.compartments) {
      const len = c.xRange[1] - c.xRange[0];
      const g = new THREE.CylinderGeometry(R * 0.97, R * 0.97, len - 0.1, 40);
      g.rotateX(-Math.PI / 2);
      const m = new THREE.Mesh(g, mat(0xffd166, { transparent: true, opacity: 0.12, depthWrite: false, emissive: 0xffd166, emissiveIntensity: 0.4 }));
      m.position.copy(bodyToLocal([(c.xRange[0] + c.xRange[1]) / 2, 0, 0]));
      m.visible = false;
      group.add(m);
      highlight.set(c.id, m);
    }

    // Pump flows: trim (between the trim tanks, under the floors), compensation (sea ↔ tank).
    group.add(trimArrow.group, compArrow.group);
  }

  function arrow(color: number) {
    const g = new THREE.Group();
    const m = new THREE.MeshBasicMaterial({ color, clippingPlanes: clip, fog: false });
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 1, 8), m);
    const head = new THREE.Mesh(new THREE.ConeGeometry(0.22, 0.5, 12), m);
    g.add(body, head);
    g.visible = false;
    return { group: g, body, head };
  }

  /** Points an arrow from body point a to b (shown moving while the pump runs). */
  function placeArrow(a: { group: THREE.Group; body: THREE.Mesh; head: THREE.Mesh }, from: Vec3, to: Vec3, t: number) {
    const p0 = bodyToLocal(from);
    const p1 = bodyToLocal(to);
    const dir = p1.clone().sub(p0);
    const len = dir.length();
    dir.normalize();
    a.group.position.copy(p0);
    a.group.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
    a.body.scale.y = len - 0.5;
    a.body.position.y = (len - 0.5) / 2;
    // The head runs along the arrow, so the flow is seen.
    a.head.position.y = len - 0.25 - (1 - ((t * 0.8) % 1)) * Math.min(1.5, len * 0.4);
    a.group.visible = true;
  }

  function setActive(on: boolean): void {
    if (on && !built) build();
    active = on;
    group.visible = on;
    model.layers.pressureHull.visible = on;
    model.layers.tanks.visible = on;
    for (const m of hullMaterials) {
      m.clippingPlanes = on ? clip : null;
      m.side = on ? THREE.DoubleSide : THREE.FrontSide;
      m.needsUpdate = true;
    }
    for (const m of model.tankMeshes.values()) {
      const tm = m.material as THREE.MeshStandardMaterial;
      tm.opacity = on ? 0.18 : 0.6;
      tm.depthWrite = !on;
    }
    if (on && !extraLight.parent) model.root.parent?.add(extraLight);
    if (!on) extraLight.removeFromParent();
  }

  const n = new THREE.Vector3();
  const p = new THREE.Vector3();

  function update(s: CutawayState): void {
    if (!active) return;
    plan = s.plan;
    model.root.updateMatrixWorld();
    const world = model.root.matrixWorld;
    // The cut: keep the port half (side) or what lies below the top cut (top).
    if (plan === 'side') {
      bodyToLocal([0, -1, 0], n);
      bodyToLocal([0, 0, 0], p);
    } else {
      bodyToLocal([0, 0, 1], n);
      bodyToLocal([0, 0, TOP_CUT_Z], p);
    }
    cut.setFromNormalAndCoplanarPoint(n, p).applyMatrix4(world);

    // Water levels: recomputed only when the fill or the attitude has changed.
    const up = s.up;
    for (const tk of s.tanks) {
      const w = water.get(tk.id);
      if (!w) continue;
      // Steps of 1 % and ~0.5° are below what can be seen, and spare a sort of the samples.
      const key = `${tk.fill.toFixed(2)} ${up.map((v) => v.toFixed(2)).join(',')}`;
      if (key !== w.key) {
        w.key = key;
        w.mesh.userData.level = waterLevel(w.samples, up, tk.fill);
      }
      const h = w.mesh.userData.level as number;
      w.mesh.visible = tk.fill > 0.002;
      // Keep where −up·p + h ≥ 0 (below the surface), body frame → world.
      bodyToLocal([-up[0], -up[1], -up[2]], n);
      bodyToLocal([up[0] * h, up[1] * h, up[2] * h], p);
      w.plane.setFromNormalAndCoplanarPoint(n, p).applyMatrix4(world);
      // Bubbles while the main ballast vents or blows.
      const b = bubbles.get(tk.id);
      if (b) animateBubbles(b, tk.ventOpen || tk.blowOpen, s.t);
    }

    // Pumps.
    const tf = cfg.tanks.find((x) => x.id === 'trim_fwd')!.position;
    const ta = cfg.tanks.find((x) => x.id === 'trim_aft')!.position;
    const cp = cfg.tanks.find((x) => x.id === 'comp')!.position;
    if (s.trimRemaining !== 0) {
      const fwd = s.trimRemaining > 0;
      placeArrow(trimArrow, [fwd ? ta[0] + 1.6 : tf[0] - 1.6, -0.6, ta[2] + 0.3], [fwd ? tf[0] - 1.6 : ta[0] + 1.6, -0.6, ta[2] + 0.3], s.t);
    } else trimArrow.group.visible = false;
    if (s.compRemaining !== 0) {
      const sea: Vec3 = [cp[0] + 3.6, -0.6, cp[2] + 1.6];
      const tank: Vec3 = [cp[0] + 2.4, -0.6, cp[2]];
      placeArrow(compArrow, s.compRemaining > 0 ? sea : tank, s.compRemaining > 0 ? tank : sea, s.t);
    } else compArrow.group.visible = false;

    if (shaft) shaft.rotation.z = s.propellerAngle;
    if (airMat) {
      airMat.emissive.setHex(0x5fd3ff);
      airMat.emissiveIntensity = 0.05 + 0.45 * Math.max(0, Math.min(1, s.air));
    }
    for (const [id, m] of highlight) m.visible = id === s.selected;

    // Water in the compartments.
    for (const c of s.compartments ?? []) {
      const w = compWater.get(c.id);
      if (!w) continue;
      w.mesh.visible = c.fill > 0.001;
      if (!w.mesh.visible) continue;
      const key = `${c.fill.toFixed(3)} ${up.map((v) => v.toFixed(2)).join(',')}`;
      if (key !== w.key) {
        w.key = key;
        w.mesh.userData.level = waterLevel(w.samples, up, c.fill);
      }
      const h = w.mesh.userData.level as number;
      bodyToLocal([-up[0], -up[1], -up[2]], n);
      bodyToLocal([up[0] * h, up[1] * h, up[2] * h], p);
      w.plane.setFromNormalAndCoplanarPoint(n, p).applyMatrix4(world);
    }
    // The battery cells: green while charging (a slow pulse), amber and red as they run down.
    if (batteryMat && s.battery !== undefined) {
      const soc = s.battery;
      if (s.charging) {
        batteryMat.emissive.setHex(0x3ad17a);
        batteryMat.emissiveIntensity = 0.25 + 0.2 * Math.sin(s.t * 2.5);
      } else if (soc < 0.15) {
        batteryMat.emissive.setHex(0xff4a4a);
        batteryMat.emissiveIntensity = 0.35 + 0.25 * Math.max(0, Math.sin(s.t * 4));
      } else if (soc < 0.3) {
        batteryMat.emissive.setHex(0xffb347);
        batteryMat.emissiveIntensity = 0.3;
      } else {
        batteryMat.emissive.setHex(0x3ad17a);
        batteryMat.emissiveIntensity = 0.04 + 0.1 * soc;
      }
    }
    // The diesels: shaking and warm while they run.
    if (engineMesh && engineMat) {
      const on = !!s.dieselRunning;
      (engineMesh as THREE.Mesh).position.set(on ? 0.012 * Math.sin(s.t * 70) : 0, on ? 0.01 * Math.sin(s.t * 53) : 0, 0);
      engineMat.emissive.setHex(0xff7a3a);
      engineMat.emissiveIntensity = on ? 0.18 + 0.06 * Math.sin(s.t * 9) : 0;
    }
    // Torpedo tubes: green ready to fire, blue loaded, amber at work (flooding, opening, loading …), dark empty; the racks show the reserve left.
    (s.tubes ?? []).forEach((tb, i) => {
      const dm = doors[i];
      if (!dm) return;
      const busy = tb.busy ?? tb.loading > 0;
      dm.emissive.setHex(tb.ready ? 0x3ad17a : busy ? 0xffb347 : tb.loaded ? 0x3a8fd1 : 0x000000);
      dm.emissiveIntensity = tb.ready ? 0.6 : busy ? 0.35 + 0.25 * Math.sin(s.t * 3) : tb.loaded ? 0.4 : 0;
    });
    if (s.reserve !== undefined) reserves.forEach((m, i) => (m.visible = i < (s.reserve ?? 0)));
  }

  function animateBubbles(b: THREE.Points, on: boolean, t: number): void {
    b.visible = on;
    if (!on) return;
    const pos = b.geometry.getAttribute('position') as THREE.BufferAttribute;
    const seeds = b.userData.seeds as number[][];
    const [ex, ey, ez] = b.userData.extent as number[];
    // Local frame: X starboard, Y up, Z aft (as the tank mesh).
    for (let i = 0; i < seeds.length; i++) {
      const [a, c, d] = seeds[i]!;
      const rise = ((t * (0.25 + 0.2 * c!) + a!) % 1) - 0.5;
      pos.setXYZ(i, (c! - 0.5) * ey! * 0.8, rise * ez! * 0.9, (d! - 0.5) * ex! * 0.8);
    }
    pos.needsUpdate = true;
  }

  return { group, setActive, update, cutPlane: () => cut };
}

/** The geometry of an item in the model's local frame. */
function geometry(item: Item): THREE.BufferGeometry {
  let g: THREE.BufferGeometry;
  if (item.shape.type === 'box') {
    const [sx, sy, sz] = item.shape.size;
    g = new THREE.BoxGeometry(sy, sz, sx); // local X = starboard, Y = up, Z = aft
  } else {
    const { radius, length, axis } = item.shape;
    g = new THREE.CylinderGeometry(radius, radius, length, 20);
    // Cylinder axis is local Y (= body up/down, z).
    if (axis === 'x') g.rotateX(Math.PI / 2); // → local Z (body x)
    else if (axis === 'y') g.rotateZ(Math.PI / 2); // → local X (body y)
  }
  const at = bodyToLocal(item.at);
  g.translate(at.x, at.y, at.z);
  return g;
}
