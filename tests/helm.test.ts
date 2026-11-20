// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { Controller } from '../src/control/controller';
import { PERISCOPE_DEPTH, TELEGRAPH, telegraphStep } from '../src/control/gameMode';
import { LIMITS } from '../src/control/parser';
import { SCENARIOS, scenarioModes } from '../src/control/scenarios';
import { Simulation, type InitialConditions } from '../src/sim/simulation';
import { bindConsole } from '../src/ui/console';
import { BAND_HALF_WIDTH, bandBearing, bandFraction, createHelm, depthToFraction, fractionToDepth, type HelmContext } from '../src/ui/helm';
import { InputModeState } from '../src/ui/inputMode';
import { bindKeyboard } from '../src/ui/keyboard';
import { repeatDelay, REPEAT_FASTEST, REPEAT_FIRST } from '../src/ui/touch';
import { PERISCOPE_BUTTON_DEPTH, ViewState, bindViewButtons } from '../src/ui/views';

const KN = 1852 / 3600;

function simplified(initial: InitialConditions = { depth: 30, designTrim: true }) {
  const c = new Controller(new Simulation(initial));
  c.setMode('simplified');
  return c;
}

/** A helm bound to a controller, with its root, the update function and a way to refresh it. */
function helm(c: Controller, waypoint: [number, number] | null = null) {
  const root = document.createElement('div');
  document.body.append(root);
  const ctx: HelmContext = { ctrl: c, waypoint };
  const update = createHelm(root, () => ctx, new InputModeState());
  const refresh = () => update(c.sim.telemetry(), ctx);
  refresh();
  return { root, refresh };
}

/** Pointer events at a fraction of an element's box (the box is stubbed: happy-dom has no layout). */
function drag(el: Element, from: [number, number], to: [number, number]) {
  el.getBoundingClientRect = () => ({ left: 0, top: 0, width: 100, height: 200, right: 100, bottom: 200, x: 0, y: 0, toJSON: () => ({}) });
  const ev = (type: string, [fx, fy]: [number, number]) => el.dispatchEvent(new MouseEvent(type, { clientX: fx * 100, clientY: fy * 200, bubbles: true }));
  ev('pointerdown', from);
  ev('pointermove', to);
  ev('pointerup', to);
}

const press = (el: Element) => {
  el.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
  el.dispatchEvent(new MouseEvent('pointerup', { bubbles: true }));
};
const byTitle = (root: Element, title: string) => root.querySelector<HTMLButtonElement>(`button[title="${title}"]`)!;

describe('telegraph', () => {
  it('runs from full astern to full ahead, within the speed limits', () => {
    const knots = TELEGRAPH.map((b) => b.knots);
    expect(knots).toEqual([...knots].sort((a, b) => a - b));
    expect(knots[0]).toBe(LIMITS.minSpeed);
    expect(knots).toContain(0);
    expect(Math.max(...knots)).toBeLessThanOrEqual(LIMITS.maxSpeed);
  });

  it('steps one position, also from a speed between two positions', () => {
    expect(telegraphStep(0, 1)).toBe(4);
    expect(telegraphStep(0, -1)).toBe(-2);
    expect(telegraphStep(3, -1)).toBe(0);
    expect(telegraphStep(3, 1)).toBe(4);
    expect(telegraphStep(12, 1)).toBe(12);
    expect(telegraphStep(-6, -1)).toBe(-6);
    expect(telegraphStep(20, -1)).toBe(12);
  });
});

