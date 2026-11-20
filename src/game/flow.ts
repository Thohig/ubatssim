/**
 * The game's states and the allowed transitions between them.
 *
 *   menu ──start──▶ playing ◀──resume── paused
 *     ▲               │  └──pause──────────▲
 *     │               └──scenario over──▶ ended
 *     └──── main menu (from paused or ended)
 *
 * `paused` also shows the introduction to the crew and the controls before a game,
 * so a start may go menu → paused, and a restart ended → paused.
 */
export type GameState = 'menu' | 'playing' | 'paused' | 'ended';

const ALLOWED: Record<GameState, readonly GameState[]> = {
  menu: ['menu', 'playing', 'paused'],
  playing: ['paused', 'ended', 'playing'],
  paused: ['playing', 'paused', 'menu'],
  ended: ['menu', 'playing', 'paused'],
};

export class GameFlow {
  private s: GameState = 'menu';
  private listeners: ((s: GameState) => void)[] = [];

  get state(): GameState {
    return this.s;
  }

  /** The simulation runs (the demo behind the menu, the game, and after a scenario has ended). */
  get simRunning(): boolean {
    return this.s !== 'paused';
  }

  /** A game is shown (HUD visible). */
  get inGame(): boolean {
    return this.s !== 'menu';
  }

  canGo(to: GameState): boolean {
    return ALLOWED[this.s].includes(to);
  }

  /** Changes state if the transition is allowed; returns false (and changes nothing) otherwise. */
  go(to: GameState): boolean {
    if (!this.canGo(to)) return false;
    this.s = to;
    for (const fn of this.listeners) fn(to);
    return true;
  }

  onChange(fn: (s: GameState) => void): void {
    this.listeners.push(fn);
  }
}
