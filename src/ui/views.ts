/**
 * Camera views: external (orbit), the open bridge, the periscope and the
 * cutaway. The view is player state, not simulation state: it never changes
 * the boat. Raising and lowering the periscope and manning the bridge are orders.
 *
 * Availability:
 *   bridge    – the bridge is manned (surfaced)
 *   periscope – the mast is fully raised
 *   cutaway   – always: the boat cut along the centre line (side) or through
 *               the upper deck (top); drag to turn, wheel or pinch to zoom,
 *               tap a space to select it and centre the view on it
 */
import type { Controller } from '../control/controller';
import type { OrderSource } from '../control/orders';
import type { CameraView } from '../render/scene';
import type { CutPlan } from '../render/cutaway';

export type ViewMode = 'external' | 'bridge' | 'periscope' | 'cutaway';

const DEG = Math.PI / 180;

/** Periscope magnifications and the matching vertical field of view [deg]. */
export const PERISCOPE_ZOOM = [
  { label: '1,5×', fov: 32 },
  { label: '6×', fov: 8 },
] as const;

/** Training speed of the periscope at low power [rad/s]; slower at high power. */
const TRAIN_RATE = 40 * DEG;
const BRIDGE_YAW_LIMIT = 160 * DEG;
const BRIDGE_PITCH_LIMIT = 40 * DEG;

export const VIEW_NAME: Record<ViewMode, string> = { external: 'Yttre vy', bridge: 'Bryggan', periscope: 'Periskop', cutaway: 'Genomskärning' };

const CUT_YAW_LIMIT = 60 * DEG;
const CUT_PITCH_LIMIT = 45 * DEG;
/** Cutaway zoom: 1 = the whole boat. */
export const CUT_ZOOM_MAX = 6;

export class ViewState {
  mode: ViewMode = 'external';
  bridgeYaw = 0;
  bridgePitch = 0;
  /** Periscope bearing relative to the bow [rad], positive to starboard. */
  periscopeBearing = 0;
  zoom = 0;
  /** −1, 0 or +1 while a training key is held. */
  trainDir = 0;
  /** Cutaway: side or top, turned by yaw/pitch, zoomed, centred on `cutPan` [m] along the boat. */
  cutPlan: CutPlan = 'side';
  cutYaw = 0;
  cutPitch = 0;
  cutZoom = 1;
  cutPan = 0;
  /** Cutaway: the tapped space (interior.ts), or null. */
  selected: string | null = null;
  private listeners: ((m: ViewMode) => void)[] = [];

  onChange(fn: (m: ViewMode) => void): void {
    this.listeners.push(fn);
  }

  set(mode: ViewMode): void {
    if (mode === this.mode) return;
    this.mode = mode;
    this.trainDir = 0;
    if (mode === 'bridge') {
      this.bridgeYaw = 0;
      this.bridgePitch = 0;
    }
    for (const fn of this.listeners) fn(mode);
  }

  /** Next available view after the present one. */
  cycle(available: Record<ViewMode, boolean>): void {
    const order: ViewMode[] = ['external', 'bridge', 'periscope', 'cutaway'];
    let i = order.indexOf(this.mode);
    for (let k = 0; k < order.length; k++) {
      i = (i + 1) % order.length;
      if (available[order[i]!]) break;
    }
    this.set(order[i]!);
  }

  toggleZoom(): void {
    this.zoom = (this.zoom + 1) % PERISCOPE_ZOOM.length;
  }

  /** Cutaway: zoom by a factor (wheel, pinch, buttons), within 1…CUT_ZOOM_MAX. */
  zoomCut(factor: number): void {
    this.cutZoom = clamp(this.cutZoom * factor, 1, CUT_ZOOM_MAX);
    this.notify();
  }

  /** Cutaway: side ↔ top. */
  toggleCutPlan(): void {
    this.cutPlan = this.cutPlan === 'side' ? 'top' : 'side';
    this.cutYaw = 0;
    this.cutPitch = 0;
    this.notify();
  }

  /** Cutaway: the whole boat again, nothing selected. */
  resetCut(): void {
    this.cutYaw = 0;
    this.cutPitch = 0;
    this.cutZoom = 1;
    this.cutPan = 0;
    this.selected = null;
    this.notify();
  }

  /** Cutaway: select a space (null to clear) and centre the view on body x [m]. */
  select(id: string | null, x?: number): void {
    this.selected = id;
    if (id !== null && x !== undefined) {
      this.cutPan = clamp(x, -30, 30);
      if (this.cutZoom < 2) this.cutZoom = 2;
    }
    this.notify();
  }

  private notify(): void {
    for (const fn of this.listeners) fn(this.mode);
  }

