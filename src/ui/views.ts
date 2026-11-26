/**
 * Camera views: external (orbit), the open bridge, the periscope and the
 * cutaway. The view is player state, not simulation state: it never changes
 * the boat. Raising and lowering the periscope and manning the bridge are orders.
 *
 * Availability:
 *   bridge    – the bridge is manned (surfaced)
 *   periscope – the mast is fully raised
 *   control   – always: inside the control room at one of its stations
 *               (controlRoom.data.ts); drag to look round, ←/→ or Plats to
 *               go to the next station, tap a screen to open its panel
 *   cutaway   – always: the boat cut along the centre line (side) or through
 *               the upper deck (top); drag to turn, wheel or pinch to zoom,
 *               tap a space to select it and centre the view on it
 */
import type { Controller } from '../control/controller';
import type { OrderSource } from '../control/orders';
import type { CameraView } from '../render/scene';
import type { CutPlan } from '../render/cutaway';
import { LOOK_PITCH, LOOK_YAW, STATION_NAME, STATION_ORDER, type StationId } from '../render/controlRoom.data';
import { COMPACT_QUERY, isCompact } from './compact';

export type ViewMode = 'external' | 'bridge' | 'periscope' | 'control' | 'cutaway';

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

export const VIEW_NAME: Record<ViewMode, string> = { external: 'Yttre vy', bridge: 'Bryggan', periscope: 'Periskop', control: 'Manöverrum', cutaway: 'Genomskärning' };

const CUT_YAW_LIMIT = 60 * DEG;
const CUT_PITCH_LIMIT = 45 * DEG;
/**
 * How far from the cross hair a ship still counts as in it [deg]: a quarter of the periscope's field of view
 * (8° at 1,5×, 2° at 6×), 5° from the bridge. A small ship 3–5 km off is a few pixels wide at 1,5×.
 */
export function markField(views: { mode: ViewMode; zoom: number }): number {
  return views.mode === 'periscope' ? PERISCOPE_ZOOM[views.zoom]!.fov / 4 : 5;
}

/**
 * Held-key training starts slow and speeds up: a tap turns the periscope about half a degree (at 40°/s from the
 * start, the shortest tap turned it 4°, more than a ship 3 km off is wide), held a second it turns at full rate.
 */
export function trainRateFactor(held: number): number {
  return held < 0.3 ? 0.1 : Math.min(1, 0.1 + (held - 0.3) * 1.3);
}

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
  /** Seconds the training key has been held (`trainRateFactor`). */
  private trainHeld = 0;
  /** Cutaway: side or top, turned by yaw/pitch, zoomed, centred on `cutPan` [m] along the boat. */
  cutPlan: CutPlan = 'side';
  cutYaw = 0;
  cutPitch = 0;
  cutZoom = 1;
  cutPan = 0;
  /** Cutaway: the tapped space (interior.ts), or null. */
  selected: string | null = null;
  /** Control room: the station (index in `STATION_ORDER`) and the look turned from its own direction [rad]. */
  station = 0;
  controlYaw = 0;
  controlPitch = 0;
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
    if (mode === 'control') {
      this.controlYaw = 0;
      this.controlPitch = 0;
    }
    for (const fn of this.listeners) fn(mode);
  }

  /** Next available view after the present one. */
  cycle(available: Record<ViewMode, boolean>): void {
    const order: ViewMode[] = ['external', 'bridge', 'periscope', 'control', 'cutaway'];
    let i = order.indexOf(this.mode);
    for (let k = 0; k < order.length; k++) {
      i = (i + 1) % order.length;
      if (available[order[i]!]) break;
    }
    this.set(order[i]!);
  }

  /** Control room: the next (or previous) station, looking its own way. */
  nextStation(dir: 1 | -1 = 1): void {
    const n = STATION_ORDER.length;
    this.goToStation(STATION_ORDER[(((this.station + dir) % n) + n) % n]!);
  }

  /** Control room: a station by its id, looking its own way. */
  goToStation(id: StationId): void {
    this.station = Math.max(0, STATION_ORDER.indexOf(id));
    this.controlYaw = 0;
    this.controlPitch = 0;
    this.notify();
  }

  /** The control room station's name. */
  stationName(): string {
    return STATION_NAME[STATION_ORDER[this.station] ?? 'periscope'];
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
    } else if (this.mode === 'control') {
      this.controlYaw = clamp(this.controlYaw - dx * 0.005, -LOOK_YAW, LOOK_YAW);
      this.controlPitch = clamp(this.controlPitch + dy * 0.005, -LOOK_PITCH, LOOK_PITCH);
    } else if (this.mode === 'cutaway') {
      this.cutYaw = clamp(this.cutYaw - dx * 0.005, -CUT_YAW_LIMIT, CUT_YAW_LIMIT);
      this.cutPitch = clamp(this.cutPitch + dy * 0.005, -CUT_PITCH_LIMIT, CUT_PITCH_LIMIT);
    }
  }

  /** Advances held-key training by dt [s] of real time. */
  update(dt: number): void {
    if (this.mode !== 'periscope' || this.trainDir === 0) {
      this.trainHeld = 0;
      return;
    }
    const rate = TRAIN_RATE * (PERISCOPE_ZOOM[this.zoom]!.fov / 32) * trainRateFactor(this.trainHeld);
    this.trainHeld += dt;
    this.periscopeBearing = wrap(this.periscopeBearing + this.trainDir * rate * dt);
  }

  /** The camera description for the renderer. `speed` [m/s] shakes a raised periscope. */
  camera(speed: number, vibrationSpeed: number): CameraView {
    if (this.mode === 'bridge') return { mode: 'bridge', yaw: this.bridgeYaw, pitch: this.bridgePitch };
    if (this.mode === 'periscope') {
      const shake = Math.max(0, Math.abs(speed) - vibrationSpeed) * 2;
      return { mode: 'periscope', bearing: this.periscopeBearing, fov: PERISCOPE_ZOOM[this.zoom]!.fov, shake };
    }
    if (this.mode === 'control') return { mode: 'control', station: this.station, yaw: this.controlYaw, pitch: this.controlPitch };
    if (this.mode === 'cutaway') return { mode: 'cutaway', plan: this.cutPlan, yaw: this.cutYaw, pitch: this.cutPitch, zoom: this.cutZoom, pan: this.cutPan };
    return { mode: 'external' };
  }
}