describe('helm mappings', () => {
  it('the depth scale is a square root: shallow water gets room, and taps snap to 5 m or periscope depth', () => {
    expect(depthToFraction(0)).toBe(0);
    expect(depthToFraction(300)).toBe(1);
    expect(depthToFraction(25)).toBeGreaterThan(0.25);
    for (const d of [0, 5, 30, 50, 120, 300]) expect(fractionToDepth(depthToFraction(d))).toBe(d);
    expect(fractionToDepth(depthToFraction(12))).toBe(PERISCOPE_DEPTH);
    expect(fractionToDepth(-1)).toBe(0);
    expect(fractionToDepth(2)).toBe(300);
  });

  it('the compass band spans ±60° around the heading, in 5° steps, across north', () => {
    expect(bandBearing(0.5, 90)).toBe(90);
    expect(bandBearing(1, 90)).toBe(90 + BAND_HALF_WIDTH);
    expect(bandBearing(0, 10)).toBe(310);
    expect(bandBearing(0.54, 0)).toBe(5);
    expect(bandBearing(0.52, 0)).toBe(0);
    expect(bandFraction(350, 10)).toBeCloseTo(0.5 - 20 / 120, 9);
    expect(bandFraction(200, 10)).toBeNull();
  });

  it('a held button repeats faster and faster, down to a floor', () => {
    expect(repeatDelay(0)).toBe(REPEAT_FIRST);
    expect(repeatDelay(3)).toBeLessThan(repeatDelay(1));
    expect(repeatDelay(50)).toBe(REPEAT_FASTEST);
  });
});

describe('screen controls (simplified)', () => {
  it('the telegraph orders a speed and lights its position', () => {
    const c = simplified();
    const { root, refresh } = helm(c);
    press(byTitle(root, 'Halv back'));
    c.step();
    expect(c.setpoints.speed).toBe(-4);
    expect(c.ap.speed).toBe(true);
    refresh();
    expect(root.querySelector('.helm-bell.on')?.getAttribute('title')).toBe('Halv back');
    expect(root.textContent).toMatch(/Halv back/);
  });

  it('marks both neighbours when the ordered speed lies between two positions', () => {
    const c = simplified();
    const { root, refresh } = helm(c);
    c.submit({ kind: 'setSpeed', knots: 6 }, 'keyboard');
    c.step();
    refresh();
    expect(root.querySelector('.helm-bell.on')).toBeNull();
    expect([...root.querySelectorAll('.helm-bell.near')].map((b) => b.getAttribute('title'))).toEqual(['Sakta fram', 'Halv fram']);
  });

  it('dragging on the depth scale orders the depth under the finger on release', () => {
    const c = simplified();
    const { root } = helm(c);
    const scale = root.querySelector('.helm-depth-scale')!;
    drag(scale, [0.5, 0.1], [0.5, depthToFraction(80)]);
    c.step();
    expect(c.setpoints.depth).toBe(80);
    expect(c.log.at(-1)?.text).toBe('Djup 80, ja');
  });

  it('a cancelled drag orders nothing', () => {
    const c = simplified();
    const { root } = helm(c);
    const scale = root.querySelector('.helm-depth-scale')!;
    const before = c.log.length;
    scale.dispatchEvent(new MouseEvent('pointerdown', { clientX: 50, clientY: 150 }));
    scale.dispatchEvent(new MouseEvent('pointercancel'));
    c.step();
    expect(c.log.length).toBe(before);
  });

  it('a tap on the compass band orders that course', () => {
    const c = simplified({ depth: 30, designTrim: true, heading: (90 * Math.PI) / 180 });
    const { root } = helm(c);
    drag(root.querySelector('.helm-band')!, [0.75, 0.5], [0.75, 0.5]);
    c.step();
    expect(c.setpoints.heading).toBe(120);
  });

  it('"Mot bojen" shows only with a buoy and steers for it', () => {
    const c = simplified({ depth: 30, designTrim: true });
    expect(byTitle(helm(c).root, 'Styr mot den gula bojen').hidden).toBe(true);
    const { root } = helm(c, [0, 1000]); // due east
    const buoy = byTitle(root, 'Styr mot den gula bojen');
    expect(buoy.hidden).toBe(false);
    press(buoy);
    c.step();
    expect(c.setpoints.heading).toBe(90);
  });

  it('Dyk/Yta follows the main ballast', () => {
    const surfaced = simplified({});
    const a = helm(surfaced).root.querySelector('.helm-ballast')!;
    expect(a.textContent).toBe('Dyk');
    press(a);
    surfaced.step();
    expect(surfaced.log.some((e) => e.text.startsWith('Dyk'))).toBe(true);

    const dived = simplified({ depth: 40, designTrim: true });
    const { root } = helm(dived);
    const b = root.querySelector('.helm-ballast')!;
    expect(b.textContent).toBe('Yta');
    press(b);
    dived.step();
    expect(dived.log.some((e) => /^Ytläge/.test(e.text))).toBe(true);
  });

  it('Håll keeps the present course and depth; ▲ makes the depth target 5 m shallower', () => {
    const c = simplified({ depth: 42, designTrim: true, speed: 4 * KN });
    c.submit({ kind: 'setDepth', depth: 100 }, 'keyboard');
    c.step();
    const { root } = helm(c);
    press(byTitle(root, 'Håll nuvarande kurs och djup'));
    c.step();
    expect(c.setpoints.depth).toBe(42);
    press(byTitle(root, 'Djup 5 m grundare'));
    c.step();
    expect(c.setpoints.depth).toBe(37);
    press(byTitle(root, `Periskopdjup, ${PERISCOPE_DEPTH} m`));
    c.step();
    expect(c.setpoints.depth).toBe(PERISCOPE_DEPTH);
  });
});