  /** Turns the periscope or the bridge look by a pointer drag [px]. */
  drag(dx: number, dy: number): void {
    if (this.mode === 'periscope') {
      this.periscopeBearing = wrap(this.periscopeBearing - dx * 0.004 * (PERISCOPE_ZOOM[this.zoom]!.fov / 32));
    } else if (this.mode === 'bridge') {
      this.bridgeYaw = clamp(this.bridgeYaw - dx * 0.005, -BRIDGE_YAW_LIMIT, BRIDGE_YAW_LIMIT);
      this.bridgePitch = clamp(this.bridgePitch + dy * 0.005, -BRIDGE_PITCH_LIMIT, BRIDGE_PITCH_LIMIT);
    } else if (this.mode === 'cutaway') {
      this.cutYaw = clamp(this.cutYaw - dx * 0.005, -CUT_YAW_LIMIT, CUT_YAW_LIMIT);
      this.cutPitch = clamp(this.cutPitch + dy * 0.005, -CUT_PITCH_LIMIT, CUT_PITCH_LIMIT);
    }
  }

  /** Advances held-key training by dt [s] of real time. */
  update(dt: number): void {
    if (this.mode !== 'periscope' || this.trainDir === 0) return;
    const rate = TRAIN_RATE * (PERISCOPE_ZOOM[this.zoom]!.fov / 32);
    this.periscopeBearing = wrap(this.periscopeBearing + this.trainDir * rate * dt);
  }

  /** The camera description for the renderer. `speed` [m/s] shakes a raised periscope. */
  camera(speed: number, vibrationSpeed: number): CameraView {
    if (this.mode === 'bridge') return { mode: 'bridge', yaw: this.bridgeYaw, pitch: this.bridgePitch };
    if (this.mode === 'periscope') {
      const shake = Math.max(0, Math.abs(speed) - vibrationSpeed) * 2;
      return { mode: 'periscope', bearing: this.periscopeBearing, fov: PERISCOPE_ZOOM[this.zoom]!.fov, shake };
    }
    if (this.mode === 'cutaway') return { mode: 'cutaway', plan: this.cutPlan, yaw: this.cutYaw, pitch: this.cutPitch, zoom: this.cutZoom, pan: this.cutPan };
    return { mode: 'external' };
  }
}

/** Which views can be shown now. */
export function availableViews(ctrl: Controller): Record<ViewMode, boolean> {
  return { external: true, bridge: ctrl.bridgeManned, periscope: ctrl.sim.actuators.periscope >= 0.99, cutaway: true };
}

/**
 * Pointer input on the 3D view: drags turn the bridge look, train the
 * periscope or turn the cutaway (the orbit controls are off in those views).
 * In the cutaway a wheel or a two-finger pinch zooms, and a tap (a press
 * that hardly moves) calls `onTap` with the screen point.
 */
export function bindViewPointer(canvas: HTMLElement, views: ViewState, onTap?: (x: number, y: number) => void): void {
  const pointers = new Map<number, { x: number; y: number; x0: number; y0: number }>();
  let pinch: number | null = null;
  canvas.addEventListener('pointerdown', (e) => {
    if (views.mode === 'external') return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, x0: e.clientX, y0: e.clientY });
    try {
      canvas.setPointerCapture(e.pointerId);
    } catch {
      // Synthetic events have no pointer to capture.
    }
    pinch = null;
  });
  canvas.addEventListener('pointermove', (e) => {
    const p = pointers.get(e.pointerId);
    if (!p || views.mode === 'external') return;
    if (pointers.size === 2 && views.mode === 'cutaway') {
      const [a, b] = [...pointers.values()];
      p.x = e.clientX;
      p.y = e.clientY;
      const d = Math.hypot(a!.x - b!.x, a!.y - b!.y);
      if (pinch !== null && d > 0) views.zoomCut(d / pinch);
      pinch = d;
      return;
    }
    views.drag(e.clientX - p.x, e.clientY - p.y);
    p.x = e.clientX;
    p.y = e.clientY;
  });
  const end = (e: PointerEvent) => {
    const p = pointers.get(e.pointerId);
    pointers.delete(e.pointerId);
    if (pointers.size < 2) pinch = null;
    if (p && e.type === 'pointerup' && views.mode === 'cutaway' && Math.hypot(e.clientX - p.x0, e.clientY - p.y0) < 6) onTap?.(e.clientX, e.clientY);
  };
  canvas.addEventListener('pointerup', end);
  canvas.addEventListener('pointercancel', end);
  canvas.addEventListener(
    'wheel',
    (e) => {
      if (views.mode !== 'cutaway') return;
      e.preventDefault();
      views.zoomCut(Math.exp(-e.deltaY * 0.0015));
    },
    { passive: false },
  );
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const wrap = (a: number) => {
  let x = (a + Math.PI) % (2 * Math.PI);
  if (x < 0) x += 2 * Math.PI;
  return x - Math.PI;
};

