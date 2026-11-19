import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

export interface SceneView {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  renderer: THREE.WebGLRenderer;
  controls: OrbitControls;
  render(): void;
}

export function createScene(container: HTMLElement): SceneView {
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(container.clientWidth, container.clientHeight);
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0a3a52);

  const camera = new THREE.PerspectiveCamera(55, container.clientWidth / container.clientHeight, 0.5, 5000);
  camera.position.set(60, 25, 60);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;

  scene.add(new THREE.HemisphereLight(0x9fd8ff, 0x0b1e2a, 1.2));
  const sun = new THREE.DirectionalLight(0xffffff, 1.5);
  sun.position.set(100, 200, 50);
  scene.add(sun);
  scene.add(new THREE.GridHelper(200, 20, 0x3a7a99, 0x1c4a60));

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
    render() {
      controls.update();
      renderer.render(scene, camera);
    },
  };
}
