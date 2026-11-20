import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { disposeTree } from '../src/render/dispose';

describe('disposeTree', () => {
  it('frees every geometry and material once, keeps the shared ones and empties the group', () => {
    const shared = new THREE.MeshStandardMaterial();
    const own = new THREE.MeshBasicMaterial();
    const geo = new THREE.BoxGeometry();
    const other = new THREE.SphereGeometry();
    const map = new THREE.Texture();
    const sprite = new THREE.SpriteMaterial({ map });
    const root = new THREE.Group();
    const inner = new THREE.Group();
    inner.add(new THREE.Mesh(geo, shared), new THREE.Mesh(geo, own), new THREE.Mesh(other, [own, shared]));
    root.add(inner, new THREE.Sprite(sprite));
    const spies = [geo, other, own, sprite, shared, map].map((x) => vi.spyOn(x, 'dispose'));
    disposeTree(root, new Set([shared]));
    expect(spies.map((s) => s.mock.calls.length)).toEqual([1, 1, 1, 1, 0, 0]);
    expect(root.children).toHaveLength(0);
  });

  it('leaves the geometry every Sprite shares', () => {
    const root = new THREE.Group();
    const s = new THREE.Sprite(new THREE.SpriteMaterial());
    root.add(s);
    const spy = vi.spyOn(s.geometry, 'dispose');
    disposeTree(root);
    expect(spy).not.toHaveBeenCalled();
  });
});

describe('VesselView', () => {
  it('frees the old ships when the vessels are set again (a new game)', async () => {
    // The glow texture is drawn on a 2D canvas: a stand-in is enough here.
    const ctx2d = { createRadialGradient: () => ({ addColorStop() {} }), fillRect() {}, fillStyle: '' };
    const doc = { createElement: () => ({ width: 0, height: 0, getContext: () => ctx2d }) };
    vi.stubGlobal('document', doc);
    try {
      const { VesselView } = await import('../src/render/vessels');
      const { corvette, freighter } = await import('../src/control/areas');
      const view = new VesselView(new THREE.Scene());
      view.setVessels([freighter('a', 'A', [[0, 0], [1000, 0]]), corvette('b', 'B', [[0, 0], [1000, 0]])]);
      const spy = vi.spyOn(THREE.BufferGeometry.prototype, 'dispose');
      const matSpy = vi.spyOn(THREE.Material.prototype, 'dispose');
      view.setVessels([]);
      expect(spy.mock.calls.length).toBeGreaterThan(4);
      expect(matSpy.mock.calls.length).toBeGreaterThan(4);
      spy.mockRestore();
      matSpy.mockRestore();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
