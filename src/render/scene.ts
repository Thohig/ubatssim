import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { SubmarineConfig } from '../sim/config/submarine';
import type { Mat3 } from '../sim/math/mat';
import type { Vec3 } from '../sim/math/vec3';
import { nedToThree, rotationToThree } from './coords';
import { createEnvironment } from './environment';
import { buildSubmarineModel, updateSubmarineModel, type SubmarineModel } from './submarineModel';

export interface RenderState {
  t: number;
  position: Vec3;
  rotation: Mat3;
  rudder: number;
  sternPlanes: number;
  /** Accumulated propeller angle [rad]. */
  propellerAngle: number;
}

export interface SceneView {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  renderer: THREE.WebGLRenderer;
  controls: OrbitControls;
  model: SubmarineModel;
  render(state: RenderState): void;
}

export function createScene(container: HTMLElement, cfg: SubmarineConfig): SceneView {
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(container.clientWidth, container.clientHeight);
  renderer.localClippingEnabled = true; // for the future cutaway view
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(55, container.clientWidth / container.clientHeight, 0.5, 6000);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.1;
  controls.minDistance = 15;
  controls.maxDistance = 600;

  scene.add(new THREE.HemisphereLight(0xbfe3ff, 0x1a2a33, 1.4));
  const sun = new THREE.DirectionalLight(0xffffff, 1.6);
  sun.position.set(200, 400, 100);
  scene.add(sun);

  const model = buildSubmarineModel(cfg);
  scene.add(model.root);
  const env = createEnvironment(scene);

  const subPos = new THREE.Vector3();
  const lastTarget = new THREE.Vector3();
  let initialised = false;

  window.addEventListener('resize', () => {
    camera.aspect = container.clientWidth / container.clientHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(container.clientWidth, container.clientHeight);
  });

  return {
    scene,
    camera,
    renderer,
    controls,
    model,
    render(state) {
      nedToThree(state.position, subPos);
      model.root.position.copy(subPos);
      rotationToThree(state.rotation, model.root.quaternion);
      updateSubmarineModel(model, state.rudder, state.sternPlanes, state.propellerAngle);

      // OrbitControls target follows the submarine; the camera keeps its offset.
      if (!initialised) {
        camera.position.copy(subPos).add(new THREE.Vector3(-55, 18, 45));
        controls.target.copy(subPos);
        lastTarget.copy(subPos);
        initialised = true;
      } else {
        const delta = subPos.clone().sub(lastTarget);
        camera.position.add(delta);
        controls.target.add(delta);
        lastTarget.copy(subPos);
      }
      controls.update();
      env.update(state.position, camera, state.t);
      renderer.render(scene, camera);
    },
  };
}
