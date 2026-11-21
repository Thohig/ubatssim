/**
 * The log book: always at the top in the middle (under the scenario
 * objective), small and brief. A new line shows for a moment and then fades
 * out and goes: acknowledgements 2,5 s, information 4 s, warnings and errors
 * 6 s, longer lines a little longer (time to read them). At most
 * `LIVE_LINES` show at once; a new one pushes the oldest out. The window
 * behind them is half transparent and fades out too once no line is left
 * (`idle`), so nothing lies over the view while nothing happens. A tap on
 * the log shows the recent history in a panel; another tap, or Esc, folds it.
 *
 * The timing is the interface's, on the wall clock: it never touches the
 * simulation. `lineLife` is pure and tested.
 */
import { formatSimTime, type Controller, type LogEntry, type LogKind } from '../control/controller';

/** Lines kept for the history (it scrolls); room for the whole "hjälp" list and what came before. */
export const MAX_KEPT = 100;
/** Lines shown at once before they fade. */
export const LIVE_LINES = 2;

/** How long a line shows [s] and how long it takes to fade out [s]. */
export function lineLife(kind: LogKind, text: string): { show: number; fade: number } {
  const base = kind === 'error' ? 6 : kind === 'info' ? 4 : 2.5;
  // About 25 characters a second of extra reading time for long lines.
  return { show: base + Math.max(0, text.length - 60) / 25, fade: kind === 'error' ? 1.5 : 0.8 };
}

/** Shows a controller's log in `el`; call again with a new controller to switch (clears the panel). */
export function bindLog(el: HTMLElement, ctrl: Controller): void {
  el.innerHTML = '';
  el.classList.remove('expanded');
  const live: HTMLElement[] = [];
  /** The window fades out with the last line (style.css, #log.idle). */
  const idle = () => el.classList.toggle('idle', live.length === 0 || live.every((d) => d.classList.contains('fading')));
  const retire = (div: HTMLElement) => {
    div.classList.remove('live', 'fading');
    const i = live.indexOf(div);
    if (i >= 0) live.splice(i, 1);
    idle();
  };
  const add = (e: LogEntry, fresh: boolean) => {
    const div = document.createElement('div');
    div.className = `log-entry ${e.kind}`;
    const time = document.createElement('span');
    time.className = 'time';
    time.textContent = `[${formatSimTime(e.t)}]`;
    div.append(time, document.createTextNode(e.text));
    if (e.source === 'keyboard' || e.source === 'touch') {
      const src = document.createElement('span');
      src.className = 'src';
      src.textContent = e.source === 'keyboard' ? 'tgb' : 'pek';
      div.append(src);
    }
    el.append(div);
    while (el.childElementCount > MAX_KEPT) el.firstElementChild?.remove();
    // The open history follows the newest line (the answer to what was just typed).
    if (el.classList.contains('expanded')) el.scrollTop = el.scrollHeight;
    if (!fresh) return;
    div.classList.add('live');
    live.push(div);
    while (live.length > LIVE_LINES) retire(live[0]!);
    idle();
    const life = lineLife(e.kind, e.text);
    window.setTimeout(() => {
      if (!live.includes(div)) return;
      div.classList.add('fading');
      idle();
    }, life.show * 1000);
    window.setTimeout(() => retire(div), (life.show + life.fade) * 1000);
  };
  // What was logged before the view came up shows only its last lines.
  const before = ctrl.log.slice(-MAX_KEPT);
  before.forEach((e, i) => add(e, i >= before.length - LIVE_LINES));
  idle();
  ctrl.onLog((e) => add(e, true));
}

/** A tap on the log shows or folds the history (the last lines, scrolled to the newest). Call once. */
export function bindLogToggle(el: HTMLElement): void {
  el.addEventListener('click', () => {
    el.classList.toggle('expanded');
    if (el.classList.contains('expanded')) el.scrollTop = el.scrollHeight;
  });
}
