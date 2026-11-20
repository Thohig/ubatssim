/**
 * The browser side of the game: the 3D view, the HUD, the menus, input,
 * sound and the frame loop, connected to the current session. Game logic
 * lives in session.ts, flow.ts and loop.ts; this file wires them to the DOM.
 */
import { AudioDirector } from '../audio/director';
import type { GameMode } from '../control/gameMode';
import { SCENARIOS, scenarioMode, scenarioModes } from '../control/scenarios';
import { AREA_INFO } from '../control/areas';
import { createScene } from '../render/scene';
import { quatToMat3 } from '../sim/math/quat';
import { getQuat } from '../sim/rigidBody';
import { SUBMARINE } from '../sim/config/submarine';
import { bindConsole } from '../ui/console';
import { createHelm } from '../ui/helm';
import { InputModeState, bindModeIndicator } from '../ui/inputMode';
import { createInstruments } from '../ui/instruments';
import { bindKeyboard } from '../ui/keyboard';
import { bindLog } from '../ui/log';
import { Menu } from '../ui/menu';
import { updateObjective } from '../ui/objective';
import { createPerfMeter } from '../ui/perfMeter';
import { loadSettings, saveSettings, type Settings } from '../ui/settings';
import { bindTouchControls, isTouchDevice } from '../ui/touch';
import { createViewOverlay } from '../ui/viewOverlay';
import { ViewState, availableViews, bindViewButtons, bindViewPointer } from '../ui/views';
import { GameFlow, type GameState } from './flow';
import { FixedStepLoop } from './loop';
import { GameSession, demoSession, freePlaySpec, scenarioSpec } from './session';
import { audioInput, overlayState } from './wiring';

const el = <T extends HTMLElement>(id: string) => {
  const n = document.getElementById(id);
  if (!n) throw new Error(`Missing #${id}`);
  return n as T;
};

