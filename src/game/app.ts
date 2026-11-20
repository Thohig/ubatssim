/**
 * The browser side of the game: the 3D view, the HUD, the menus, input,
 * sound and the frame loop, connected to the current session. Game logic
 * lives in session.ts, flow.ts and loop.ts; this file wires them to the DOM.
 */
import { AudioDirector } from '../audio/director';
import { SCENARIOS } from '../control/scenarios';
import { AREA_INFO } from '../control/areas';
import { createScene } from '../render/scene';
import type { CutawayState } from '../render/cutaway';
import { quatToMat3 } from '../sim/math/quat';
import { getQuat } from '../sim/rigidBody';
import { spaceAt } from '../render/interior';
import { cutawayInfo, spaceCentre } from '../ui/cutawayInfo';
import { h } from '../ui/dom';
import { SUBMARINE } from '../sim/config/submarine';
import { bindConsole } from '../ui/console';
import { createHelm } from '../ui/helm';
import { InputModeState, bindModeIndicator } from '../ui/inputMode';
import { createInstruments, layoutKey } from '../ui/instruments';
import { bindKeyboard } from '../ui/keyboard';
import { bindLog } from '../ui/log';
import { Menu } from '../ui/menu';
import { updateObjective } from '../ui/objective';
import { createPerfMeter } from '../ui/perfMeter';
import { loadSettings, saveSettings, type Settings } from '../ui/settings';
import { isTouchDevice } from '../ui/button';
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
  views.onChange((m) => {
    document.body.classList.toggle('onboard', m === 'bridge' || m === 'periscope');
    document.body.classList.toggle('cutaway', m === 'cutaway');
  });
  let lastPeriscope = 0;
  let session: GameSession;
  let updateInstruments: ReturnType<typeof createInstruments>;
  /** The instrument layout follows who handles what: rebuilt when that changes. */
  let instrumentsKey = '';

  /** The first log lines of a game: the crew handles everything, and where to take over. */
  const HELP_HINT =
    'Besättningen sköter ubåten. Styr med kontrollerna längst ner. Växla djup eller kurs till Hand, eller öppna Ballast ▾, Trim ▾ och Fart ▾ för att sköta något själv. ☰ → Hjälp förklarar.';

  /** Shows a session: log, instruments, sound, camera, buoy, ships and the area. */
  const attach = (s: GameSession): GameSession => {
    const { sim, ctrl, runner } = s;
    bindLog(logEl, ctrl);
    instrumentsEl.classList.remove('expanded');
    updateInstruments = createInstruments(instrumentsEl, ctrl);
    instrumentsKey = layoutKey(ctrl.duties());
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
        const spec = freePlaySpec(area, start, conditions, sea, HELP_HINT);
        if (spec) startGame(new GameSession(spec));
      },
      startScenario(id) {
        const sc = SCENARIOS.find((s) => s.id === id);
        if (sc) startGame(new GameSession(scenarioSpec(sc, HELP_HINT)));
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
      crewChange(system, crew) {
        // An order like any other: carried out when the game continues (the menu shows it already).
        session.ctrl.submit({ kind: 'crew', system, crew }, 'touch');
        menu.setPauseInfo(pauseInfo());
        menu.show('crew');
      },
      introDone: finishIntro,
    },
    settings,
  );

  function startGame(s: GameSession): void {
    session = attach(s);
    mode.set('steer');
    if (!settings.crewIntroSeen) {
      flow.go('paused');
      menu.show('intro');
      return;
    }
    flow.go('playing');
  }

  function finishIntro(): void {
    settings = { ...settings, crewIntroSeen: true };
    saveSettings(settings);
    menu.setSettings(settings);
    flow.go('playing');
  }

  const pauseInfo = () => ({ duties: session.ctrl.pendingDuties(), locks: session.ctrl.options.locks });

  function showPause(): void {
    menu.setPauseInfo(pauseInfo());
    menu.show('pause');
  }

  function endScenario(): void {
    const r = session.runner;
    if (!r || flow.state !== 'playing' || r.status === 'running') return;
    flow.go('ended');
    menu.showResult({
      scenario: r.scenario,
      completed: r.status === 'completed',
      message: r.message ?? '',
      time: r.endTime ?? session.sim.t,
      selfHandled: [...session.ctrl.selfHandled],
    });
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
  const openConsole = bindConsole(el<HTMLFormElement>('console'), consoleInput, activeCtrl, mode);
  bindKeyboard(activeCtrl, mode, openConsole, views);
  // Cutaway: a tap selects the space under it (interior.ts) and centres the view on it.
  bindViewPointer(view.renderer.domElement, views, (x, y) => {
    const p = view.pickCut(x, y);
    const id = p ? spaceAt(SUBMARINE, p) : null;
    views.select(id, id ? spaceCentre(SUBMARINE, id) : undefined);
  });
  // The cutaway frames the boat between the panels: measured when they change size, not every frame.
  const measureSafeArea = () => {
    const c = view.renderer.domElement.getBoundingClientRect();
    /** A panel's box, or null while it is hidden (small screens hide some in the cutaway). */
    const box = (id: string) => {
      const r = el(id).getBoundingClientRect();
      return r.width > 0 && r.height > 0 ? r : null;
    };
    const inst = box('instruments');
    const btns = box('view-btns');
    const helm = box('helm');
    const info = box('cutaway-info');
    const narrow = c.width < 760;
    view.setSafeArea({
      // On a narrow screen the instruments sit above the boat, not beside it.
      left: !narrow && inst ? Math.max(0, inst.right - c.left) : 0,
      top: Math.max(56, narrow && inst ? inst.bottom - c.top : 0),
      right: btns ? Math.max(0, c.right - btns.left) : 0,
      bottom: Math.max(helm ? c.bottom - helm.top : 0, info && narrow ? c.bottom - info.top : 0),
    });
  };
  const safeAreaObserver = new ResizeObserver(measureSafeArea);
  for (const id of ['instruments', 'view-btns', 'helm', 'cutaway-info']) safeAreaObserver.observe(el(id));
  window.addEventListener('resize', measureSafeArea);
  const cutawayInfoEl = el('cutaway-info');
  let cutawayInfoKey = '';
  /** The information box for the selected space (10 times a second, only on change). */
  const updateCutawayInfo = (s: GameSession) => {
    const info = views.mode === 'cutaway' && views.selected ? cutawayInfo(SUBMARINE, views.selected, s.sim.telemetry(), { bridgeManned: s.ctrl.bridgeManned }) : null;
    const key = info ? `${info.title}|${info.lines.join('|')}` : views.mode === 'cutaway' ? 'hint' : '';
    if (key === cutawayInfoKey) return;
    cutawayInfoKey = key;
    cutawayInfoEl.hidden = views.mode !== 'cutaway';
    if (info) cutawayInfoEl.replaceChildren(h('h3', null, info.title), h('p', null, info.description), h('ul', null, ...info.lines.map((l) => h('li', null, l))));
    else cutawayInfoEl.replaceChildren(h('p', null, 'Tryck på ett rum, en tank eller tornet för att se vad som finns där.'));
  };
  const updateViewButtons = bindViewButtons(el('view-btns'), activeCtrl, views, openConsole);
  const helmEl = el('helm');
  const updateHelm = createHelm(helmEl, () => (flow.state === 'playing' ? { ctrl: session.ctrl, waypoint: session.scenario?.waypoint ?? null } : null), mode);
  // The log and the instrument panel stay above the screen controls (style.css, --helm-h).
  new ResizeObserver(() => document.body.style.setProperty('--helm-h', `${helmEl.offsetHeight}px`)).observe(helmEl);
  const drawOverlay = createViewOverlay(el<HTMLCanvasElement>('view-overlay'));
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
    touch = isTouchDevice();
    document.body.classList.toggle('touch', touch);
    consoleInput.placeholder = 'Skriv ett kommando, t.ex. "djup 120", eller "hjälp"';
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
    if (!flow.inGame || (views.mode !== 'bridge' && views.mode !== 'periscope')) return null;
    const cam = views.camera(0, Infinity);
    return overlayState(session, {
      mode: views.mode,
      relative: views.mode === 'bridge' ? views.bridgeYaw : views.periscopeBearing,
      zoom: views.zoom,
      fov: cam.mode === 'periscope' ? cam.fov : 70,
    });
  }

  /**
   * What the cutaway shows. The telemetry part is taken 10 times a second
   * (with the instruments); the shaft and the animations move every frame.
   */
  let cutawayFromTelemetry: Omit<CutawayState, 'plan' | 'propellerAngle' | 'selected' | 't'> | null = null;
  function sampleCutaway(s: GameSession) {
    const t = s.sim.telemetry();
    const R = quatToMat3(getQuat(s.sim.y));
    // True up in the body frame: Rᵀ·(0, 0, −1), R body → NED (row-major).
    cutawayFromTelemetry = {
      up: [-R[6]!, -R[7]!, -R[8]!],
      tanks: t.tanks.map((k) => ({ id: k.id, fill: k.fill, ventOpen: k.ventOpen, blowOpen: k.blowOpen })),
      trimRemaining: t.trimRemaining,
      compRemaining: t.compRemaining,
      air: t.airPressure / s.sim.cfg.air.bottlePressure,
    };
  }
  function cutawayState(s: GameSession): CutawayState {
    if (!cutawayFromTelemetry) sampleCutaway(s);
    return { ...cutawayFromTelemetry!, plan: views.cutPlan, propellerAngle: s.propellerAngle, selected: views.selected, t: s.sim.t };
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
      cutaway: views.mode === 'cutaway' ? cutawayState(s) : undefined,
    });
    drawOverlay(overlay());
    perf.mark('render');

    if (now - lastUi > 100 && !hud.hidden) {
      const tel = sim.telemetry();
      const key = layoutKey(s.ctrl.duties());
      if (key !== instrumentsKey) {
        instrumentsKey = key;
        updateInstruments = createInstruments(instrumentsEl, s.ctrl);
      }
      updateInstruments(tel);
      updateViewButtons(s.ctrl);
      updateHelm(tel, { ctrl: s.ctrl, waypoint: s.scenario?.waypoint ?? null });
      updateCutawayInfo(s);
      if (views.mode === 'cutaway') sampleCutaway(s);
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
