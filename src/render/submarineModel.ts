/**
 * Simple submarine model built from the simulation's own geometry data.
 * Parts live in separate groups (outer hull, pressure hull, tanks, sail,
 * control surfaces, propeller) with their own materials so a clipping-plane
 * cutaway view can be added later without restructuring.
 */
import * as THREE from 'three';
import type { SubmarineConfig, TankKind } from '../sim/config/submarine';
import { hullRadius } from '../sim/hull';
import { bodyToLocal } from './coords';

export interface SubmarineModel {
  root: THREE.Group;
  layers: {
    outerHull: THREE.Group;
    pressureHull: THREE.Group;
    tanks: THREE.Group;
    compartments: THREE.Group;
    appendages: THREE.Group;
  };
  /** Materials per layer, for clipping planes / transparency later. */
  materials: Record<string, THREE.Material>;
  rudderPivot: THREE.Group;
  planesPivot: THREE.Group;
  propeller: THREE.Group;
  /** Telescopic periscope mast and head; follow the mast extension. */
  periscopeMast: THREE.Mesh;
  periscopeHead: THREE.Mesh;
  snorkelMast: THREE.Mesh;
  snorkelHead: THREE.Mesh;
  /** The radar mast and its antenna (a flat bar across the boat). */
  radarMast: THREE.Mesh;
  radarHead: THREE.Mesh;
  /** Tank meshes by id, for showing fill levels later. */
  tankMeshes: Map<string, THREE.Mesh>;
}

const TANK_COLORS: Record<TankKind, number> = { mainBallast: 0x3d7fbf, trim: 0x3fbf8f, compensating: 0xbfa33f };

