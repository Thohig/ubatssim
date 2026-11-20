import type { ViewState } from './views';

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

export function bindModeIndicator(el: HTMLElement, state: InputModeState, touch = false, views?: ViewState): void {
  const render = () => {
    const m = state.current;
    const view = views?.mode ?? 'external';
    el.className = `mode ${m}${m === 'steer' && view !== 'external' ? ` ${view}` : ''}`;
    if (m === 'steer' && view === 'periscope') {
      el.innerHTML = touch
        ? 'PERISKOP<small>dra för att vrida · Vy = byt</small>'
        : 'PERISKOP<small>←/→ vrider · Z förstoring · Shift+←/→ styr · Esc = yttre vy</small>';
      return;
    }
    if (m === 'steer' && view === 'cutaway') {
      el.innerHTML = touch
        ? 'SNITT<small>tryck på ett rum · dra · nyp</small>'
        : 'SNITT<small>klicka på ett rum · dra för att vrida · hjul eller +/− zoomar · Z ovan/sida · C eller Esc = yttre vy</small>';
      return;
    }
    if (m === 'steer' && view === 'bridge') {
      el.innerHTML = touch ? 'BRYGGAN<small>dra för att titta runt</small>' : 'BRYGGAN<small>dra för att titta runt · V byter vy · Esc = yttre vy</small>';
      return;
    }
    if (touch) {
      el.innerHTML = m === 'steer' ? 'STYRNING<small>&gt;_ = konsol</small>' : 'KONSOL<small>tryck på en styrknapp för att stänga</small>';
      return;
    }
    el.innerHTML =
      m === 'steer'
        ? 'STYRNING<small>pilar styr · V byter vy · Enter eller / = konsol</small>'
        : 'KONSOL<small>↑/↓ historik · Esc = styrning</small>';
  };
  render();
  state.onChange(render);
  views?.onChange(render);
}
