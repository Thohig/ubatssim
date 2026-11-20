/**
 * Start menu, pause menu and result screen as a DOM overlay. The screens
 * are in menuScreens.ts; this class shows them, keeps the menu's own
 * choices (area, light, sea state) and calls back into the game. It owns no
 * game state.
 */
import type { CrewSystem } from '../control/crew';
import type { Scenario } from '../control/scenarios';
import type { Settings } from './settings';
import type { ConditionsId } from '../control/areas';
import type { SeaStateId } from '../sim/config/seaStates';
import type { AreaId } from '../sim/config/areas';
import { html, mount } from './dom';
import { SCREENS, type MenuState, type PauseInfo, type ResultInfo, type Screen } from './menuScreens';

export type { PauseInfo, ResultInfo } from './menuScreens';

export interface MenuHandlers {
  startFree(area: AreaId, start: string, conditions: ConditionsId, sea: SeaStateId): void;
  startScenario(id: string): void;
  resume(): void;
  restart(): void;
  toMainMenu(): void;
  settingsChanged(s: Settings): void;
  /** ☰ → Besättning: hand a system (or all) to the crew, or take it over. */
  crewChange(system: CrewSystem | 'all', crew: boolean): void;
  /** The introduction was dismissed. */
  introDone(): void;
  /** The scenario briefing was dismissed ("Till sjöss"). */
  briefingDone(): void;
  /** Load the page again (after an error, or when the graphics did not come back). */
  reload(): void;
  /** The graphics came back and the player continues. */
  graphicsOk(): void;
}


export class Menu {
  private screen: Screen = 'main';
  /** Where "Tillbaka" goes from settings/help/crew: the main or the pause menu, or the briefing. */
  private base: 'main' | 'pause' | 'briefing' = 'main';
  private result: ResultInfo | null = null;
  private briefing: Scenario | null = null;
  private error: string | null = null;
  private graphicsBack = false;
  private pauseInfo: PauseInfo = { duties: null, locks: {} };
  /** Free play: chosen area and light/visibility. */
  private area: AreaId = 'westCoast';
  private conditions: ConditionsId = 'day';
  private sea: SeaStateId = 'calm';

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
      else if (input.name === 'sea') this.sea = input.value as SeaStateId;
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
    if (screen === 'main' || screen === 'pause' || screen === 'briefing') this.base = screen;
    this.screen = screen;
    this.root.hidden = false;
    this.root.dataset.screen = screen;
    const state: MenuState = {
      settings: this.settings,
      pauseInfo: this.pauseInfo,
      result: this.result,
      briefing: this.briefing,
      error: this.error,
      graphicsBack: this.graphicsBack,
      area: this.area,
      conditions: this.conditions,
      sea: this.sea,
    };
    mount(this.root, html`<div class="menu-card">${SCREENS[screen](state)}</div>`);
    this.root.querySelector<HTMLElement>('button, input')?.focus({ preventScroll: true });
  }

  showResult(r: ResultInfo): void {
    this.result = r;
    this.show('result');
    this.base = 'main';
  }

  /** The scenario's briefing before it starts (call `setPauseInfo` first: it shows who handles what). */
  showBriefing(s: Scenario): void {
    this.briefing = s;
    this.show('briefing');
  }

  /** After an unexpected error: what happened, with the report to copy. */
  showError(report: string): void {
    this.error = report;
    this.show('error');
  }

  /** The graphics were lost (`back` false) or came back (true). */
  showGraphics(back: boolean): void {
    this.graphicsBack = back;
    this.show('graphics');
  }

  /** Back to where the current screen was opened from (Esc, "Tillbaka"). */
  back(): void {
    this.show(this.base);
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
        this.back();
        break;
      case 'area':
        this.area = arg as AreaId;
        this.show('free-area');
        break;
      case 'free':
        this.h.startFree(this.area, arg!, this.conditions, this.sea);
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
      case 'crew': {
        const [system, crew] = (arg ?? '').split(':');
        this.h.crewChange(system as CrewSystem | 'all', crew === '1');
        break;
      }
      case 'introDone':
        this.h.introDone();
        break;
      case 'briefingDone':
        this.h.briefingDone();
        break;
      case 'reload':
        this.h.reload();
        break;
      case 'graphicsOk':
        this.h.graphicsOk();
        break;
      case 'copyError':
        this.copyError();
        break;
    }
  }

  /** Copies the report; where the clipboard is not allowed, selects the text instead. */
  private copyError(): void {
    const area = this.root.querySelector<HTMLTextAreaElement>('.error-report');
    const button = this.root.querySelector<HTMLButtonElement>('[data-action="copyError"]');
    const done = (ok: boolean) => {
      if (button) button.textContent = ok ? 'Kopierad' : 'Markera och kopiera texten';
      if (!ok) area?.select();
    };
    try {
      navigator.clipboard.writeText(this.error ?? '').then(() => done(true), () => done(false));
    } catch {
      done(false);
    }
  }

  private onSetting(name: string, value: string): void {
    const s = { ...this.settings };
    if (name === 'timeScale') s.timeScale = Number(value) as Settings['timeScale'];
    if (name === 'particles') s.particles = value === 'true';
    if (name === 'lightRays') s.lightRays = value === 'true';
    if (name === 'volume') s.volume = Number(value) / 100;
    if (name === 'soundEffects') s.soundEffects = value === 'true';
    if (name === 'soundAmbience') s.soundAmbience = value === 'true';
    if (name === 'voice') s.voice = value === 'true';
    if (name === 'showLog') s.showLog = value === 'true';
    this.settings = s;
    this.h.settingsChanged(s);
  }
}
