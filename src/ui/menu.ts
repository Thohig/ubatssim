/**
 * Start menu, pause menu and result screen as a DOM overlay. The menu only
 * renders screens and calls back into main.ts; it owns no game state.
 */
import { HELP_TEXT } from '../control/parser';
import { SCENARIOS, scenarioModes, type Scenario } from '../control/scenarios';
import { formatSimTime } from '../control/controller';
import { GAME_MODES, GAME_MODE_NAME, GAME_MODE_TEXT, type GameMode } from '../control/gameMode';
import type { Settings } from './settings';
import { AREA_INFO, AREA_ORDER, CONDITIONS, type ConditionsId } from '../control/areas';
import type { AreaId } from '../sim/config/areas';

export interface MenuHandlers {
  startFree(area: AreaId, start: string, conditions: ConditionsId): void;
  startScenario(id: string): void;
  resume(): void;
  restart(): void;
  toMainMenu(): void;
  settingsChanged(s: Settings): void;
  /** Pause menu: switch the running game to the other mode. */
  switchMode(): void;
  /** The simplified mode's introduction was dismissed. */
  introDone(): void;
}

/** What the pause menu needs to know about the running game. */
export interface PauseInfo {
  mode: GameMode;
  /** False when the scenario allows only one mode. */
  canSwitch: boolean;
}

export interface ResultInfo {
  scenario: Scenario;
  completed: boolean;
  message: string;
  time: number;
}

type Screen = 'main' | 'free' | 'free-area' | 'scenarios' | 'settings' | 'help' | 'pause' | 'result' | 'intro';

const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

export class Menu {
  private screen: Screen = 'main';
  /** Where "Tillbaka" goes from settings/help: the main or the pause menu. */
  private base: 'main' | 'pause' = 'main';
  private result: ResultInfo | null = null;
  private pauseInfo: PauseInfo = { mode: 'simplified', canSwitch: true };
  /** Free play: chosen area and light/visibility. */
  private area: AreaId = 'westCoast';
  private conditions: ConditionsId = 'day';

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
      if (input.name === 'conditions') this.conditions = input.value as ConditionsId;
      else if (input.name) this.onSetting(input.name, input.type === 'checkbox' ? String(input.checked) : input.value);
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

  /** Call before `show('pause')`. */
  setPauseInfo(p: PauseInfo): void {
    this.pauseInfo = p;
  }

