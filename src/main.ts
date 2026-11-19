import { Controller } from './control/controller';
import { SCENARIOS, ScenarioRunner, type Scenario } from './control/scenarios';
import { createScene } from './render/scene';
import { quatToMat3 } from './sim/math/quat';
import { getQuat } from './sim/rigidBody';
import { DT, IDX_SHAFT, Simulation, type InitialConditions } from './sim/simulation';
import { bindConsole } from './ui/console';
import { InputModeState, bindModeIndicator } from './ui/inputMode';
import { createInstruments } from './ui/instruments';
import { bindKeyboard } from './ui/keyboard';
import { bindLog } from './ui/log';
import { Menu, type FreeStart } from './ui/menu';
import { updateObjective } from './ui/objective';
import { loadSettings, recordBestTime, saveSettings, type Settings } from './ui/settings';
import { bindTouchControls, isTouchDevice } from './ui/touch';

const el = <T extends HTMLElement>(id: string) => {
  const n = document.getElementById(id);
  if (!n) throw new Error(`Missing #${id}`);
  return n as T;
};

const KN = 1852 / 3600;

// ------------------------------------------------------------------ sessions

type GameState = 'menu' | 'playing' | 'paused' | 'ended';

interface Session {
  sim: Simulation;
  ctrl: Controller;
  runner: ScenarioRunner | null;
  /** How to recreate this session for "Starta om". */
  restart: () => Session;
  propellerAngle: number;
  updateInstruments: ReturnType<typeof createInstruments>;
}

const FREE_STARTS: Record<FreeStart, { initial: InitialConditions; text: string }> = {
  surface: { initial: {}, text: 'Ubåten ligger i ytläge.' },
  periscope: { initial: { depth: 18, speed: 4 * KN, designTrim: true }, text: 'Ubåten går på periskopdjup, 18 m.' },
  deep: { initial: { depth: 100, speed: 8 * KN, designTrim: true }, text: 'Ubåten går på 100 m djup, under språngskiktet.' },
};

let settings: Settings = loadSettings();
let state: GameState = 'menu';
let session: Session;

const sim0 = new Simulation();
const view = createScene(el('app'), sim0.cfg);
const hud = el('hud');
const logEl = el('log');
const instrumentsEl = el('instruments');
const objectiveEl = el('objective');

function newSession(initial: InitialConditions, scenario: Scenario | null, intro: string): Session {
  const sim = new Simulation(initial);
  const ctrl = new Controller(sim);
  ctrl.options.autopilotAllowed = settings.autopilot;
  const runner = scenario ? new ScenarioRunner(scenario, ctrl) : null;
  bindLog(logEl, ctrl);
  instrumentsEl.classList.remove('expanded');
  const s: Session = {
    sim,
    ctrl,
    runner,
    restart: () => newSession(initial, scenario, intro),
    propellerAngle: 0,
    updateInstruments: createInstruments(instrumentsEl, ctrl),
  };
  if (intro) ctrl.addLog(intro, 'info');
  if (!ctrl.options.autopilotAllowed) ctrl.addLog('Autopilot för djup och kurs är avstängd.', 'info');
  ctrl.addLog(touch ? 'Tryck >_ och skriv "hjälp" för kommandon.' : 'Skriv "hjälp" i konsolen för kommandon.', 'info');
  runner?.onChange((p) => {
    if (p.status !== 'running') window.setTimeout(() => endScenario(), 1500);
  });
  view.resetCamera();
  return s;
}

/** Background session shown behind the main menu: cruising on autopilot. */
function demoSession(): Session {
  const s = newSession({ depth: 20, speed: 5 * KN, designTrim: true, heading: 0.6 }, null, '');
  for (const o of [
    { kind: 'setDepth', depth: 20 },
    { kind: 'setHeading', heading: 35 },
    { kind: 'setSpeed', knots: 5 },
  ] as const)
    s.ctrl.submit(o, 'console');
  return s;
}

// ---------------------------------------------------------------------- menu

