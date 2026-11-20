import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { SubmarineConfig } from '../sim/config/submarine';
import type { Mat3 } from '../sim/math/mat';
import type { Vec3 } from '../sim/math/vec3';
import { bodyToLocal, nedToThree, rotationToThree } from './coords';
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
  /** Periscope extension 0…1. */
  periscope: number;
}

/**
 * Where the camera is. Angles are relative to the bow, positive to
 * starboard and upwards.
 *   external  – orbiting camera that follows the boat (mouse/finger)
 *   bridge    – eye of the officer of the watch on the open bridge
 *   periscope – in the periscope head; `shake` [m] adds vibration
 */
export type CameraView =
  | { mode: 'external' }
  | { mode: 'bridge'; yaw: number; pitch: number }
  | { mode: 'periscope'; bearing: number; fov: number; shake: number };

const EXTERNAL_FOV = 55;
const BRIDGE_FOV = 70;

export interface SceneView {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  renderer: THREE.WebGLRenderer;
  controls: OrbitControls;
  model: SubmarineModel;
  render(state: RenderState): void;
  /** Place the camera at its default offset on the next render. */
  resetCamera(): void;
  /** Slow automatic orbit, used behind the menu. */
  setAutoRotate(on: boolean): void;
  setParticles(on: boolean): void;
  /** Show a yellow buoy at [north, east], or hide it with null. */
  setWaypoint(wp: [number, number] | null): void;
  setView(view: CameraView): void;
  /** Depth of the camera [m], negative above the water (after the last render). */
  cameraDepth(): number;
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

  // Waypoint buoy: yellow spar buoy with a top mark, visible above and below water.
  const buoy = new THREE.Group();
  const buoyMat = new THREE.MeshStandardMaterial({ color: 0xffcc22, emissive: 0x332200, roughness: 0.6 });
  const spar = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.6, 9, 16), buoyMat);
  spar.position.y = 1.5;
  const mark = new THREE.Mesh(new THREE.ConeGeometry(1.2, 2, 16), buoyMat);
  mark.position.y = 7;
  const chain = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 40, 4), new THREE.MeshBasicMaterial({ color: 0x333333 }));
  chain.position.y = -23;
  buoy.add(spar, mark, chain);
  buoy.visible = false;
  scene.add(buoy);

  const subPos = new THREE.Vector3();
  const lastTarget = new THREE.Vector3();
  let initialised = false;
  let view: CameraView = { mode: 'external' };
  /** Orbit camera offset from the boat, kept while another view is active. */
  const orbitOffset = new THREE.Vector3(-55, 18, 45);
  let wasExternal = true;
  const eye = new THREE.Vector3();
  const look = new THREE.Quaternion();
  const qYaw = new THREE.Quaternion();
  const qPitch = new THREE.Quaternion();
  const AX_Y = new THREE.Vector3(0, 1, 0);
  const AX_X = new THREE.Vector3(1, 0, 0);

  const setFov = (fov: number) => {
    if (camera.fov !== fov) {
      camera.fov = fov;
      camera.updateProjectionMatrix();
    }
  };

  /** Places the camera at a body-frame point, looking along the bow turned by yaw and pitch. */
  const placeOnBoard = (bodyPoint: [number, number, number], yaw: number, pitch: number) => {
    model.root.updateMatrixWorld();
    model.root.localToWorld(bodyToLocal(bodyPoint, eye));
    camera.position.copy(eye);
    // Local forward is −Z; turning to starboard (+X) is a negative rotation about +Y.
    qYaw.setFromAxisAngle(AX_Y, -yaw);
    qPitch.setFromAxisAngle(AX_X, pitch);
    look.copy(model.root.quaternion).multiply(qYaw).multiply(qPitch);
    camera.quaternion.copy(look);
  };

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
    resetCamera() {
      initialised = false;
    },
    setAutoRotate(on) {
      controls.autoRotate = on;
      controls.autoRotateSpeed = 0.6;
    },
    setParticles(on) {
      env.setParticles(on);
    },
    setWaypoint(wp) {
      buoy.visible = wp !== null;
      if (wp) nedToThree([wp[0], wp[1], 0], buoy.position);
    },
    setView(v) {
      view = v;
    },
    cameraDepth() {
      return -camera.position.y;
    },
    render(state) {
      nedToThree(state.position, subPos);
      model.root.position.copy(subPos);
      rotationToThree(state.rotation, model.root.quaternion);
      updateSubmarineModel(model, state.rudder, state.sternPlanes, state.propellerAngle, state.periscope, cfg.periscope.extension);

      if (view.mode === 'external') {
        controls.enabled = true;
        setFov(EXTERNAL_FOV);
        // OrbitControls target follows the submarine; the camera keeps its offset.
        if (!initialised) {
          orbitOffset.set(-55, 18, 45);
          wasExternal = false;
          initialised = true;
        }
        if (!wasExternal) {
          camera.position.copy(subPos).add(orbitOffset);
          controls.target.copy(subPos);
          lastTarget.copy(subPos);
        } else {
          const delta = subPos.clone().sub(lastTarget);
          camera.position.add(delta);
          controls.target.add(delta);
          lastTarget.copy(subPos);
        }
        controls.update();
        orbitOffset.copy(camera.position).sub(subPos);
        wasExternal = true;
      } else {
        controls.enabled = false;
        wasExternal = false;
        if (view.mode === 'bridge') {
          setFov(BRIDGE_FOV);
          placeOnBoard(cfg.bridge.eye, view.yaw, view.pitch);
        } else {
          setFov(view.fov);
          const p = cfg.periscope;
          const head: [number, number, number] = [p.base[0], p.base[1], p.base[2] - p.extension * state.periscope];
          // Vibration of a mast towed fast through the water.
          const k = view.shake;
          placeOnBoard(head, view.bearing + 0.002 * k * Math.sin(state.t * 41), 0.003 * k * Math.sin(state.t * 53 + 1));
          model.periscopeHead.visible = false;
        }
      }
      env.update(state.position, camera, state.t);
      renderer.render(scene, camera);
    },
  };
}
