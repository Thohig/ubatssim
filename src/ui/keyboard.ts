import type { Controller } from '../control/controller';
import { PERISCOPE_DEPTH } from '../control/gameMode';
import type { OrderSource } from '../control/orders';
import type { InputModeState } from './inputMode';

/**
 * "Dyk" in the simplified simulation: flood the main ballast and, unless a
 * deeper target is already set, aim the depth autopilot at periscope depth.
 */
export function submitDive(ctrl: Controller, source: OrderSource): void {
  ctrl.submit({ kind: 'dive' }, source);
  if (!ctrl.ap.depth || ctrl.setpoints.depth < PERISCOPE_DEPTH) ctrl.submit({ kind: 'setDepth', depth: PERISCOPE_DEPTH }, source);
}

/**
 * Steering keys. Every key press becomes an Order in the controller's queue.
 * `getCtrl` returns null while no game is running (menu open or paused).
 *
 * Realistic simulation:
 *   ←/→  rudder ±5° (port/starboard)      ↑/↓  stern planes up/down 5°
 *   Space  rudder midships
 * Simplified simulation:
 *   ←/→  heading ±10°                      ↑/↓  depth ∓5 m
 *   Space  hold present depth and heading  D  dive   S  surface
 * Both:
 *   Shift+↑/↓  speed ±1 knot               Enter or /  open the console
 */
export function bindKeyboard(getCtrl: () => Controller | null, mode: InputModeState, openConsole: () => void): void {
  window.addEventListener('keydown', (e) => {
    if (mode.current !== 'steer') return;
    const ctrl = getCtrl();
    if (!ctrl) return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const simple = ctrl.options.mode === 'simplified';
    const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    switch (key) {
      case 'ArrowLeft':
        if (simple) ctrl.submit({ kind: 'adjustHeading', deltaDegrees: -10 }, 'keyboard');
        else ctrl.submit({ kind: 'rudder', angle: -5, relative: true }, 'keyboard');
        break;
      case 'ArrowRight':
        if (simple) ctrl.submit({ kind: 'adjustHeading', deltaDegrees: 10 }, 'keyboard');
        else ctrl.submit({ kind: 'rudder', angle: 5, relative: true }, 'keyboard');
        break;
      case 'ArrowUp':
        if (e.shiftKey) ctrl.submit({ kind: 'adjustSpeed', deltaKnots: 1 }, 'keyboard');
        else if (simple) ctrl.submit({ kind: 'adjustDepth', deltaMetres: -5 }, 'keyboard');
        else ctrl.submit({ kind: 'planes', angle: -5, relative: true }, 'keyboard');
        break;
      case 'ArrowDown':
        if (e.shiftKey) ctrl.submit({ kind: 'adjustSpeed', deltaKnots: -1 }, 'keyboard');
        else if (simple) ctrl.submit({ kind: 'adjustDepth', deltaMetres: 5 }, 'keyboard');
        else ctrl.submit({ kind: 'planes', angle: 5, relative: true }, 'keyboard');
        break;
      case ' ':
        if (simple) ctrl.submit({ kind: 'holdCourse' }, 'keyboard');
        else ctrl.submit({ kind: 'rudder', angle: 0 }, 'keyboard');
        break;
      case 'd':
        if (!simple) return;
        submitDive(ctrl, 'keyboard');
        break;
      case 's':
        if (!simple) return;
        ctrl.submit({ kind: 'surface' }, 'keyboard');
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
