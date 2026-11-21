// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { Controller } from '../src/control/controller';
import { HELP_TEXT } from '../src/control/parser';
import { SCENARIOS } from '../src/control/scenarios';
import { Simulation } from '../src/sim/simulation';
import { h, html, raw } from '../src/ui/dom';
import { createInstruments, instrumentLayout } from '../src/ui/instruments';
import { Menu } from '../src/ui/menu';
import { SCREENS, handledText, type MenuState, type Screen } from '../src/ui/menuScreens';
import { CREW_SYSTEMS, type CrewDuties } from '../src/control/crew';
import { DEFAULT_SETTINGS } from '../src/ui/settings';
import { bindLog } from '../src/ui/log';
import { OBJECTIVE_SHOW, OBJECTIVE_TAP_SHOW, createObjective } from '../src/ui/objective';
import { ScenarioRunner } from '../src/control/scenarios';

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
  pauseInfo: { duties: allCrew(), locks: {} },
  result: { scenario: SCENARIOS[0]!, completed: true, message: 'Uppdraget slutfört på 312 s.', time: 312, selfHandled: ['trim', 'safetyNet'] },
  briefing: SCENARIOS.find((s) => s.id === 'trim-drill')!,
  order: { text: 'Ta er obemärkt genom sundet.', no: 417 },
  logLines: [{ t: 12, text: 'Djup <80>, ja', kind: 'ack' }],
  error: 'Fel: <test>\n  at frame',
  graphicsBack: false,
  area: 'westCoast',
  conditions: 'day',
  sea: 'calm',
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

  it('the scenario list shows what a scenario locks', () => {
    const div = document.createElement('div');
    div.innerHTML = SCREENS.scenarios(state()).value;
    expect(div.querySelector('[data-arg="trim-drill"]')!.textContent).toMatch(/Du sköter djup och trim själv/);
    expect(div.querySelector('[data-arg="emergency-blow"]')!.textContent).toMatch(/Utan skyddsnät/);
    expect(div.querySelectorAll('[data-action="scenario"]').length).toBe(SCENARIOS.length);
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
    b.innerHTML = SCREENS.pause(state({ pauseInfo: { duties: allCrew({ trim: false, depth: false, safetyNet: false }), locks: {} } })).value;
    expect(b.textContent).toMatch(/Du sköter djup och trim\. Besättningen sköter resten\. Skyddsnätet är av\./);
  });

  it('☰ → Besättning has a choice per system, with locked choices disabled', () => {
    const div = document.createElement('div');
    div.innerHTML = SCREENS.crew(state({ pauseInfo: { duties: allCrew({ depth: false }), locks: { depth: false } } })).value;
    expect(div.querySelectorAll('.crew-row').length).toBe(CREW_SYSTEMS.length);
    expect(div.querySelector<HTMLButtonElement>('[data-arg="depth:1"]')!.disabled).toBe(true);
    expect(div.querySelector('[data-arg="depth:0"]')!.getAttribute('aria-pressed')).toBe('true');
    expect(div.querySelector<HTMLButtonElement>('[data-arg="trim:0"]')!.disabled).toBe(false);
    expect(div.textContent).toMatch(/Här styr du djupet själv/);
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

  it('the Menu calls back on clicks and keeps its own choices', () => {
    const root = document.createElement('div');
    const calls: string[] = [];
    const menu = new Menu(
      root,
      {
        startFree: (area, start, cond, sea) => calls.push(`free ${area} ${start} ${cond} ${sea}`),
        startScenario: (id) => calls.push(`scenario ${id}`),
        resume: () => calls.push('resume'),
        restart: () => calls.push('restart'),
        toMainMenu: () => calls.push('main'),
        settingsChanged: (s) => calls.push(`settings ${s.timeScale}`),
        crewChange: (system, crew) => calls.push(`crew ${system} ${crew}`),
        introDone: () => calls.push('intro'),
        briefingDone: () => calls.push('briefing'),
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
    (root.querySelector('[data-action="free"]') as HTMLElement).click();
    menu.setPauseInfo({ duties: allCrew(), locks: {} });
    menu.show('crew');
    (root.querySelector('[data-arg="trim:0"]') as HTMLElement).click();
    expect(calls).toEqual(['free fjord sea fog calm', 'crew trim false']);
  });

  it('the briefing lists every objective; Besättning comes back to it, Till sjöss starts', () => {
    const root = document.createElement('div');
    const calls: string[] = [];
    const noop = () => {};
    const menu = new Menu(
      root,
      { startFree: noop, startScenario: noop, resume: noop, restart: noop, toMainMenu: () => calls.push('main'), settingsChanged: noop, crewChange: noop, introDone: noop, briefingDone: () => calls.push('briefing'), reload: noop, graphicsOk: noop },
      { ...DEFAULT_SETTINGS },
    );
    const sc = SCENARIOS.find((s) => s.id === 'trim-drill')!;
    menu.setPauseInfo({ duties: allCrew({ depth: false, trim: false }), locks: sc.locks ?? {} });
    menu.showBriefing(sc);
    expect(root.querySelector('h2')!.textContent).toMatch(sc.title);
    const goals = [...root.querySelectorAll('.briefing-goals li')].map((li) => li.textContent ?? '');
    expect(goals).toHaveLength(sc.objectives.length);
    sc.objectives.forEach((o, i) => expect(goals[i]).toMatch(o.text));
    expect(root.textContent).toMatch(/Du sköter djup och trim själv/);
    (root.querySelector('[data-arg="crew"]') as HTMLElement).click();
    expect(menu.current).toBe('crew');
    (root.querySelector('[data-action="back"]') as HTMLElement).click();
    expect(menu.current).toBe('briefing');
    (root.querySelector('[data-action="briefingDone"]') as HTMLElement).click();
    expect(calls).toEqual(['briefing']);
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
    startScenario: () => {},
    resume: () => {},
    restart: () => calls.push('restart'),
    toMainMenu: () => calls.push('main'),
    settingsChanged: () => {},
    crewChange: () => {},
    introDone: () => {},
    briefingDone: () => {},
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

describe('objective box', () => {
  const setup = () => {
    const sc = SCENARIOS.find((s) => s.id === 'first-dive')!;
    const ctrl = new Controller(new Simulation(sc.initial));
    ctrl.crewTakesAll();
    const runner = new ScenarioRunner(sc, ctrl);
    const box = createObjective(document.createElement('div'));
    return { sc, ctrl, runner, box };
  };

  it('opens for a new objective, folds by itself, and opens again on a tap', () => {
    const { sc, runner, box } = setup();
    box.update(null, 0);
    expect(box.el.hidden).toBe(true);
    box.update(runner, 0);
    expect(box.el.hidden).toBe(false);
    expect(box.expanded).toBe(true);
    expect(box.el.querySelector('.obj-step')!.textContent).toBe(`1/${sc.objectives.length}`);
    expect(box.el.querySelector('.obj-text')!.textContent).toBe(sc.objectives[0]!.text);
    expect(box.el.querySelectorAll('.obj-list li')).toHaveLength(sc.objectives.length);
    // Paused (dt = 0): stays open behind the menu.
    for (let i = 0; i < 100; i++) box.update(runner, 0);
    expect(box.expanded).toBe(true);
    for (let i = 0; i < OBJECTIVE_SHOW * 10 + 1; i++) box.update(runner, 0.1);
    expect(box.expanded).toBe(false);
    expect(box.el.classList.contains('expanded')).toBe(false);
    box.el.querySelector<HTMLButtonElement>('.obj-head')!.click();
    expect(box.expanded).toBe(true);
    expect(box.el.querySelector('.obj-head')!.getAttribute('aria-expanded')).toBe('true');
    for (let i = 0; i < OBJECTIVE_TAP_SHOW * 10 + 1; i++) box.update(runner, 0.1);
    expect(box.expanded).toBe(false);
    box.toggle();
    box.toggle();
    expect(box.expanded).toBe(false);
  });

  it('quiet (fire panel on a phone on its side): a new objective marks the head instead of opening', () => {
    const { runner, box } = setup();
    box.update(runner, 0, true);
    expect(box.expanded).toBe(false);
    expect(box.el.classList.contains('fresh')).toBe(true);
    for (let i = 0; i < OBJECTIVE_SHOW * 10 + 1; i++) box.update(runner, 0.1, true);
    expect(box.el.classList.contains('fresh')).toBe(false);
    box.toggle();
    expect(box.expanded).toBe(true);
  });

  it('opens again when the objective changes or its hint does, and marks the done ones', () => {
    const { sc, ctrl, runner, box } = setup();
    box.update(runner, 0);
    box.update(runner, OBJECTIVE_SHOW + 1);
    expect(box.expanded).toBe(false);
    // The hint follows who handles the objective's system.
    // The first objective's hint follows who handles the ballast.
    ctrl.submit({ kind: 'crew', system: 'ballast', crew: false }, 'touch');
    ctrl.step();
    box.update(runner, 0.1);
    expect(box.expanded).toBe(true);
    expect(box.el.querySelector('.obj-hint')!.textContent).toBe(sc.objectives[0]!.hint);
    box.update(runner, OBJECTIVE_SHOW + 1);
    // Pretend the first objective is met: the runner moves on.
    (runner as unknown as { index: number }).index = 1;
    box.update(runner, 0.1);
    expect(box.expanded).toBe(true);
    expect(box.el.querySelector('.obj-list li.done')!.textContent).toBe(`✓ ${sc.objectives[0]!.text}`);
    expect(box.el.querySelector('.obj-list li.current')!.textContent).toBe(sc.objectives[1]!.text);
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
});
