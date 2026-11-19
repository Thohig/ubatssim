/**
 * Start menu, pause menu and result screen as a DOM overlay. The menu only
 * renders screens and calls back into main.ts; it owns no game state.
 */
import { HELP_TEXT } from '../control/parser';
import { SCENARIOS, type Scenario } from '../control/scenarios';
import { formatSimTime } from '../control/controller';
import { loadBestTimes, type Settings } from './settings';

export type FreeStart = 'surface' | 'periscope' | 'deep' | 'archipelago';

export interface MenuHandlers {
  startFree(start: FreeStart): void;
  startScenario(id: string): void;
  resume(): void;
  restart(): void;
  toMainMenu(): void;
  settingsChanged(s: Settings): void;
}

export interface ResultInfo {
  scenario: Scenario;
  completed: boolean;
  message: string;
  time: number;
  newBest: boolean;
}

type Screen = 'main' | 'free' | 'scenarios' | 'settings' | 'help' | 'pause' | 'result';

const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

export class Menu {
  private screen: Screen = 'main';
  /** Where "Tillbaka" goes from settings/help: the main or the pause menu. */
  private base: 'main' | 'pause' = 'main';
  private result: ResultInfo | null = null;

  constructor(
    private readonly root: HTMLElement,
    private readonly h: MenuHandlers,
    private settings: Settings,
  ) {
    root.addEventListener('click', (e) => {
      const target = (e.target as HTMLElement).closest<HTMLElement>('[data-action]');
      if (target) this.onAction(target.dataset.action!, target.dataset.arg);
    });
    root.addEventListener('change', (e) => {
      const input = e.target as HTMLInputElement;
      if (input.name) this.onSetting(input.name, input.type === 'checkbox' ? String(input.checked) : input.value);
    });
  }

  get visible(): boolean {
    return !this.root.hidden;
  }

  get current(): Screen {
    return this.screen;
  }

  show(screen: Screen): void {
    if (screen === 'main' || screen === 'pause') this.base = screen;
    this.screen = screen;
    this.root.hidden = false;
    this.root.dataset.screen = screen;
    this.root.innerHTML = `<div class="menu-card">${this.render()}</div>`;
    this.root.querySelector<HTMLElement>('button, input')?.focus({ preventScroll: true });
  }

  showResult(r: ResultInfo): void {
    this.result = r;
    this.show('result');
    this.base = 'main';
  }

  hide(): void {
    this.root.hidden = true;
  }

  private onAction(action: string, arg?: string): void {
    switch (action) {
      case 'nav':
        this.show(arg as Screen);
        break;
      case 'back':
        this.show(this.base);
        break;
      case 'free':
        this.h.startFree(arg as FreeStart);
        break;
      case 'scenario':
        this.h.startScenario(arg!);
        break;
      case 'resume':
        this.h.resume();
        break;
      case 'restart':
        this.h.restart();
        break;
      case 'main':
        this.h.toMainMenu();
        break;
    }
  }

  private onSetting(name: string, value: string): void {
    const s = { ...this.settings };
    if (name === 'timeScale') s.timeScale = Number(value) as Settings['timeScale'];
    if (name === 'autopilot') s.autopilot = value === 'true';
    if (name === 'touch') s.touch = value as Settings['touch'];
    if (name === 'particles') s.particles = value === 'true';
    this.settings = s;
    this.h.settingsChanged(s);
  }

