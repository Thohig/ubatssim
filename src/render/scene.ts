import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { SubmarineConfig } from '../sim/config/submarine';
import type { Mat3 } from '../sim/math/mat';
import type { Vec3 } from '../sim/math/vec3';
import { bodyToLocal, nedToThree, rotationToThree } from './coords';
import { createEnvironment, glowTexture, type AreaDecor, type ConditionsId } from './environment';
import { LifeView } from './life';
import type { AircraftDef, AircraftState } from '../sim/aircraft';
import type { CreatureDef, CreatureState } from '../sim/life';
import type { AreaId } from '../sim/config/areas';
import type { WaveComponent } from '../sim/waves';
import type { VesselDef, VesselState } from '../sim/vessel';
import { VesselView } from './vessels';
import { buildSubmarineModel, updateSubmarineModel, type SubmarineModel } from './submarineModel';
import { createEffects, type EffectsInput } from './effects';
import { createCutaway, type CutawayState, type CutPlan } from './cutaway';
import { createControlRoom, type ControlRoomFrame } from './controlRoom';
import type { StationPanel } from './controlRoom.data';

export interface RenderState {
  t: number;
  position: Vec3;
  rotation: Mat3;
  rudder: number;
  sternPlanes: number;
  /** Accumulated propeller angle [rad]. */
  propellerAngle: number;
  /** Periscope and snorkel extension 0…1. */
  periscope: number;
  snorkel?: number;
  /** Radar mast extension 0…1. */
  radar?: number;
  /** Bubbles, wake, spray and exhaust (effects.ts); none in the cutaway. */
  effects?: EffectsInput | null;
  /** Torpedoes in the water: NED position and heading [rad]. */
  torpedoes?: { north: number; east: number; depth: number; heading: number }[];
  /** Other vessels, in the order given to `setVessels`. */
  vessels: readonly VesselState[];
  /** Whales and fish schools, and aircraft, in the order given to `setLife`. */
  creatures?: readonly CreatureState[];
  aircraft?: readonly AircraftState[];
  /** What the cutaway view shows (only in that view). */
  cutaway?: CutawayState;
  /** What the control room shows (only in that view). */
  control?: ControlRoomFrame;
}

/**
 * Where the camera is. Angles are relative to the bow, positive to
 * starboard and upwards.
 *   external  – orbiting camera that follows the boat (mouse/finger)
 *   bridge    – eye of the officer of the watch on the open bridge
 *   periscope – in the periscope head; `shake` [m] adds vibration
 *   cutaway   – outside the boat looking at the cut: from starboard (side)
 *               or from above (top); `pan` [m] along the boat, `zoom` ≥ 1
 */
export type CameraView =
  | { mode: 'external' }
  | { mode: 'bridge'; yaw: number; pitch: number }
  | { mode: 'periscope'; bearing: number; fov: number; shake: number }
  | { mode: 'cutaway'; plan: CutPlan; yaw: number; pitch: number; zoom: number; pan: number }
  /** Inside the control room at a station (controlRoom.data.ts), the look turned by yaw and pitch from its own. */
  | { mode: 'control'; station: number; yaw: number; pitch: number }
  /** Behind the start page: a camera standing still in the water while the boat glides past. */
  | { mode: 'flyby' };

const CUTAWAY_FOV = 40;

const EXTERNAL_FOV = 55;
/**
 * The fly-by behind the start page [m]: the camera waits `FLYBY_AHEAD` ahead
 * of the boat and `FLYBY_SIDE` off its port side, `FLYBY_BELOW` deeper, and
 * moves ahead again once the boat is `FLYBY_PAST` beyond it.
 */
const FLYBY_AHEAD = 75;
const FLYBY_SIDE = 30;
const FLYBY_BELOW = 5;
const FLYBY_PAST = 70;
const BRIDGE_FOV = 70;
const CONTROL_FOV = 68;
/**
 * The control room's vertical field of view [deg] for a view's aspect: 68°, wider on a
 * phone held upright, so that at least ~60° shows across (at most 100° up and down).
 */
