/**
 * Frees what a group of objects holds on the graphics card. Three.js keeps a
 * geometry's buffers and a material's programs until `dispose()` is called;
 * removing the object from the scene is not enough. Textures are left alone
 * (`material.dispose()` does not free its maps): the ones used here are shared.
 */
import * as THREE from 'three';

/**
 * Disposes every geometry and material under `root` (root included), except
 * the materials in `keep` (shared between rebuilds), and removes the children.
 */
export function disposeTree(root: THREE.Object3D, keep: ReadonlySet<THREE.Material> = new Set()): void {
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  root.traverse((o) => {
    const m = o as Partial<THREE.Mesh>;
    // Every Sprite shares one geometry in Three.js: never freed here.
    if (m.geometry instanceof THREE.BufferGeometry && !(o instanceof THREE.Sprite)) geometries.add(m.geometry);
    const mat = m.material;
    for (const x of Array.isArray(mat) ? mat : mat ? [mat] : []) if (!keep.has(x)) materials.add(x);
  });
  for (const g of geometries) g.dispose();
  for (const x of materials) x.dispose();
  root.clear();
}
