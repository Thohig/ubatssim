import { Controller } from './control/controller';
import type { GameMode } from './control/gameMode';
import { SCENARIOS, ScenarioRunner, scenarioMode, scenarioModes, type Scenario } from './control/scenarios';
import { createScene } from './render/scene';
import { quatToMat3 } from './sim/math/quat';
import { getQuat } from './sim/rigidBody';
import { DT, IDX_SHAFT, Simulation, type InitialConditions } from './sim/simulation';
import { bindConsole } from './ui/console';
import { InputModeState, bindModeIndicator } from './ui/inputMode';
import { createInstruments } from './ui/instruments';
import { bindKeyboard } from './ui/keyboard';
import { bindLog } from './ui/log';
import { Menu } from './ui/menu';
import { AREA_INFO, type ConditionsId } from './control/areas';
import { AREAS } from './sim/config/areas';
import { heightFunction } from './sim/terrain';
import { updateObjective } from './ui/objective';
import { loadSettings, saveSettings, type Settings } from './ui/settings';
import { bindTouchControls, isTouchDevice } from './ui/touch';
import { createViewOverlay } from './ui/viewOverlay';
import { ViewState, availableViews, bindViewButtons, bindViewPointer } from './ui/views';
import { AudioDirector } from './audio/director';
import { createPerfMeter } from './ui/perfMeter';

const perf = createPerfMeter(new URLSearchParams(location.search).has('perf'));

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
  scenario: Scenario | null;
  /** How to recreate this session for "Starta om". */
  restart: () => Session;
  propellerAngle: number;
  updateInstruments: ReturnType<typeof createInstruments>;
  conditions: ConditionsId;
}

const audio = new AudioDirector();
// Browsers start sound only after a user gesture.
for (const ev of ['pointerdown', 'keydown'] as const) window.addEventListener(ev, () => audio.unlock(), { capture: true });

let settings: Settings = loadSettings();
let state: GameState = 'menu';
let session: Session;

const sim0 = new Simulation();
const view = createScene(el('app'), sim0.cfg);
const hud = el('hud');
const logEl = el('log');
const instrumentsEl = el('instruments');
const objectiveEl = el('objective');

/** Game sessions start in `mode`; the demo session behind the menu runs the realistic mode. */
function newSession(
  initial: InitialConditions,
  scenario: Scenario | null,
  intro: string,
  mode: GameMode = 'realistic',
  conditions: ConditionsId = 'day',
): Session {
  const sim = new Simulation(initial);
  const ctrl = new Controller(sim);
  ctrl.options.autopilotAllowed = settings.autopilot;
  const runner = scenario ? new ScenarioRunner(scenario, ctrl) : null;
  bindLog(logEl, ctrl);
  if (intro) ctrl.addLog(intro, 'info');
  ctrl.setMode(mode);
  instrumentsEl.classList.remove('expanded');
  const s: Session = {
    sim,
    ctrl,
    runner,
    scenario,
    restart: () => newSession(initial, scenario, intro, ctrl.options.mode, conditions),
    propellerAngle: 0,
    updateInstruments: createInstruments(instrumentsEl, ctrl),
    conditions,
  };
  ctrl.onLog((e) => audio.onLog(e.text, e.kind, e.source));
  runner?.onChange((p) => {
    if (p.status !== 'running') audio.onScenarioEnd(p.status === 'completed');
  });
  audio.reset(sim.y[2]!, sim.actuators.periscope);
  if (mode === 'realistic' && !ctrl.options.autopilotAllowed) ctrl.addLog('Autopilot för djup och kurs är avstängd.', 'info');
  ctrl.addLog(touch ? 'Tryck >_ och skriv "hjälp" för kommandon.' : 'Skriv "hjälp" i konsolen för kommandon.', 'info');
  runner?.onChange((p) => {
    if (p.status !== 'running') window.setTimeout(() => endScenario(), 1500);
  });
  view.resetCamera();
  view.setWaypoint(scenario?.waypoint ?? null);
  const area = sim.areaId;
  // Free play and the demo behind the menu have the area's traffic; scenarios bring their own.
  if (!scenario) ctrl.world.add(AREA_INFO[area].traffic);
  view.setVessels(ctrl.world.vessels.map((v) => v.def));
  view.setArea(heightFunction(AREAS[area].terrain), AREA_INFO[area].lighthouses, conditions, sim.waves);
  views.set('external');
  lastPeriscope = sim.actuators.periscope;
  return s;
}

