import { HELP_TEXT, parseCommand } from '../control/parser';
import type { Controller } from '../control/controller';
import type { InputModeState } from './inputMode';

/** Command console: Enter submits, ↑/↓ browse history, Esc returns to steering. */
export function bindConsole(form: HTMLFormElement, input: HTMLInputElement, ctrl: Controller, mode: InputModeState): () => void {
  const history: string[] = [];
  let hIndex = 0;
  let draft = '';

  const open = () => {
    mode.set('console');
    input.focus();
  };
  const close = () => {
    mode.set('steer');
    input.blur();
  };

  mode.onChange((m) => {
    form.classList.toggle('active', m === 'console');
    if (m === 'steer') input.blur();
  });

  input.addEventListener('focus', () => mode.set('console'));
  input.addEventListener('blur', () => mode.set('steer'));

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const text = input.value.trim();
    if (!text) return;
    if (history[history.length - 1] !== text) history.push(text);
    hIndex = history.length;
    draft = '';
    input.value = '';
    const r = parseCommand(text);
    if (!r.ok) {
      ctrl.addLog(`${text} – ${r.error}`, 'error', 'console');
    } else if ('help' in r) {
      for (const line of HELP_TEXT) ctrl.addLog(line, 'info');
    } else {
      ctrl.submit(r.order, 'console');
    }
  });

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      close();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (hIndex === history.length) draft = input.value;
      if (hIndex > 0) input.value = history[--hIndex]!;
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (hIndex < history.length) {
        hIndex++;
        input.value = hIndex === history.length ? draft : history[hIndex]!;
      }
    }
    e.stopPropagation();
  });

  return open;
}