/** Which views can be shown now. */
export function availableViews(ctrl: Controller): Record<ViewMode, boolean> {
  return { external: true, bridge: ctrl.bridgeManned, periscope: ctrl.sim.actuators.periscope >= 0.99, control: true, cutaway: true };
}

/**
 * Pointer input on the 3D view: drags turn the bridge look, train the
 * periscope, look round the control room or turn the cutaway (the orbit
 * controls are off in those views). In the cutaway a wheel or a two-finger
 * pinch zooms. In the cutaway and the control room a tap (a press that
 * hardly moves) calls `onTap` with the screen point.
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
    if (p && e.type === 'pointerup' && (views.mode === 'cutaway' || views.mode === 'control') && Math.hypot(e.clientX - p.x0, e.clientY - p.y0) < 6) onTap?.(e.clientX, e.clientY);
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
  const before = views.mode;
  views.cycle(available);
  // The periscope on its way up was passed over: say that its view opens by itself once it is up.
  const order: ViewMode[] = ['external', 'bridge', 'periscope', 'control', 'cutaway'];
  const passed = order.indexOf(before) < order.indexOf('periscope') && order.indexOf(views.mode) > order.indexOf('periscope');
  if (passed && sim.commands.periscopeUp && !available.periscope) ctrl.addLog(PERISCOPE_RISING, 'info');
}

/** Said when the view cycle passes the periscope while it is being raised. */
export const PERISCOPE_RISING = 'Periskopet hissas. Vyn öppnas när det är uppe.';

/** True bearing [deg] the bridge look or the periscope points at. */
export function viewBearing(ctrl: Controller, views: ViewState): number {
  const rel = views.mode === 'bridge' ? views.bridgeYaw : views.mode === 'periscope' ? views.periscopeBearing : 0;
  const deg = ((ctrl.sim.kinematics().heading + rel) * 180) / Math.PI;
  return ((deg % 360) + 360) % 360;
}

/** C: into the cutaway, or back to the external view (Vy also reaches it, as the last view in the cycle). */
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

/**
 * Icons for the view buttons (24 × 24, drawn with the text colour): an eye for
 * Vy, a periscope, a snorkel drawing air, a folded chart and sonar arcs.
 */
