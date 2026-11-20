/**
 * Other vessels: simple low-poly ships (hull, superstructure, funnel or
 * wheelhouse) with navigation lights: masthead (white), port (red),
 * starboard (green) and stern (white). The lights glow at night and in fog.
 */
import * as THREE from 'three';
import type { VesselDef, VesselState } from '../sim/vessel';
import { nedToThree } from './coords';

interface ShipModel {
  root: THREE.Group;
  lights: THREE.Sprite[];
}

const HULL = { freighter: 0x5a2420, ferry: 0xf0f0ea, fishing: 0x1f4f7a } as const;
const TOP = { freighter: 0xe8e4da, ferry: 0x1f5fa8, fishing: 0xf2f2ee } as const;

function glowTexture(): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = c.height = 32;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(16, 16, 0, 16, 16, 16);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.3, 'rgba(255,255,255,0.5)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 32, 32);
  return new THREE.CanvasTexture(c);
}

export class VesselView {
  private ships: ShipModel[] = [];
  private readonly group = new THREE.Group();
  private readonly glow = glowTexture();
  private lightsOn = false;

  constructor(scene: THREE.Scene) {
    scene.add(this.group);
  }

  setVessels(defs: readonly VesselDef[]): void {
    this.group.clear();
    this.ships = defs.map((d) => this.build(d));
    for (const s of this.ships) this.group.add(s.root);
  }

  setLights(on: boolean): void {
    this.lightsOn = on;
  }

  /** `heave` gives the water surface elevation at a Three.js (x, z) point. */
  update(states: readonly VesselState[], heave: (x: number, z: number) => number): void {
    states.forEach((st, i) => {
      const s = this.ships[i];
      if (!s) return;
      nedToThree([st.north, st.east, 0], s.root.position);
      s.root.position.y = heave(s.root.position.x, s.root.position.z);
      // Model bow is −Z; heading is clockwise from north (−Z) towards east (+X).
      s.root.rotation.y = -st.heading;
      for (const l of s.lights) l.visible = this.lightsOn;
    });
  }

  private build(d: VesselDef): ShipModel {
    const root = new THREE.Group();
    const L = d.length;
    const B = d.beam;
    const freeboard = Math.max(1.5, L * 0.06);
    const hullMat = new THREE.MeshStandardMaterial({ color: HULL[d.kind], roughness: 0.8 });
    const topMat = new THREE.MeshStandardMaterial({ color: TOP[d.kind], roughness: 0.7 });
    // Hull: a box with a tapered bow.
    const hullGeo = new THREE.BoxGeometry(B, d.draft + freeboard, L, 1, 1, 4);
    const pos = hullGeo.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      if (pos.getZ(i) < -L * 0.3) pos.setX(i, pos.getX(i) * Math.max(0.15, (pos.getZ(i) + L / 2) / (L * 0.2)));
    }
    hullGeo.computeVertexNormals();
    const hull = new THREE.Mesh(hullGeo, hullMat);
    hull.position.y = (freeboard - d.draft) / 2;
    root.add(hull);
    // Superstructure aft (freighter), midships (ferry) or forward (fishing boat).
    const where = d.kind === 'freighter' ? L * 0.35 : d.kind === 'ferry' ? 0 : -L * 0.15;
    const hTop = d.kind === 'ferry' ? L * 0.12 : L * 0.08;
    const lTop = d.kind === 'ferry' ? L * 0.7 : L * 0.18;
    const top = new THREE.Mesh(new THREE.BoxGeometry(B * 0.85, hTop, lTop), topMat);
    top.position.set(0, freeboard + hTop / 2, where);
    root.add(top);
    if (d.kind === 'freighter') {
      // Cargo hatches forward.
      const hatchMat = new THREE.MeshStandardMaterial({ color: 0x3d4a3a, roughness: 0.9 });
      for (let k = 0; k < 3; k++) {
        const h = new THREE.Mesh(new THREE.BoxGeometry(B * 0.7, 1.2, L * 0.14), hatchMat);
        h.position.set(0, freeboard + 0.6, -L * 0.35 + k * L * 0.17);
        root.add(h);
      }
    }
    const mastTop = freeboard + hTop + Math.max(3, L * 0.06);
    const lights = [
      this.light(0xffffff, [0, mastTop, where - lTop / 4]),
      this.light(0xff3020, [-B / 2, freeboard + hTop * 0.6, where - lTop / 2]),
      this.light(0x30ff60, [B / 2, freeboard + hTop * 0.6, where - lTop / 2]),
      this.light(0xffffff, [0, freeboard + 1, L / 2]),
    ];
    for (const l of lights) root.add(l);
    return { root, lights };
  }

  private light(color: number, at: [number, number, number]): THREE.Sprite {
    const s = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: this.glow, color, blending: THREE.AdditiveBlending, depthWrite: false, sizeAttenuation: false, fog: false }),
    );
    s.scale.setScalar(0.02);
    s.position.set(...at);
    s.visible = false;
    return s;
  }
}