export function controlFov(aspect: number): number {
  const across = (75 * Math.PI) / 180;
  const v = (2 * Math.atan(Math.tan(across / 2) / Math.max(0.1, aspect)) * 180) / Math.PI;
  return Math.min(100, Math.max(CONTROL_FOV, v));
}

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
  setLightRays(on: boolean): void;
  /** Show a yellow buoy at [north, east], or hide it with null. */
  setWaypoint(wp: [number, number] | null): void;
  setView(view: CameraView): void;
  /** Terrain, lighthouses, buoys and stations, and light/visibility of the sea area. */
  setArea(area: AreaId, decor: AreaDecor, conditions: ConditionsId, waves: readonly WaveComponent[]): void;
  /** The other vessels to draw (their states come with each render). */
  setVessels(defs: readonly VesselDef[]): void;
  /** Whales, schools and aircraft (states with each render); gulls follow the fishing boats and circle these coastal points [north, east]. */
  setLife(creatures: readonly CreatureDef[], aircraft: readonly AircraftDef[], coast: readonly [number, number][]): void;
  /** Depth of the camera [m], negative above the water (after the last render). */
  cameraDepth(): number;
  /** Cutaway view: the body-frame point [m] under a screen point on the cut, or null. */
  pickCut(clientX: number, clientY: number): Vec3 | null;
  /** Control room: the screen under a screen point (what a tap on it opens), or null. */
  pickControl(clientX: number, clientY: number): StationPanel | null;
  /**
   * The part of the view not covered by panels, in pixels from the canvas's
   * edges: the cutaway frames the boat there. Null = the whole view.
   */
  setSafeArea(insets: { left: number; top: number; right: number; bottom: number } | null): void;
}

