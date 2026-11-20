/**
 * Camera views: external (orbit), the open bridge and the periscope. The
 * view is player state, not simulation state: it never changes the boat.
 * Raising and lowering the periscope and manning the bridge are orders.
 *
 * Availability:
 *   bridge    – the bridge is manned (surfaced)
 *   periscope – the mast is fully raised
 */
import type { Controller } from '../control/controller';
import type { OrderSource } from '../control/orders';
import type { CameraView } from '../render/scene';

export type ViewMode = 'external' | 'bridge' | 'periscope';

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

export const VIEW_NAME: Record<ViewMode, string> = { external: 'Yttre vy', bridge: 'Bryggan', periscope: 'Periskop' };

export class ViewState {
  mode: ViewMode = 'external';
  bridgeYaw = 0;
  bridgePitch = 0;
  /** Periscope bearing relative to the bow [rad], positive to starboard. */
  periscopeBearing = 0;
  zoom = 0;
  /** −1, 0 or +1 while a training key is held. */
  trainDir = 0;
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
    const order: ViewMode[] = ['external', 'bridge', 'periscope'];
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

  /** Turns the periscope or the bridge look by a pointer drag [px]. */
  drag(dx: number, dy: number): void {
    if (this.mode === 'periscope') {
      this.periscopeBearing = wrap(this.periscopeBearing - dx * 0.004 * (PERISCOPE_ZOOM[this.zoom]!.fov / 32));
    } else if (this.mode === 'bridge') {
      this.bridgeYaw = clamp(this.bridgeYaw - dx * 0.005, -BRIDGE_YAW_LIMIT, BRIDGE_YAW_LIMIT);
      this.bridgePitch = clamp(this.bridgePitch + dy * 0.005, -BRIDGE_PITCH_LIMIT, BRIDGE_PITCH_LIMIT);
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
    return { mode: 'external' };
  }
}

/** Which views can be shown now. */
export function availableViews(ctrl: Controller): Record<ViewMode, boolean> {
  return { external: true, bridge: ctrl.bridgeManned, periscope: ctrl.sim.actuators.periscope >= 0.99 };
}

/**
 * Pointer drags on the 3D view turn the bridge look or train the
 * periscope (the orbit controls are off in those views).
 */
export function bindViewPointer(canvas: HTMLElement, views: ViewState): void {
  let last: { x: number; y: number; id: number } | null = null;
  canvas.addEventListener('pointerdown', (e) => {
    if (views.mode === 'external') return;
    last = { x: e.clientX, y: e.clientY, id: e.pointerId };
    canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!last || e.pointerId !== last.id || views.mode === 'external') return;
    views.drag(e.clientX - last.x, e.clientY - last.y);
    last = { x: e.clientX, y: e.clientY, id: e.pointerId };
  });
  const end = () => (last = null);
  canvas.addEventListener('pointerup', end);
  canvas.addEventListener('pointercancel', end);
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const wrap = (a: number) => {
  let x = (a + Math.PI) % (2 * Math.PI);
  if (x < 0) x += 2 * Math.PI;
  return x - Math.PI;
};

/**
 * V / "Vy": next available view. In the simplified simulation the bridge
 * is manned automatically when the boat is surfaced, as "Dyk" clears it.
 */
export function cycleView(ctrl: Controller, views: ViewState, source: OrderSource): void {
  const available = availableViews(ctrl);
  const sim = ctrl.sim;
  // Not while diving: the vents are open.
  const canMan = sim.bodyPointDepth(sim.cfg.bridge.deck) < -0.5 && !sim.tanks.some((t) => t.ventOpen);
  if (views.mode === 'external' && !available.bridge && canMan && ctrl.options.mode === 'simplified') {
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

/** B / "Brg": report the bearing of the cross hair (or the bridge look). */
export function reportViewBearing(ctrl: Controller, views: ViewState, source: OrderSource): void {
  if (views.mode === 'external') return;
  ctrl.submit({ kind: 'reportBearing', bearing: Math.round(viewBearing(ctrl, views)) % 360 }, source);
}

/** P / "Per": raise a housed periscope, lower a raised one. */
export function togglePeriscope(ctrl: Controller, source: OrderSource): void {
  ctrl.submit({ kind: 'periscope', up: !ctrl.sim.commands.periscopeUp }, source);
}

/** Buttons for the views next to the menu button (mouse and touch). */
export function bindViewButtons(root: HTMLElement, getCtrl: () => Controller | null, views: ViewState): void {
  root.innerHTML = `
    <button type="button" data-v="view" title="Byt vy (V)" aria-label="Byt vy">Vy</button>
    <button type="button" data-v="periscope" title="Periskop upp/ned (P)" aria-label="Periskop upp eller ned">Per</button>
    <button type="button" data-v="zoom" title="Förstoring (Z)" aria-label="Förstoring">Zoom</button>
    <button type="button" data-v="bearing" title="Rapportera bäringen (B)" aria-label="Rapportera bäringen">Brg</button>`;
  const zoom = root.querySelector<HTMLButtonElement>('[data-v="zoom"]')!;
  const brg = root.querySelector<HTMLButtonElement>('[data-v="bearing"]')!;
  const sync = () => {
    zoom.hidden = views.mode !== 'periscope';
    brg.hidden = views.mode === 'external';
  };
  sync();
  views.onChange(sync);
  root.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-v]');
    const ctrl = getCtrl();
    if (!b || !ctrl) return;
    if (b.dataset.v === 'view') cycleView(ctrl, views, 'touch');
    else if (b.dataset.v === 'periscope') togglePeriscope(ctrl, 'touch');
    else if (b.dataset.v === 'bearing') reportViewBearing(ctrl, views, 'touch');
    else views.toggleZoom();
  });
}
