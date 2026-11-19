import { formatSimTime, type Controller, type LogEntry } from '../control/controller';

const MAX_VISIBLE = 14;

export function bindLog(el: HTMLElement, ctrl: Controller): void {
  const add = (e: LogEntry) => {
    const div = document.createElement('div');
    div.className = `log-entry ${e.kind}`;
    const time = document.createElement('span');
    time.className = 'time';
    time.textContent = `[${formatSimTime(e.t)}]`;
    div.append(time, document.createTextNode(e.text));
    if (e.source === 'keyboard') {
      const src = document.createElement('span');
      src.className = 'src';
      src.textContent = 'tgb';
      div.append(src);
    }
    el.append(div);
    while (el.childElementCount > MAX_VISIBLE) el.firstElementChild?.remove();
  };
  ctrl.log.forEach(add);
  ctrl.onLog(add);
}
