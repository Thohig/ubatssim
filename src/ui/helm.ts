/**
 * The screen controls, always shown in a game. Every control submits
 * ordinary orders with source 'touch'; the keyboard and the console give
 * the same orders. What a control does follows who handles the system
 * (crew.ts): the crew holds targets, the player moves rudder and planes.
 *
 *  - Depth (left thumb), Auto: a vertical scale with the present depth, the
 *    target, periscope depth, the sea bed and the safety net's limit. Tap or
 *    drag to choose a target (5 m steps); the order is sent on release. ▲/▼
 *    move the target 5 m, "13 m" goes to periscope depth.
 *    Hand: a stern-plane gauge (tap or drag for an angle), Upp/Ned 5°, Noll.
 *  - Course (right thumb), Auto: a compass band ±60° around the heading. Tap
 *    or drag to choose a course (5° steps), sent on release. ◀/▶ turn 10°,
 *    and "Mot bojen" steers for the scenario's buoy.
 *    Hand: a rudder gauge, BB/SB 5°, Mitt.
 *  - Speed (centre): an engine-order telegraph, full astern to full ahead.
 *    On phones it is a lever: tap or drag along it, sent on release.
 *  - Dyk/Yta (follows the main ballast), Håll, and the panels Ballast ▾,
 *    Trim ▾, Fart ▾ and El ▾ (battery, snorkel, diesels, leaks) with each
 *    system's state and controls. A button in a
 *    panel takes that system over (as the order does); the panel's header
 *    hands it back to the crew. The panel's tabs switch between the three.
 *
 * Phones (compact layout, compact.ts) show fewer controls: one Auto/Hand
 * chip per axis instead of the switch, and one "System ▾" button for the
 * three panels. Both are in the DOM everywhere; style.css picks.
 *
 * The mappings between screen position and depth or bearing are pure
 * functions (exported for the tests); drawing uses a 2D canvas when there is one.
 */
import type { Controller } from '../control/controller';
import { CREW_NAME, CREW_ROLE, HELM_MAX_DEPTH, LOCK_TEXT, PERISCOPE_DEPTH, TELEGRAPH, type CrewSystem } from '../control/crew';
import { LIMITS } from '../control/parser';
import type { Telemetry } from '../sim/simulation';
import { h } from './dom';
import type { InputModeState } from './inputMode';
import { submitDive } from './keyboard';
import { haptic, makeButton, type ScreenButton } from './button';
import { isCompact } from './compact';

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

/** Rudder or plane angle [deg] under a fraction 0…1 across a gauge (whole degrees, ±max). */
export const gaugeAngle = (f: number, max: number): number => Math.round((Math.max(0, Math.min(1, f)) - 0.5) * 2 * max);

