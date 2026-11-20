// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { Controller } from '../src/control/controller';
import { LOCK_TEXT, PERISCOPE_DEPTH, TELEGRAPH, telegraphStep } from '../src/control/crew';
import { LIMITS } from '../src/control/parser';
import { SCENARIOS } from '../src/control/scenarios';
import { Simulation, type InitialConditions } from '../src/sim/simulation';
import { bindConsole } from '../src/ui/console';
import { BAND_HALF_WIDTH, bandBearing, bandFraction, createHelm, depthToFraction, fractionToDepth, gaugeAngle, type HelmContext } from '../src/ui/helm';
import { InputModeState } from '../src/ui/inputMode';
import { bindKeyboard } from '../src/ui/keyboard';
import { repeatDelay, REPEAT_FASTEST, REPEAT_FIRST } from '../src/ui/button';
import { PERISCOPE_BUTTON_DEPTH, ViewState, bindViewButtons } from '../src/ui/views';

const KN = 1852 / 3600;

/** A game as it starts: the crew handles everything. */
function crewGame(initial: InitialConditions = { depth: 30, designTrim: true }) {
  const c = new Controller(new Simulation(initial));
  c.crewTakesAll();
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

describe('screen controls with the crew', () => {
  it('the telegraph orders a speed and lights its position', () => {
    const c = crewGame();
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
    const c = crewGame();
    const { root, refresh } = helm(c);
    c.submit({ kind: 'setSpeed', knots: 6 }, 'keyboard');
    c.step();
    refresh();
    expect(root.querySelector('.helm-bell.on')).toBeNull();
    expect([...root.querySelectorAll('.helm-bell.near')].map((b) => b.getAttribute('title'))).toEqual(['Sakta fram', 'Halv fram']);
  });

  it('dragging on the depth scale orders the depth under the finger on release', () => {
    const c = crewGame();
    const { root } = helm(c);
    const scale = root.querySelector('.helm-depth-scale')!;
    drag(scale, [0.5, 0.1], [0.5, depthToFraction(80)]);
    c.step();
    expect(c.setpoints.depth).toBe(80);
    expect(c.log.at(-1)?.text).toBe('Djup 80, ja');
  });

  it('a cancelled drag orders nothing', () => {
    const c = crewGame();
    const { root } = helm(c);
    const scale = root.querySelector('.helm-depth-scale')!;
    const before = c.log.length;
    scale.dispatchEvent(new MouseEvent('pointerdown', { clientX: 50, clientY: 150 }));
    scale.dispatchEvent(new MouseEvent('pointercancel'));
    c.step();
    expect(c.log.length).toBe(before);
  });

  it('a tap on the compass band orders that course', () => {
    const c = crewGame({ depth: 30, designTrim: true, heading: (90 * Math.PI) / 180 });
    const { root } = helm(c);
    drag(root.querySelector('.helm-band')!, [0.75, 0.5], [0.75, 0.5]);
    c.step();
    expect(c.setpoints.heading).toBe(120);
  });

  it('"Mot bojen" shows only with a buoy and steers for it', () => {
    const c = crewGame({ depth: 30, designTrim: true });
    expect(byTitle(helm(c).root, 'Styr mot den gula bojen').hidden).toBe(true);
    const { root } = helm(c, [0, 1000]); // due east
    const buoy = byTitle(root, 'Styr mot den gula bojen');
    expect(buoy.hidden).toBe(false);
    press(buoy);
    c.step();
    expect(c.setpoints.heading).toBe(90);
  });

  it('Dyk/Yta follows the main ballast', () => {
    const surfaced = crewGame({});
    const a = helm(surfaced).root.querySelector('.helm-ballast')!;
    expect(a.textContent).toBe('Dyk');
    press(a);
    surfaced.step();
    expect(surfaced.log.some((e) => e.text.startsWith('Dyk'))).toBe(true);

    const dived = crewGame({ depth: 40, designTrim: true });
    const { root } = helm(dived);
    const b = root.querySelector('.helm-ballast')!;
    expect(b.textContent).toBe('Yta');
    press(b);
    dived.step();
    expect(dived.log.some((e) => /^Ytläge/.test(e.text))).toBe(true);
  });

  it('Håll keeps the present course and depth; ▲ makes the depth target 5 m shallower', () => {
    const c = crewGame({ depth: 42, designTrim: true, speed: 4 * KN });
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

describe('Auto / Hand', () => {
  it('the switch takes the axis over and the group shows rudder or planes', () => {
    const c = crewGame({ depth: 40, designTrim: true, speed: 4 * KN });
    const { root, refresh } = helm(c);
    const depthAuto = root.querySelector<HTMLElement>('.helm-depth-scale:not(.helm-planes)')!;
    const planes = root.querySelector<HTMLElement>('.helm-planes')!;
    expect(planes.hidden).toBe(true);
    press(byTitle(root, 'Djup: du styr djuprodret'));
    c.step();
    refresh();
    expect(c.ap.depth).toBe(false);
    expect(planes.hidden).toBe(false);
    expect(depthAuto.hidden).toBe(true);
    press(byTitle(root, 'Djuproder 5° ned'));
    c.step();
    expect(c.manual.planes).toBe(Math.round(c.sim.commands.sternPlanes * 180 / Math.PI));
    drag(root.querySelector('.helm-planes')!, [0.5, 0.5], [0.5, 0.75]);
    c.step();
    expect(c.manual.planes).toBe(gaugeAngle(0.75, LIMITS.maxPlanes));
    press(byTitle(root, 'Djup: besättningen håller målet'));
    c.step();
    refresh();
    expect(c.ap.depth).toBe(true);
    expect(planes.hidden).toBe(true);
  });

  it('the rudder gauge orders the angle under the finger; Mitt centres it', () => {
    const c = crewGame({ depth: 40, designTrim: true, speed: 4 * KN });
    const { root, refresh } = helm(c);
    press(byTitle(root, 'Kurs: du styr rodret'));
    c.step();
    refresh();
    drag(root.querySelector('.helm-rudder')!, [0.5, 0.5], [0.25, 0.5]);
    c.step();
    expect(c.manual.rudder).toBe(gaugeAngle(0.25, LIMITS.maxRudder));
    expect(c.manual.rudder).toBeLessThan(0);
    press(byTitle(root, 'Roder midskepps'));
    c.step();
    expect(c.manual.rudder).toBe(0);
    expect(gaugeAngle(1, 30)).toBe(30);
  });

  it('a locked axis cannot be switched', () => {
    const c = new Controller(new Simulation({ depth: 40, designTrim: true }));
    c.options.locks = { depth: false };
    c.crewTakesAll();
    const { root } = helm(c);
    const auto = byTitle(root, 'Djup: besättningen håller målet');
    expect(auto.disabled).toBe(true);
    expect(auto.parentElement!.title).toBe(LOCK_TEXT.depth[1]);
  });
});

describe('panels', () => {
  const panelBtn = (root: Element, name: string) => [...root.querySelectorAll<HTMLButtonElement>('.helm-panel-btn')].find((b) => b.textContent?.startsWith(name))!;

  it('a button in a panel takes the system over; the header hands it back', () => {
    const c = crewGame({ depth: 40, designTrim: true, speed: 4 * KN });
    const { root, refresh } = helm(c);
    const panel = root.querySelector<HTMLElement>('.helm-panel')!;
    expect(panel.hidden).toBe(true);
    press(panelBtn(root, 'Trim'));
    refresh();
    expect(panel.hidden).toBe(false);
    expect(panel.textContent).toMatch(/Trimassistenten kompenserar och trimmar/);
    press(byTitle(root, 'Kompensera ut 100 liter'));
    c.step();
    refresh();
    expect(c.options.crew.trim).toBe(false);
    expect(c.sim.compRemaining).toBeLessThan(0);
    expect(panelBtn(root, 'Trim').classList.contains('self')).toBe(true);
    expect(panel.textContent).toMatch(/Du kompenserar och trimmar/);
    const handBack = [...panel.querySelectorAll('button')].find((b) => b.textContent === 'Lämna till besättningen')!;
    press(handBack);
    c.step();
    expect(c.options.crew.trim).toBe(true);
  });

  it('the ballast panel floods per tank and clears the bridge', () => {
    const c = crewGame({});
    const { root, refresh } = helm(c);
    press(panelBtn(root, 'Ballast'));
    refresh();
    expect(root.querySelector('.helm-panel')!.textContent).toMatch(/Bryggan: bemannad/);
    press(byTitle(root, 'Klart bryggan: utrym den före dykning'));
    c.step();
    expect(c.bridgeManned).toBe(false);
    press(byTitle(root, 'Fyll huvudballast för'));
    c.step();
    expect(c.options.crew.ballast).toBe(false);
    const fwd = c.sim.tankDefs.findIndex((d) => d.id === 'mbt_fwd');
    const aft = c.sim.tankDefs.findIndex((d) => d.id === 'mbt_aft');
    expect(c.sim.tanks[fwd]!.ventOpen).toBe(true);
    expect(c.sim.tanks[aft]!.ventOpen).toBe(false);
  });

  it('the speed panel steps the shaft speed and takes the speed over; the telegraph hands it back', () => {
    const c = crewGame({ depth: 40, designTrim: true, speed: 4 * KN });
    const { root, refresh } = helm(c);
    press(panelBtn(root, 'Fart'));
    refresh();
    const before = Math.round(c.sim.telemetry().rpsCmd * 60);
    press(byTitle(root, 'Propellervarv +10 rpm'));
    c.step();
    expect(c.ap.speed).toBe(false);
    expect(c.manual.rpm).toBe(before + 10);
    refresh();
    expect(root.querySelector('.helm-telegraph .helm-readout')!.textContent).toMatch(/Varv/);
    press(byTitle(root, 'Halv fram'));
    c.step();
    expect(c.ap.speed).toBe(true);
  });
});

describe('the console and the keys', () => {
  it('the console opens for everyone, and a console order takes its system over', () => {
    const form = document.createElement('form');
    const input = document.createElement('input');
    form.append(input);
    document.body.append(form);
    const mode = new InputModeState();
    const c = crewGame({ depth: 40, designTrim: true, speed: 4 * KN });
    const open = bindConsole(form, input, () => c, mode);
    open();
    expect(mode.current).toBe('console');
    input.value = 'roder sb 10';
    form.dispatchEvent(new Event('submit', { cancelable: true }));
    c.step();
    expect(c.ap.heading).toBe(false);
    expect(c.manual.rudder).toBe(10);
  });

  it('the arrows follow Auto/Hand; Shift moves the telegraph, or the shaft speed on hand', () => {
    const c = crewGame({ depth: 30, designTrim: true, speed: 3 * KN });
    let opened = 0;
    bindKeyboard(() => c, new InputModeState(), () => opened++, new ViewState());
    const key = (k: string, shiftKey = false) => window.dispatchEvent(new KeyboardEvent('keydown', { key: k, shiftKey }));
    key('Enter');
    expect(opened).toBe(1);
    key('ArrowDown', true); // 3 knots → Stopp
    c.step();
    expect(c.setpoints.speed).toBe(0);
    key('ArrowDown', true);
    c.step();
    key('ArrowDown', true);
    c.step();
    expect(c.setpoints.speed).toBe(-4);
    key('ArrowRight');
    c.step();
    expect(c.setpoints.heading).toBe(10);
    // Heading on Hand: the arrows move the rudder, Space centres it.
    c.submit({ kind: 'crew', system: 'heading', crew: false }, 'touch');
    c.step();
    const r0 = c.manual.rudder;
    key('ArrowRight');
    c.step();
    expect(c.manual.rudder).toBe(r0 + 5);
    key(' ');
    c.step();
    expect(c.manual.rudder).toBe(0);
    // Speed on Hand: Shift steps the shaft speed.
    c.submit({ kind: 'crew', system: 'speed', crew: false }, 'touch');
    c.step();
    const rpm = Math.round(c.sim.telemetry().rpsCmd * 60);
    key('ArrowUp', true);
    c.step();
    expect(c.manual.rpm).toBe(rpm + 10);
  });

  it('no scenario hint needs the console', () => {
    for (const sc of SCENARIOS) {
      for (const o of sc.objectives) {
        for (const hint of [o.hint, o.hintCrew ?? '']) expect(hint, `${sc.id}: ${o.text}`).not.toMatch(/(^|\. )Skriv|konsol/i);
        if (o.hintCrew) expect(o.system, `${sc.id}: ${o.text}`).toBeDefined();
      }
    }
  });
});

describe('view buttons follow the situation', () => {
  it('Per and Vy are hidden deep down and shown near the surface', () => {
    const root = document.createElement('div');
    const views = new ViewState();
    const update = bindViewButtons(root, () => null, views);
    const per = root.querySelector<HTMLButtonElement>('[data-v="periscope"]')!;
    const vy = root.querySelector<HTMLButtonElement>('[data-v="view"]')!;
    update(crewGame({ depth: PERISCOPE_BUTTON_DEPTH + 30, designTrim: true }));
    expect(per.hidden).toBe(true);
    expect(vy.hidden).toBe(true);
    update(crewGame({ depth: PERISCOPE_DEPTH, designTrim: true }));
    expect(per.hidden).toBe(false);
    expect(vy.hidden).toBe(false);
    expect(root.querySelector('[data-v="console"]')).not.toBeNull();
  });
});
