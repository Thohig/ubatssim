/**
 * The screen controls, always shown in a game. Every control submits
 * ordinary orders with source 'touch'; the keyboard gives
 * the same orders. What a control does follows who handles the system
 * (crew.ts): the crew holds targets, the player moves rudder and planes.
 *
 * Two levels. The base, always shown, is what the player wants; the crew
 * (conn.ts) chooses how:
 *  - Depth (left thumb): Yta, Periskop and Djup, and a vertical scale with
 *    the present depth, the target, periscope depth, the sea bed and the
 *    safety net's limit. Tap or drag the scale to choose a target (5 m
 *    steps); the order is sent on release. Djup goes back to the last deep
 *    target.
 *  - Course (right thumb): a compass band ±60° around the heading. Tap or
 *    drag to choose a course (5° steps), sent on release; "Mot bojen" steers
 *    for the scenario's buoy.
 *  - Speed (centre): an engine-order telegraph, full astern to full ahead.
 *    On phones it is a lever: tap or drag along it, sent on release. While
 *    the crew runs a speed of its own the readout over it says so.
 *  - The plan line over the telegraph: what the boat does now ("Går ned
 *    till 100 m."). A tap opens the details: Manöver (why, and the planes,
 *    rudder and shaft) and the panels Ballast, Trim, Fart, El and Torped.
 *  - The view buttons (views.ts) in a column at the right edge, in
 *    `viewDock`, on computers.
 *
 * Expert mode (`Controller.options.expert`, ☰ → Besättning) adds the hand
 * controls: an Auto/Hand switch per axis (a chip on phones), the stern-plane
 * and rudder gauges on Hand, and in the panels the buttons that take a
 * system over and "Ta över". Both phone and computer variants are in the
 * DOM everywhere; style.css picks.
 *
 * The parts: mappings.ts (screen position ↔ depth, bearing, angle; pure,
 * exported for the tests), canvas.ts (drawing on 2D canvases), drag.ts
 * (tap or drag), panels.ts (the five panels) and this file, which builds the
 * controls and updates them.
 */
import type { Controller } from '../../control/controller';
import { CREW_NAME, CREW_NOUN, CREW_ROLE, HELM_MAX_DEPTH, LOCK_TEXT, MANOEUVRE_SYSTEMS, PERISCOPE_DEPTH, TELEGRAPH } from '../../control/crew';
import { MANOEUVRE_NAME } from '../../control/conn';
import { LIMITS } from '../../control/parser';
import type { Telemetry } from '../../sim/simulation';
import { h } from '../dom';
import { submitPeriscopeDepth, submitSurface } from '../keyboard';
import { haptic, makeButton, type ScreenButton } from '../button';
import { isCompact } from '../compact';
import { colors, drawCompassBand, drawDepthScale, drawGauge, observer, type Colors } from './canvas';
import { bindDrag } from './drag';
import { DEG, angleText, bandBearing, bearing3, bearingTo, fmt, fractionToDepth, gaugeAngle, setText, setTitle, telegraphIndex } from './mappings';
import { PANELS, PANEL_SYSTEM, PANEL_TITLE, createPanels, type Panel } from './panels';

export { BAND_HALF_WIDTH, bandBearing, bandFraction, depthToFraction, fractionToDepth, gaugeAngle, telegraphIndex } from './mappings';

/** Periscope depth counts as the depth target up to this deep [m] (the Periskop button lit). */
const PERISCOPE_BAND = PERISCOPE_DEPTH + 3;
/** The Djup button's first target, before any deep target has been given [m]. */
const FIRST_DEEP = 50;

export interface HelmContext {
  ctrl: Controller;
  /** The scenario's buoy [north, east], if any. */
  waypoint: [number, number] | null;
}

/**
 * Builds the screen controls in `root`. `getCtx` returns null while no game
 * is running (presses are then ignored). Returns the update function, to
 * call with fresh telemetry ~10 times a second.
 */