/**
 * V / "Vy": next available view. While the crew handles the ballast the
 * bridge is manned automatically when the boat is surfaced, as "Dyk" clears it.
 */
export function cycleView(ctrl: Controller, views: ViewState, source: OrderSource): void {
  const available = availableViews(ctrl);
  const sim = ctrl.sim;
  // Not while diving: the vents are open.
  const canMan = sim.bodyPointDepth(sim.cfg.bridge.deck) < -0.5 && !sim.tanks.some((t) => t.ventOpen);
  if (views.mode === 'external' && !available.bridge && canMan && ctrl.options.crew.ballast) {
    ctrl.submit({ kind: 'bridge', manned: true }, source);
    views.set('bridge');
    return;
  }
  views.cycle(available);
}

/** True bearing [deg] the bridge look or the periscope points at. */
export function viewBearing(ctrl: Controller, views: ViewState): number {
  const rel = views.mode === 'bridge' ? views.bridgeYaw : views.mode === 'periscope' ? views.periscopeBearing : 0;
  const deg = ((ctrl.sim.kinematics().heading + rel) * 180) / Math.PI;
  return ((deg % 360) + 360) % 360;
}

/** C / "Snitt": into the cutaway, or back to the external view. */
export function toggleCutaway(views: ViewState): void {
  views.set(views.mode === 'cutaway' ? 'external' : 'cutaway');
}

/** B / "Brg": report the bearing of the cross hair (or the bridge look). */
export function reportViewBearing(ctrl: Controller, views: ViewState, source: OrderSource): void {
  if (views.mode !== 'bridge' && views.mode !== 'periscope') return;
  ctrl.submit({ kind: 'reportBearing', bearing: Math.round(viewBearing(ctrl, views)) % 360 }, source);
}

/** P / "Per": raise a housed periscope, lower a raised one. */
export function togglePeriscope(ctrl: Controller, source: OrderSource): void {
  ctrl.submit({ kind: 'periscope', up: !ctrl.sim.commands.periscopeUp }, source);
}

/** The chart and sonar panel (navPanel.ts). */
export interface NavSwitch {
  mode(): 'chart' | 'sonar' | null;
  toggle(mode: 'chart' | 'sonar'): void;
}

/** Showing and hiding the log book (a setting, kept by the app). */
export interface LogSwitch {
  shown(): boolean;
  toggle(): void;
}

/**
 * Buttons for the views next to the menu button (mouse and touch), and
 * "Logg", which shows or hides the log book. On phones (style.css) only
 * "Vyer ▾" shows; it folds the others out, and a choice folds them in.
 */
