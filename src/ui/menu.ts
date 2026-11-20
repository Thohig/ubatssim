/**
 * Start menu, pause menu and result screen as a DOM overlay. The screens
 * are in menuScreens.ts; this class shows them, keeps the menu's own
 * choices (area, light, sea state) and calls back into the game. It owns no
 * game state.
 */
import type { GameMode } from '../control/gameMode';
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
  /** Pause menu: switch the running game to the other mode. */
  switchMode(): void;
  /** The simplified mode's introduction was dismissed. */
  introDone(): void;
}


export class Menu {
  private screen: Screen = 'main';
  /** Where "Tillbaka" goes from settings/help: the main or the pause menu. */
  private base: 'main' | 'pause' = 'main';
  private result: ResultInfo | null = null;
  private pauseInfo: PauseInfo = { mode: 'simplified', canSwitch: true };
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
    if (screen === 'main' || screen === 'pause') this.base = screen;
    this.screen = screen;
    this.root.hidden = false;
    this.root.dataset.screen = screen;
    const state: MenuState = {
      settings: this.settings,
      pauseInfo: this.pauseInfo,
      result: this.result,
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
    if (name === 'volume') s.volume = Number(value) / 100;
    if (name === 'soundEffects') s.soundEffects = value === 'true';
    if (name === 'soundAmbience') s.soundAmbience = value === 'true';
    if (name === 'voice') s.voice = value === 'true';
    this.settings = s;
    this.h.settingsChanged(s);
    if (name === 'mode') this.show(this.screen); // re-render the scenario notes and help
  }
}
