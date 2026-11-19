export type InputMode = 'steer' | 'console';

/** Tracks whether the arrow keys steer the boat or edit the console. */
export class InputModeState {
  private mode: InputMode = 'steer';
  private listeners: ((m: InputMode) => void)[] = [];

  get current(): InputMode {
    return this.mode;
  }

  set(mode: InputMode): void {
    if (mode === this.mode) return;
    this.mode = mode;
    for (const fn of this.listeners) fn(mode);
  }

  onChange(fn: (m: InputMode) => void): void {
    this.listeners.push(fn);
  }
}

export function bindModeIndicator(el: HTMLElement, state: InputModeState, touch = false): void {
  const render = (m: InputMode) => {
    el.className = `mode ${m}`;
    if (touch) {
      el.innerHTML = m === 'steer' ? 'STYRNING<small>&gt;_ = konsol</small>' : 'KONSOL<small>tryck på en styrknapp för att stänga</small>';
      return;
    }
    el.innerHTML =
      m === 'steer'
        ? 'STYRNING<small>pilar styr · Enter eller / = konsol</small>'
        : 'KONSOL<small>↑/↓ historik · Esc = styrning</small>';
  };
  render(state.current);
  state.onChange(render);
}