export function createHelm(
  root: HTMLElement,
  getCtx: () => HelmContext | null,
  viewDock: HTMLElement = h('div', { class: 'helm-views' }),
): (t: Telemetry, ctx: HelmContext) => void {
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
  const button = (b: ScreenButton) => makeButton(b, fire);
  /** A button that acts once on press (no repeat), for panels and switches. */
  const tapButton = (label: string, title: string, run: (c: Controller) => void, className = '') =>
    makeButton({ label, title, run, className: `helm-small ${className}` }, fire);
  let last: { t: Telemetry; ctx: HelmContext } | null = null;
  // The theme colours, read once: getComputedStyle forces a style recalculation.
  let palette: Colors | null = null;
  const pal = () => (palette ??= colors(root));
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
  // The deepest target the player gave last: Djup goes back there.
  let lastDeep: number | null = null;
  const surfaceBtn = button({ label: 'Yta', title: 'Yta: besättningen går upp och blåser huvudballasten nära ytan', className: 'helm-mode', run: (c) => submitSurface(c, 'touch') });
  const periscopeBtn = button({ label: 'Periskop', title: `Periskopdjup, ${PERISCOPE_DEPTH} m: i ytläge dyker besättningen dit`, className: 'helm-mode', run: (c) => submitPeriscopeDepth(c, 'touch') });
  const deepBtn = button({
    label: 'Djup',
    title: 'Djup: tillbaka till det senaste djupa djupmålet (välj ett annat på skalan)',
    className: 'helm-mode',
    run: (c) => c.submit({ kind: 'setDepth', depth: lastDeep ?? Math.max(FIRST_DEEP, Math.round(c.sim.kinematics().depth / 5) * 5) }, 'touch'),
  });
  const modeBtns = [surfaceBtn, periscopeBtn, deepBtn] as const;
  const depthAutoBtns = h('div', { class: 'helm-depth-btns helm-modes', role: 'group', 'aria-label': 'Djupläge' }, ...modeBtns);
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
  // The scale or the plane gauge, and beside it the depth modes (expert mode: the Auto/Hand switch over them).
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
  const courseAuto = h('div', { class: 'touch-row helm-band-row' }, band);
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
    undefined,
    isCompact,
  );
  // While the crew runs its own speed for a while (rising, giving the planes way) the bells dim but still take
  // orders, the readout says why, and the telegraph is back at the ordered bell when it ends.
  const telegraph = h(
    'div',
    { class: 'helm-group helm-telegraph' },
    // The ordered speed, only on phones between two bells or while the crew runs its own (style.css): the instruments show it otherwise.
    h('div', { class: 'helm-telegraph-head' }, speedReadout),
    h('div', { class: 'helm-telegraph-row' }, bellRow),
  );

  // ---- The plan line: what the boat does now; a tap opens the details.
  let open: Panel | null = null;
  /** The panel the plan line opens: the one last shown. */
  let lastPanel: Panel = 'manoeuvre';
  const planName = h('span', { class: 'helm-plan-name' });
  const planText = h('span', { class: 'helm-plan-text' });
  const planMore = h('span', { class: 'helm-plan-more', 'aria-hidden': 'true' }, '▸');
  const planBtn = h('button', { type: 'button', class: 'helm-plan', 'aria-expanded': 'false', title: 'Vad besättningen gör: tryck för detaljer, ballast, trim, fart, el och torped' }, planName, planText, planMore);
  planBtn.addEventListener('click', () => toggle(open ? null : lastPanel));
  const actions = h('div', { class: 'helm-actions' }, planBtn);

  // ---- Panels.
  const tabs = PANELS.map((p) => {
    const el = h('button', { type: 'button', class: 'helm-tab', role: 'tab', 'aria-selected': 'false' }, PANEL_TITLE[p]);
    el.addEventListener('click', () => {
      if (open !== p) toggle(p);
    });
    return { p, el };
  });
  const panelOwner = h('b', { class: 'helm-panel-owner' });
  const panelRoleText = h('span');
  const panelRole = h('span', { class: 'helm-panel-role' }, panelOwner, ' ', panelRoleText);
  const panelToggle = tapButton('', '', (c) => {
    const sys = open ? PANEL_SYSTEM[open] : null;
    if (sys) c.submit({ kind: 'crew', system: sys, crew: !c.duty(sys) }, 'touch');
  });
  const closeBtn = h('button', { type: 'button', class: 'helm-panel-close', 'aria-label': 'Stäng' }, '✕');
  closeBtn.addEventListener('click', () => toggle(null));
  const panels = createPanels(tapButton);
  const panelCrew = h('div', { class: 'helm-panel-crew' }, panelRole, panelToggle);
  const panelEl = h(
    'div',
    { class: 'helm-panel panel', hidden: true },
    h('div', { class: 'helm-panel-head' }, h('div', { class: 'helm-tabs', role: 'tablist' }, ...tabs.map((x) => x.el)), closeBtn),
    panelCrew,
    ...Object.values(panels).map((x) => x.el),
  );

  function toggle(p: Panel | null): void {
    open = open === p ? null : p;
    if (open) lastPanel = open;
    panelEl.hidden = open === null;
    for (const x of tabs) {
      x.el.classList.toggle('on', x.p === open);
      x.el.setAttribute('aria-selected', String(x.p === open));
    }
    planBtn.classList.toggle('open', open !== null);
    planBtn.setAttribute('aria-expanded', String(open !== null));
    setText(planMore, open ? '▾' : '▸');
    for (const [k, x] of Object.entries(panels)) x.el.hidden = k !== open;
    redraw();
  }

  const centre = h('div', { class: 'helm-centre' }, actions, telegraph);
  viewDock.classList.add('helm-views');
  root.replaceChildren(depthGroup, centre, viewDock, courseGroup, panelEl);
  for (const c of [depthCanvas, band, planesGauge, rudderGauge]) observer?.observe(c);

  function update(t: Telemetry, ctx: HelmContext): void {
    last = { t, ctx };
    const c = ctx.ctrl;
    const depth = t.depth;
    const heading = t.heading * DEG;
    const depthAutoOn = c.ap.depth;
    const headingAutoOn = c.ap.heading;
    const expert = c.options.expert;

    // Auto/Hand (expert mode only): which body each group shows.
    depthSwitch.update(c);
    courseSwitch.update(c);
    depthSwitch.el.hidden = !expert;
    courseSwitch.el.hidden = !expert;
    depthSwitch.chip.hidden = !expert;
    courseSwitch.chip.hidden = !expert;
    root.classList.toggle('expert', expert);
    if (depthAutoOn && c.setpoints.depth > PERISCOPE_BAND) lastDeep = c.setpoints.depth;
    const sp = c.setpoints.depth;
    const lit = !depthAutoOn ? -1 : sp < 5 ? 0 : sp <= PERISCOPE_BAND ? 1 : 2;
    modeBtns.forEach((b, i) => {
      b.classList.toggle('on', i === lit);
      b.setAttribute('aria-pressed', String(i === lit));
    });
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
        ? `${Math.round(depth)} m${depthTarget !== null ? ` → ${depthTarget === 0 && depthPreview === null ? 'yta' : `${depthTarget} m`}` : ''}${c.hovering ? ' · svävar' : ''}`
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
    const crew = c.crewSpeed();
    setText(
      speedReadout,
      crew
        ? `${fmt(crew.knots)} kn · ${crew.reason}`
        : order === null
          ? `Varv ${Math.round(t.rpsCmd * 60)}`
          : bell
            ? bell.name
            : order < 0
              ? `Back ${fmt(-order)} kn`
              : `${fmt(order)} kn`,
    );
    telegraph.classList.toggle('crew', !!crew);
    setTitle(speedReadout, crew ? `Besättningen kör ${fmt(crew.knots)} knop (${crew.reason}). Telegrafen går tillbaka när den är klar, och en ny order gäller direkt.` : '');

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

    // The plan line.
    const plan = c.conn.plan();
    setText(planName, MANOEUVRE_NAME[plan.mode]);
    setText(planText, plan.text);
    planBtn.classList.toggle('quiet', plan.quiet);
    planBtn.classList.toggle('hand', plan.mode === 'hand');

    // Panel buttons are marked while the player handles that system.
    const self = (p: Panel) => {
      const sys = PANEL_SYSTEM[p];
      return sys ? !c.duty(sys) : (['depth', 'heading', 'speed'] as const).some((a) => !c.ap[a]);
    };
    for (const x of tabs) x.el.classList.toggle('self', self(x.p));
    planBtn.classList.toggle('self', PANELS.some(self));
    panelEl.classList.toggle('expert', expert);
    if (open) {
      const sys = PANEL_SYSTEM[open];
      panelCrew.hidden = sys === null;
      if (sys) {
        const crew = c.duty(sys);
        const lock = c.options.locks[sys];
        // Who handles it first, then what that means (a locked system: why it cannot change).
        setText(panelOwner, `${crew ? 'Besättningen' : 'Du'} sköter ${CREW_NOUN[sys]}.`);
        setText(panelRoleText, lock === undefined ? CREW_ROLE[sys][crew ? 0 : 1] : LOCK_TEXT[sys][lock ? 0 : 1]);
        setText(panelToggle, crew ? 'Ta över' : 'Lämna till besättningen');
        setTitle(panelToggle, crew ? `Du tar över: ${CREW_NAME[sys].toLowerCase()}` : `Besättningen tar över: ${CREW_NAME[sys].toLowerCase()}`);
        // Outside expert mode the manoeuvre is the crew's: no Ta över (it would be refused).
        panelToggle.hidden = lock !== undefined || (!expert && crew && MANOEUVRE_SYSTEMS.includes(sys));
      }
      panels[open].update(t, c);
    }

    if (coursePreview === null) bandCentre = heading;
    const col = pal();
    if (depthAutoOn) {
      const limit = c.options.crew.safetyNet ? c.assist.depthLimit() : HELM_MAX_DEPTH;
      drawDepthScale(depthCanvas, t, depthTarget, depthPreview !== null, limit, col);
    } else drawGauge(planesGauge, true, planesCmd, t.sternPlanes * DEG, LIMITS.maxPlanes, planesPreview !== null, col);
    if (headingAutoOn) drawCompassBand(band, t, heading, bandCentre, courseTarget, coursePreview !== null, ctx.waypoint, col);
    else drawGauge(rudderGauge, false, rudderCmd, t.rudder * DEG, LIMITS.maxRudder, rudderPreview !== null, col);
  }

  return update;
}
