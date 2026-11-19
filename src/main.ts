import { Controller } from './control/controller';
import { createScene } from './render/scene';
import { getQuat } from './sim/rigidBody';
import { quatToMat3 } from './sim/math/quat';
import { DT, IDX_SHAFT, Simulation } from './sim/simulation';
import { bindConsole } from './ui/console';
import { InputModeState, bindModeIndicator } from './ui/inputMode';
import { createInstruments } from './ui/instruments';
import { bindKeyboard } from './ui/keyboard';
import { bindLog } from './ui/log';
import { bindTouchControls, isTouchDevice } from './ui/touch';

const el = <T extends HTMLElement>(id: string) => {
  const n = document.getElementById(id);
  if (!n) throw new Error(`Missing #${id}`);
  return n as T;
};

const sim = new Simulation();
const ctrl = new Controller(sim);
const view = createScene(el('app'), sim.cfg);

const touch = isTouchDevice();
document.body.classList.toggle('touch', touch);
const consoleInput = el<HTMLInputElement>('console-input');
if (touch) consoleInput.placeholder = 'Skriv kommando, t.ex. "djup 120" eller "hjälp"';

const mode = new InputModeState();
bindModeIndicator(el('mode'), mode, touch);
const openConsole = bindConsole(el<HTMLFormElement>('console'), consoleInput, ctrl, mode);
bindKeyboard(ctrl, mode, openConsole);
if (touch) bindTouchControls(el('touch'), ctrl, mode, openConsole);
bindLog(el('log'), ctrl);
const updateInstruments = createInstruments(el('instruments'), ctrl);
ctrl.addLog(
  touch
    ? 'Ubåten ligger i ytläge. Tryck >_ och skriv "hjälp" för kommandon.'
    : 'Ubåten ligger i ytläge. Skriv "hjälp" i konsolen för kommandon.',
  'info',
);

/** Max simulation steps per animation frame (guards against spiral of death). */
const MAX_STEPS_PER_FRAME = 25;
let acc = 0;
let last = performance.now();
let propellerAngle = 0;
let lastInstruments = 0;

function frame(now: number): void {
  acc += Math.min(0.25, (now - last) / 1000);
  last = now;
  let steps = 0;
  while (acc >= DT && steps < MAX_STEPS_PER_FRAME) {
    ctrl.step();
    propellerAngle += 2 * Math.PI * sim.y[IDX_SHAFT]! * DT;
    acc -= DT;
    steps++;
  }
  if (steps === MAX_STEPS_PER_FRAME) acc = 0;

  view.render({
    t: sim.t,
    position: [sim.y[0]!, sim.y[1]!, sim.y[2]!],
    rotation: quatToMat3(getQuat(sim.y)),
    rudder: sim.actuators.rudder,
    sternPlanes: sim.actuators.sternPlanes,
    propellerAngle,
  });

  if (now - lastInstruments > 100) {
    updateInstruments(sim.telemetry());
    lastInstruments = now;
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
