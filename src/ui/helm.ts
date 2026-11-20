/**
 * Screen controls for the simplified simulation. Together with the keyboard
 * shortcuts they are the only controls there: the simplified mode has no
 * console. Every control submits ordinary orders with source 'touch'.
 *
 *  - Depth (left thumb): a vertical scale with the present depth, the target,
 *    periscope depth, the sea bed and the safety net's limit. Tap or drag to
 *    choose a target (5 m steps); the order is sent on release. ▲/▼ move the
 *    target 5 m, "13 m" goes to periscope depth.
 *  - Course (right thumb): a compass band ±60° around the heading. Tap or
 *    drag to choose a course (5° steps), sent on release. ◀/▶ turn 10°, and
 *    "Mot bojen" steers for the scenario's buoy.
 *  - Speed (centre): an engine-order telegraph, full astern to full ahead.
 *  - Context buttons: one Dyk/Yta button that follows the ballast, and Håll.
 *
 * The mappings between screen position and depth or bearing are pure
 * functions (exported for the tests); drawing uses a 2D canvas when there is one.
 */
import type { Controller } from '../control/controller';
import { HELM_MAX_DEPTH, PERISCOPE_DEPTH, TELEGRAPH } from '../control/gameMode';
import type { Telemetry } from '../sim/simulation';
import { h } from './dom';
import type { InputModeState } from './inputMode';
import { submitDive } from './keyboard';
import { makeButton, type TouchButton } from './touch';

const DEG = 180 / Math.PI;

// ------------------------------------------------------------- mappings

/**
 * Depth scale: fraction 0…1 from the top for a depth. The scale is a square
 * root, so the shallow water where the boat dives and surfaces gets room.
 */
export const depthToFraction = (depth: number): number => Math.sqrt(Math.max(0, Math.min(HELM_MAX_DEPTH, depth)) / HELM_MAX_DEPTH);

/** The depth target for a fraction of the scale: 5 m steps, periscope depth when close to it. */
export function fractionToDepth(f: number): number {
  const d = HELM_MAX_DEPTH * Math.max(0, Math.min(1, f)) ** 2;
  if (Math.abs(d - PERISCOPE_DEPTH) < 3) return PERISCOPE_DEPTH;
  return Math.min(HELM_MAX_DEPTH, Math.round(d / 5) * 5);
}

/** Half the compass band's width [deg]. */
export const BAND_HALF_WIDTH = 60;

/** The bearing [deg, 0–359] under a fraction 0…1 across the compass band centred on `centre` [deg], in 5° steps. */
export function bandBearing(f: number, centre: number): number {
  const b = centre + (Math.max(0, Math.min(1, f)) - 0.5) * 2 * BAND_HALF_WIDTH;
  return ((Math.round(b / 5) * 5) % 360 + 360) % 360;
}

/** Where a bearing [deg] lies across the band centred on `centre`: 0…1, or null outside it. */
export function bandFraction(bearing: number, centre: number): number | null {
  const d = ((bearing - centre + 540) % 360) - 180;
  return Math.abs(d) > BAND_HALF_WIDTH ? null : 0.5 + d / (2 * BAND_HALF_WIDTH);
}

const bearing3 = (b: number) => String(Math.round(((b % 360) + 360) % 360) % 360).padStart(3, '0');
const COMPASS_POINTS: Record<number, string> = { 0: 'N', 45: 'NO', 90: 'O', 135: 'SO', 180: 'S', 225: 'SV', 270: 'V', 315: 'NV' };

/** True bearing [deg] from the boat to a point. */
const bearingTo = (t: Telemetry, p: [number, number]) => ((Math.atan2(p[1] - t.position[1], p[0] - t.position[0]) * DEG) + 360) % 360;

// ------------------------------------------------------------- drawing

interface Colors {
  text: string;
  muted: string;
  accent: string;
  warn: string;
  error: string;
  water: string;
  seabed: string;
}

function colors(el: Element): Colors {
  const cs = getComputedStyle(el);
  const v = (name: string, fallback: string) => cs.getPropertyValue(name).trim() || fallback;
  return {
    text: v('--text', '#d8f1ff'),
    muted: v('--muted', '#7fa3b8'),
    accent: v('--accent', '#5fd3ff'),
    warn: v('--warn', '#ffd166'),
    error: v('--error', '#ff6b6b'),
    water: 'rgba(40, 120, 170, 0.25)',
    seabed: 'rgba(150, 110, 70, 0.55)',
  };
}