const ICONS = {
  view: '<path d="M2 12s3.6-6 10-6 10 6 10 6-3.6 6-10 6S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  periscope: '<path d="M10 21V6a2 2 0 0 1 2-2h6v4h-4v13"/><path d="M3 16c1.5-1.2 3-1.2 4.5 0s3 1.2 4.5 0 3-1.2 4.5 0 3 1.2 4.5 0"/>',
  snorkel: '<path d="M11 21V9a4 4 0 0 1 8 0v1"/><path d="M5 3v5m-2-2 2 2 2-2"/><path d="M3 16c1.5-1.2 3-1.2 4.5 0s3 1.2 4.5 0 3-1.2 4.5 0 3 1.2 4.5 0"/>',
  chart: '<path d="M3 6l6-2 6 2 6-2v14l-6 2-6-2-6 2z"/><path d="M9 4v14M15 6v14"/>',
  sonar: '<circle cx="5" cy="19" r="1.5"/><path d="M5 13a6 6 0 0 1 6 6M5 8a11 11 0 0 1 11 11M5 3a16 16 0 0 1 16 16"/>',
  radar: '<path d="M12 21V11"/><path d="M5 7.5c4.5-3 9.5-3 14 0L12 11z"/><path d="M3 16c1.5-1.2 3-1.2 4.5 0s3 1.2 4.5 0 3-1.2 4.5 0 3 1.2 4.5 0"/>',
} as const;
const icon = (k: keyof typeof ICONS) => `<svg viewBox="0 0 24 24" aria-hidden="true">${ICONS[k]}</svg>`;
/** The buttons that move to the dock on computers (`dock`, a column at the right edge), in their order there. */
const DOCKED = ['view', 'chart', 'sonar', 'periscope', 'snorkel', 'radar'] as const;

/**
 * Buttons for the views next to the menu button (mouse and touch), and Karta
 * and Sonar. On phones (style.css) only "Vyer ▾" shows; it folds the others
 * out, and a choice folds them in. On computers Vy, Per, Snork, the radar mast, Karta and
 * Sonar (icons) go to `dock`, between the telegraph and the course; Zoom,
 * Brg, Ovan and Hela stay at the top right, where they follow the view.
 */
