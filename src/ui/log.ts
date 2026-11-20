/**
 * The log book: at the top in the middle (under the scenario objective),
 * without a background. A new line shows for a while and then fades out and
 * goes: acknowledgements 4 s, information 6 s, warnings and errors 10 s,
 * longer lines a little longer (time to read them). At most `LIVE_LINES`
 * show at once; a new one pushes the oldest out. A tap on the log shows the
 * recent history in a panel (and the console shows it while open); another
 * tap, or Esc, folds it. Hidden (the setting, Logg, L) only new errors show.
 *
 * The timing is the interface's, on the wall clock: it never touches the
 * simulation. `lineLife` is pure and tested.
 */
import { formatSimTime, type Controller, type LogEntry, type LogKind } from '../control/controller';

/** Lines kept for the history. */
const MAX_KEPT = 14;
/** Lines shown at once before they fade. */
export const LIVE_LINES = 3;

/** How long a line shows [s] and how long it takes to fade out [s]. */
export function lineLife(kind: LogKind, text: string): { show: number; fade: number } {
  const base = kind === 'error' ? 10 : kind === 'info' ? 6 : 4;
  // About 25 characters a second of extra reading time for long lines.
  return { show: base + Math.max(0, text.length - 60) / 25, fade: kind === 'error' ? 2 : 1 };
}

/** Shows a controller's log in `el`; call again with a new controller to switch (clears the panel). */
export function bindLog(el: HTMLElement, ctrl: Controller): void {
  el.innerHTML = '';
  el.classList.remove('expanded');
  const live: HTMLElement[] = [];
  const retire = (div: HTMLElement) => {
    div.classList.remove('live', 'fading');
    const i = live.indexOf(div);
    if (i >= 0) live.splice(i, 1);
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
    const life = lineLife(e.kind, e.text);
    window.setTimeout(() => {
      if (live.includes(div)) div.classList.add('fading');
    }, life.show * 1000);
    window.setTimeout(() => retire(div), (life.show + life.fade) * 1000);
  };
  // What was logged before the view came up shows only its last lines.
  const before = ctrl.log.slice(-MAX_KEPT);
  before.forEach((e, i) => add(e, i >= before.length - LIVE_LINES));
  ctrl.onLog((e) => add(e, true));
}

/**
 * The log and the console are one: a tap on the log (or on the "›_ Logg"
 * handle under it) opens the console, which shows the history above its
 * input line. Without `open` a tap just shows or folds the history. Call once.
 * (iOS shows the on-screen keyboard only for focus() inside a click handler.)
 */
export function bindLogToggle(el: HTMLElement, open?: () => void): void {
  el.addEventListener('click', () => {
    if (open) {
      open();
      return;
    }
    el.classList.toggle('expanded');
    if (el.classList.contains('expanded')) el.scrollTop = el.scrollHeight;
  });
}