/**
 * The CSS size of each canvas, kept by a ResizeObserver: reading clientWidth
 * during an update would force a layout right after the panel's text changed.
 */
const sizes = new WeakMap<Element, { w: number; h: number }>();
const observer =
  typeof ResizeObserver === 'undefined'
    ? null
    : new ResizeObserver((entries) => {
        for (const e of entries) sizes.set(e.target, { w: e.contentRect.width, h: e.contentRect.height });
      });
const sizeOf = (el: Element) => sizes.get(el) ?? { w: 0, h: 0 };

/** A 2D context sized to the canvas's CSS box at device resolution, or null (no canvas support or no size yet). */
function canvas2d(canvas: HTMLCanvasElement): CanvasRenderingContext2D | null {
  let ctx: CanvasRenderingContext2D | null;
  try {
    ctx = canvas.getContext('2d');
  } catch {
    return null;
  }
  if (!ctx) return null;
  const dpr = window.devicePixelRatio || 1;
  const size = sizeOf(canvas);
  const w = Math.round(size.w * dpr);
  const hgt = Math.round(size.h * dpr);
  if (w === 0 || hgt === 0) return null;
  if (canvas.width !== w || canvas.height !== hgt) {
    canvas.width = w;
    canvas.height = hgt;
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, size.w, size.h);
  return ctx;
}

// ------------------------------------------------------------- dragging

/**
 * Tap-or-drag on an element: `pick` maps the pointer to a value shown while
 * the finger is down; `commit` gets the value on release. Cancelled drags
 * send nothing.
 */
function bindDrag<T>(el: HTMLElement, pick: (fx: number, fy: number) => T, preview: (v: T | null) => void, commit: (v: T) => void, onStart?: () => void): void {
  let active = false;
  let value: T | null = null;
  const at = (e: PointerEvent) => {
    const r = el.getBoundingClientRect();
    const fx = r.width > 0 ? (e.clientX - r.left) / r.width : 0.5;
    const fy = r.height > 0 ? (e.clientY - r.top) / r.height : 0.5;
    value = pick(fx, fy);
    preview(value);
  };
  el.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    active = true;
    onStart?.();
    try {
      el.setPointerCapture?.(e.pointerId);
    } catch {
      // Synthetic events (tests) have no active pointer to capture.
    }
    at(e);
  });
  el.addEventListener('pointermove', (e) => {
    if (active) at(e);
  });
  el.addEventListener('pointerup', () => {
    if (!active) return;
    active = false;
    if (value !== null) commit(value);
    value = null;
    preview(null);
  });
  el.addEventListener('pointercancel', () => {
    active = false;
    value = null;
    preview(null);
  });
}

// ------------------------------------------------------------- the helm

export interface HelmContext {
  ctrl: Controller;
  /** The scenario's buoy [north, east], if any. */
  waypoint: [number, number] | null;
}

/**
 * Builds the simplified mode's screen controls in `root`. `getCtx` returns
 * null while no game is running (presses are then ignored). Returns the
 * update function, to call with fresh telemetry ~10 times a second.
 */
