// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { Controller } from '../src/control/controller';
import { HELP_TEXT } from '../src/control/parser';
import { SCENARIOS } from '../src/control/scenarios';
import { Simulation } from '../src/sim/simulation';
import { h, html, raw } from '../src/ui/dom';
import { createInstruments, LAYOUT } from '../src/ui/instruments';
import { Menu } from '../src/ui/menu';
import { SCREENS, type MenuState, type Screen } from '../src/ui/menuScreens';
import { DEFAULT_SETTINGS } from '../src/ui/settings';

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

const state = (over: Partial<MenuState> = {}): MenuState => ({
  settings: { ...DEFAULT_SETTINGS },
  pauseInfo: { mode: 'simplified', canSwitch: true },
  result: { scenario: SCENARIOS[0]!, completed: true, message: 'Uppdraget slutfört på 312 s.', time: 312 },
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

  it('the scenario list marks scenarios that need the realistic mode', () => {
    const div = document.createElement('div');
    div.innerHTML = SCREENS.scenarios(state()).value;
    const trim = div.querySelector('[data-arg="trim-drill"]')!;
    expect(trim.textContent).toMatch(/Kräver realistisk simulering/);
    expect(div.querySelectorAll('[data-action="scenario"]').length).toBe(SCENARIOS.length);
  });

  it('the help lists every console command, escaped', () => {
    const div = document.createElement('div');
    div.innerHTML = SCREENS.help(state()).value;
    expect(div.querySelector('pre')!.textContent).toBe(HELP_TEXT.join('\n'));
  });

  it('the pause menu offers the other mode, or says the scenario needs this one', () => {
    const a = document.createElement('div');
    a.innerHTML = SCREENS.pause(state()).value;
    expect(a.textContent).toMatch(/Byt till realistisk simulering/);
    const b = document.createElement('div');
    b.innerHTML = SCREENS.pause(state({ pauseInfo: { mode: 'realistic', canSwitch: false } })).value;
    expect(b.textContent).toMatch(/kräver realistisk simulering/);
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
        settingsChanged: (s) => calls.push(`settings ${s.mode}`),
        switchMode: () => calls.push('switch'),
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
    expect(calls).toEqual(['free fjord sea fog calm']);
  });
});

describe('instrument panel', () => {
  it('follows the layout of the game mode', () => {
    for (const mode of ['simplified', 'realistic'] as const) {
      const c = new Controller(new Simulation());
      c.setMode(mode);
      const el = document.createElement('div');
      createInstruments(el, c)(c.sim.telemetry());
      const more = el.querySelector('.inst-more')!;
      const mainText = Array.from(el.children).filter((n) => n !== more).map((n) => n.textContent).join(' ');
      expect(mainText.includes('Roder')).toBe(LAYOUT[mode].main.includes('rudder'));
      expect(more.textContent).toMatch(/Tankar/);
      expect(el.querySelectorAll('.ap').length).toBe(mode === 'realistic' ? 3 : 0);
    }
  });

  it('shows "→ yta" on the surface in the simplified mode, and the trim', () => {
    const c = new Controller(new Simulation());
    c.setMode('simplified');
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
