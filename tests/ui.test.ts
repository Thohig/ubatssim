// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { Controller } from '../src/control/controller';
import { HELP_TEXT } from '../src/control/parser';
import { Simulation } from '../src/sim/simulation';
import { h, html, raw } from '../src/ui/dom';
import { createInstruments, instrumentLayout } from '../src/ui/instruments';
import { Menu } from '../src/ui/menu';
import { SCREENS, handledText, type MenuState, type Screen } from '../src/ui/menuScreens';
import { CREW_SYSTEMS, type CrewDuties } from '../src/control/crew';
import { DEFAULT_SETTINGS } from '../src/ui/settings';
import { bindLog } from '../src/ui/log';

describe('dom helpers', () => {
  it('html escapes inserted values, but not nested html or raw', () => {
    expect(html`<p>${'<b>&"\''}</p>`.value).toBe('<p>&lt;b&gt;&amp;&quot;&#39;</p>');
    expect(html`<p>${html`<b>${'x<'}</b>`}</p>`.value).toBe('<p><b>x&lt;</b></p>');
    expect(html`<i>${['a', html`<b>b</b>`, null, false, 3]}</i>`.value).toBe('<i>a<b>b</b>3</i>');
    expect(html`${raw('<br/>')}`.value).toBe('<br/>');
  });

  it('h builds elements with text children (no HTML parsing)', () => {
    const el = h('div', { class: 'x', 'data-arg': 'y' }, '<b>', h('span', null, 'z'));
    expect(el.className).toBe('x');
    expect(el.dataset.arg).toBe('y');
    expect(el.innerHTML).toBe('&lt;b&gt;<span>z</span>');
  });
});

const allCrew = (over: Partial<CrewDuties> = {}): CrewDuties => ({ ...(Object.fromEntries(CREW_SYSTEMS.map((x) => [x, true])) as CrewDuties), ...over });

const state = (over: Partial<MenuState> = {}): MenuState => ({
  settings: { ...DEFAULT_SETTINGS },
  pauseInfo: { duties: allCrew(), expert: true },
  result: { message: 'Skrovet kollapsade under krossdjupet.', time: 559, selfHandled: ['trim', 'safetyNet'] },
  order: { text: 'Ta er obemärkt genom sundet.', no: 417 },
  logLines: [{ t: 12, text: 'Djup <80>, ja', kind: 'ack' }],
  error: 'Fel: <test>\n  at frame',
  graphicsBack: false,
  area: 'westCoast',
  conditions: 'day',
  sea: 'calm',
  patrols: true,
  ...over,
});