export function buildSubmarineModel(cfg: SubmarineConfig): SubmarineModel {
  const root = new THREE.Group();
  root.name = 'submarine';
  const materials = {
    outerHull: new THREE.MeshStandardMaterial({ color: 0x2b3238, roughness: 0.8, metalness: 0.2 }),
    pressureHull: new THREE.MeshStandardMaterial({ color: 0x6b7a85, roughness: 0.6, metalness: 0.4 }),
    sail: new THREE.MeshStandardMaterial({ color: 0x252b30, roughness: 0.8, metalness: 0.2 }),
    fins: new THREE.MeshStandardMaterial({ color: 0x3a434a, roughness: 0.7, metalness: 0.2 }),
    propeller: new THREE.MeshStandardMaterial({ color: 0xb08d57, roughness: 0.4, metalness: 0.8 }),
    compartment: new THREE.MeshStandardMaterial({ color: 0x8899aa, transparent: true, opacity: 0.15 }),
  };

  // Outer hull: lathe of the radius profile. Lathe revolves around +Y, so
  // the profile's Y is body x and the result is rotated onto −Z (forward).
  const outerHull = new THREE.Group();
  outerHull.name = 'outerHull';
  const pts: THREE.Vector2[] = [];
  const n = 120;
  for (let i = 0; i <= n; i++) {
    const x = -cfg.hull.length / 2 + (cfg.hull.length * i) / n;
    pts.push(new THREE.Vector2(Math.max(0.001, hullRadius(cfg.hull, x)), x));
  }
  const hullGeo = new THREE.LatheGeometry(pts, 48);
  hullGeo.rotateX(-Math.PI / 2); // +Y (body forward) → −Z
  outerHull.add(new THREE.Mesh(hullGeo, materials.outerHull));
  root.add(outerHull);

  // Pressure hull (hidden by default, revealed by a future cutaway).
  const pressureHull = new THREE.Group();
  pressureHull.name = 'pressureHull';
  const [px0, px1] = cfg.hull.pressureHullX;
  const phGeo = new THREE.CylinderGeometry(cfg.hull.pressureHullRadius, cfg.hull.pressureHullRadius, px1 - px0, 40, 1, false);
  phGeo.rotateX(-Math.PI / 2);
  const ph = new THREE.Mesh(phGeo, materials.pressureHull);
  ph.position.copy(bodyToLocal([(px0 + px1) / 2, 0, 0]));
  pressureHull.add(ph);
  pressureHull.visible = false;
  root.add(pressureHull);

  // Tanks from the tank data.
  const tanks = new THREE.Group();
  tanks.name = 'tanks';
  const tankMeshes = new Map<string, THREE.Mesh>();
  for (const def of cfg.tanks) {
    const mat = new THREE.MeshStandardMaterial({ color: TANK_COLORS[def.kind], transparent: true, opacity: 0.6 });
    materials[`tank_${def.id}` as keyof typeof materials] = mat;
    let geo: THREE.BufferGeometry;
    if (def.shape.type === 'box') {
      const [sx, sy, sz] = def.shape.size;
      geo = new THREE.BoxGeometry(sy, sz, sx); // local X = starboard, Y = up, Z = aft
    } else {
      geo = new THREE.CylinderGeometry(def.shape.radius, def.shape.radius, def.shape.length, 32);
      geo.rotateX(-Math.PI / 2);
    }
    const mesh = new THREE.Mesh(geo, mat);
    mesh.name = def.id;
    mesh.position.copy(bodyToLocal(def.position));
    tanks.add(mesh);
    tankMeshes.set(def.id, mesh);
  }
  tanks.visible = false;
  root.add(tanks);

  // Compartment volumes (dry), also for the future cutaway.
  const compartments = new THREE.Group();
  compartments.name = 'compartments';
  for (const c of cfg.compartments) {
    const len = c.xRange[1] - c.xRange[0];
    const geo = new THREE.CylinderGeometry(cfg.hull.pressureHullRadius * 0.98, cfg.hull.pressureHullRadius * 0.98, len, 32);
    geo.rotateX(-Math.PI / 2);
    const m = new THREE.Mesh(geo, materials.compartment);
    m.name = c.id;
    m.position.copy(bodyToLocal([(c.xRange[0] + c.xRange[1]) / 2, 0, 0]));
    compartments.add(m);
  }
  compartments.visible = false;
  root.add(compartments);

  // Appendages: sail, rudder, stern planes, propeller.
  const appendages = new THREE.Group();
  appendages.name = 'appendages';
  const sail = cfg.hull.sail;
  const sailGeo = new THREE.CapsuleGeometry(sail.thickness / 2, sail.length - sail.thickness, 6, 16);
  sailGeo.rotateX(Math.PI / 2); // capsule axis along Z
  sailGeo.scale(1, sail.height / sail.thickness, 1);
  const sailMesh = new THREE.Mesh(sailGeo, materials.sail);
  sailMesh.position.copy(bodyToLocal(sail.position));
  appendages.add(sailMesh);

  const finGeo = (span: number, chord: number) => new THREE.BoxGeometry(span, 0.25, chord);
  const rudderFin = cfg.fins.find((f) => f.id === 'rudder')!;
  const planesFin = cfg.fins.find((f) => f.id === 'sternPlanes')!;

  // Rudder: vertical, pivot about local Y at its quarter chord.
  const rudderPivot = new THREE.Group();
  rudderPivot.position.copy(bodyToLocal(rudderFin.position));
  const rChord = 2.6;
  const rSpan = rudderFin.area / rChord / 2;
  for (const s of [1, -1]) {
    const m = new THREE.Mesh(finGeo(0.25, rChord), materials.fins);
    m.scale.set(1, (rSpan + 1.2) / 0.25, 1);
    m.position.set(0, s * (rSpan / 2 + 0.6), rChord / 4);
    rudderPivot.add(m);
  }
  appendages.add(rudderPivot);

  // Stern planes: horizontal, pivot about local X.
  const planesPivot = new THREE.Group();
  planesPivot.position.copy(bodyToLocal(planesFin.position));
  const pChord = 2.6;
  const pSpan = planesFin.area / pChord / 2;
  for (const s of [1, -1]) {
    const m = new THREE.Mesh(finGeo(pSpan + 1.2, pChord), materials.fins);
    m.position.set(s * (pSpan / 2 + 0.6), 0, pChord / 4);
    planesPivot.add(m);
  }
  appendages.add(planesPivot);

  const propeller = new THREE.Group();
  propeller.position.copy(bodyToLocal(cfg.propulsion.position));
  const bladeGeo = new THREE.BoxGeometry(0.5, cfg.propulsion.diameter / 2, 0.12);
  bladeGeo.translate(0, cfg.propulsion.diameter / 4, 0);
  for (let i = 0; i < 7; i++) {
    const b = new THREE.Mesh(bladeGeo, materials.propeller);
    b.rotation.y = 0.35; // blade pitch
    const holder = new THREE.Group();
    holder.rotation.z = (i * 2 * Math.PI) / 7;
    holder.add(b);
    propeller.add(holder);
  }
  const hub = new THREE.Mesh(new THREE.SphereGeometry(0.45, 16, 12), materials.propeller);
  propeller.add(hub);
  appendages.add(propeller);

  // Periscope: a mast that slides up out of the sail, with a slightly thicker head.
  const per = cfg.periscope;
  const mastGeo = new THREE.CylinderGeometry(per.diameter / 2, per.diameter / 2, 1, 12);
  mastGeo.translate(0, 0.5, 0); // grows upwards from the foot
  const periscopeMast = new THREE.Mesh(mastGeo, materials.fins);
  periscopeMast.position.copy(bodyToLocal(per.base));
  periscopeMast.visible = false;
  const periscopeHead = new THREE.Mesh(new THREE.CylinderGeometry(per.diameter * 0.7, per.diameter * 0.7, 0.9, 12), materials.sail);
  periscopeHead.visible = false;
  appendages.add(periscopeMast, periscopeHead);
  // Snorkel: a thicker mast beside the periscope with the head valve on top.
  const sn = cfg.snorkel;
  const snorkelGeo = new THREE.CylinderGeometry(sn.diameter / 2, sn.diameter / 2, 1, 12);
  snorkelGeo.translate(0, 0.5, 0);
  const snorkelMast = new THREE.Mesh(snorkelGeo, materials.fins);
  snorkelMast.position.copy(bodyToLocal(sn.base));
  snorkelMast.visible = false;
  const snorkelHead = new THREE.Mesh(new THREE.BoxGeometry(sn.diameter * 1.3, 0.7, sn.diameter * 2.2), materials.sail);
  snorkelHead.visible = false;
  appendages.add(snorkelMast, snorkelHead);
  const rd = cfg.radar;
  const radarGeo = new THREE.CylinderGeometry(rd.diameter / 2, rd.diameter / 2, 1, 12);
  radarGeo.translate(0, 0.5, 0);
  const radarMast = new THREE.Mesh(radarGeo, materials.fins);
  radarMast.position.copy(bodyToLocal(rd.base));
  radarMast.visible = false;
  const radarHead = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.3, 0.35), materials.sail);
  radarHead.visible = false;
  appendages.add(radarMast, radarHead);
  root.add(appendages);

  return {
    root,
    layers: { outerHull, pressureHull, tanks, compartments, appendages },
    materials,
    rudderPivot,
    planesPivot,
    propeller,
    periscopeMast,
    periscopeHead,
    snorkelMast,
    snorkelHead,
    radarMast,
    radarHead,
    tankMeshes,
  };
}