export function bindViewButtons(
  root: HTMLElement,
  getCtrl: () => Controller | null,
  views: ViewState,
  nav?: NavSwitch,
  dock?: HTMLElement,
): (ctrl: Controller) => void {
  root.innerHTML = `
    <button type="button" data-v="menu" class="views-menu" title="Vyer, sjökort och sonar" aria-label="Vyer, sjökort och sonar" aria-expanded="false">Vyer ▾</button>
    <button type="button" data-v="view" class="icon" title="Byt vy (V)" aria-label="Byt vy">${icon('view')}</button>
    <button type="button" data-v="periscope" class="icon" title="Periskop upp/ned (P)" aria-label="Periskop upp eller ned">${icon('periscope')}</button>
    <button type="button" data-v="snorkel" class="icon" title="Snorkel upp/ned (N)" aria-label="Snorkel upp eller ned">${icon('snorkel')}</button>
    <button type="button" data-v="radar" class="icon" title="Radarmast upp/ned (Y): radarvarnaren lyssnar när den är uppe" aria-label="Radarmast upp eller ned">${icon('radar')}</button>
    <button type="button" data-v="zoom" title="Förstoring (Z)" aria-label="Förstoring">Zoom</button>
    <button type="button" data-v="bearing" title="Rapportera bäringen (B)" aria-label="Rapportera bäringen">Brg</button>
    <button type="button" data-v="plan" title="Snittet från sidan eller ovanifrån (Z)" aria-label="Snittet från sidan eller ovanifrån">Ovan</button>
    <button type="button" data-v="whole" title="Hela ubåten" aria-label="Visa hela ubåten">Hela</button>
    <button type="button" data-v="station" title="Nästa plats i manöverrummet (←/→)" aria-label="Nästa plats i manöverrummet">Plats</button>
    <button type="button" data-v="chart" class="icon" title="Sjökortet (K)" aria-label="Sjökortet">${icon('chart')}</button>
    <button type="button" data-v="sonar" class="icon" title="Sonaren (H)" aria-label="Sonaren">${icon('sonar')}</button>`;
  const all = [...root.querySelectorAll<HTMLButtonElement>('button')];
  const view = root.querySelector<HTMLButtonElement>('[data-v="view"]')!;
  const per = root.querySelector<HTMLButtonElement>('[data-v="periscope"]')!;
  const zoom = root.querySelector<HTMLButtonElement>('[data-v="zoom"]')!;
  const snork = root.querySelector<HTMLButtonElement>('[data-v="snorkel"]')!;
  const radarBtn = root.querySelector<HTMLButtonElement>('[data-v="radar"]')!;
  const brg = root.querySelector<HTMLButtonElement>('[data-v="bearing"]')!;
  const plan = root.querySelector<HTMLButtonElement>('[data-v="plan"]')!;
  const whole = root.querySelector<HTMLButtonElement>('[data-v="whole"]')!;
  const station = root.querySelector<HTMLButtonElement>('[data-v="station"]')!;
  const chartBtn = root.querySelector<HTMLButtonElement>('[data-v="chart"]')!;
  const sonarBtn = root.querySelector<HTMLButtonElement>('[data-v="sonar"]')!;
  chartBtn.hidden = sonarBtn.hidden = !nav;
  /** Whether the boat is too deep for the periscope and the bridge. */
  let deep = false;
  const sync = () => {
    zoom.hidden = views.mode !== 'periscope';
    brg.hidden = views.mode !== 'bridge' && views.mode !== 'periscope';
    const inCut = views.mode === 'cutaway';
    view.classList.toggle('on', views.mode !== 'external');
    plan.hidden = !inCut;
    whole.hidden = !inCut;
    station.hidden = views.mode !== 'control';
    plan.textContent = views.cutPlan === 'side' ? 'Ovan' : 'Sida';
    per.hidden = deep;
    snork.hidden = deep;
    radarBtn.hidden = deep;
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
  // Computers: the view buttons in the column at the right edge; phones: all under Vyer ▾, in their order.
  const place = () => {
    if (!dock) return;
    if (isCompact()) root.append(...all);
    else for (const v of DOCKED) dock.append(all.find((b) => b.dataset.v === v)!);
  };
  place();
  try {
    window.matchMedia?.(COMPACT_QUERY).addEventListener?.('change', place);
  } catch {
    // No media queries (tests): the first placement stays.
  }
  const onClick = (e: Event) => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-v]');
    if (b?.dataset.v === 'menu') {
      fold(!root.classList.contains('open'));
      return;
    }
    fold(false);
    if (b?.dataset.v === 'chart' || b?.dataset.v === 'sonar') {
      nav?.toggle(b.dataset.v);
      sync();
      return;
    }
    const ctrl = getCtrl();
    if (!b || !ctrl) return;
    if (b.dataset.v === 'plan') views.toggleCutPlan();
    else if (b.dataset.v === 'whole') views.resetCut();
    else if (b.dataset.v === 'view') cycleView(ctrl, views, 'touch');
    else if (b.dataset.v === 'periscope') togglePeriscope(ctrl, 'touch');
    else if (b.dataset.v === 'snorkel') ctrl.submit({ kind: 'snorkel', up: !ctrl.sim.commands.snorkelUp }, 'touch');
    else if (b.dataset.v === 'radar') ctrl.submit({ kind: 'radarMast', up: !ctrl.sim.commands.radarUp }, 'touch');
    else if (b.dataset.v === 'bearing') reportViewBearing(ctrl, views, 'touch');
    else if (b.dataset.v === 'station') views.nextStation(1);
    else views.toggleZoom();
  };
  root.addEventListener('click', onClick);
  dock?.addEventListener('click', onClick);
  /**
   * Call ~10 times a second. The buttons follow the situation: Per and Snork
   * are hidden below PERISCOPE_BUTTON_DEPTH with the masts housed. Vy always
   * shows: deep it switches between the external view and the cutaway.
   */
  return (ctrl) => {
    const k = ctrl.sim.kinematics();
    const next = k.depth > PERISCOPE_BUTTON_DEPTH && ctrl.sim.actuators.periscope < 0.01 && ctrl.sim.actuators.snorkel < 0.01 && ctrl.sim.actuators.radar < 0.01;
    // The masts that are up light their buttons.
    per.classList.toggle('on', ctrl.sim.commands.periscopeUp);
    snork.classList.toggle('on', ctrl.sim.commands.snorkelUp);
    radarBtn.classList.toggle('on', ctrl.sim.commands.radarUp);
    // The chart and the sonar may also open with K and H.
    const navChanged = chartBtn.classList.contains('on') !== (nav?.mode() === 'chart') || sonarBtn.classList.contains('on') !== (nav?.mode() === 'sonar');
    if (next !== deep || navChanged) {
      deep = next;
      sync();
    }
  };
}

/** The periscope and view buttons show above this CO depth [m]. */
export const PERISCOPE_BUTTON_DEPTH = 25;