export function createHelm(root: HTMLElement, getCtx: () => HelmContext | null, mode: InputModeState): (t: Telemetry, ctx: HelmContext) => void {
  const submit = (fn: (c: Controller) => void) => {
    const ctx = getCtx();
    if (ctx) fn(ctx.ctrl);
  };
  const fire = (b: TouchButton) => {
    const ctx = getCtx();
    if (ctx && b.order) ctx.ctrl.submit(b.order, 'touch');
    if (ctx && b.run) b.run(ctx.ctrl);
  };
  const button = (b: TouchButton) => makeButton(b, fire, mode);
  let last: { t: Telemetry; ctx: HelmContext } | null = null;
  // The theme colours, read once: getComputedStyle forces a style recalculation.
  let palette: Colors | null = null;
  const pal = () => (palette ??= colors(root));
  // What each canvas last showed: it is redrawn only when that changes.
  let depthKey = '';
  let bandKey = '';
  const redraw = () => {
    if (last) update(last.t, last.ctx);
  };

  // Depth.
  const depthReadout = h('div', { class: 'helm-readout' });
  const depthCanvas = h('canvas', { class: 'helm-depth-scale', 'aria-label': 'Djupskala: tryck eller dra för att välja djup' });
  let depthPreview: number | null = null;
  bindDrag(
    depthCanvas,
    (_fx, fy) => fractionToDepth(fy),
    (v) => {
      depthPreview = v;
      redraw();
    },
    (depth) => submit((c) => c.submit({ kind: 'setDepth', depth }, 'touch')),
  );
  const depthGroup = h(
    'div',
    { class: 'helm-group helm-depth' },
    h('div', { class: 'touch-label' }, 'Djup'),
    depthReadout,
    h(
      'div',
      { class: 'helm-depth-row' },
      depthCanvas,
      h(
        'div',
        { class: 'helm-depth-btns' },
        button({ label: '▲', title: 'Djup 5 m grundare', order: { kind: 'adjustDepth', deltaMetres: -5 }, repeat: true }),
        button({ label: '▼', title: 'Djup 5 m djupare', order: { kind: 'adjustDepth', deltaMetres: 5 }, repeat: true }),
        button({ label: `${PERISCOPE_DEPTH} m`, title: `Periskopdjup, ${PERISCOPE_DEPTH} m`, order: { kind: 'setDepth', depth: PERISCOPE_DEPTH }, className: 'helm-small' }),
      ),
    ),
  );

  // Course.
  const courseReadout = h('div', { class: 'helm-readout' });
  const band = h('canvas', { class: 'helm-band', 'aria-label': 'Kompass: tryck eller dra för att välja kurs' });
  let bandCentre = 0;
  let coursePreview: number | null = null;
  bindDrag(
    band,
    (fx) => bandBearing(fx, bandCentre),
    (v) => {
      coursePreview = v;
      redraw();
    },
    (heading) => submit((c) => c.submit({ kind: 'setHeading', heading }, 'touch')),
    // Freeze the band while the finger is down, so the target does not slide as the boat turns.
    () => {
      if (last) bandCentre = last.t.heading * DEG;
    },
  );
  const buoyBtn = button({
    label: 'Mot bojen',
    title: 'Styr mot den gula bojen',
    className: 'helm-small helm-buoy',
    run: (c) => {
      const ctx = getCtx();
      if (!ctx?.waypoint) return;
      c.submit({ kind: 'setHeading', heading: Math.round(bearingTo(c.sim.telemetry(), ctx.waypoint)) % 360 }, 'touch');
    },
  });
  const courseGroup = h(
    'div',
    { class: 'helm-group helm-course' },
    h('div', { class: 'touch-label' }, 'Kurs'),
    courseReadout,
    h(
      'div',
      { class: 'touch-row helm-band-row' },
      button({ label: '◀', title: 'Kurs 10° babord', order: { kind: 'adjustHeading', deltaDegrees: -10 }, repeat: true }),
      band,
      button({ label: '▶', title: 'Kurs 10° styrbord', order: { kind: 'adjustHeading', deltaDegrees: 10 }, repeat: true }),
    ),
    buoyBtn,
  );

  // Telegraph.
  const speedReadout = h('div', { class: 'helm-readout' });
  const bells = TELEGRAPH.map((b) => {
    const el = button({ label: b.label, title: b.name, order: { kind: 'setSpeed', knots: b.knots }, className: `helm-bell${b.knots < 0 ? ' astern' : b.knots === 0 ? ' stop' : ''}` });
    return { bell: b, el };
  });
  const telegraph = h(
    'div',
    { class: 'helm-group helm-telegraph' },
    h('div', { class: 'helm-telegraph-head' }, h('span', { class: 'astern' }, '◀ Back'), speedReadout, h('span', null, 'Fram ▶')),
    h('div', { class: 'touch-row' }, ...bells.map((b) => b.el)),
  );

  // Context buttons.
  let ballastAction: 'dive' | 'surface' = 'dive';
  const ballastBtn = button({
    label: 'Dyk',
    title: 'Dyk: fyll huvudballasten',
    className: 'helm-ballast',
    run: (c) => (ballastAction === 'dive' ? submitDive(c, 'touch') : c.submit({ kind: 'surface' }, 'touch')),
  });
  const holdBtn = button({ label: 'Håll', title: 'Håll nuvarande kurs och djup', order: { kind: 'holdCourse' } });
  const context = h('div', { class: 'touch-row helm-context' }, ballastBtn, holdBtn);

  const centre = h('div', { class: 'helm-centre' }, context, telegraph);
  root.replaceChildren(depthGroup, centre, courseGroup);
  observer?.observe(depthCanvas);
  observer?.observe(band);

  function update(t: Telemetry, ctx: HelmContext): void {
    last = { t, ctx };
    const c = ctx.ctrl;
    const depth = t.depth;
    const heading = t.heading * DEG;

    // Readouts.
    const depthTarget = depthPreview ?? (c.ap.depth ? (c.surfaceHold ? 0 : c.setpoints.depth) : null);
    setText(depthReadout, `${Math.round(depth)} m${depthTarget !== null ? ` → ${depthTarget === 0 && depthPreview === null ? 'yta' : `${depthTarget} m`}` : ''}`);
    const courseTarget = coursePreview ?? (c.ap.heading ? c.setpoints.heading : null);
    setText(courseReadout, `${bearing3(heading)}°${courseTarget !== null ? ` → ${bearing3(courseTarget)}°` : ''}`);
    const order = c.ap.speed ? c.setpoints.speed : null;
    const bell = order === null ? null : TELEGRAPH.find((b) => Math.abs(b.knots - order) < 0.01);
    setText(speedReadout, order === null ? '' : bell ? bell.name : order < 0 ? `Back ${fmt(-order)} kn` : `${fmt(order)} kn`);

    // Telegraph: the ordered bell lit; a speed between two bells marks both neighbours.
    const above = order === null || bell ? undefined : TELEGRAPH.find((x) => x.knots > order)?.knots;
    const below = order === null || bell ? undefined : [...TELEGRAPH].reverse().find((x) => x.knots < order)?.knots;
    for (const b of bells) {
      const on = order !== null && Math.abs(b.bell.knots - order) < 0.01;
      b.el.classList.toggle('on', on);
      b.el.classList.toggle('near', b.bell.knots === above || b.bell.knots === below);
      b.el.setAttribute('aria-pressed', String(on));
    }

    // Dyk/Yta follows the main ballast: while it floods (vents open) or is mostly
    // full the button surfaces; while it is blown or mostly empty it dives.
    const mbt = t.tanks.filter((x) => x.kind === 'mainBallast');
    const fill = mbt.reduce((s, x) => s + x.fill, 0) / Math.max(1, mbt.length);
    const blowing = mbt.some((x) => x.blowOpen);
    const flooding = mbt.some((x) => x.ventOpen);
    ballastAction = blowing ? 'dive' : flooding || fill >= 0.5 ? 'surface' : 'dive';
    setText(ballastBtn, ballastAction === 'dive' ? 'Dyk' : 'Yta');
    const title = ballastAction === 'dive' ? 'Dyk: fyll huvudballasten' : 'Ytläge: blås huvudballasten';
    if (ballastBtn.title !== title) {
      ballastBtn.title = title;
      ballastBtn.setAttribute('aria-label', title);
    }

    buoyBtn.hidden = ctx.waypoint === null;
    if (coursePreview === null) bandCentre = heading;

    drawDepth(t, c, depthTarget);
    drawBand(t, heading, courseTarget, ctx.waypoint);
  }

  function drawDepth(t: Telemetry, c: Controller, target: number | null): void {
    const limit = c.options.safetyNet ? c.assist.depthLimit() : HELM_MAX_DEPTH;
    // Rounded to about a pixel: the scale is ~0.7 px/m at 30 m and coarser below.
    const size = sizeOf(depthCanvas);
    const key = `${size.w}x${size.h} ${Math.round(t.depth * 2)} ${target} ${depthPreview !== null} ${Math.round(t.seabedDepth)} ${limit}`;
    if (key === depthKey) return;
    depthKey = key;
    const g = canvas2d(depthCanvas);
    if (!g) return;
    const col = pal();
    const { w, h: H } = size;
    const y = (d: number) => depthToFraction(d) * H;
    g.fillStyle = col.water;
    g.fillRect(0, 0, w, H);
    // Sea bed.
    if (t.seabedDepth < HELM_MAX_DEPTH) {
      g.fillStyle = col.seabed;
      g.fillRect(0, y(t.seabedDepth), w, H - y(t.seabedDepth));
    }
    // Safety-net limit.
    {
      const lim = limit;
      if (lim < HELM_MAX_DEPTH) {
        g.strokeStyle = col.error;
        g.setLineDash([3, 3]);
        g.beginPath();
        g.moveTo(0, y(lim));
        g.lineTo(w, y(lim));
        g.stroke();
        g.setLineDash([]);
      }
    }
    // Ticks.
    g.font = '9px system-ui, sans-serif';
    g.textBaseline = 'middle';
    for (const d of [10, 25, 50, 100, 200]) {
      g.fillStyle = col.muted;
      g.fillRect(0, y(d), 5, 1);
      g.fillText(String(d), 7, y(d));
    }
    // Periscope depth.
    g.fillStyle = col.accent;
    g.fillRect(w - 6, y(PERISCOPE_DEPTH) - 1, 6, 2);
    // Present depth.
    g.fillStyle = col.text;
    g.fillRect(0, y(t.depth) - 1, w, 2);
    // Target.
    if (target !== null) {
      const ty = y(target);
      g.fillStyle = depthPreview !== null ? col.warn : col.accent;
      g.beginPath();
      g.moveTo(w, ty);
      g.lineTo(w - 10, ty - 6);
      g.lineTo(w - 10, ty + 6);
      g.closePath();
      g.fill();
    }
  }

  function drawBand(t: Telemetry, heading: number, target: number | null, waypoint: [number, number] | null): void {
    const buoy = waypoint ? Math.round(bearingTo(t, waypoint) * 2) : null;
    // Rounded to about a pixel: the band is ~2 px per degree.
    const size = sizeOf(band);
    const key = `${size.w}x${size.h} ${Math.round(heading * 2)} ${Math.round(bandCentre * 2)} ${target} ${coursePreview !== null} ${buoy}`;
    if (key === bandKey) return;
    bandKey = key;
    const g = canvas2d(band);
    if (!g) return;
    const col = pal();
    const { w, h: H } = size;
    const x = (b: number) => {
      const f = bandFraction(b, bandCentre);
      return f === null ? null : f * w;
    };
    g.fillStyle = col.water;
    g.fillRect(0, 0, w, H);
    g.font = '10px system-ui, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'top';
    const start = Math.ceil((bandCentre - BAND_HALF_WIDTH) / 5) * 5;
    for (let b = start; b <= bandCentre + BAND_HALF_WIDTH; b += 5) {
      const px = x(b);
      if (px === null) continue;
      const n = ((b % 360) + 360) % 360;
      const major = n % 30 === 0 || n % 45 === 0;
      g.fillStyle = major ? col.text : col.muted;
      g.fillRect(px, H - (major ? 10 : 5), 1, major ? 10 : 5);
      if (major) {
        const label = COMPASS_POINTS[n] ?? bearing3(n);
        g.fillStyle = COMPASS_POINTS[n] ? col.text : col.muted;
        g.fillText(label, px, 3);
      }
    }
    // Buoy.
    if (waypoint) {
      const px = x(bearingTo(t, waypoint));
      if (px !== null) {
        g.fillStyle = col.warn;
        g.beginPath();
        g.arc(px, H / 2 + 2, 4, 0, 2 * Math.PI);
        g.fill();
      }
    }
    // Target.
    if (target !== null) {
      const px = x(target);
      if (px !== null) {
        g.fillStyle = coursePreview !== null ? col.warn : col.accent;
        g.beginPath();
        g.moveTo(px, H - 12);
        g.lineTo(px - 6, H);
        g.lineTo(px + 6, H);
        g.closePath();
        g.fill();
      }
    }
    // Lubber line: the present heading.
    const hx = x(heading);
    if (hx !== null) {
      g.fillStyle = col.error;
      g.fillRect(hx - 1, 0, 2, H);
    }
  }

  return update;
}

const fmt = (v: number) => String(Math.round(v * 10) / 10).replace('.', ',');

function setText(el: HTMLElement, text: string): void {
  if (el.textContent !== text) el.textContent = text;
}