describe('menu screens', () => {
  it('no screen shows markup as text (every nested template is html)', () => {
    for (const screen of Object.keys(SCREENS) as Screen[]) {
      const div = document.createElement('div');
      div.innerHTML = SCREENS[screen](state()).value;
      expect(div.textContent, screen).not.toMatch(/<\/?(button|label|span|b|p|input|li|div)\b/);
      expect(div.querySelectorAll('button, input').length, screen).toBeGreaterThan(0);
    }
  });

  it('☰ → Loggbok shows the history as text, with the time; the pause menu leads there', () => {
    const pause = document.createElement('div');
    pause.innerHTML = SCREENS.pause(state()).value;
    expect(pause.querySelector('[data-arg="logbook"]')).not.toBeNull();
    const div = document.createElement('div');
    div.innerHTML = SCREENS.logbook(state()).value;
    expect(div.querySelector('.logbook .log-entry.ack')!.textContent).toBe('[00:00:12]Djup <80>, ja');
    div.innerHTML = SCREENS.logbook(state({ logLines: [] })).value;
    expect(div.textContent).toMatch(/Inget loggat/);
  });

  it('the help no longer speaks of a console; it tells how to choose a target and a tube', () => {
    const div = document.createElement('div');
    div.innerHTML = SCREENS.help(state()).value;
    expect(div.textContent).not.toMatch(/konsol/i);
    expect(div.textContent).toMatch(/laddad tub/);
    expect(div.textContent).toMatch(/M1, M2/);
  });

  it('the pause menu says who handles what and leads to ☰ → Besättning', () => {
    const a = document.createElement('div');
    a.innerHTML = SCREENS.pause(state()).value;
    expect(a.textContent).toMatch(/Besättningen sköter allt/);
    expect(a.querySelector('[data-arg="crew"]')).not.toBeNull();
    const b = document.createElement('div');
    b.innerHTML = SCREENS.pause(state({ pauseInfo: { duties: allCrew({ trim: false, depth: false, safetyNet: false }), expert: true } })).value;
    expect(b.textContent).toMatch(/Du sköter djup och trim\. Besättningen sköter resten\. Skyddsnätet är av\./);
  });

  it('☰ → Besättning has a choice per system in expert mode', () => {
    const div = document.createElement('div');
    div.innerHTML = SCREENS.crew(state({ pauseInfo: { duties: allCrew({ depth: false }), expert: true } })).value;
    // The manoeuvre row first, then one per system.
    expect(div.querySelectorAll('.crew-row').length).toBe(CREW_SYSTEMS.length + 1);
    expect(div.querySelector('[data-arg="depth:0"]')!.getAttribute('aria-pressed')).toBe('true');
    expect(div.querySelector<HTMLButtonElement>('[data-arg="depth:1"]')!.disabled).toBe(false);
    expect(div.querySelector('[data-action="expert"][data-arg="1"]')!.getAttribute('aria-pressed')).toBe('true');
  });

  it('outside expert mode ☰ → Besättning shows only what the crew does besides the manoeuvre', () => {
    const div = document.createElement('div');
    div.innerHTML = SCREENS.crew(state({ pauseInfo: { duties: allCrew(), expert: false } })).value;
    expect(div.querySelector('[data-arg="depth:0"]')).toBeNull();
    expect(div.querySelector('[data-arg="charging:0"]')).not.toBeNull();
    expect(div.querySelector('[data-arg="all:0"]')).toBeNull();
    expect(div.querySelector('[data-action="expert"][data-arg="0"]')!.getAttribute('aria-pressed')).toBe('true');
    expect(div.querySelector<HTMLButtonElement>('[data-action="expert"][data-arg="1"]')!.disabled).toBe(false);
  });

  it('the result says what the player handled', () => {
    expect(handledText([])).toBe('Besättningen skötte allt.');
    expect(handledText(['trim', 'ballast'])).toBe('Du skötte själv trimmet och ballasten.');
    expect(handledText(['safetyNet', 'depth'])).toBe('Du skötte själv djupet, utan skyddsnät.');
    expect(handledText(['safetyNet'])).toBe('Besättningen skötte allt, utan skyddsnät.');
    const div = document.createElement('div');
    div.innerHTML = SCREENS.result(state()).value;
    expect(div.textContent).toMatch(/Du skötte själv trimmet, utan skyddsnät/);
  });

  it('the game ends when the boat is lost: the time at sea, play again or a new area', () => {
    const div = document.createElement('div');
    div.innerHTML = SCREENS.result(state()).value;
    expect(div.textContent).toMatch(/Ubåten förlorad/);
    expect(div.textContent).toMatch(/Skrovet kollapsade/);
    expect(div.textContent).toMatch(/00:09:19/);
    expect(div.querySelector('[data-action="restart"]')).not.toBeNull();
    expect(div.querySelector('[data-arg="free"]')).not.toBeNull();
  });

  it('the start page and the help speak of no scenarios', () => {
    for (const screen of ['main', 'help', 'pause'] as Screen[]) {
      const div = document.createElement('div');
      div.innerHTML = SCREENS[screen](state()).value;
      expect(div.textContent, screen).not.toMatch(/scenari|målrutan/i);
    }
  });

  it('the Menu calls back on clicks and keeps its own choices', () => {
    const root = document.createElement('div');
    const calls: string[] = [];
    const menu = new Menu(
      root,
      {
        startFree: (area, start, cond, sea, patrols) => calls.push(`free ${area} ${start} ${cond} ${sea}${patrols ? '' : ' fredligt'}`),
        resume: () => calls.push('resume'),
        restart: () => calls.push('restart'),
        toMainMenu: () => calls.push('main'),
        settingsChanged: (s) => calls.push(`settings ${s.timeScale}`),
        crewChange: (system, crew) => calls.push(`crew ${system} ${crew}`),
        expertChange: (on) => calls.push(`expert ${on}`),
        introDone: () => calls.push('intro'),
        reload: () => calls.push('reload'),
        graphicsOk: () => calls.push('graphicsOk'),
      },
      { ...DEFAULT_SETTINGS },
    );
    menu.show('main');
    (root.querySelector('[data-arg="free"]') as HTMLElement).click();
    (root.querySelector('[data-arg="fjord"]') as HTMLElement).click();
    const fog = root.querySelector('input[name=conditions][value=fog]') as HTMLInputElement;
    fog.checked = true;
    fog.dispatchEvent(new Event('change', { bubbles: true }));
    // Fjorden has no corvettes in free play: no choice there.
    expect(root.querySelector('input[name=patrols]')).toBeNull();
    (root.querySelector('[data-action="free"]') as HTMLElement).click();
    // Östersjön has one: free play without it.
    menu.show('free');
    (root.querySelector('[data-arg="baltic"]') as HTMLElement).click();
    const none = root.querySelector('input[name=patrols][value=off]') as HTMLInputElement;
    none.checked = true;
    none.dispatchEvent(new Event('change', { bubbles: true }));
    (root.querySelector('[data-action="free"]') as HTMLElement).click();
    menu.setPauseInfo({ duties: allCrew(), expert: true });
    menu.show('crew');
    (root.querySelector('[data-arg="trim:0"]') as HTMLElement).click();
    (root.querySelector('[data-action="expert"][data-arg="0"]') as HTMLElement).click();
    expect(calls).toEqual(['free fjord sea fog calm', 'free baltic surface fog calm fredligt', 'crew trim false', 'expert false']);
  });
});

