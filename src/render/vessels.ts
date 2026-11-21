/**
 * Other vessels: simple low-poly ships (hull, superstructure, funnel or
 * wheelhouse) with navigation lights: masthead (white), port (red),
 * starboard (green) and stern (white). The lights glow at night and in fog.
 */
import * as THREE from 'three';
import type { VesselDef, VesselState } from '../sim/vessel';
import { nedToThree } from './coords';
import { disposeTree } from './dispose';

interface ShipModel {
  root: THREE.Group;
  lights: THREE.Sprite[];
}

const HULL = { freighter: 0x5a2420, ferry: 0xf0f0ea, fishing: 0x1f4f7a, patrol: 0x6b7378, sail: 0xf4f4f0 } as const;
const TOP = { freighter: 0xe8e4da, ferry: 0x1f5fa8, fishing: 0xf2f2ee, patrol: 0x8a9399, sail: 0xd9d2c0 } as const;

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
    disposeTree(this.group);
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
      // Torpedoed: settles by the stern, then slides under; gone when sunk.
      s.root.visible = st.sunk < 1;
      if (st.sunk > 0) {
        s.root.position.y -= st.sunk * st.sunk * 40;
        s.root.rotation.x = -0.35 * st.sunk;
      } else s.root.rotation.x = 0;
      s.root.rotation.z = (s.root.userData.heel as number | undefined) ?? 0;
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
    // Superstructure aft (freighter), midships (ferry, corvette) or forward (fishing boat).
    const where = d.kind === 'freighter' ? L * 0.35 : d.kind === 'ferry' ? 0 : d.kind === 'patrol' ? L * 0.05 : -L * 0.15;
    const hTop = d.kind === 'ferry' ? L * 0.12 : d.kind === 'patrol' ? L * 0.1 : L * 0.08;
    const lTop = d.kind === 'ferry' ? L * 0.7 : d.kind === 'patrol' ? L * 0.35 : L * 0.18;
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
    if (d.kind === 'patrol') {
      // A lattice mast with the radar: a slim box on the superstructure.
      const mast = new THREE.Mesh(new THREE.BoxGeometry(1.2, L * 0.12, 1.2), topMat);
      mast.position.set(0, freeboard + hTop + L * 0.06, where - lTop * 0.1);
      root.add(mast);
    }
    if (d.kind === 'sail') {
      // A yacht: no superstructure to speak of, a tall mast, mainsail and jib.
      top.scale.set(0.6, 0.5, 0.6);
      const mastH = L * 1.35;
      const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.1, mastH, 6), new THREE.MeshStandardMaterial({ color: 0xc8c8c8, roughness: 0.4 }));
      mast.position.set(0, freeboard + mastH / 2, -L * 0.05);
      root.add(mast);
      const sailMat = new THREE.MeshStandardMaterial({ color: 0xf6f3ea, roughness: 0.8, side: THREE.DoubleSide });
      const tri = (a: [number, number], b: [number, number], c: [number, number]) => {
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.BufferAttribute(new Float32Array([0, a[1], a[0], 0, b[1], b[0], 0, c[1], c[0]]), 3));
        g.computeVertexNormals();
        return new THREE.Mesh(g, sailMat);
      };
      const base = freeboard + 1.2;
      const main = tri([-L * 0.05, base], [-L * 0.05, base + mastH * 0.92], [L * 0.4, base]);
      const jib = tri([-L * 0.08, base + mastH * 0.8], [-L * 0.48, base - 0.4], [-L * 0.1, base - 0.2]);
      // Sheeted out a little to one side.
      main.rotation.y = 0.25;
      jib.rotation.y = 0.15;
      root.add(main, jib);
      // Heeling in the wind.
      root.userData.heel = 0.12;
    }
    if (d.trawl) {
      // The trawl: two warps from the stern down to the net, a dark funnel behind its mouth.
      const tr = d.trawl;
      const warpMat = new THREE.MeshBasicMaterial({ color: 0x1b1b1b });
      const mid = (tr.top + tr.bottom) / 2;
      for (const side of [-1, 1]) {
        const from = new THREE.Vector3(side * B * 0.3, 0, L / 2);
        const to = new THREE.Vector3((side * tr.width) / 2, -tr.top, tr.distance);
        const warp = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, from.distanceTo(to), 4), warpMat);
        warp.position.copy(from).add(to).multiplyScalar(0.5);
        warp.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), to.clone().sub(from).normalize());
        root.add(warp);
      }
      const net = new THREE.Mesh(
        new THREE.CylinderGeometry(tr.width / 2, 1.5, 60, 12, 1, true),
        new THREE.MeshStandardMaterial({ color: 0x3a4a3c, transparent: true, opacity: 0.35, side: THREE.DoubleSide, wireframe: true }),
      );
      net.rotation.x = Math.PI / 2;
      net.scale.set(1, 1, (tr.bottom - tr.top) / tr.width);
      net.position.set(0, -mid, tr.distance + 30);
      root.add(net);
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
