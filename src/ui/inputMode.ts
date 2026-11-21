import type { ViewState } from './views';

/** The line at the top left saying what the keys (or fingers) do in the present view. */
export function bindModeIndicator(el: HTMLElement, touch = false, views?: ViewState): void {
  const render = () => {
    const view = views?.mode ?? 'external';
    el.className = `mode steer${view !== 'external' ? ` ${view}` : ''}`;
    if (view === 'periscope') {
      el.innerHTML = touch
        ? 'PERISKOP<small>dra för att vrida · Vy = byt</small>'
        : 'PERISKOP<small>←/→ vrider · Z förstoring · Shift+←/→ styr · Esc = yttre vy</small>';
      return;
    }
    if (view === 'cutaway') {
      el.innerHTML = touch
        ? 'SNITT<small>tryck på ett rum · dra · nyp</small>'
        : 'SNITT<small>klicka på ett rum · dra för att vrida · hjul eller +/− zoomar · Z ovan/sida · C eller Esc = yttre vy</small>';
      return;
    }
    if (view === 'bridge') {
      el.innerHTML = touch ? 'BRYGGAN<small>dra för att titta runt</small>' : 'BRYGGAN<small>dra för att titta runt · V byter vy · Esc = yttre vy</small>';
      return;
    }
    el.innerHTML = touch ? 'STYRNING<small>tryck på loggen = historik</small>' : 'STYRNING<small>pilar styr · V byter vy · Esc = paus</small>';
  };
  render();
  views?.onChange(render);
}