describe('instrument panel', () => {
  it('brings what the player takes over into the main panel', () => {
    const crew = instrumentLayout(allCrew());
    expect(crew.main).not.toContain('rudder');
    expect(crew.more).toContain('rudder');
    const hand = instrumentLayout(allCrew({ heading: false, trim: false }));
    expect(hand.main).toEqual(expect.arrayContaining(['rudder', 'net', 'tanks']));
    expect(hand.more).not.toContain('rudder');
    for (const l of [crew, hand]) {
      expect(l.more[0]).not.toBe('sep');
      expect(l.more.at(-1)).not.toBe('sep');
    }
    const c = new Controller(new Simulation());
    c.crewTakesAll();
    const el = document.createElement('div');
    createInstruments(el, c)(c.sim.telemetry());
    const more = el.querySelector('.inst-more')!;
    expect(more.textContent).toMatch(/Tankar/);
    expect(el.querySelectorAll('.ap').length).toBe(0);
    // "Mer ▾" folds the rest, and the state survives a rebuild.
    const toggle = el.querySelector<HTMLButtonElement>('.inst-toggle')!;
    expect(el.classList.contains('expanded')).toBe(false);
    toggle.click();
    expect(el.classList.contains('expanded')).toBe(true);
    expect(toggle.textContent).toBe('Mindre ▴');
    createInstruments(el, c);
    expect(el.querySelector('.inst-toggle')!.textContent).toBe('Mindre ▴');
  });

  it('shows "→ yta" on the surface with the crew on the depth, and the trim', () => {
    const c = new Controller(new Simulation());
    c.crewTakesAll();
    for (let i = 0; i < 10; i++) c.step();
    const el = document.createElement('div');
    createInstruments(el, c)(c.sim.telemetry());
    expect(el.textContent).toMatch(/→ yta/);
    expect(el.textContent).toMatch(/Ytläge/);
  });

  it('marks shallow water and grounding as an alarm', () => {
    const c = new Controller(new Simulation());
    const el = document.createElement('div');
    const update = createInstruments(el, c);
    const t = c.sim.telemetry();
    update({ ...t, depthUnderKeel: 3 });
    expect(el.querySelector('.alarm')).not.toBeNull();
    update({ ...t, depthUnderKeel: 200 });
    expect(el.querySelector('.alarm')).toBeNull();
  });
});

describe('log history', () => {
  it('keeps the whole help list and the lines before it', () => {
    const ctrl = new Controller(new Simulation());
    const el = document.createElement('div');
    bindLog(el, ctrl);
    ctrl.addLog('Före hjälpen', 'info');
    for (const line of HELP_TEXT) ctrl.addLog(line, 'info');
    const text = [...el.children].map((c) => c.textContent ?? '');
    expect(text.some((t) => t.includes('Före hjälpen'))).toBe(true);
    expect(text.some((t) => t.includes(HELP_TEXT[0]!))).toBe(true);
  });
});