/** The telegraph position (index in TELEGRAPH) under a fraction 0…1 along the lever. */
export const telegraphIndex = (f: number): number => Math.max(0, Math.min(TELEGRAPH.length - 1, Math.floor(Math.max(0, Math.min(1, f)) * TELEGRAPH.length)));

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
function bindDrag<T>(
  el: HTMLElement,
  pick: (fx: number, fy: number) => T,
  preview: (v: T | null) => void,
  commit: (v: T) => void,
  onStart?: () => void,
  enabled: () => boolean = () => true,
): void {
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
    if (!enabled()) return;
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

type Panel = 'ballast' | 'trim' | 'speed' | 'power';
const PANELS: readonly Panel[] = ['ballast', 'trim', 'speed', 'power'];
const PANEL_SYSTEM: Record<Panel, CrewSystem> = { ballast: 'ballast', trim: 'trim', speed: 'speed', power: 'charging' };
const PANEL_TITLE: Record<Panel, string> = { ballast: 'Ballast', trim: 'Trim', speed: 'Fart', power: 'El' };

/**
 * Builds the screen controls in `root`. `getCtx` returns null while no game
 * is running (presses are then ignored). Returns the update function, to
 * call with fresh telemetry ~10 times a second.
 */
export function createHelm(root: HTMLElement, getCtx: () => HelmContext | null, mode: InputModeState): (t: Telemetry, ctx: HelmContext) => void {
  const submit = (fn: (c: Controller) => void) => {
    const ctx = getCtx();
    if (ctx) fn(ctx.ctrl);
  };
  const fire = (b: ScreenButton) => {
    const ctx = getCtx();
    if (ctx && b.order) ctx.ctrl.submit(b.order, 'touch');
    if (ctx && b.run) b.run(ctx.ctrl);
    b.action?.();
  };
  const button = (b: ScreenButton) => makeButton(b, fire, mode);
  /** A button that acts once on press (no repeat), for panels and switches. */
  const tapButton = (label: string, title: string, run: (c: Controller) => void, className = '') =>
    makeButton({ label, title, run, className: `helm-small ${className}` }, fire, mode);
  let last: { t: Telemetry; ctx: HelmContext } | null = null;
  // The theme colours, read once: getComputedStyle forces a style recalculation.
  let palette: Colors | null = null;
  const pal = () => (palette ??= colors(root));
  // What each canvas last showed: it is redrawn only when that changes.
  const keys = new Map<HTMLCanvasElement, string>();
  const changed = (canvas: HTMLCanvasElement, key: string) => {
    if (keys.get(canvas) === key) return false;
    keys.set(canvas, key);
    return true;
  };
  const redraw = () => {
    if (last) update(last.t, last.ctx);
  };

  /**
   * The Auto/Hand switch of an axis: hands the axis to the crew or takes it
   * over. `chip` is the phone version: one button that shows the state and toggles it.
   */
  const axisSwitch = (axis: 'depth' | 'heading') => {
    const auto = tapButton('Auto', `${CREW_NAME[axis]}: besättningen håller målet`, (c) => c.submit({ kind: 'crew', system: axis, crew: true }, 'touch'), 'helm-seg');
    const hand = tapButton('Hand', `${CREW_NAME[axis]}: du styr ${axis === 'depth' ? 'djuprodret' : 'rodret'}`, (c) => c.submit({ kind: 'crew', system: axis, crew: false }, 'touch'), 'helm-seg');
    const el = h('div', { class: 'helm-switch', role: 'group', 'aria-label': `${CREW_NAME[axis]}: Auto eller Hand` }, auto, hand);
    const chip = tapButton('Auto', `${CREW_NAME[axis]}: växla mellan Auto och Hand`, (c) => c.submit({ kind: 'crew', system: axis, crew: !c.duty(axis) }, 'touch'), 'helm-chip');
    return {
      el,
      chip,
      update(c: Controller) {
        const crew = c.duty(axis);
        const lock = c.options.locks[axis];
        auto.classList.toggle('on', crew);
        hand.classList.toggle('on', !crew);
        auto.disabled = lock === false;
        hand.disabled = lock === true;
        const note = lock === undefined ? '' : LOCK_TEXT[axis][lock ? 0 : 1];
        if (el.title !== note) el.title = note;
        setText(chip, crew ? 'Auto' : 'Hand');
        chip.classList.toggle('hand', !crew);
        chip.disabled = lock !== undefined;
      },
    };
  };

  // ---- Depth: target scale (Auto) or stern planes (Hand).
  const depthReadout = h('div', { class: 'helm-readout' });
  const depthSwitch = axisSwitch('depth');
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
  const depthAutoBtns = h(
      'div',
      { class: 'helm-depth-btns' },
      button({ label: '▲', title: 'Djup 5 m grundare', order: { kind: 'adjustDepth', deltaMetres: -5 }, repeat: true }),
      button({ label: '▼', title: 'Djup 5 m djupare', order: { kind: 'adjustDepth', deltaMetres: 5 }, repeat: true }),
      button({ label: `${PERISCOPE_DEPTH} m`, title: `Periskopdjup, ${PERISCOPE_DEPTH} m`, order: { kind: 'setDepth', depth: PERISCOPE_DEPTH }, className: 'helm-small' }),
  );
  const planesGauge = h('canvas', { class: 'helm-depth-scale helm-planes', 'aria-label': 'Djuproder: tryck eller dra för att lägga rodret' });
  let planesPreview: number | null = null;
  bindDrag(
    planesGauge,
    (_fx, fy) => gaugeAngle(fy, LIMITS.maxPlanes),
    (v) => {
      planesPreview = v;
      redraw();
    },
    (angle) => submit((c) => c.submit({ kind: 'planes', angle }, 'touch')),
  );
  const depthHandBtns = h(
    'div',
    { class: 'helm-depth-btns' },
    button({ label: '▲ Upp', title: 'Djuproder 5° upp', order: { kind: 'planes', angle: -5, relative: true }, repeat: true }),
    button({ label: '▼ Ned', title: 'Djuproder 5° ned', order: { kind: 'planes', angle: 5, relative: true }, repeat: true }),
    button({ label: 'Noll', title: 'Djuproder noll', order: { kind: 'planes', angle: 0 }, className: 'helm-small' }),
  );
  // The scale or the plane gauge, and beside it the Auto/Hand switch over the buttons.
  depthSwitch.el.classList.add('vertical');
  const depthGroup = h(
    'div',
    { class: 'helm-group helm-depth' },
    h('div', { class: 'helm-head' }, h('span', { class: 'touch-label' }, 'Djup'), depthReadout, depthSwitch.chip),
    h('div', { class: 'helm-depth-row' }, depthCanvas, planesGauge, h('div', { class: 'helm-depth-side' }, depthSwitch.el, depthAutoBtns, depthHandBtns)),
  );

  // ---- Course: compass band (Auto) or rudder (Hand).
  const courseReadout = h('div', { class: 'helm-readout' });
  const courseSwitch = axisSwitch('heading');
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
  const courseAuto = h(
    'div',
    { class: 'touch-row helm-band-row' },
    button({ label: '◀', title: 'Kurs 10° babord', order: { kind: 'adjustHeading', deltaDegrees: -10 }, repeat: true }),
    band,
    button({ label: '▶', title: 'Kurs 10° styrbord', order: { kind: 'adjustHeading', deltaDegrees: 10 }, repeat: true }),
  );
  const rudderGauge = h('canvas', { class: 'helm-band helm-rudder', 'aria-label': 'Roder: tryck eller dra för att lägga rodret' });
  let rudderPreview: number | null = null;
  bindDrag(
    rudderGauge,
    (fx) => gaugeAngle(fx, LIMITS.maxRudder),
    (v) => {
      rudderPreview = v;
      redraw();
    },
    (angle) => submit((c) => c.submit({ kind: 'rudder', angle }, 'touch')),
  );
  const courseHand = h(
    'div',
    { class: 'touch-row helm-band-row' },
    button({ label: '◀ BB', title: 'Roder 5° babord', order: { kind: 'rudder', angle: -5, relative: true }, repeat: true }),
    rudderGauge,
    button({ label: 'SB ▶', title: 'Roder 5° styrbord', order: { kind: 'rudder', angle: 5, relative: true }, repeat: true }),
  );
  const midBtn = button({ label: 'Mitt', title: 'Roder midskepps', order: { kind: 'rudder', angle: 0 }, className: 'helm-small' });
  const courseBtns = h('div', { class: 'touch-row helm-course-btns' }, buoyBtn, midBtn);
  const courseGroup = h(
    'div',
    { class: 'helm-group helm-course' },
    h('div', { class: 'helm-head' }, h('span', { class: 'touch-label' }, 'Kurs'), courseReadout, courseSwitch.chip, courseSwitch.el),
    courseAuto,
    courseHand,
    courseBtns,
  );

  // ---- Telegraph.
  const speedReadout = h('div', { class: 'helm-readout' });
  const bells = TELEGRAPH.map((b) => {
    const el = button({ label: b.label, title: b.name, order: { kind: 'setSpeed', knots: b.knots }, className: `helm-bell${b.knots < 0 ? ' astern' : b.knots === 0 ? ' stop' : ''}` });
    return { bell: b, el };
  });
  const bellRow = h('div', { class: 'touch-row helm-bells', 'aria-label': 'Maskintelegraf: tryck eller dra för att välja fart' }, ...bells.map((b) => b.el));
  // Phones: the row is a lever. The bells do not take the pointer there (style.css), so tap or drag the row.
  let bellPreview: number | null = null;
  bindDrag(
    bellRow,
    (fx) => telegraphIndex(fx),
    (i) => {
      if (i !== null && i !== bellPreview) haptic();
      bellPreview = i;
      bells.forEach((b, k) => b.el.classList.toggle('preview', k === i));
    },
    (i) => submit((c) => c.submit({ kind: 'setSpeed', knots: TELEGRAPH[i]!.knots }, 'touch')),
    () => {
      if (mode.current === 'console') mode.set('steer');
    },
    isCompact,
  );
  const telegraph = h(
    'div',
    { class: 'helm-group helm-telegraph' },
    h('div', { class: 'helm-telegraph-head' }, h('span', { class: 'astern' }, '◀ Back'), speedReadout, h('span', null, 'Fram ▶')),
    bellRow,
  );

  // ---- Dyk/Yta, Håll and the panel buttons.
  let ballastAction: 'dive' | 'surface' = 'dive';
  const ballastBtn = button({
    label: 'Dyk',
    title: 'Dyk: fyll huvudballasten',
    className: 'helm-ballast',
    run: (c) => (ballastAction === 'dive' ? submitDive(c, 'touch') : c.submit({ kind: 'surface' }, 'touch')),
  });
  const holdBtn = button({ label: 'Håll', title: 'Håll nuvarande kurs och djup', order: { kind: 'holdCourse' } });
  let open: Panel | null = null;
  /** The panel "System ▾" opens: the one last shown. */
  let lastPanel: Panel = 'ballast';
  const panelBtns = PANELS.map((p) => {
    const el = tapButton(`${PANEL_TITLE[p]} ▾`, `${PANEL_TITLE[p]}: visa läget och reglagen`, () => toggle(p), 'helm-panel-btn');
    el.setAttribute('aria-expanded', 'false');
    return { p, el };
  });
  // Phones: one button for the three panels (the tabs switch between them).
  const systemBtn = tapButton('System ▾', 'Ballast, trim, fart och el: visa läget och reglagen', () => toggle(open ? null : lastPanel), 'helm-system');
  systemBtn.setAttribute('aria-expanded', 'false');
  const actions = h(
    'div',
    { class: 'helm-actions' },
    h('div', { class: 'touch-row helm-context' }, ballastBtn, holdBtn, systemBtn),
    h('div', { class: 'touch-row helm-panel-btns' }, ...panelBtns.map((b) => b.el)),
  );

  // ---- Panels.
  const tabs = PANELS.map((p) => {
    const el = h('button', { type: 'button', class: 'helm-tab', role: 'tab', 'aria-selected': 'false' }, PANEL_TITLE[p]);
    el.addEventListener('click', () => {
      if (open !== p) toggle(p);
    });
    return { p, el };
  });
  const panelRole = h('span', { class: 'helm-panel-role' });
  const panelToggle = tapButton('', '', (c) => {
    if (!open) return;
    const sys = PANEL_SYSTEM[open];
    c.submit({ kind: 'crew', system: sys, crew: !c.duty(sys) }, 'touch');
  });
  const closeBtn = h('button', { type: 'button', class: 'helm-panel-close', 'aria-label': 'Stäng' }, '✕');
  closeBtn.addEventListener('click', () => toggle(null));
  const panels = { ballast: ballastPanel(), trim: trimPanel(), speed: speedPanel(), power: powerPanel() };
  const panelEl = h(
    'div',
    { class: 'helm-panel panel', hidden: true },
    h('div', { class: 'helm-panel-head' }, h('div', { class: 'helm-tabs', role: 'tablist' }, ...tabs.map((x) => x.el)), closeBtn),
    h('div', { class: 'helm-panel-crew' }, panelRole, panelToggle),
    ...Object.values(panels).map((x) => x.el),
  );

  function toggle(p: Panel | null): void {
    open = open === p ? null : p;
    if (open) lastPanel = open;
    panelEl.hidden = open === null;
    for (const b of panelBtns) {
      b.el.classList.toggle('open', b.p === open);
      b.el.setAttribute('aria-expanded', String(b.p === open));
    }
    for (const x of tabs) {
      x.el.classList.toggle('on', x.p === open);
      x.el.setAttribute('aria-selected', String(x.p === open));
    }
    systemBtn.classList.toggle('open', open !== null);
    systemBtn.setAttribute('aria-expanded', String(open !== null));
    for (const [k, x] of Object.entries(panels)) x.el.hidden = k !== open;
    redraw();
  }

  /** A labelled level bar. */
  function level(label: string) {
    const text = h('span');
    const fill = h('div', { class: 'fill' });
    const flags = h('span', { class: 'flags' });
    return {
      el: h('div', { class: 'helm-level' }, h('div', { class: 'tank-name' }, h('span', null, label), h('span', null, flags, ' ', text)), h('div', { class: 'bar' }, fill)),
      set(value: string, frac: number, flag = '') {
        setText(text, value);
        setText(flags, flag);
        fill.style.width = `${Math.max(0, Math.min(1, frac)) * 100}%`;
      },
    };
  }

  function ballastPanel() {
    const group = (g: 'fwd' | 'aft' | 'all', label: string) =>
      h(
        'div',
        { class: 'helm-panel-row' },
        h('span', { class: 'helm-panel-label' }, label),
        tapButton('Fyll', `Fyll huvudballast ${label.toLowerCase()}`, (c) => c.submit({ kind: 'mainBallast', action: 'flood', group: g }, 'touch')),
        tapButton('Blås', `Blås huvudballast ${label.toLowerCase()}`, (c) => c.submit({ kind: 'mainBallast', action: 'blow', group: g }, 'touch')),
        tapButton('Stäng', `Stäng huvudballast ${label.toLowerCase()}`, (c) => c.submit({ kind: 'mainBallast', action: 'shut', group: g }, 'touch')),
      );
    const fwd = level('Huvudballast för');
    const aft = level('Huvudballast akter');
    const air = level('HP-luft');
    const bridgeState = h('span', { class: 'helm-panel-label' });
    let manned = false;
    const bridgeBtn = tapButton('', '', (c) => c.submit({ kind: 'bridge', manned: !manned }, 'touch'));
    const el = h(
      'div',
      { class: 'helm-panel-body', hidden: true },
      fwd.el,
      aft.el,
      group('fwd', 'För'),
      group('aft', 'Akter'),
      group('all', 'Båda'),
      h('div', { class: 'helm-panel-row' }, bridgeState, bridgeBtn),
      air.el,
    );
    return {
      el,
      update(t: Telemetry, c: Controller) {
        const tank = (id: string) => t.tanks.find((x) => x.id === id);
        for (const [lv, id] of [
          [fwd, 'mbt_fwd'],
          [aft, 'mbt_aft'],
        ] as const) {
          const x = tank(id);
          if (x) lv.set(`${Math.round(x.fill * 100)} %`, x.fill, x.blowOpen ? 'BLÅS' : x.ventOpen ? 'VENT' : '');
        }
        air.set(`${Math.round(t.airPressure / 1e5)} bar`, t.airPressure / c.sim.cfg.air.bottlePressure);
        manned = c.bridgeManned;
        setText(bridgeState, manned ? 'Bryggan: bemannad' : 'Bryggan: utrymd');
        setText(bridgeBtn, manned ? 'Klart bryggan' : 'Bemanna');
        bridgeBtn.title = manned ? 'Klart bryggan: utrym den före dykning' : 'Bemanna bryggan (bara i ytläge)';
      },
    };
  }

  function trimPanel() {
    const net = h('span', { class: 'helm-panel-value' });
    const pumps = h('span', { class: 'helm-panel-value' });
    const fwd = level('Trimtank för');
    const aft = level('Trimtank akter');
    const comp = level('Kompenseringstank');
    const step = (label: string, title: string, order: (n: number) => Parameters<Controller['submit']>[0], n: number) =>
      tapButton(label, title, (c) => c.submit(order(n), 'touch'));
    const el = h(
      'div',
      { class: 'helm-panel-body', hidden: true },
      h('div', { class: 'helm-panel-row' }, h('span', { class: 'helm-panel-label' }, 'Flytkraft'), net),
      h('div', { class: 'helm-panel-row' }, h('span', { class: 'helm-panel-label' }, 'Pumpar'), pumps),
      comp.el,
      h(
        'div',
        { class: 'helm-panel-row' },
        h('span', { class: 'helm-panel-label' }, 'Kompensera'),
        step('In 100', 'Kompensera in 100 liter', (n) => ({ kind: 'compensate', litres: n }), 100),
        step('In 500', 'Kompensera in 500 liter', (n) => ({ kind: 'compensate', litres: n }), 500),
        step('Ut 100', 'Kompensera ut 100 liter', (n) => ({ kind: 'compensate', litres: -n }), 100),
        step('Ut 500', 'Kompensera ut 500 liter', (n) => ({ kind: 'compensate', litres: -n }), 500),
      ),
      fwd.el,
      aft.el,
      h(
        'div',
        { class: 'helm-panel-row' },
        h('span', { class: 'helm-panel-label' }, 'Trimma'),
        step('För 100', 'Trimma 100 liter förut', (n) => ({ kind: 'trim', litres: n }), 100),
        step('För 500', 'Trimma 500 liter förut', (n) => ({ kind: 'trim', litres: n }), 500),
        step('Akter 100', 'Trimma 100 liter akterut', (n) => ({ kind: 'trim', litres: -n }), 100),
        step('Akter 500', 'Trimma 500 liter akterut', (n) => ({ kind: 'trim', litres: -n }), 500),
      ),
    );
    return {
      el,
      update(t: Telemetry) {
        const kg = t.netBuoyancy / 9.80665;
        const state = t.submergedFraction <= 0.999 ? 'ytläge' : kg < -100 ? 'tung' : kg > 100 ? 'lätt' : 'neutral';
        setText(net, `${kg > 0 ? '+' : ''}${Math.round(kg)} kg · ${state} · stamp ${fmt(t.pitch * DEG)}°`);
        const parts = [
          t.compRemaining !== 0 ? `kompensering ${Math.round(Math.abs(t.compRemaining) * 1000)} l kvar` : '',
          t.trimRemaining !== 0 ? `trim ${Math.round(Math.abs(t.trimRemaining) * 1000)} l kvar` : '',
        ].filter(Boolean);
        setText(pumps, parts.length ? parts.join(' · ') : 'stilla');
        const tank = (id: string) => t.tanks.find((x) => x.id === id);
        for (const [lv, id] of [
          [fwd, 'trim_fwd'],
          [aft, 'trim_aft'],
          [comp, 'comp'],
        ] as const) {
          const x = tank(id);
          if (x) lv.set(`${Math.round(x.water * 1000)} l`, x.fill);
        }
      },
    };
  }

  /** Battery, diesels and snorkel, and the leaks with the drain pump. */
  function powerPanel() {
    const battery = level('Batteri');
    const load = h('span', { class: 'helm-panel-value' });
    const diesel = h('span', { class: 'helm-panel-value' });
    const snorkel = h('span', { class: 'helm-panel-value' });
    const drain = h('span', { class: 'helm-panel-value' });
    const leaks = h('div', { class: 'helm-leaks' });
    const el = h(
      'div',
      { class: 'helm-panel-body', hidden: true },
      battery.el,
      h('div', { class: 'helm-panel-row' }, h('span', { class: 'helm-panel-label' }, 'Last'), load),
      h(
        'div',
        { class: 'helm-panel-row' },
        h('span', { class: 'helm-panel-label' }, 'Snorkel'),
        snorkel,
        tapButton('Upp', 'Hissa snorkeln', (c) => c.submit({ kind: 'snorkel', up: true }, 'touch')),
        tapButton('Ned', 'Sänk snorkeln', (c) => c.submit({ kind: 'snorkel', up: false }, 'touch')),
      ),
      h(
        'div',
        { class: 'helm-panel-row' },
        h('span', { class: 'helm-panel-label' }, 'Diesel'),
        diesel,
        tapButton('Start', 'Starta dieslarna', (c) => c.submit({ kind: 'diesel', on: true }, 'touch')),
        tapButton('Stopp', 'Stoppa dieslarna', (c) => c.submit({ kind: 'diesel', on: false }, 'touch')),
      ),
      h('div', { class: 'helm-panel-row' }, h('span', { class: 'helm-panel-label' }, 'Läns'), drain),
      leaks,
    );
    const leakRows = new Map<string, ReturnType<typeof level>>();
    return {
      el,
      update(t: Telemetry) {
        const p = t.batteryPower;
        battery.set(`${Math.round(t.battery * 100)} %`, t.battery, p < -1000 ? 'LADDAS' : t.battery < 0.15 ? 'LÅGT' : '');
        setText(load, `${Math.round(t.electricalLoad / 1000)} kW${p < -1000 ? ` · laddar ${Math.round(-p / 1000)} kW` : ''}`);
        setText(diesel, t.dieselRunning ? `går, ${Math.round(t.generatorPower / 1000)} kW` : t.dieselOrdered ? 'väntar på luft' : 'stopp');
        setText(
          snorkel,
          t.snorkel > 0.99 ? (t.inductionAir ? 'uppe, luft' : 'uppe, ventilen stängd') : t.snorkel < 0.01 ? 'nere' : `${Math.round(t.snorkel * 100)} %`,
        );
        const wet = t.compartments.filter((x) => x.water > 0.001 || x.holeArea > 0);
        setText(drain, wet.length === 0 ? 'torrt, ingen läcka' : t.drainPumpRunning ? 'länspumpen går' : 'länspumpen orkar inte på det här djupet');
        for (const x of t.compartments) {
          let row = leakRows.get(x.id);
          const show = x.water > 0.001 || x.holeArea > 0;
          if (show && !row) {
            row = level(x.name);
            leakRows.set(x.id, row);
            leaks.append(row.el);
          }
          if (!row) continue;
          row.el.hidden = !show;
          if (show) row.set(`${fmt(x.water)} m³${x.inflow > 0 ? ` · ${Math.round(x.inflow * 1000)} l/s in` : ''}`, x.water / x.volume, x.holeArea > 0 ? 'LÄCKA' : '');
        }
      },
    };
  }

  function speedPanel() {
    const speed = h('span', { class: 'helm-panel-value' });
    const rpm = h('span', { class: 'helm-panel-value' });
    const rpmStep = (delta: number) =>
      tapButton(`Varv ${delta > 0 ? '+' : '−'}${Math.abs(delta)}`, `Propellervarv ${delta > 0 ? '+' : '−'}${Math.abs(delta)} rpm`, (c) => {
        const now = Math.round(c.sim.telemetry().rpsCmd * 60);
        const next = Math.max(-LIMITS.maxRpmAstern, Math.min(LIMITS.maxRpm, now + delta));
        c.submit({ kind: 'setRpm', rpm: next }, 'touch');
      });
    const el = h(
      'div',
      { class: 'helm-panel-body', hidden: true },
      h('div', { class: 'helm-panel-row' }, h('span', { class: 'helm-panel-label' }, 'Fart'), speed),
      h('div', { class: 'helm-panel-row' }, h('span', { class: 'helm-panel-label' }, 'Varv'), rpm),
      h(
        'div',
        { class: 'helm-panel-row' },
        h('span', { class: 'helm-panel-label' }, 'Fartmål'),
        tapButton('−1 knop', 'Fartmål 1 knop lägre', (c) => c.submit({ kind: 'adjustSpeed', deltaKnots: -1 }, 'touch')),
        tapButton('+1 knop', 'Fartmål 1 knop högre', (c) => c.submit({ kind: 'adjustSpeed', deltaKnots: 1 }, 'touch')),
      ),
      h('div', { class: 'helm-panel-row' }, h('span', { class: 'helm-panel-label' }, 'Varv'), rpmStep(-10), rpmStep(10), tapButton('Stopp', 'Propellervarv 0', (c) => c.submit({ kind: 'setRpm', rpm: 0 }, 'touch'))),
    );
    return {
      el,
      update(t: Telemetry) {
        const kn = (t.u * 3600) / 1852;
        setText(speed, kn < -0.05 ? `back ${fmt(-kn)} knop` : `${fmt(Math.max(0, kn))} knop`);
        setText(rpm, `${Math.round(t.rps * 60)} rpm (order ${Math.round(t.rpsCmd * 60)}) · ${Math.round(t.shaftPower / 1000)} kW`);
      },
    };
  }

  const centre = h('div', { class: 'helm-centre' }, actions, telegraph);
  root.replaceChildren(depthGroup, centre, courseGroup, panelEl);
  for (const c of [depthCanvas, band, planesGauge, rudderGauge]) observer?.observe(c);

  function update(t: Telemetry, ctx: HelmContext): void {
    last = { t, ctx };
    const c = ctx.ctrl;
    const depth = t.depth;
    const heading = t.heading * DEG;
    const depthAutoOn = c.ap.depth;
    const headingAutoOn = c.ap.heading;

    // Auto/Hand: which body each group shows.
    depthSwitch.update(c);
    courseSwitch.update(c);
    depthCanvas.hidden = !depthAutoOn;
    depthAutoBtns.hidden = !depthAutoOn;
    planesGauge.hidden = depthAutoOn;
    depthHandBtns.hidden = depthAutoOn;
    courseAuto.hidden = !headingAutoOn;
    courseHand.hidden = headingAutoOn;
    midBtn.hidden = headingAutoOn;
    buoyBtn.hidden = !headingAutoOn || ctx.waypoint === null;
    courseBtns.hidden = buoyBtn.hidden && midBtn.hidden;

    // Readouts.
    const depthTarget = depthPreview ?? (depthAutoOn ? (c.surfaceHold ? 0 : c.setpoints.depth) : null);
    const planesCmd = planesPreview ?? Math.round(t.sternPlanesCmd * DEG);
    setText(
      depthReadout,
      depthAutoOn
        ? `${Math.round(depth)} m${depthTarget !== null ? ` → ${depthTarget === 0 && depthPreview === null ? 'yta' : `${depthTarget} m`}` : ''}`
        : `${Math.round(depth)} m · ${angleText(planesCmd, 'ned', 'upp')}`,
    );
    const courseTarget = coursePreview ?? (headingAutoOn ? c.setpoints.heading : null);
    const rudderCmd = rudderPreview ?? Math.round(t.rudderCmd * DEG);
    setText(
      courseReadout,
      headingAutoOn
        ? `${bearing3(heading)}°${courseTarget !== null ? ` → ${bearing3(courseTarget)}°` : ''}`
        : `${bearing3(heading)}° · ${angleText(rudderCmd, 'SB', 'BB')}`,
    );
    const order = c.ap.speed ? c.setpoints.speed : null;
    const bell = order === null ? null : TELEGRAPH.find((b) => Math.abs(b.knots - order) < 0.01);
    setText(
      speedReadout,
      order === null ? `Varv ${Math.round(t.rpsCmd * 60)}` : bell ? bell.name : order < 0 ? `Back ${fmt(-order)} kn` : `${fmt(order)} kn`,
    );

    // Telegraph: the ordered bell lit; a speed between two bells marks both neighbours.
    const above = order === null || bell ? undefined : TELEGRAPH.find((x) => x.knots > order)?.knots;
    const below = order === null || bell ? undefined : [...TELEGRAPH].reverse().find((x) => x.knots < order)?.knots;
    telegraph.classList.toggle('exact', !!bell);
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
    setTitle(ballastBtn, ballastAction === 'dive' ? 'Dyk: fyll huvudballasten' : 'Ytläge: blås huvudballasten');

    // Panel buttons are marked while the player handles that system.
    for (const b of panelBtns) b.el.classList.toggle('self', !c.duty(PANEL_SYSTEM[b.p]));
    for (const x of tabs) x.el.classList.toggle('self', !c.duty(PANEL_SYSTEM[x.p]));
    systemBtn.classList.toggle('self', panelBtns.some((b) => !c.duty(PANEL_SYSTEM[b.p])));
    if (open) {
      const sys = PANEL_SYSTEM[open];
      const crew = c.duty(sys);
      const lock = c.options.locks[sys];
      setText(panelRole, lock === undefined ? CREW_ROLE[sys][crew ? 0 : 1] : LOCK_TEXT[sys][lock ? 0 : 1]);
      setText(panelToggle, crew ? 'Ta över' : 'Lämna till besättningen');
      setTitle(panelToggle, crew ? `Du tar över: ${CREW_NAME[sys].toLowerCase()}` : `Besättningen tar över: ${CREW_NAME[sys].toLowerCase()}`);
      panelToggle.hidden = lock !== undefined;
      panels[open].update(t, c);
    }

    if (coursePreview === null) bandCentre = heading;
    if (depthAutoOn) drawDepth(t, c, depthTarget);
    else drawGauge(planesGauge, true, planesCmd, t.sternPlanes * DEG, LIMITS.maxPlanes, planesPreview !== null);
    if (headingAutoOn) drawBand(t, heading, courseTarget, ctx.waypoint);
    else drawGauge(rudderGauge, false, rudderCmd, t.rudder * DEG, LIMITS.maxRudder, rudderPreview !== null);
  }

  function drawDepth(t: Telemetry, c: Controller, target: number | null): void {
    const limit = c.options.crew.safetyNet ? c.assist.depthLimit() : HELM_MAX_DEPTH;
    // Rounded to about a pixel: the scale is ~0.7 px/m at 30 m and coarser below.
    const size = sizeOf(depthCanvas);
    if (!changed(depthCanvas, `${size.w}x${size.h} ${Math.round(t.depth * 2)} ${target} ${depthPreview !== null} ${Math.round(t.seabedDepth)} ${limit}`)) return;
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
    if (limit < HELM_MAX_DEPTH) {
      g.strokeStyle = col.error;
      g.setLineDash([3, 3]);
      g.beginPath();
      g.moveTo(0, y(limit));
      g.lineTo(w, y(limit));
      g.stroke();
      g.setLineDash([]);
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
    if (!changed(band, `${size.w}x${size.h} ${Math.round(heading * 2)} ${Math.round(bandCentre * 2)} ${target} ${coursePreview !== null} ${buoy}`)) return;
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
    // A narrow band (phones) labels only the compass points, so the labels do not run together.
    const numbers = (w / (2 * BAND_HALF_WIDTH)) * 30 >= 40;
    const start = Math.ceil((bandCentre - BAND_HALF_WIDTH) / 5) * 5;
    for (let b = start; b <= bandCentre + BAND_HALF_WIDTH; b += 5) {
      const px = x(b);
      if (px === null) continue;
      const n = ((b % 360) + 360) % 360;
      const major = n % 30 === 0 || n % 45 === 0;
      g.fillStyle = major ? col.text : col.muted;
      g.fillRect(px, H - (major ? 10 : 5), 1, major ? 10 : 5);
      if (major && (numbers || COMPASS_POINTS[n])) {
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

  /**
   * A rudder (horizontal, port left) or stern-plane gauge (vertical, "upp"
   * at the top): the ordered angle as a marker, the actual angle as a bar.
   */
  function drawGauge(canvas: HTMLCanvasElement, vertical: boolean, cmd: number, actual: number, max: number, preview: boolean): void {
    const size = sizeOf(canvas);
    if (!changed(canvas, `${size.w}x${size.h} ${cmd} ${Math.round(actual * 2)} ${preview}`)) return;
    const g = canvas2d(canvas);
    if (!g) return;
    const col = pal();
    const { w, h: H } = size;
    const len = vertical ? H : w;
    const pos = (a: number) => (0.5 + Math.max(-1, Math.min(1, a / max)) / 2) * len;
    g.fillStyle = col.water;
    g.fillRect(0, 0, w, H);
    g.font = '9px system-ui, sans-serif';
    g.fillStyle = col.muted;
    for (const a of [-20, -10, 0, 10, 20]) {
      const p = pos(a);
      if (vertical) g.fillRect(0, p, a === 0 ? w : 6, 1);
      else g.fillRect(p, H - (a === 0 ? H : 6), 1, a === 0 ? H : 6);
    }
    g.textBaseline = 'top';
    if (vertical) {
      g.fillText('UPP', 3, 3);
      g.textBaseline = 'bottom';
      g.fillText('NED', 3, H - 3);
    } else {
      g.fillText('BB', 3, 3);
      g.textAlign = 'right';
      g.fillText('SB', w - 3, 3);
      g.textAlign = 'left';
    }
    // Actual angle: a bar from zero.
    g.fillStyle = col.accent;
    const z = pos(0);
    const p = pos(actual);
    if (vertical) g.fillRect(w / 2 - 4, Math.min(z, p), 8, Math.max(2, Math.abs(p - z)));
    else g.fillRect(Math.min(z, p), H / 2 - 4, Math.max(2, Math.abs(p - z)), 8);
    // Ordered angle: a marker.
    g.fillStyle = preview ? col.warn : col.text;
    const m = pos(cmd);
    if (vertical) g.fillRect(4, m - 1, w - 8, 3);
    else g.fillRect(m - 1, 4, 3, H - 8);
  }

  return update;
}

/** "5° ned", "12° SB", "0°". */
function angleText(a: number, positive: string, negative: string): string {
  return a === 0 ? '0°' : `${Math.abs(a)}° ${a > 0 ? positive : negative}`;
}

const fmt = (v: number) => String(Math.round(v * 10) / 10).replace('.', ',');

function setText(el: HTMLElement, text: string): void {
  if (el.textContent !== text) el.textContent = text;
}

function setTitle(el: HTMLElement, title: string): void {
  if (el.title === title) return;
  el.title = title;
  el.setAttribute('aria-label', title);
}