  /** Keeps the menu's copy of the settings in step with changes made elsewhere. */
  setSettings(s: Settings): void {
    this.settings = s;
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
      case 'area':
        this.area = arg as AreaId;
        this.show('free-area');
        break;
      case 'free':
        this.h.startFree(this.area, arg!, this.conditions);
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
      case 'switchMode':
        this.h.switchMode();
        break;
      case 'introDone':
        this.h.introDone();
        break;
    }
  }

  private onSetting(name: string, value: string): void {
    const s = { ...this.settings };
    if (name === 'mode') s.mode = value as GameMode;
    if (name === 'timeScale') s.timeScale = Number(value) as Settings['timeScale'];
    if (name === 'autopilot') s.autopilot = value === 'true';
    if (name === 'touch') s.touch = value as Settings['touch'];
    if (name === 'particles') s.particles = value === 'true';
    this.settings = s;
    this.h.settingsChanged(s);
    if (name === 'mode') this.show(this.screen); // re-render the scenario notes and help
  }

  private render(): string {
    const back = `<button class="menu-btn secondary" data-action="back">‹ Tillbaka</button>`;
    switch (this.screen) {
      case 'main':
        return `
          <h1 class="menu-title">Ubåtssim</h1>
          <p class="menu-sub">Simulering av en dieselelektrisk ubåt</p>
          <div class="mode-choice" role="radiogroup" aria-label="Spelläge">
            ${GAME_MODES.map(
              (m) => `<label class="mode-opt"><input type="radio" name="mode" value="${m}" ${this.settings.mode === m ? 'checked' : ''}/>
                <span><b>${GAME_MODE_NAME[m]}</b><small>${GAME_MODE_TEXT[m]}</small></span></label>`,
            ).join('')}
          </div>
          <div class="menu-list">
            <button class="menu-btn primary" data-action="nav" data-arg="free">Fritt spel</button>
            <button class="menu-btn" data-action="nav" data-arg="scenarios">Scenarier</button>
            <button class="menu-btn" data-action="nav" data-arg="settings">Inställningar</button>
            <button class="menu-btn" data-action="nav" data-arg="help">Hjälp</button>
          </div>`;

      case 'pause':
        return `
          <h2 class="menu-title small">Paus</h2>
          <p class="menu-sub">${GAME_MODE_NAME[this.pauseInfo.mode]}</p>
          <div class="menu-list">
            <button class="menu-btn primary" data-action="resume">Fortsätt</button>
            ${
              this.pauseInfo.canSwitch
                ? `<button class="menu-btn" data-action="switchMode">Byt till ${GAME_MODE_NAME[this.pauseInfo.mode === 'simplified' ? 'realistic' : 'simplified'].toLowerCase()}</button>`
                : `<p class="menu-note">Det här scenariot kräver ${GAME_MODE_NAME[this.pauseInfo.mode].toLowerCase()}.</p>`
            }
            <button class="menu-btn" data-action="restart">Starta om</button>
            <button class="menu-btn" data-action="nav" data-arg="settings">Inställningar</button>
            <button class="menu-btn" data-action="nav" data-arg="help">Hjälp</button>
            <button class="menu-btn secondary" data-action="main">Huvudmeny</button>
          </div>`;

      case 'free':
        return `
          <h2 class="menu-title small">Fritt spel</h2>
          <p class="menu-sub">Välj havsområde.</p>
          <div class="menu-list">
            ${AREA_ORDER.map((id) => `<button class="menu-btn choice" data-action="area" data-arg="${id}"><b>${esc(AREA_INFO[id].title)}</b><span>${esc(AREA_INFO[id].description)}</span></button>`).join('')}
          </div>
          ${back}`;

      case 'free-area': {
        const a = AREA_INFO[this.area];
        return `
          <h2 class="menu-title small">${esc(a.title)}</h2>
          <fieldset><legend>Ljus och sikt</legend>
            ${CONDITIONS.map((c) => `<label class="opt"><input type="radio" name="conditions" value="${c.id}" ${this.conditions === c.id ? 'checked' : ''}/> ${esc(c.title)}</label>`).join('')}
          </fieldset>
          <p class="menu-sub">Välj var du vill börja.</p>
          <div class="menu-list">
            ${a.starts.map((st) => `<button class="menu-btn choice" data-action="free" data-arg="${esc(st.id)}"><b>${esc(st.title)}</b><span>${esc(st.description)}</span></button>`).join('')}
          </div>
          <button class="menu-btn secondary" data-action="nav" data-arg="free">‹ Tillbaka</button>`;
      }

      case 'scenarios': {
        const mode = this.settings.mode;
        const meta = (s: Scenario) => {
          const parts: string[] = [];
          const modes = scenarioModes(s);
          if (!modes.includes(mode)) parts.push(`Kräver ${GAME_MODE_NAME[modes[0]!].toLowerCase()}`);
          const playedIn = modes.includes(mode) ? mode : modes[0]!;
          if (playedIn === 'realistic' && !s.autopilotAllowed) parts.push('Utan autopilot');
          if (playedIn === 'simplified' && s.safetyNet === false) parts.push('Utan automatisk nödblåsning');
          const area = s.initial.area ?? 'westCoast';
          if (area !== 'westCoast') parts.unshift(AREA_INFO[area].title);
          if (s.conditions === 'night') parts.unshift('Natt');
          if (s.conditions === 'fog') parts.unshift('Dimma');
          parts.push(`${s.objectives.length} mål`);
          return parts.join(' · ');
        };
        const cards = SCENARIOS.map(
          (s) => `
          <button class="menu-btn choice scenario" data-action="scenario" data-arg="${esc(s.id)}">
            <b>${esc(s.title)} <span class="badge ${esc(s.difficulty)}">${esc(s.difficulty)}</span></b>
            <span>${esc(s.description)}</span>
            <span class="meta">${esc(meta(s))}</span>
          </button>`,
        ).join('');
        return `<h2 class="menu-title small">Scenarier</h2><p class="menu-sub">${GAME_MODE_NAME[mode]}</p><div class="menu-list">${cards}</div>${back}`;
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
          <fieldset><legend>Realistisk simulering, fritt spel</legend>
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
            <h3>Spelläge</h3>
            <p><b>Förenklad simulering:</b> du anger djup och kurs, och autopiloten styr roder och djuproder. Assistenten kompenserar och trimmar ubåten och nödblåser nära krossdjupet. Allt den gör syns i loggen.</p>
            <p><b>Realistisk simulering:</b> du styr roder och djuproder och sköter ballast, trim och kompensering själv.</p>
            <p>Läget väljs på startsidan och kan bytas i pausmenyn.</p>
            <h3>Tangentbord</h3>
            <table>
              <tr><th></th><th>Förenklad</th><th>Realistisk</th></tr>
              <tr><td>← / →</td><td>Kurs 10° babord / styrbord</td><td>Roder 5° babord / styrbord</td></tr>
              <tr><td>↑ / ↓</td><td>Djup 5 m grundare / djupare</td><td>Djuproder 5° upp / ned</td></tr>
              <tr><td>Mellanslag</td><td>Håll kurs och djup</td><td>Roder midskepps</td></tr>
              <tr><td>D</td><td>Dyk (till periskopdjup, 13 m, om inget djupare mål finns)</td><td>–</td></tr>
              <tr><td>S</td><td>Ytläge</td><td>–</td></tr>
              <tr><td>Shift + ↑ / ↓</td><td colspan="2">Fart ±1 knop</td></tr>
              <tr><td>V</td><td colspan="2">Byt vy: yttre, bryggan (i ytläge) och periskopet (när det är uppe)</td></tr>
              <tr><td>P</td><td colspan="2">Periskop upp / ned. Vyn öppnas när masten är uppe.</td></tr>
              <tr><td>Z</td><td colspan="2">Periskopets förstoring, 1,5× eller 6×</td></tr>
              <tr><td>← / → i periskopet</td><td colspan="2">Vrid periskopet. Shift + ← / → styr.</td></tr>
              <tr><td>Enter eller /</td><td colspan="2">Öppna konsolen (↑/↓ bläddrar i historiken)</td></tr>
              <tr><td>Esc</td><td colspan="2">Lämna konsolen, eller pausa</td></tr>
            </table>
            <h3>Vyer</h3>
            <p><b>Bryggan:</b> i ytläge står du överst i tornet. Dra för att titta runt. Bryggan måste utrymmas innan ubåten dyker: skriv <code>klart bryggan</code> i realistisk simulering. I förenklad simulering sköts det automatiskt.</p>
            <p><b>Periskopet:</b> hissa med P eller <code>periskop upp</code>. Det tar 8 s. Huvudet når över vattnet ner till ungefär 14 m djup. Över 6 knop vibrerar bilden.</p>
            <p>Knapparna Vy, Per och Zoom under ☰ gör samma sak som tangenterna. Esc går tillbaka till den yttre vyn.</p>
            <h3>Pekskärm</h3>
            <p>Knapparna längst ner har samma funktioner som tangenterna. I förenklad simulering ändrar ◀ / ▶ kursen och ▲ / ▼ djupet, och Dyk och Yta sköter huvudballasten. Håll in för att upprepa. <code>&gt;_</code> öppnar konsolen och ☰ pausar.</p>
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

      case 'intro':
        return `
          <h2 class="menu-title small">Förenklad simulering</h2>
          <ul class="intro">
            <li><b>↑ / ↓</b> (▲ / ▼) ändrar djupet 5 m, <b>← / →</b> ändrar kursen 10°.</li>
            <li><b>Shift + ↑ / ↓</b> (− / +) ändrar farten.</li>
            <li><b>D</b> dyker och <b>S</b> går till ytläge.</li>
            <li>Assistenten trimmar ubåten. Det den gör syns i loggen.</li>
          </ul>
          <div class="menu-list">
            <button class="menu-btn primary" data-action="introDone">Kör</button>
          </div>`;

      case 'result': {
        const r = this.result!;
        return `
          <h2 class="menu-title small ${r.completed ? 'ok' : 'fail'}">${r.completed ? 'Uppdrag slutfört' : 'Uppdraget misslyckades'}</h2>
          <p class="menu-sub">${esc(r.scenario.title)}</p>
          <p>${esc(r.message)}</p>
          ${r.completed ? `<p>Tid: <b>${formatSimTime(r.time)}</b></p>` : ''}
          <div class="menu-list">
            <button class="menu-btn primary" data-action="restart">Spela igen</button>
            <button class="menu-btn" data-action="nav" data-arg="scenarios">Scenarier</button>
            <button class="menu-btn secondary" data-action="main">Huvudmeny</button>
          </div>`;
      }
    }
  }
}