export function startApp(): void {
  const perf = createPerfMeter(new URLSearchParams(location.search).has('perf'));
  const audio = new AudioDirector();
  // Browsers start sound only after a user gesture.
  for (const ev of ['pointerdown', 'keydown'] as const) window.addEventListener(ev, () => audio.unlock(), { capture: true });

  let settings: Settings = loadSettings();
  const flow = new GameFlow();
  const loop = new FixedStepLoop();
  const view = createScene(el('app'), SUBMARINE);
  const hud = el('hud');
  const logEl = el('log');
  const instrumentsEl = el('instruments');
  const objectiveEl = el('objective');

  let touch = false;
  const mode = new InputModeState();
  const views = new ViewState();
  // On-board views: the HUD makes room for the view on small screens (style.css).
  views.onChange((m) => document.body.classList.toggle('onboard', m !== 'external'));
  let lastPeriscope = 0;
  let session: GameSession;
  let updateInstruments: ReturnType<typeof createInstruments>;

  /** The first log line of a game: where to find the controls. The simplified mode has no console. */
  const helpHint = (m: GameMode) =>
    m === 'simplified'
      ? 'Styr med kontrollerna längst ner. ☰ → Hjälp förklarar dem.'
      : touch
        ? 'Tryck >_ och skriv "hjälp" för kommandon.'
        : 'Skriv "hjälp" i konsolen för kommandon.';

  /** Shows a session: log, instruments, sound, camera, buoy, ships and the area. */
  const attach = (s: GameSession): GameSession => {
    const { sim, ctrl, runner } = s;
    bindLog(logEl, ctrl);
    instrumentsEl.classList.remove('expanded');
    updateInstruments = createInstruments(instrumentsEl, ctrl);
    ctrl.onLog((e) => audio.onLog(e.text, e.kind, e.source));
    runner?.onChange((p) => {
      if (p.status === 'running') return;
      audio.onScenarioEnd(p.status === 'completed');
      window.setTimeout(() => endScenario(), 1500);
    });
    audio.reset(sim.y[2]!, sim.actuators.periscope);
    view.resetCamera();
    view.setWaypoint(s.scenario?.waypoint ?? null);
    view.setVessels(ctrl.world.vessels.map((v) => v.def));
    view.setArea(sim.areaId, AREA_INFO[sim.areaId].lighthouses, s.conditions, sim.waves);
    views.set('external');
    lastPeriscope = sim.actuators.periscope;
    return s;
  };

  // ------------------------------------------------------------------- menu

  const menu = new Menu(
    el('menu'),
    {
      startFree(area, start, conditions, sea) {
        const spec = freePlaySpec(area, start, conditions, sea, settings.mode, settings.autopilot, helpHint(settings.mode));
        if (spec) startGame(new GameSession(spec));
      },
      startScenario(id) {
        const sc = SCENARIOS.find((s) => s.id === id);
        if (sc) startGame(new GameSession(scenarioSpec(sc, settings.mode, settings.autopilot, helpHint(scenarioMode(sc, settings.mode)))));
      },
      resume() {
        flow.go('playing');
      },
      restart() {
        startGame(session.restart());
      },
      toMainMenu() {
        session = attach(demoSession());
        flow.go('menu');
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
        updateInstruments = createInstruments(instrumentsEl, session.ctrl);
        applyGameMode();
        showPause();
      },
      introDone: finishIntro,
    },
    settings,
  );

  function startGame(s: GameSession): void {
    session = attach(s);
    applyGameMode();
    if (s.ctrl.options.mode === 'simplified' && !settings.introSeen) {
      flow.go('paused');
      menu.show('intro');
      return;
    }
    flow.go('playing');
  }

  function finishIntro(): void {
    settings = { ...settings, introSeen: true };
    saveSettings(settings);
    menu.setSettings(settings);
    flow.go('playing');
  }

  /**
   * Shows the controls for the running game's mode: the screen controls and
   * no console in the simplified mode, the console (and touch buttons) in the
   * realistic mode.
   */
  function applyGameMode(): void {
    const simple = session.ctrl.options.mode === 'simplified';
    document.body.classList.toggle('simplified', simple);
    el('touch').dataset.mode = session.ctrl.options.mode;
    if (simple) mode.set('steer');
  }

  function showPause(): void {
    const m = session.ctrl.options.mode;
    const other: GameMode = m === 'simplified' ? 'realistic' : 'simplified';
    menu.setPauseInfo({ mode: m, canSwitch: !session.scenario || scenarioModes(session.scenario).includes(other) });
    menu.show('pause');
  }

  function endScenario(): void {
    const r = session.runner;
    if (!r || flow.state !== 'playing' || r.status === 'running') return;
    flow.go('ended');
    menu.showResult({ scenario: r.scenario, completed: r.status === 'completed', message: r.message ?? '', time: r.endTime ?? session.sim.t });
  }

  flow.onChange((s: GameState) => {
    audio.setRunning(s === 'playing');
    hud.hidden = !flow.inGame;
    view.setAutoRotate(s === 'menu');
    if (s === 'playing') menu.hide();
    if (s === 'menu') menu.show('main');
    if (s === 'paused') showPause();
    if (s !== 'playing') mode.set('steer');
  });

  const pause = () => {
    if (flow.state === 'playing') flow.go('paused');
  };

  // ------------------------------------------------------------------ input

  const consoleInput = el<HTMLInputElement>('console-input');
  const activeCtrl = () => (flow.state === 'playing' ? session.ctrl : null);
  const openConsole = bindConsole(el<HTMLFormElement>('console'), consoleInput, activeCtrl, mode, () => session.ctrl.options.mode !== 'simplified');
  bindKeyboard(activeCtrl, mode, openConsole, views);
  bindViewPointer(view.renderer.domElement, views);
  const updateViewButtons = bindViewButtons(el('view-btns'), activeCtrl, views);
  const helmEl = el('helm');
  const updateHelm = createHelm(helmEl, () => (flow.state === 'playing' ? { ctrl: session.ctrl, waypoint: session.scenario?.waypoint ?? null } : null), mode);
  let helmHeight = -1;
  const drawOverlay = createViewOverlay(el<HTMLCanvasElement>('view-overlay'));
  bindTouchControls(el('touch'), activeCtrl, mode, openConsole);
  el('menu-btn').addEventListener('click', pause);

  window.addEventListener('keydown', (e) => {
    const state = flow.state;
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
      flow.go('playing');
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
    consoleInput.placeholder = touch ? 'Skriv kommando, t.ex. "djup 120" eller "hjälp"' : 'Enter eller / öppnar konsolen – skriv "hjälp"';
    bindModeIndicator(el('mode'), mode, touch, views);
    view.setParticles(settings.particles);
    audio.apply({ volume: settings.volume, effects: settings.soundEffects, ambience: settings.soundAmbience, voice: settings.voice });
  }

  // ------------------------------------------------------------------ views

  /** Opens the periscope view when the mast is up, and leaves views that are no longer available. */
  function updateViews(dt: number): void {
    const { sim, ctrl } = session;
    const ext = sim.actuators.periscope;
    if (flow.state === 'playing' && lastPeriscope < 0.99 && ext >= 0.99) views.set('periscope');
    lastPeriscope = ext;
    // Orders still in the queue may make a view available (e.g. "bemanna bryggan").
    if (ctrl.queue.length === 0 && !availableViews(ctrl)[views.mode]) {
      if (views.mode === 'bridge') ctrl.addLog('Bryggan är utrymd. Yttre vy.', 'info');
      views.set('external');
    }
    views.update(dt);
    view.setView(flow.inGame ? views.camera(sim.kinematics().u, sim.cfg.periscope.vibrationSpeed) : { mode: 'external' });
  }

  function overlay() {
    if (!flow.inGame || views.mode === 'external') return null;
    const cam = views.camera(0, Infinity);
    return overlayState(session, {
      mode: views.mode,
      relative: views.mode === 'bridge' ? views.bridgeYaw : views.periscopeBearing,
      zoom: views.zoom,
      fov: cam.mode === 'periscope' ? cam.fov : 70,
    });
  }

  // ------------------------------------------------------------------- loop

  applySettings();
  session = attach(demoSession());
  flow.go('menu'); // shows the main menu, hides the HUD, turns the camera slowly

  let last = performance.now();
  let lastUi = 0;

  function frame(now: number): void {
    perf.begin();
    const elapsed = Math.min(0.25, (now - last) / 1000);
    last = now;
    const scale = flow.state === 'playing' ? settings.timeScale : 1;
    const s = session;
    perf.steps(loop.advance(elapsed, scale, flow.simRunning, () => s.step()));
    perf.mark('sim');

    const sim = s.sim;
    updateViews(elapsed);
    view.render({
      t: sim.t,
      position: [sim.y[0]!, sim.y[1]!, sim.y[2]!],
      rotation: quatToMat3(getQuat(sim.y)),
      rudder: sim.actuators.rudder,
      sternPlanes: sim.actuators.sternPlanes,
      propellerAngle: s.propellerAngle,
      periscope: sim.actuators.periscope,
      vessels: s.ctrl.world.vessels.map((v) => v.state),
    });
    drawOverlay(overlay());
    perf.mark('render');

    if (now - lastUi > 100 && !hud.hidden) {
      const tel = sim.telemetry();
      updateInstruments(tel);
      updateViewButtons(s.ctrl);
      if (s.ctrl.options.mode === 'simplified') {
        updateHelm(tel, { ctrl: s.ctrl, waypoint: s.scenario?.waypoint ?? null });
        // The log and the objective sit above the screen controls (style.css).
        if (helmEl.offsetHeight !== helmHeight) {
          helmHeight = helmEl.offsetHeight;
          document.body.style.setProperty('--helm-h', `${helmHeight}px`);
        }
      }
      audio.update(audioInput(s, views.mode, view.cameraDepth() > 0));
      updateObjective(objectiveEl, s.runner);
      lastUi = now;
    }
    perf.mark('ui');
    perf.end();
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}
