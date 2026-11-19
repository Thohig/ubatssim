import { createScene } from './render/scene';

const container = document.getElementById('app');
if (!container) throw new Error('Missing #app element');

const view = createScene(container);

function frame(): void {
  view.render();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