/** Background session shown behind the main menu: cruising on autopilot. */
function demoSession(): Session {
  // Surfaced off the archipelago, heading north along the coast.
  const s = newSession({ east: 1700, speed: 5 * KN }, null, '');
  for (const o of [
    { kind: 'setHeading', heading: 0 },
    { kind: 'setSpeed', knots: 5 },
  ] as const)
    s.ctrl.submit(o, 'console');
  return s;
}

// ---------------------------------------------------------------------- menu

const menu = new Menu(
  el('menu'),
  {
    startFree(area, start, conditions, sea) {
      const f = AREA_INFO[area].starts.find((s) => s.id === start);
      if (f) startGame(newSession({ ...f.initial, sea }, null, f.text, settings.mode, conditions));
    },
    startScenario(id) {
      const sc = SCENARIOS.find((s) => s.id === id);
      if (sc) startGame(newSession(sc.initial, sc, `Scenario: ${sc.title}. ${sc.description}`, scenarioMode(sc, settings.mode), sc.conditions ?? 'day'));
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
    switchMode() {
      const next: GameMode = session.ctrl.options.mode === 'simplified' ? 'realistic' : 'simplified';
      if (session.scenario && !scenarioModes(session.scenario).includes(next)) return;
      session.ctrl.setMode(next);
      // The choice is remembered for the next game, as on the start page.
      settings = { ...settings, mode: next };
      saveSettings(settings);
      menu.setSettings(settings);
      session.updateInstruments = createInstruments(instrumentsEl, session.ctrl);
      applyGameMode();
      showPause();
    },
    introDone: finishIntro,
  },
  settings,
);

function startGame(s: Session): void {
  session = s;
  applyGameMode();
  if (s.ctrl.options.mode === 'simplified' && !settings.introSeen) {
    setState('paused');
    menu.show('intro');
    return;
  }
  setState('playing');
}

function finishIntro(): void {
  settings = { ...settings, introSeen: true };
  saveSettings(settings);
  menu.setSettings(settings);
  setState('playing');
}

/** Shows the touch buttons for the running game's mode. */
function applyGameMode(): void {
  el('touch').dataset.mode = session.ctrl.options.mode;
}

function showPause(): void {
  const mode = session.ctrl.options.mode;
  const other: GameMode = mode === 'simplified' ? 'realistic' : 'simplified';
  menu.setPauseInfo({ mode, canSwitch: !session.scenario || scenarioModes(session.scenario).includes(other) });
  menu.show('pause');
}

function endScenario(): void {
  const r = session.runner;
  if (!r || state !== 'playing' || r.status === 'running') return;
  const completed = r.status === 'completed';
  const time = r.endTime ?? session.sim.t;
  setState('ended');
  menu.showResult({ scenario: r.scenario, completed, message: r.message ?? '', time });
}

function setState(s: GameState): void {
  state = s;
  audio.setRunning(s === 'playing');
  const inGame = s === 'playing' || s === 'paused' || s === 'ended';
  hud.hidden = !inGame;
  view.setAutoRotate(s === 'menu');
  if (s === 'playing') menu.hide();
  if (s === 'menu') menu.show('main');
  if (s === 'paused') showPause();
  if (s !== 'playing') mode.set('steer');
}

function pause(): void {
  if (state === 'playing') setState('paused');
}

// --------------------------------------------------------------------- input

let touch = false;
const mode = new InputModeState();
const views = new ViewState();
// On-board views: the HUD makes room for the view on small screens (style.css).
views.onChange((m) => document.body.classList.toggle('onboard', m !== 'external'));
let lastPeriscope = 0;
const consoleInput = el<HTMLInputElement>('console-input');
const activeCtrl = () => (state === 'playing' ? session.ctrl : null);
const openConsole = bindConsole(el<HTMLFormElement>('console'), consoleInput, activeCtrl, mode);
bindKeyboard(activeCtrl, mode, openConsole, views);
bindViewPointer(view.renderer.domElement, views);
bindViewButtons(el('view-btns'), activeCtrl, views);
const drawOverlay = createViewOverlay(el<HTMLCanvasElement>('view-overlay'));
bindTouchControls(el('touch'), activeCtrl, mode, openConsole);
el('menu-btn').addEventListener('click', pause);

window.addEventListener('keydown', (e) => {
  if ((e.key === 'm' || e.key === 'M') && state === 'playing' && mode.current === 'steer' && !e.metaKey && !e.ctrlKey && !e.altKey) {
    const muted = audio.engine.toggleMute();
    session.ctrl.addLog(muted ? 'Ljudet är avstängt (M).' : 'Ljudet är på (M).', 'info');
    return;
  }
  if (e.key !== 'Escape') return;
  if (state === 'playing' && mode.current === 'steer' && views.mode !== 'external') {
    e.preventDefault();
    views.set('external');
  } else if (state === 'playing' && mode.current === 'steer') {
    e.preventDefault();
    pause();
  } else if (state === 'paused' && menu.current === 'intro') {
    e.preventDefault();
    finishIntro();
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
  bindModeIndicator(el('mode'), mode, touch, views);
  view.setParticles(settings.particles);
  audio.apply({ volume: settings.volume, effects: settings.soundEffects, ambience: settings.soundAmbience, voice: settings.voice });
}

// --------------------------------------------------------------------- views

/** Opens the periscope view when the mast is up, and leaves views that are no longer available. */
function updateViews(dt: number): void {
  const { sim, ctrl } = session;
  const inGame = state !== 'menu';
  const ext = sim.actuators.periscope;
  if (inGame && state === 'playing' && lastPeriscope < 0.99 && ext >= 0.99) views.set('periscope');
  lastPeriscope = ext;
  // Orders still in the queue may make a view available (e.g. "bemanna bryggan").
  if (ctrl.queue.length === 0 && !availableViews(ctrl)[views.mode]) {
    if (views.mode === 'bridge') ctrl.addLog('Bryggan är utrymd. Yttre vy.', 'info');
    views.set('external');
  }
  views.update(dt);
  view.setView(inGame ? views.camera(sim.kinematics().u, sim.cfg.periscope.vibrationSpeed) : { mode: 'external' });
}

function nearestShip(): { range: number; bladeRate: number } | undefined {
  const k = session.ctrl.world.contacts()[0];
  return k ? { range: k.range, bladeRate: k.vessel.def.propellerRps * k.vessel.def.blades } : undefined;
}

function overlayState() {
  if (state === 'menu' || views.mode === 'external') return null;
  const { sim, runner } = session;
  const k = sim.kinematics();
  const rel = views.mode === 'bridge' ? views.bridgeYaw : views.periscopeBearing;
  const wp = runner?.scenario.waypoint;
  const cam = views.camera(0, Infinity);
  return {
    mode: views.mode,
    bearing: ((k.heading + rel) * 180) / Math.PI,
    waypointBearing: wp ? ((Math.atan2(wp[1] - sim.y[1]!, wp[0] - sim.y[0]!) * 180) / Math.PI + 360) % 360 : null,
    zoom: views.zoom,
    underwater: views.mode === 'periscope' && sim.bodyPointDepth(sim.periscopeHead()) > 0,
    fov: cam.mode === 'periscope' ? cam.fov : 70,
  };
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
  perf.begin();
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
  perf.steps(steps);
  perf.mark('sim');

  updateViews(elapsed);
  view.render({
    t: sim.t,
    position: [sim.y[0]!, sim.y[1]!, sim.y[2]!],
    rotation: quatToMat3(getQuat(sim.y)),
    rudder: sim.actuators.rudder,
    sternPlanes: sim.actuators.sternPlanes,
    propellerAngle: session.propellerAngle,
    periscope: sim.actuators.periscope,
    vessels: session.ctrl.world.vessels.map((v) => v.state),
  });
  drawOverlay(overlayState());
  perf.mark('render');

  if (now - lastUi > 100 && !hud.hidden) {
    const t = sim.telemetry();
    session.updateInstruments(t);
    audio.update({
      t,
      maxPower: sim.cfg.propulsion.maxPower,
      lpBlower: sim.commands.lpBlower,
      view: views.mode,
      cameraUnderwater: view.cameraDepth() > 0,
      conditions: session.conditions,
      seaHs: sim.sea.hs,
      coastal: sim.areaId !== 'atlantic',
      ship: nearestShip(),
    });
    updateObjective(objectiveEl, session.runner);
    lastUi = now;
  }
  perf.mark('ui');
  perf.end();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