describe('no console in the simplified mode', () => {
  it('the console neither opens nor takes focus when not allowed', () => {
    const form = document.createElement('form');
    const input = document.createElement('input');
    form.append(input);
    document.body.append(form);
    const mode = new InputModeState();
    let allowed = false;
    const open = bindConsole(form, input, () => null, mode, () => allowed);
    open();
    expect(mode.current).toBe('steer');
    input.dispatchEvent(new FocusEvent('focus'));
    expect(mode.current).toBe('steer');
    allowed = true;
    open();
    expect(mode.current).toBe('console');
  });

  it('keys: Enter does not open the console; Shift+↓/↑ move the telegraph', () => {
    let c = simplified({ depth: 30, designTrim: true, speed: 3 * KN });
    let opened = 0;
    bindKeyboard(() => c, new InputModeState(), () => opened++, new ViewState());
    const key = (k: string, shiftKey = false) => window.dispatchEvent(new KeyboardEvent('keydown', { key: k, shiftKey }));
    key('Enter');
    key('/');
    expect(opened).toBe(0);
    key('ArrowDown', true); // 3 knots → Stopp
    c.step();
    expect(c.setpoints.speed).toBe(0);
    key('ArrowDown', true);
    c.step();
    key('ArrowDown', true);
    c.step();
    expect(c.setpoints.speed).toBe(-4);
    key('ArrowUp', true);
    c.step();
    expect(c.setpoints.speed).toBe(-2);

    // The realistic mode keeps the console and ±1 knot.
    c = new Controller(new Simulation({ depth: 30, designTrim: true }));
    key('Enter');
    expect(opened).toBe(1);
    key('ArrowUp', true);
    c.step();
    expect(c.setpoints.speed).toBe(1);
  });

  it('every scenario hint in the simplified mode uses the controls, not typed commands', () => {
    for (const sc of SCENARIOS) {
      if (!scenarioModes(sc).includes('simplified')) continue;
      for (const o of sc.objectives) {
        const hint = o.hintSimplified ?? o.hint;
        expect(hint, `${sc.id}: ${o.text}`).not.toMatch(/Skriv|konsol/i);
      }
    }
  });
});

describe('view buttons follow the situation (simplified)', () => {
  it('Per and Vy are hidden deep down and shown near the surface', () => {
    const root = document.createElement('div');
    const views = new ViewState();
    const update = bindViewButtons(root, () => null, views);
    const per = root.querySelector<HTMLButtonElement>('[data-v="periscope"]')!;
    const vy = root.querySelector<HTMLButtonElement>('[data-v="view"]')!;
    update(simplified({ depth: PERISCOPE_BUTTON_DEPTH + 30, designTrim: true }));
    expect(per.hidden).toBe(true);
    expect(vy.hidden).toBe(true);
    update(simplified({ depth: PERISCOPE_DEPTH, designTrim: true }));
    expect(per.hidden).toBe(false);
    expect(vy.hidden).toBe(false);
    // The realistic mode always shows them.
    update(new Controller(new Simulation({ depth: 100, designTrim: true })));
    expect(per.hidden).toBe(false);
  });
});