describe('error and lost graphics', () => {
  const handlers = (calls: string[]) => ({
    startFree: () => {},
    resume: () => {},
    restart: () => calls.push('restart'),
    toMainMenu: () => calls.push('main'),
    settingsChanged: () => {},
    crewChange: () => {},
    expertChange: () => {},
    introDone: () => {},
    reload: () => calls.push('reload'),
    graphicsOk: () => calls.push('graphicsOk'),
  });

  it('the error screen shows the report as text and offers a new start', () => {
    const root = document.createElement('div');
    const calls: string[] = [];
    const menu = new Menu(root, handlers(calls), { ...DEFAULT_SETTINGS });
    menu.showError('Fel: <b>x</b>\nat frame (app.ts:1)');
    expect(menu.current).toBe('error');
    expect(root.querySelector('textarea')!.value).toBe('Fel: <b>x</b>\nat frame (app.ts:1)');
    expect(root.querySelector('b')).toBeNull();
    (root.querySelector('[data-action="restart"]') as HTMLElement).click();
    (root.querySelector('[data-action="reload"]') as HTMLElement).click();
    (root.querySelector('[data-action="main"]') as HTMLElement).click();
    expect(calls).toEqual(['restart', 'reload', 'main']);
  });

  it('lost graphics: only Ladda om until they come back, then Fortsätt', () => {
    const root = document.createElement('div');
    const calls: string[] = [];
    const menu = new Menu(root, handlers(calls), { ...DEFAULT_SETTINGS });
    menu.showGraphics(false);
    expect(root.querySelector('[data-action="graphicsOk"]')).toBeNull();
    expect(root.querySelector('[data-action="reload"]')).not.toBeNull();
    menu.showGraphics(true);
    (root.querySelector('[data-action="graphicsOk"]') as HTMLElement).click();
    expect(calls).toEqual(['graphicsOk']);
  });
});

describe('the periscope eyepiece and its bearing band', () => {
  it('the band lies outside the circle: below it with room above the controls, else above it', async () => {
    const { periscopeLayout } = await import('../src/ui/viewOverlay');
    for (const [w, h, clear] of [
      [1400, 860, 700],
      [1280, 800, 560],
      [375, 812, 520],
      [812, 375, 300],
      [1920, 1080, 1000],
    ] as const) {
      const { r, bandY } = periscopeLayout(w, h, clear);
      const cy = h / 2;
      expect(r).toBeGreaterThan(Math.min(w, h) * 0.25);
      // The band (its label 44 px above the line, the buoy mark 30 px below) does not reach into the circle.
      expect(bandY + 30 <= cy - r || bandY - 44 >= cy + r, `${w}×${h}`).toBe(true);
      expect(bandY - 44).toBeGreaterThanOrEqual(0);
      if (bandY > cy) expect(bandY + 30).toBeLessThanOrEqual(clear);
    }
  });

  it('on an ordinary desktop window the band stays clear of the log and the mode label at the top', async () => {
    const { periscopeLayout } = await import('../src/ui/viewOverlay');
    // 1280 × 800 and 1280 × 720 with the screen controls ~100 px high: the band lay under the log at the top.
    for (const [w, h, clear] of [
      [1280, 800, 700],
      [1280, 720, 620],
      [1024, 768, 670],
    ] as const) {
      const { r, bandY } = periscopeLayout(w, h, clear);
      expect(r).toBeGreaterThan(Math.min(w, h) * 0.25);
      if (bandY < h / 2) expect(bandY - 44, `${w}×${h}`).toBeGreaterThanOrEqual(108);
      else expect(bandY + 30, `${w}×${h}`).toBeLessThanOrEqual(clear);
    }
  });

  it('a panel beside it at the horizon (the fire panel in a small window) does not cover the horizon in the circle', async () => {
    const { periscopeLayout } = await import('../src/ui/viewOverlay');
    // 800 × 600: the fire panel's left edge at 536 px.
    const { r } = periscopeLayout(800, 600, 450, 536);
    expect(400 + r).toBeLessThanOrEqual(536);
    expect(r).toBeGreaterThan(600 * 0.15);
    // A large window: the panel is far to the right and changes nothing.
    expect(periscopeLayout(1280, 800, 700, 986).r).toBe(periscopeLayout(1280, 800, 700).r);
  });
});