const menu = new Menu(
  el('menu'),
  {
    startFree(start) {
      const f = FREE_STARTS[start];
      startGame(newSession(f.initial, null, f.text));
    },
    startScenario(id) {
      const sc = SCENARIOS.find((s) => s.id === id);
      if (sc) startGame(newSession(sc.initial, sc, `Scenario: ${sc.title}. ${sc.description}`));
    },
    resume() {
      setState('playing');
    },
    restart() {
      startGame(session.restart());
    },
    toMainMenu() {
      session = demoSession();
      setState('menu');
    },
    settingsChanged(s) {
      settings = s;
      saveSettings(s);
      applySettings();
    },
  },
  settings,
);

function startGame(s: Session): void {
  session = s;
  setState('playing');
}

function endScenario(): void {
  const r = session.runner;
  if (!r || state !== 'playing' || r.status === 'running') return;
  const completed = r.status === 'completed';
  const time = r.endTime ?? session.sim.t;
  const newBest = completed ? recordBestTime(r.scenario.id, time) : false;
  setState('ended');
  menu.showResult({ scenario: r.scenario, completed, message: r.message ?? '', time, newBest });
}

function setState(s: GameState): void {
  state = s;
  const inGame = s === 'playing' || s === 'paused' || s === 'ended';
  hud.hidden = !inGame;
  view.setAutoRotate(s === 'menu');
  if (s === 'playing') menu.hide();
  if (s === 'menu') menu.show('main');
  if (s === 'paused') menu.show('pause');
  if (s !== 'playing') mode.set('steer');
}

function pause(): void {
  if (state === 'playing') setState('paused');
}

// --------------------------------------------------------------------- input

let touch = false;
const mode = new InputModeState();
const consoleInput = el<HTMLInputElement>('console-input');
const activeCtrl = () => (state === 'playing' ? session.ctrl : null);
const openConsole = bindConsole(el<HTMLFormElement>('console'), consoleInput, activeCtrl, mode);
bindKeyboard(activeCtrl, mode, openConsole);
bindTouchControls(el('touch'), activeCtrl, mode, openConsole);
el('menu-btn').addEventListener('click', pause);

window.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  if (state === 'playing' && mode.current === 'steer') {
    e.preventDefault();
    pause();
  } else if (state === 'paused' && (menu.current === 'pause' || !menu.visible)) {
    e.preventDefault();
    setState('playing');
  } else if (menu.visible && menu.current !== 'main' && menu.current !== 'pause' && menu.current !== 'result') {
    e.preventDefault();
    menu.show(state === 'paused' ? 'pause' : 'main');
  }
});
document.addEventListener('visibilitychange', () => {
  if (document.hidden) pause();
});

function applySettings(): void {
  touch = settings.touch === 'on' || (settings.touch === 'auto' && isTouchDevice());
  document.body.classList.toggle('touch', touch);
  consoleInput.placeholder = touch
    ? 'Skriv kommando, t.ex. "djup 120" eller "hjälp"'
    : 'Enter eller / öppnar konsolen – skriv "hjälp"';
  bindModeIndicator(el('mode'), mode, touch);
  view.setParticles(settings.particles);
}

// ---------------------------------------------------------------------- loop

applySettings();
session = demoSession();
setState('menu');

const MAX_STEPS_PER_FRAME = 25;
let acc = 0;
let last = performance.now();
let lastUi = 0;

function frame(now: number): void {
  const elapsed = Math.min(0.25, (now - last) / 1000);
  last = now;
  const running = state === 'playing' || state === 'menu' || state === 'ended';
  const scale = state === 'playing' ? settings.timeScale : 1;
  if (running) acc += elapsed * scale;
  const maxSteps = MAX_STEPS_PER_FRAME * scale;
  let steps = 0;
  const { sim, ctrl, runner } = session;
  while (acc >= DT && steps < maxSteps) {
    ctrl.step();
    runner?.update();
    session.propellerAngle += 2 * Math.PI * sim.y[IDX_SHAFT]! * DT;
    acc -= DT;
    steps++;
  }
  if (steps >= maxSteps) acc = 0;

  view.render({
    t: sim.t,
    position: [sim.y[0]!, sim.y[1]!, sim.y[2]!],
    rotation: quatToMat3(getQuat(sim.y)),
    rudder: sim.actuators.rudder,
    sternPlanes: sim.actuators.sternPlanes,
    propellerAngle: session.propellerAngle,
  });

  if (now - lastUi > 100 && !hud.hidden) {
    session.updateInstruments(sim.telemetry());
    updateObjective(objectiveEl, session.runner);
    lastUi = now;
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