export function createScene(container: HTMLElement, cfg: SubmarineConfig): SceneView {
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(container.clientWidth, container.clientHeight);
  renderer.localClippingEnabled = true; // for the future cutaway view
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  // Far plane beyond the day visibility (~15 km): a ship hull-down on the horizon still shows.
  // Depth precision depends on the near plane, not on this.
  const camera = new THREE.PerspectiveCamera(55, container.clientWidth / container.clientHeight, 0.5, 20000);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.1;
  controls.minDistance = 15;
  controls.maxDistance = 600;

  const hemi = new THREE.HemisphereLight(0xbfe3ff, 0x1a2a33, 1.4);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xffffff, 1.6);
  sun.position.set(200, 400, 100);
  scene.add(sun);

  const model = buildSubmarineModel(cfg);
  scene.add(model.root);
  const cutaway = createCutaway(model, cfg);
  let cutawayOn = false;
  // The control room is a scene of its own in the model's local frame: rendered instead of the world.
  const controlRoom = createControlRoom(cfg);
  let boatDepth = 0;
  let insets = { left: 0, top: 0, right: 0, bottom: 0 };
  const env = createEnvironment(scene, hemi, sun);
  const vesselView = new VesselView(scene);
  const lifeView = new LifeView(scene, glowTexture());
  let vesselDefs: readonly VesselDef[] = [];
  let lampsLit = false;
  let darkness = false;

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
  const flybyPos = new THREE.Vector3();
  let flybyPlaced = false;
  const fwd = new THREE.Vector3();
  const port = new THREE.Vector3();

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

  /**
   * Cutaway camera: outside the boat, at a distance that fits its length
   * (divided by the zoom), looking at the cut. Side: from starboard, turned
   * by yaw (towards the bow) and pitch (from above). Top: from above, bow
   * to the right.
   */
  const camUp = new THREE.Vector3();
  const target = new THREE.Vector3();
  const placeCutawayCamera = (v: Extract<CameraView, { mode: 'cutaway' }>) => {
    model.root.updateMatrixWorld();
    // Frame the boat in the free part of the view and shift the picture so
    // its centre is there (setViewOffset keeps the picking consistent).
    const W = renderer.domElement.clientWidth || 1;
    const H = renderer.domElement.clientHeight || 1;
    const safeW = Math.max(80, W - insets.left - insets.right);
    const safeH = Math.max(60, H - insets.top - insets.bottom);
    camera.setViewOffset(W, H, -((insets.left - insets.right) / 2), -((insets.top - insets.bottom) / 2), W, H);
    const t = Math.tan((CUTAWAY_FOV * Math.PI) / 360);
    const L = cfg.hull.length + 4;
    const tall = v.plan === 'side' ? 15 : 9; // keel to the top of the sail, or the beam
    const fit = Math.max((L * H) / (2 * t * safeW), (tall * H) / (2 * t * safeH));
    const dist = fit / v.zoom;
    const tBody: Vec3 = [v.pan, 0, v.plan === 'side' ? -1.2 : 0];
    let d: Vec3;
    let upBody: Vec3;
    if (v.plan === 'side') {
      d = [Math.sin(v.yaw) * Math.cos(v.pitch), Math.cos(v.yaw) * Math.cos(v.pitch), -Math.sin(v.pitch)];
      upBody = [0, 0, -1];
    } else {
      d = [Math.sin(v.pitch) * 0.6, Math.sin(v.yaw) * 0.6, -1];
      const k = Math.hypot(d[0], d[1], d[2]);
      d = [d[0] / k, d[1] / k, d[2] / k];
      upBody = [0, -1, 0]; // port at the top of the screen, bow to the right
    }
    model.root.localToWorld(bodyToLocal(tBody, target));
    model.root.localToWorld(bodyToLocal([tBody[0] + d[0] * dist, tBody[1] + d[1] * dist, tBody[2] + d[2] * dist], eye));
    camera.position.copy(eye);
    bodyToLocal(upBody, camUp).applyQuaternion(model.root.quaternion);
    camera.up.copy(camUp);
    camera.lookAt(target);
    camera.up.set(0, 1, 0);
  };

  window.addEventListener('resize', () => {
    camera.aspect = container.clientWidth / container.clientHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(container.clientWidth, container.clientHeight);
  });

  const effects = createEffects(scene);
  let lastEffectsT: number | null = null;
  // Torpedoes: 533 mm × 6 m, dark; a small pool reused every frame.
  const torpedoGeo = new THREE.CylinderGeometry(0.27, 0.27, 6, 10);
  torpedoGeo.rotateX(Math.PI / 2); // along −Z, like the ship models' bows
  const torpedoMat = new THREE.MeshStandardMaterial({ color: 0x23282b, roughness: 0.5 });
  const torpedoMeshes: THREE.Mesh[] = [];
  const placeTorpedoes = (list: NonNullable<RenderState['torpedoes']>) => {
    while (torpedoMeshes.length < list.length) {
      const m = new THREE.Mesh(torpedoGeo, torpedoMat);
      scene.add(m);
      torpedoMeshes.push(m);
    }
    torpedoMeshes.forEach((m, i) => {
      const t = list[i];
      m.visible = !!t;
      if (!t) return;
      nedToThree([t.north, t.east, t.depth], m.position);
      m.rotation.y = -t.heading;
    });
  };

  /** Inside the control room: the camera at the station's eye, shaken by depth charges; the room instead of the world. */
  const R0 = new THREE.Quaternion();
  const controlFrame: ControlRoomFrame = { lighting: 'white', alarm: false, shake: 0, water: 0, doors: [], screens: null };
  const renderControlRoom = (v: Extract<CameraView, { mode: 'control' }>, state: RenderState) => {
    const f = state.control ?? controlFrame;
    const st = controlRoom.stations[v.station] ?? controlRoom.stations[0]!;
    const k = f.shake;
    setFov(controlFov(camera.aspect));
    bodyToLocal(st.eye, eye);
    if (k > 0) eye.add(new THREE.Vector3(0.03 * k * Math.sin(state.t * 47), 0.03 * k * Math.sin(state.t * 59 + 2), 0.02 * k * Math.sin(state.t * 41 + 1)));
    camera.position.copy(eye);
    qYaw.setFromAxisAngle(AX_Y, -(st.yaw + v.yaw + 0.02 * k * Math.sin(state.t * 37)));
    qPitch.setFromAxisAngle(AX_X, st.pitch + v.pitch + 0.015 * k * Math.sin(state.t * 43 + 1));
    camera.quaternion.copy(R0).multiply(qYaw).multiply(qPitch);
    const Rm = state.rotation;
    controlRoom.update(f, [-Rm[6]!, -Rm[7]!, -Rm[8]!], state.t);
    renderer.render(controlRoom.scene, camera);
  };

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
    setLightRays(on) {
      env.setLightRays(on);
    },
    setWaypoint(wp) {
      buoy.visible = wp !== null;
      if (wp) nedToThree([wp[0], wp[1], 0], buoy.position);
    },
    setView(v) {
      view = v;
    },
    setArea(area, decor, conditions, waves) {
      env.setArea(area, decor, conditions, waves);
      vesselView.setLights(conditions !== 'day');
      lampsLit = conditions !== 'day';
      darkness = conditions === 'night';
    },
    setVessels(defs) {
      vesselDefs = defs;
      vesselView.setVessels(defs);
    },
    setLife(creatures, aircraft, coast) {
      lifeView.set(creatures, aircraft, vesselDefs, coast);
    },
    cameraDepth() {
      // Inside the boat: below the water as the boat is (no wind, the sea heard through the hull).
      if (view.mode === 'control') return Math.max(1, boatDepth);
      return env.surfaceAt(camera.position.x, camera.position.z) - camera.position.y;
    },
    setSafeArea(i) {
      insets = i ?? { left: 0, top: 0, right: 0, bottom: 0 };
    },
    pickControl(clientX, clientY) {
      if (view.mode !== 'control') return null;
      const r = renderer.domElement.getBoundingClientRect();
      const ndc = new THREE.Vector2(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
      const ray = new THREE.Raycaster();
      ray.setFromCamera(ndc, camera);
      return controlRoom.pick(ray);
    },
    pickCut(clientX, clientY) {
      if (!cutawayOn) return null;
      const r = renderer.domElement.getBoundingClientRect();
      const ndc = new THREE.Vector2(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
      const ray = new THREE.Raycaster();
      ray.setFromCamera(ndc, camera);
      const hit = ray.ray.intersectPlane(cutaway.cutPlane(), new THREE.Vector3());
      if (!hit) return null;
      const local = model.root.worldToLocal(hit);
      return [-local.z, local.x, -local.y]; // model-local → body (see coords.ts)
    },
    render(state) {
      nedToThree(state.position, subPos);
      model.root.position.copy(subPos);
      rotationToThree(state.rotation, model.root.quaternion);
      updateSubmarineModel(model, state.rudder, state.sternPlanes, state.propellerAngle, state.periscope, cfg.periscope.extension, state.snorkel ?? 0, cfg.snorkel.extension, state.radar ?? 0, cfg.radar.extension);
      boatDepth = state.position[2];
      if (view.mode === 'control') {
        if (cutawayOn) {
          cutawayOn = false;
          cutaway.setActive(false);
          camera.clearViewOffset();
        }
        controls.enabled = false;
        wasExternal = false;
        flybyPlaced = false;
        renderControlRoom(view, state);
        // Effects run on simulation time: none pile up while the room is shown.
        lastEffectsT = state.t;
        return;
      }
      const wantCutaway = view.mode === 'cutaway';
      if (wantCutaway !== cutawayOn) {
        cutawayOn = wantCutaway;
        cutaway.setActive(wantCutaway);
        if (!wantCutaway) camera.clearViewOffset();
      }

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
        if (view.mode !== 'flyby') flybyPlaced = false;
        if (view.mode === 'flyby') {
          setFov(EXTERNAL_FOV);
          // Body forward is model −z and starboard model +x (see coords.ts); level both.
          fwd.set(0, 0, -1).applyQuaternion(model.root.quaternion).setY(0).normalize();
          port.set(-1, 0, 0).applyQuaternion(model.root.quaternion).setY(0).normalize();
          const along = eye.copy(flybyPos).sub(subPos).dot(fwd);
          if (!flybyPlaced || along < -FLYBY_PAST || along > FLYBY_AHEAD + 20) {
            flybyPos.copy(subPos).addScaledVector(fwd, FLYBY_AHEAD).addScaledVector(port, FLYBY_SIDE);
            flybyPos.y -= FLYBY_BELOW;
            flybyPlaced = true;
          }
          camera.position.copy(flybyPos);
          camera.lookAt(subPos);
        } else if (view.mode === 'cutaway') {
          setFov(CUTAWAY_FOV);
          placeCutawayCamera(view);
          if (state.cutaway) cutaway.update(state.cutaway);
        } else if (view.mode === 'bridge') {
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
      placeTorpedoes(state.torpedoes ?? []);
      // Effects run on simulation time: they stand still while the game is paused.
      effects.update(state.effects ?? null, lastEffectsT === null ? 0 : state.t - lastEffectsT, (x, z) => env.surfaceAt(x, z));
      lastEffectsT = state.t;
      vesselView.update(state.vessels, (x, z) => env.surfaceAt(x, z));
      // The periscope head or the bridge above the water startles the gulls.
      const showing = state.periscope > 0.9 && state.position[2] < 20 ? ([state.position[0], state.position[1]] as [number, number]) : null;
      lifeView.update(
        { t: state.t, creatures: state.creatures ?? [], aircraft: state.aircraft ?? [], vessels: state.vessels, showing, lamps: lampsLit, night: darkness, camera: camera.position },
        (x, z) => env.surfaceAt(x, z),
      );
      renderer.render(scene, camera);
    },
  };
}
