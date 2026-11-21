// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Controller } from '../src/control/controller';
import { LOCK_TEXT, PERISCOPE_DEPTH, TELEGRAPH, telegraphStep } from '../src/control/crew';
import { LIMITS } from '../src/control/parser';
import { SCENARIOS } from '../src/control/scenarios';
import { Simulation, type InitialConditions } from '../src/sim/simulation';
import { BAND_HALF_WIDTH, bandBearing, bandFraction, createHelm, depthToFraction, fractionToDepth, gaugeAngle, telegraphIndex, type HelmContext } from '../src/ui/helm';
import { bindLog, bindLogToggle, lineLife, LIVE_LINES } from '../src/ui/log';
import { statusFields } from '../src/ui/statusBar';
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
  const update = createHelm(root, () => ctx);
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
const tabOf = (root: Element, name: string) => [...root.querySelectorAll<HTMLButtonElement>('.helm-tab')].find((t) => t.textContent === name)!;
/** Opens a panel as the player does: System ▾, then its tab. Returns the tab. */
const openPanel = (root: Element, name: string) => {
  if (root.querySelector<HTMLElement>('.helm-panel')!.hidden) press(root.querySelector('.helm-system')!);
  const tab = tabOf(root, name);
  if (!tab.classList.contains('on')) tab.click();
  return tab;
};

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
    expect(telegraphStep(19, 1)).toBe(19);
    expect(telegraphStep(12, 1)).toBe(19);
    expect(telegraphStep(-7, -1)).toBe(-7);
    expect(telegraphStep(20, -1)).toBe(19);
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
    // Stopped, the crew also says it hovers there (hover.ts).
    expect(c.log.map((e) => e.text)).toContain('Djup 80, ja');
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
    // A normal ascent: the surface as the target, the main ballast blown only near the surface.
    expect(dived.setpoints.depth).toBe(0);
    expect(dived.sim.tanks.some((t) => t.blowOpen)).toBe(false);
    expect(dived.log.some((e) => /Stigning till ytan/.test(e.text))).toBe(true);
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
  it('a button in a panel takes the system over; the header hands it back', () => {
    const c = crewGame({ depth: 40, designTrim: true, speed: 4 * KN });
    const { root, refresh } = helm(c);
    const panel = root.querySelector<HTMLElement>('.helm-panel')!;
    expect(panel.hidden).toBe(true);
    openPanel(root, 'Trim');
    refresh();
    expect(panel.hidden).toBe(false);
    expect(panel.textContent).toMatch(/Trimassistenten kompenserar och trimmar/);
    press(byTitle(root, 'Kompensera ut 100 liter'));
    c.step();
    refresh();
    expect(c.options.crew.trim).toBe(false);
    expect(c.sim.compRemaining).toBeLessThan(0);
    expect(tabOf(root, 'Trim').classList.contains('self')).toBe(true);
    expect(panel.textContent).toMatch(/Du kompenserar och trimmar/);
    const handBack = [...panel.querySelectorAll('button')].find((b) => b.textContent === 'Lämna till besättningen')!;
    press(handBack);
    c.step();
    expect(c.options.crew.trim).toBe(true);
  });

  it('the ballast panel floods per tank and clears the bridge', () => {
    const c = crewGame({});
    const { root, refresh } = helm(c);
    openPanel(root, 'Ballast');
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
    openPanel(root, 'Fart');
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

describe('the keys', () => {
  it('the arrows follow Auto/Hand; Shift moves the telegraph, or the shaft speed on hand', () => {
    const c = crewGame({ depth: 30, designTrim: true, speed: 3 * KN });
    bindKeyboard(() => c, new ViewState());
    const key = (k: string, shiftKey = false) => window.dispatchEvent(new KeyboardEvent('keydown', { key: k, shiftKey }));
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
  it('Per is hidden deep down and shown near the surface; Vy always shows', () => {
    const root = document.createElement('div');
    const views = new ViewState();
    const update = bindViewButtons(root, () => null, views);
    const per = root.querySelector<HTMLButtonElement>('[data-v="periscope"]')!;
    const vy = root.querySelector<HTMLButtonElement>('[data-v="view"]')!;
    update(crewGame({ depth: PERISCOPE_BUTTON_DEPTH + 30, designTrim: true }));
    expect(per.hidden).toBe(true);
    expect(vy.hidden).toBe(false);
    expect(root.querySelector('[data-v="cutaway"]')).toBeNull();
    update(crewGame({ depth: PERISCOPE_DEPTH, designTrim: true }));
    expect(per.hidden).toBe(false);
    expect(vy.hidden).toBe(false);
    // The console is opened from the log now, not from a view button.
    expect(root.querySelector('[data-v="console"]')).toBeNull();
  });
});

/** Pretends the screen is a phone (compact.ts reads the media query). */
function phone(on: boolean) {
  window.matchMedia = ((q: string) => ({ matches: on, media: q, addEventListener() {}, removeEventListener() {} })) as unknown as typeof window.matchMedia;
}

describe('the phone layout', () => {
  const realMatchMedia = window.matchMedia;
  afterEach(() => {
    window.matchMedia = realMatchMedia;
  });

  it('the telegraph is a lever: a tap or a drag along it orders the position on release', () => {
    expect(telegraphIndex(0)).toBe(0);
    expect(telegraphIndex(0.5)).toBe(TELEGRAPH.findIndex((b) => b.knots === 0));
    expect(telegraphIndex(1)).toBe(TELEGRAPH.length - 1);
    phone(true);
    const c = crewGame();
    const { root } = helm(c);
    const lever = root.querySelector('.helm-bells')!;
    drag(lever, [0.5, 0.5], [0.99, 0.5]);
    c.step();
    expect(c.setpoints.speed).toBe(TELEGRAPH.at(-1)!.knots);
    drag(lever, [0.2, 0.5], [0.2, 0.5]);
    c.step();
    expect(c.setpoints.speed).toBe(TELEGRAPH[telegraphIndex(0.2)]!.knots);
  });

  it('on a wide screen the lever leaves the bells to themselves (one order per press)', () => {
    phone(false);
    const c = crewGame();
    const { root } = helm(c);
    const before = c.queue.length;
    press(byTitle(root, 'Full fram'));
    expect(c.queue.length).toBe(before + 1);
  });

  it('one Auto/Hand chip per axis shows the state and switches it; a lock disables it', () => {
    const c = crewGame({ depth: 40, designTrim: true, speed: 4 * KN });
    const { root, refresh } = helm(c);
    const chip = byTitle(root, 'Kurs: växla mellan Auto och Hand');
    expect(chip.textContent).toBe('Auto');
    press(chip);
    c.step();
    refresh();
    expect(c.ap.heading).toBe(false);
    expect(chip.textContent).toBe('Hand');
    expect(chip.classList.contains('hand')).toBe(true);
    press(chip);
    c.step();
    refresh();
    expect(c.ap.heading).toBe(true);

    const locked = new Controller(new Simulation({ depth: 40, designTrim: true }));
    locked.options.locks = { depth: false };
    locked.crewTakesAll();
    expect(byTitle(helm(locked).root, 'Djup: växla mellan Auto och Hand').disabled).toBe(true);
  });

  it('"System ▾" opens the panel last shown; the tabs switch between the three', () => {
    const c = crewGame({ depth: 40, designTrim: true, speed: 4 * KN });
    const { root, refresh } = helm(c);
    const system = root.querySelector<HTMLButtonElement>('.helm-system')!;
    const panel = root.querySelector<HTMLElement>('.helm-panel')!;
    const tab = (name: string) => [...root.querySelectorAll<HTMLButtonElement>('.helm-tab')].find((t) => t.textContent === name)!;
    press(system);
    refresh();
    expect(panel.hidden).toBe(false);
    expect(tab('Ballast').classList.contains('on')).toBe(true);
    tab('Fart').click();
    refresh();
    expect(panel.textContent).toMatch(/rpm/);
    expect(tab('Fart').getAttribute('aria-selected')).toBe('true');
    press(system);
    expect(panel.hidden).toBe(true);
    press(system);
    expect(tab('Fart').classList.contains('on')).toBe(true);
    // A system the player handles marks its tab and the button.
    press(byTitle(root, 'Propellervarv +10 rpm'));
    c.step();
    refresh();
    expect(tab('Fart').classList.contains('self')).toBe(true);
    expect(system.classList.contains('self')).toBe(true);
  });

  it('"Vyer ▾" folds the view buttons out, and a choice folds them in', () => {
    const root = document.createElement('div');
    const views = new ViewState();
    const c = crewGame({ depth: PERISCOPE_DEPTH, designTrim: true });
    bindViewButtons(root, () => c, views)(c);
    const menu = root.querySelector<HTMLButtonElement>('[data-v="menu"]')!;
    menu.click();
    expect(root.classList.contains('open')).toBe(true);
    expect(menu.getAttribute('aria-expanded')).toBe('true');
    root.querySelector<HTMLButtonElement>('[data-v="view"]')!.click(); // external → (no bridge, no periscope) → cutaway
    expect(views.mode).toBe('cutaway');
    expect(root.classList.contains('open')).toBe(false);
  });

  it('the status bar shows what the controls do not: time, speed, water under the keel and trim', () => {
    const c = crewGame({ depth: 30, designTrim: true, speed: 4 * KN });
    const f = statusFields(c.sim.telemetry());
    expect(f.time).toBe('00:00');
    expect(f.speed).toBe('4,0 kn');
    expect(f.keel).toMatch(/^(köl \d+ m)?$/);
    expect(f.trim).toBe('Neutral');
    expect(statusFields({ ...c.sim.telemetry(), u: -2 * KN }).speed).toBe('back 2,0 kn');
    expect(statusFields({ ...c.sim.telemetry(), grounded: true }).keelAlarm).toBe(true);
  });

  it('no hint names a panel button: the buttons differ between phone and computer', () => {
    for (const sc of SCENARIOS) for (const o of sc.objectives) for (const hint of [o.hint, o.hintCrew ?? '']) expect(hint, `${sc.id}: ${o.text}`).not.toMatch(/▾/);
  });
});

describe('the panels', () => {
  it('one button opens the panels, on phones and computers alike', () => {
    const { root } = helm(crewGame());
    expect(root.querySelectorAll('.helm-system').length).toBe(1);
    expect(root.querySelector('.helm-panel-btn, .helm-panel-btns')).toBeNull();
  });

  it('Nödblåsning in the Ballast panel blows both tanks at depth, full ahead, the surface as target; the crew keeps the ballast', () => {
    const c = crewGame({ depth: 120, designTrim: true, speed: 4 * KN });
    const { root } = helm(c);
    openPanel(root, 'Ballast');
    press(root.querySelector('.helm-emergency')!);
    c.step();
    expect(c.sim.tanks.some((t) => t.blowOpen)).toBe(true);
    expect(c.setpoints.depth).toBe(0);
    expect(c.setpoints.speed).toBe(19);
    expect(c.duty('ballast')).toBe(true);
  });

  it('Per.djup sets periscope depth; surfaced, the crew dives for it', () => {
    const dived = crewGame({ depth: 40, designTrim: true });
    press(helm(dived).root.querySelector('.helm-perdepth')!);
    dived.step();
    expect(dived.setpoints.depth).toBe(PERISCOPE_DEPTH);
    const surfaced = crewGame({});
    press(helm(surfaced).root.querySelector('.helm-perdepth')!);
    surfaced.step();
    expect(surfaced.setpoints.depth).toBe(PERISCOPE_DEPTH);
    expect(surfaced.sim.tanks.some((t) => t.ventOpen)).toBe(true);
  });

  it('on computers the view buttons go to the dock in the screen controls, as icons', () => {
    const root = document.createElement('div');
    const dock = document.createElement('div');
    const c = crewGame({ depth: PERISCOPE_DEPTH, designTrim: true });
    bindViewButtons(root, () => c, new ViewState(), { mode: () => null, toggle: () => {} }, dock)(c);
    expect([...dock.querySelectorAll<HTMLButtonElement>('button')].map((b) => b.dataset.v)).toEqual(['view', 'chart', 'periscope', 'sonar', 'snorkel', 'radar']);
    for (const b of dock.querySelectorAll('button')) {
      expect(b.querySelector('svg')).not.toBeNull();
      expect(b.getAttribute('aria-label')).toBeTruthy();
    }
    expect(root.querySelector('[data-v="zoom"]')).not.toBeNull();
  });
});

describe('chart, sonar and the El panel', () => {
  it('the chart: north up, east right, the boat in the middle; depth colours from land to deep water', async () => {
    const { chartPoint, depthColor } = await import('../src/ui/navPanel');
    expect(chartPoint([0, 0], [0, 0], 1000, 200, 200)).toEqual([100, 100]);
    expect(chartPoint([1000, 0], [0, 0], 1000, 200, 200)).toEqual([100, 0]);
    expect(chartPoint([0, 1000], [0, 0], 1000, 200, 200)).toEqual([200, 100]);
    expect(depthColor(-5)).not.toBe(depthColor(5));
    expect(depthColor(500)).not.toBe(depthColor(5));
  });

  it('Karta and Sonar open the panel and light while it shows that page', () => {
    const root = document.createElement('div');
    let mode: 'chart' | 'sonar' | null = null;
    const c = crewGame({ depth: 30, designTrim: true });
    const update = bindViewButtons(root, () => c, new ViewState(), {
      mode: () => mode,
      toggle: (m) => (mode = mode === m ? null : m),
    });
    update(c);
    const chart = root.querySelector<HTMLButtonElement>('[data-v="chart"]')!;
    const sonar = root.querySelector<HTMLButtonElement>('[data-v="sonar"]')!;
    chart.click();
    expect(mode).toBe('chart');
    expect(chart.classList.contains('on')).toBe(true);
    sonar.click();
    expect(mode).toBe('sonar');
    expect(chart.classList.contains('on')).toBe(false);
    expect(sonar.classList.contains('on')).toBe(true);
  });

  it('the El panel: snorkel and diesel orders; a diesel order takes the charging over', () => {
    const c = crewGame({ depth: 13, neutral: true, battery: 0.5 });
    const { root, refresh } = helm(c);
    const panelBtn = openPanel(root, 'El');
    refresh();
    const panel = root.querySelector<HTMLElement>('.helm-panel')!;
    expect(panel.textContent).toMatch(/Maskinisten startar dieslarna/);
    expect(panel.textContent).toMatch(/50 %/);
    press(byTitle(root, 'Hissa snorkeln'));
    c.step();
    expect(c.sim.commands.snorkelUp).toBe(true);
    expect(c.duty('charging')).toBe(true);
    press(byTitle(root, 'Stoppa dieslarna'));
    c.step();
    refresh();
    expect(c.duty('charging')).toBe(false);
    expect(panelBtn.classList.contains('self')).toBe(true);
  });

  it('a leak shows in the El panel with its compartment', () => {
    const c = crewGame({ depth: 60, designTrim: true, leaks: { engine: 1e-3 } });
    for (let i = 0; i < 300; i++) c.step();
    const { root, refresh } = helm(c);
    openPanel(root, 'El');
    refresh();
    const text = root.querySelector('.helm-panel')!.textContent!;
    expect(text).toMatch(/Maskinrum/);
    expect(text).toMatch(/LÄCKA/);
    expect(text).toMatch(/länspumpen går/);
  });
});

describe('the fire control panel', () => {
  it('shows in the periscope view; Mål marks the vessel in the cross hair and Fyr is off without a solution', async () => {
    const { createFirePanel, solutionText } = await import('../src/ui/firePanel');
    const { freighter } = await import('../src/control/areas');
    const c = crewGame({ depth: 13, neutral: true, heading: 0, area: 'atlantic' });
    c.world.add([{ ...freighter('m', 'målet', [[3000, 0], [3000, 1]]), speed: 0 }]);
    c.submit({ kind: 'periscope', up: true }, 'keyboard');
    for (let i = 0; i < 1000; i++) c.step();
    const root = document.createElement('div');
    const views = new ViewState();
    const update = createFirePanel(root, () => c, views);
    update(c);
    expect(root.hidden).toBe(true);
    views.set('periscope');
    update(c);
    expect(root.hidden).toBe(false);
    expect(solutionText(c)).toMatch(/Inget mål/);
    const fire = byTitle(root, 'Skjut mot målet (F)');
    expect(fire.disabled).toBe(true);
    byTitle(root, 'Markera fartyget i hårkorset (T)').click();
    c.step();
    expect(c.fire.target?.name).toBe('målet');
    byTitle(root, 'Mät avståndet med stadimetern (R)').click();
    c.step();
    update(c);
    expect(solutionText(c)).toMatch(/^M1 målet: 3,0 km/);
    // The torpedo room makes the tubes ready (flood, open the doors) once a target is marked.
    expect(fire.disabled).toBe(true);
    expect(root.querySelectorAll('.fire-tube.loading')).toHaveLength(4);
    for (let i = 0; i < 2500; i++) c.step();
    update(c);
    expect(fire.disabled).toBe(false);
    expect(root.querySelectorAll('.fire-tube.loaded')).toHaveLength(4);
  });

  it('a second target shows a row to choose between them; a tap on a tube fires that tube', async () => {
    const { createFirePanel } = await import('../src/ui/firePanel');
    const { freighter } = await import('../src/control/areas');
    const c = crewGame({ depth: 13, neutral: true, heading: 0, area: 'atlantic' });
    c.world.add([
      { ...freighter('a', 'första', [[3000, 0], [3000, 1]]), speed: 0 },
      { ...freighter('b', 'andra', [[2500, 1500], [2500, 1501]]), speed: 0 },
    ]);
    c.submit({ kind: 'periscope', up: true }, 'keyboard');
    for (let i = 0; i < 1000; i++) c.step();
    const root = document.createElement('div');
    const views = new ViewState();
    views.set('periscope');
    const update = createFirePanel(root, () => c, views);
    const bearingTo = (n: number, e: number) => (Math.atan2(e - c.sim.y[1]!, n - c.sim.y[0]!) * 180) / Math.PI;
    c.submit({ kind: 'markTarget', bearing: bearingTo(3000, 0) }, 'keyboard');
    c.step();
    update(c);
    expect(root.querySelector<HTMLElement>('.fire-targets')!.hidden).toBe(true);
    c.submit({ kind: 'markTarget', bearing: bearingTo(2500, 1500) }, 'keyboard');
    c.step();
    update(c);
    const row = root.querySelector<HTMLElement>('.fire-targets')!;
    expect(row.hidden).toBe(false);
    expect(row.querySelector('.fire-target.on')!.textContent).toBe('M2');
    row.querySelector<HTMLButtonElement>('[data-label="M1"]')!.click();
    c.step();
    update(c);
    expect(c.fire.current).toBe('M1');
    expect(row.querySelector('.fire-target.on')!.textContent).toBe('M1');
    // With a solution (the crew's fire controller ranges too) and the tubes made ready by the torpedo room, tube 3 fires and empties.
    c.submit({ kind: 'rangeTarget', bearing: bearingTo(3000, 0) }, 'keyboard');
    for (let i = 0; i < 2500; i++) c.step();
    update(c);
    const tube3 = byTitle(root, 'Skjut från tub 3');
    expect(tube3.disabled).toBe(false);
    tube3.click();
    c.step();
    expect(c.fire.tubes.map((t) => t.loaded)).toEqual([true, true, false, true]);
  });
});

describe('the log book', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('lines live longer for warnings and long texts', () => {
    expect(lineLife('ack', 'Djup 120, ja').show).toBe(2.5);
    expect(lineLife('info', 'Kort.').show).toBe(4);
    expect(lineLife('error', 'Grundstötning!').show).toBe(6);
    expect(lineLife('error', 'x').fade).toBeGreaterThan(lineLife('info', 'x').fade);
    expect(lineLife('info', 'x'.repeat(160)).show).toBeGreaterThan(lineLife('info', 'x').show);
  });

  it('at most two lines show; each fades and goes after its time, and the window with the last one', () => {
    vi.useFakeTimers();
    const el = document.createElement('div');
    const c = new Controller(new Simulation({ depth: 30, designTrim: true }));
    bindLog(el, c);
    expect(el.classList.contains('idle')).toBe(true);
    for (let i = 0; i < 5; i++) c.addLog(`Rad ${i}`, 'ack');
    c.addLog('Varning!', 'error');
    expect(el.classList.contains('idle')).toBe(false);
    const live = () => [...el.querySelectorAll('.log-entry.live')].map((x) => x.textContent!.replace(/^\[.*?\]/, ''));
    expect(LIVE_LINES).toBe(2);
    expect(live()).toEqual(['Rad 4', 'Varning!']);
    vi.advanceTimersByTime(2600);
    expect(el.querySelectorAll('.log-entry.fading')).toHaveLength(1);
    vi.advanceTimersByTime(800);
    expect(live()).toEqual(['Varning!']);
    expect(el.classList.contains('idle')).toBe(false);
    // The error fades after 6 s: the window starts fading with it.
    vi.advanceTimersByTime(2700);
    expect(el.classList.contains('idle')).toBe(true);
    vi.advanceTimersByTime(1600);
    expect(live()).toEqual([]);
    // The history keeps them.
    expect(el.querySelectorAll('.log-entry').length).toBe(6);
  });

  it('a tap shows the history and another folds it; a new game folds it too', () => {
    const el = document.createElement('div');
    bindLogToggle(el);
    bindLog(el, crewGame());
    el.click();
    expect(el.classList.contains('expanded')).toBe(true);
    el.click();
    expect(el.classList.contains('expanded')).toBe(false);
    el.click();
    bindLog(el, crewGame());
    expect(el.classList.contains('expanded')).toBe(false);
  });
});
