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

  it('the help lists every console command, escaped', () => {
    const div = document.createElement('div');
    div.innerHTML = SCREENS.help(state()).value;
    expect(div.querySelector('pre')!.textContent).toBe(HELP_TEXT.join('\n'));
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