export function bindViewButtons(
  root: HTMLElement,
  getCtrl: () => Controller | null,
  views: ViewState,
  openConsole?: () => void,
  log?: LogSwitch,
  nav?: NavSwitch,
): (ctrl: Controller) => void {
  root.innerHTML = `
    <button type="button" data-v="menu" class="views-menu" title="Vyer och konsolen" aria-label="Vyer och konsolen" aria-expanded="false">Vyer ▾</button>
    <button type="button" data-v="view" title="Byt vy (V)" aria-label="Byt vy">Vy</button>
    <button type="button" data-v="periscope" title="Periskop upp/ned (P)" aria-label="Periskop upp eller ned">Per</button>
    <button type="button" data-v="snorkel" title="Snorkel upp/ned (N)" aria-label="Snorkel upp eller ned">Snork</button>
    <button type="button" data-v="zoom" title="Förstoring (Z)" aria-label="Förstoring">Zoom</button>
    <button type="button" data-v="bearing" title="Rapportera bäringen (B)" aria-label="Rapportera bäringen">Brg</button>
    <button type="button" data-v="cutaway" title="Genomskärning av ubåten (C)" aria-label="Genomskärning av ubåten">Snitt</button>
    <button type="button" data-v="plan" title="Snittet från sidan eller ovanifrån (Z)" aria-label="Snittet från sidan eller ovanifrån">Ovan</button>
    <button type="button" data-v="whole" title="Hela ubåten" aria-label="Visa hela ubåten">Hela</button>
    <button type="button" data-v="chart" title="Sjökortet (K)" aria-label="Sjökortet">Karta</button>
    <button type="button" data-v="sonar" title="Sonaren (H)" aria-label="Sonaren">Sonar</button>
    <button type="button" data-v="log" title="Visa eller dölj loggboken (L)" aria-label="Visa eller dölj loggboken" aria-pressed="false">Logg</button>
    <button type="button" data-v="console" class="console-btn" title="Kommandokonsolen (Enter)" aria-label="Öppna kommandokonsolen">&gt;_</button>`;
  const view = root.querySelector<HTMLButtonElement>('[data-v="view"]')!;
  const per = root.querySelector<HTMLButtonElement>('[data-v="periscope"]')!;
  const zoom = root.querySelector<HTMLButtonElement>('[data-v="zoom"]')!;
  const snork = root.querySelector<HTMLButtonElement>('[data-v="snorkel"]')!;
  const brg = root.querySelector<HTMLButtonElement>('[data-v="bearing"]')!;
  const cut = root.querySelector<HTMLButtonElement>('[data-v="cutaway"]')!;
  const plan = root.querySelector<HTMLButtonElement>('[data-v="plan"]')!;
  const whole = root.querySelector<HTMLButtonElement>('[data-v="whole"]')!;
  const logBtn = root.querySelector<HTMLButtonElement>('[data-v="log"]')!;
  logBtn.hidden = !log;
  const chartBtn = root.querySelector<HTMLButtonElement>('[data-v="chart"]')!;
  const sonarBtn = root.querySelector<HTMLButtonElement>('[data-v="sonar"]')!;
  chartBtn.hidden = sonarBtn.hidden = !nav;
  /** Whether the boat is too deep for the periscope and the bridge. */
  let deep = false;
  const sync = () => {
    zoom.hidden = views.mode !== 'periscope';
    brg.hidden = views.mode !== 'bridge' && views.mode !== 'periscope';
    const inCut = views.mode === 'cutaway';
    cut.classList.toggle('on', inCut);
    plan.hidden = !inCut;
    whole.hidden = !inCut;
    plan.textContent = views.cutPlan === 'side' ? 'Ovan' : 'Sida';
    per.hidden = deep;
    snork.hidden = deep;
    view.hidden = deep && views.mode === 'external';
    const shown = log?.shown() ?? true;
    logBtn.classList.toggle('on', shown);
    logBtn.setAttribute('aria-pressed', String(shown));
    chartBtn.classList.toggle('on', nav?.mode() === 'chart');
    sonarBtn.classList.toggle('on', nav?.mode() === 'sonar');
  };
  sync();
  views.onChange(sync);
  const menu = root.querySelector<HTMLButtonElement>('[data-v="menu"]')!;
  const fold = (open: boolean) => {
    root.classList.toggle('open', open);
    menu.setAttribute('aria-expanded', String(open));
    menu.textContent = open ? 'Vyer ▴' : 'Vyer ▾';
  };
  root.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-v]');
    if (b?.dataset.v === 'menu') {
      fold(!root.classList.contains('open'));
      return;
    }
    fold(false);
    // iOS shows the on-screen keyboard only for focus() inside a click handler.
    if (b?.dataset.v === 'console') {
      openConsole?.();
      return;
    }
    if (b?.dataset.v === 'log') {
      log?.toggle();
      sync();
      return;
    }
    if (b?.dataset.v === 'chart' || b?.dataset.v === 'sonar') {
      nav?.toggle(b.dataset.v);
      sync();
      return;
    }
    const ctrl = getCtrl();
    if (!b || !ctrl) return;
    if (b.dataset.v === 'cutaway') toggleCutaway(views);
    else if (b.dataset.v === 'plan') views.toggleCutPlan();
    else if (b.dataset.v === 'whole') views.resetCut();
    else if (b.dataset.v === 'view') cycleView(ctrl, views, 'touch');
    else if (b.dataset.v === 'periscope') togglePeriscope(ctrl, 'touch');
    else if (b.dataset.v === 'snorkel') ctrl.submit({ kind: 'snorkel', up: !ctrl.sim.commands.snorkelUp }, 'touch');
    else if (b.dataset.v === 'bearing') reportViewBearing(ctrl, views, 'touch');
    else views.toggleZoom();
  });
  /**
   * Call ~10 times a second. The buttons follow the situation: Per and Vy
   * are hidden below PERISCOPE_BUTTON_DEPTH with the mast housed, where
   * neither the periscope nor the bridge can be used.
   */
  return (ctrl) => {
    const k = ctrl.sim.kinematics();
    const next = k.depth > PERISCOPE_BUTTON_DEPTH && ctrl.sim.actuators.periscope < 0.01 && ctrl.sim.actuators.snorkel < 0.01;
    // The log setting may also change from the settings screen or the L key.
    const navChanged = chartBtn.classList.contains('on') !== (nav?.mode() === 'chart') || sonarBtn.classList.contains('on') !== (nav?.mode() === 'sonar');
    if (next !== deep || navChanged || logBtn.classList.contains('on') !== (log?.shown() ?? true)) {
      deep = next;
      sync();
    }
  };
}

/** The periscope and view buttons show above this CO depth [m]. */
export const PERISCOPE_BUTTON_DEPTH = 25;
