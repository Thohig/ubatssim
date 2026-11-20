import { formatSimTime, type Controller, type LogEntry } from '../control/controller';
import { isCompact } from './compact';

const MAX_VISIBLE = 14;

/** Shows a controller's log in `el`; call again with a new controller to switch (clears the panel). */
export function bindLog(el: HTMLElement, ctrl: Controller): void {
  el.innerHTML = '';
  el.classList.remove('expanded');
  const add = (e: LogEntry) => {
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
    while (el.childElementCount > MAX_VISIBLE) el.firstElementChild?.remove();
  };
  ctrl.log.forEach(add);
  ctrl.onLog(add);
}

/**
 * Phones show only the latest log line (it dims after a while, style.css);
 * a tap shows the recent log, another tap folds it again. Call once.
 */
export function bindLogToggle(el: HTMLElement): void {
  el.addEventListener('click', () => {
    if (isCompact()) el.classList.toggle('expanded');
  });
}
