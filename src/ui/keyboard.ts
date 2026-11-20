import type { Controller } from '../control/controller';
import { PERISCOPE_DEPTH, telegraphStep } from '../control/gameMode';
import type { OrderSource } from '../control/orders';
import type { InputModeState } from './inputMode';
import { cycleView, reportViewBearing, togglePeriscope, type ViewState } from './views';

/**
 * "Dyk" in the simplified simulation: flood the main ballast and, unless a
 * deeper target is already set, aim the depth autopilot at periscope depth.
 */
export function submitDive(ctrl: Controller, source: OrderSource): void {
  ctrl.submit({ kind: 'dive' }, source);
  if (!ctrl.ap.depth || ctrl.setpoints.depth < PERISCOPE_DEPTH) ctrl.submit({ kind: 'setDepth', depth: PERISCOPE_DEPTH }, source);
}

const KNOT = 1852 / 3600;

/** Simplified mode: the telegraph one position ahead (+1) or astern (−1) of the present speed order. */
export function submitTelegraphStep(ctrl: Controller, dir: 1 | -1, source: OrderSource): void {
  const current = ctrl.ap.speed ? ctrl.setpoints.speed : Math.round(ctrl.sim.kinematics().u / KNOT);
  ctrl.submit({ kind: 'setSpeed', knots: telegraphStep(current, dir) }, source);
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
 *   Shift+↑/↓  telegraph one position ahead/astern (no console)
 * Both:
 *   Shift+↑/↓  speed ±1 knot (realistic)   Enter or /  open the console (realistic)
 *   V  next view   P  periscope up/down   Z  periscope magnification
 *   B  report the bearing of the cross hair / bridge look
 * In the periscope view ←/→ train the periscope and Shift+←/→ steer.
 */
export function bindKeyboard(getCtrl: () => Controller | null, mode: InputModeState, openConsole: () => void, views: ViewState): void {
  window.addEventListener('keyup', (e) => {
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') views.trainDir = 0;
  });
  window.addEventListener('keydown', (e) => {
    if (mode.current !== 'steer') return;
    const ctrl = getCtrl();
    if (!ctrl) return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const simple = ctrl.options.mode === 'simplified';
    const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    if (views.mode === 'periscope' && !e.shiftKey && (key === 'ArrowLeft' || key === 'ArrowRight')) {
      views.trainDir = key === 'ArrowLeft' ? -1 : 1;
      e.preventDefault();
      return;
    }
    switch (key) {
      case 'v':
        cycleView(ctrl, views, 'keyboard');
        break;
      case 'p':
        togglePeriscope(ctrl, 'keyboard');
        break;
      case 'z':
        if (views.mode !== 'periscope') return;
        views.toggleZoom();
        break;
      case 'b':
        if (views.mode === 'external') return;
        reportViewBearing(ctrl, views, 'keyboard');
        break;
      case 'ArrowLeft':
        if (simple) ctrl.submit({ kind: 'adjustHeading', deltaDegrees: -10 }, 'keyboard');
        else ctrl.submit({ kind: 'rudder', angle: -5, relative: true }, 'keyboard');
        break;
      case 'ArrowRight':
        if (simple) ctrl.submit({ kind: 'adjustHeading', deltaDegrees: 10 }, 'keyboard');
        else ctrl.submit({ kind: 'rudder', angle: 5, relative: true }, 'keyboard');
        break;
      case 'ArrowUp':
        if (e.shiftKey && simple) submitTelegraphStep(ctrl, 1, 'keyboard');
        else if (e.shiftKey) ctrl.submit({ kind: 'adjustSpeed', deltaKnots: 1 }, 'keyboard');
        else if (simple) ctrl.submit({ kind: 'adjustDepth', deltaMetres: -5 }, 'keyboard');
        else ctrl.submit({ kind: 'planes', angle: -5, relative: true }, 'keyboard');
        break;
      case 'ArrowDown':
        if (e.shiftKey && simple) submitTelegraphStep(ctrl, -1, 'keyboard');
        else if (e.shiftKey) ctrl.submit({ kind: 'adjustSpeed', deltaKnots: -1 }, 'keyboard');
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
        if (simple) return; // the simplified mode has no console
        openConsole();
        break;
      default:
        return;
    }
    e.preventDefault();
  });
}
