import type { Controller } from '../control/controller';
import type { InputModeState } from './inputMode';

/**
 * Steering keys. Every key press becomes an Order in the controller's queue.
 *   ←/→  rudder ±5° (port/starboard)      ↑/↓  stern planes up/down 5°
 *   Shift+↑/↓  speed ±1 knot              Space  rudder midships
 *   Enter or /  open the console
 */
export function bindKeyboard(ctrl: Controller, mode: InputModeState, openConsole: () => void): void {
  window.addEventListener('keydown', (e) => {
    if (mode.current !== 'steer') return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    switch (e.key) {
      case 'ArrowLeft':
        ctrl.submit({ kind: 'rudder', angle: -5, relative: true }, 'keyboard');
        break;
      case 'ArrowRight':
        ctrl.submit({ kind: 'rudder', angle: 5, relative: true }, 'keyboard');
        break;
      case 'ArrowUp':
        if (e.shiftKey) ctrl.submit({ kind: 'adjustSpeed', deltaKnots: 1 }, 'keyboard');
        else ctrl.submit({ kind: 'planes', angle: -5, relative: true }, 'keyboard');
        break;
      case 'ArrowDown':
        if (e.shiftKey) ctrl.submit({ kind: 'adjustSpeed', deltaKnots: -1 }, 'keyboard');
        else ctrl.submit({ kind: 'planes', angle: 5, relative: true }, 'keyboard');
        break;
      case ' ':
        ctrl.submit({ kind: 'rudder', angle: 0 }, 'keyboard');
        break;
      case 'Enter':
      case '/':
        openConsole();
        break;
      default:
        return;
    }
    e.preventDefault();
  });
}