/**
 * Applies actuator states to the model.
 * Rudder positive = starboard turn = trailing edge to starboard (pushes the stern to port).
 * Planes positive = dive = trailing edge down.
 */
export function updateSubmarineModel(
  m: SubmarineModel,
  rudder: number,
  planes: number,
  propellerAngle: number,
  periscope = 0,
  periscopeExtension = 7.5,
  snorkel = 0,
  snorkelExtension = 7.2,
  radar = 0,
  radarExtension = 7.0,
): void {
  const r = radar * radarExtension;
  m.radarMast.visible = r > 0.05;
  m.radarHead.visible = r > 0.05;
  m.radarMast.scale.y = Math.max(0.01, r);
  m.radarHead.position.copy(m.radarMast.position);
  m.radarHead.position.y += r;
  const s = snorkel * snorkelExtension;
  m.snorkelMast.visible = s > 0.05;
  m.snorkelHead.visible = s > 0.05;
  m.snorkelMast.scale.y = Math.max(0.01, s);
  m.snorkelHead.position.copy(m.snorkelMast.position);
  m.snorkelHead.position.y += s - 0.35;
  const h = periscope * periscopeExtension;
  m.periscopeMast.visible = h > 0.05;
  m.periscopeHead.visible = h > 0.05;
  m.periscopeMast.scale.y = Math.max(0.01, h);
  m.periscopeHead.position.copy(m.periscopeMast.position);
  m.periscopeHead.position.y += h - 0.45;
  // Trailing edge is toward +Z (aft). Rotating about +Y by +a moves +Z toward +X (starboard).
  m.rudderPivot.rotation.y = rudder;
  // Rotating about +X by +a moves +Z toward −Y (down).
  m.planesPivot.rotation.x = planes;
  m.propeller.rotation.z = propellerAngle;
}