  private render(): string {
    const back = `<button class="menu-btn secondary" data-action="back">‹ Tillbaka</button>`;
    switch (this.screen) {
      case 'main':
        return `
          <h1 class="menu-title">Ubåtssim</h1>
          <p class="menu-sub">Realistisk simulering av en dieselelektrisk ubåt</p>
          <div class="menu-list">
            <button class="menu-btn primary" data-action="nav" data-arg="free">Fritt spel</button>
            <button class="menu-btn" data-action="nav" data-arg="scenarios">Scenarier</button>
            <button class="menu-btn" data-action="nav" data-arg="settings">Inställningar</button>
            <button class="menu-btn" data-action="nav" data-arg="help">Hjälp</button>
          </div>`;

      case 'pause':
        return `
          <h2 class="menu-title small">Paus</h2>
          <div class="menu-list">
            <button class="menu-btn primary" data-action="resume">Fortsätt</button>
            <button class="menu-btn" data-action="restart">Starta om</button>
            <button class="menu-btn" data-action="nav" data-arg="settings">Inställningar</button>
            <button class="menu-btn" data-action="nav" data-arg="help">Hjälp</button>
            <button class="menu-btn secondary" data-action="main">Huvudmeny</button>
          </div>`;

      case 'free':
        return `
          <h2 class="menu-title small">Fritt spel</h2>
          <p class="menu-sub">Välj var du vill börja.</p>
          <div class="menu-list">
            <button class="menu-btn choice" data-action="free" data-arg="surface"><b>Ytläge</b><span>Stilla vid ytan på öppet hav, skärgården 2 km österut.</span></button>
            <button class="menu-btn choice" data-action="free" data-arg="archipelago"><b>Skärgården</b><span>I ytläge i ett smalt sund mellan kobbar och skär.</span></button>
            <button class="menu-btn choice" data-action="free" data-arg="periscope"><b>Periskopdjup</b><span>18 m, 4 knop, neutralt trimmad.</span></button>
            <button class="menu-btn choice" data-action="free" data-arg="deep"><b>Djupt vatten</b><span>100 m, 8 knop, under språngskiktet.</span></button>
          </div>
          ${back}`;

      case 'scenarios': {
        const best = loadBestTimes();
        const cards = SCENARIOS.map(
          (s) => `
          <button class="menu-btn choice scenario" data-action="scenario" data-arg="${esc(s.id)}">
            <b>${esc(s.title)} <span class="badge ${esc(s.difficulty)}">${esc(s.difficulty)}</span></b>
            <span>${esc(s.description)}</span>
            <span class="meta">${s.autopilotAllowed ? '' : 'Utan autopilot · '}${s.objectives.length} mål${best[s.id] !== undefined ? ` · Bästa tid ${formatSimTime(best[s.id]!)}` : ''}</span>
          </button>`,
        ).join('');
        return `<h2 class="menu-title small">Scenarier</h2><div class="menu-list">${cards}</div>${back}`;
      }

      case 'settings': {
        const s = this.settings;
        const radio = (name: string, value: string, label: string, checked: boolean) =>
          `<label class="opt"><input type="radio" name="${name}" value="${value}" ${checked ? 'checked' : ''}/> ${label}</label>`;
        return `
          <h2 class="menu-title small">Inställningar</h2>
          <fieldset><legend>Tidskomprimering</legend>
            ${radio('timeScale', '1', '×1', s.timeScale === 1)}${radio('timeScale', '2', '×2', s.timeScale === 2)}${radio('timeScale', '4', '×4', s.timeScale === 4)}
          </fieldset>
          <fieldset><legend>Fritt spel</legend>
            <label class="opt"><input type="checkbox" name="autopilot" ${s.autopilot ? 'checked' : ''}/> Tillåt autopilot för djup och kurs</label>
          </fieldset>
          <fieldset><legend>Pekknappar</legend>
            ${radio('touch', 'auto', 'Automatiskt', s.touch === 'auto')}${radio('touch', 'on', 'Alltid', s.touch === 'on')}${radio('touch', 'off', 'Aldrig', s.touch === 'off')}
          </fieldset>
          <fieldset><legend>Grafik</legend>
            <label class="opt"><input type="checkbox" name="particles" ${s.particles ? 'checked' : ''}/> Svävande partiklar</label>
          </fieldset>
          <p class="menu-note">Inställningarna sparas i den här webbläsaren.</p>
          ${back}`;
      }

      case 'help':
        return `
          <h2 class="menu-title small">Hjälp</h2>
          <div class="help">
            <h3>Tangentbord</h3>
            <table>
              <tr><td>← / →</td><td>Roder 5° babord / styrbord</td></tr>
              <tr><td>↑ / ↓</td><td>Djuproder 5° upp / ned</td></tr>
              <tr><td>Shift + ↑ / ↓</td><td>Fart ±1 knop</td></tr>
              <tr><td>Mellanslag</td><td>Roder midskepps</td></tr>
              <tr><td>Enter eller /</td><td>Öppna konsolen (↑/↓ bläddrar i historiken)</td></tr>
              <tr><td>Esc</td><td>Lämna konsolen, eller pausa</td></tr>
            </table>
            <h3>Pekskärm</h3>
            <p>Knapparna längst ner styr roder, djuproder och fart. Håll in för att upprepa. <code>&gt;_</code> öppnar konsolen och ☰ pausar.</p>
            <h3>Kommandon</h3>
            <pre>${esc(HELP_TEXT.join('\n'))}</pre>
            <h3>Att tänka på</h3>
            <ul>
              <li>Djuprodren verkar bara när ubåten har fart: lyftkraften växer med farten i kvadrat.</li>
              <li><b>Flytkraftsöverskott</b> (under "Mer") visar om ubåten är lätt (+) eller tung (−). Trimma med <code>kompensera in/ut &lt;liter&gt;</code>.</li>
              <li>Under språngskiktet (40–70 m) är vattnet tätare. Ubåten blir då lättare och behöver ta in vatten.</li>
              <li>Skrovet trycks ihop mer än vattnet på djupet, så ubåten blir långsamt tyngre ju djupare den går.</li>
              <li>Tryckluften räcker inte till hur många blåsningar som helst. Håll koll på HP-luften.</li>
            </ul>
          </div>
          ${back}`;

      case 'result': {
        const r = this.result!;
        return `
          <h2 class="menu-title small ${r.completed ? 'ok' : 'fail'}">${r.completed ? 'Uppdrag slutfört' : 'Uppdraget misslyckades'}</h2>
          <p class="menu-sub">${esc(r.scenario.title)}</p>
          <p>${esc(r.message)}</p>
          ${r.completed ? `<p>Tid: <b>${formatSimTime(r.time)}</b>${r.newBest ? ' – nytt rekord!' : ''}</p>` : ''}
          <div class="menu-list">
            <button class="menu-btn primary" data-action="restart">Spela igen</button>
            <button class="menu-btn" data-action="nav" data-arg="scenarios">Scenarier</button>
            <button class="menu-btn secondary" data-action="main">Huvudmeny</button>
          </div>`;
      }
    }
  }
}
