import type { Controller } from '../control/controller';
import { PERISCOPE_DEPTH, telegraphStep } from '../control/crew';
import { LIMITS } from '../control/parser';
import type { OrderSource } from '../control/orders';
import type { InputModeState } from './inputMode';
import { cycleView, reportViewBearing, toggleCutaway, togglePeriscope, type ViewState } from './views';

/**
 * "Dyk": flood the main ballast and, unless a deeper target is already set,
 * aim the depth autopilot at periscope depth (on Hand the depth stays the player's).
 */
export function submitDive(ctrl: Controller, source: OrderSource): void {
  ctrl.submit({ kind: 'dive' }, source);
  if (ctrl.ap.depth && ctrl.setpoints.depth < PERISCOPE_DEPTH) ctrl.submit({ kind: 'setDepth', depth: PERISCOPE_DEPTH }, source);
}

const KNOT = 1852 / 3600;

/** The telegraph one position ahead (+1) or astern (−1) of the present speed order (hands the speed to the crew). */
export function submitTelegraphStep(ctrl: Controller, dir: 1 | -1, source: OrderSource): void {
  const current = ctrl.ap.speed ? ctrl.setpoints.speed : Math.round(ctrl.sim.kinematics().u / KNOT);
  ctrl.submit({ kind: 'setSpeed', knots: telegraphStep(current, dir) }, source);
}

/** Shaft speed ±`delta` rpm from the present order (the player handles the speed). */
export function submitRpmStep(ctrl: Controller, delta: number, source: OrderSource): void {
  const now = Math.round(ctrl.sim.telemetry().rpsCmd * 60);
  ctrl.submit({ kind: 'setRpm', rpm: Math.max(-LIMITS.maxRpmAstern, Math.min(LIMITS.maxRpm, now + delta)) }, source);
}

/**
 * Steering keys. Every key press becomes an Order in the controller's queue.
 * `getCtrl` returns null while no game is running (menu open or paused).
 * The arrows follow who handles each axis (crew.ts):
 *   ←/→  Auto: course ±10°      Hand: rudder ±5° (port/starboard)
 *   ↑/↓  Auto: depth ∓5 m       Hand: stern planes up/down 5°
 *   Shift+↑/↓  crew: telegraph one position ahead/astern; player: ±10 rpm
 *   Space  both Auto: hold present depth and heading; else rudder (or planes) to zero
 *   D  dive   S  surface   Enter or /  open the console
 *   V  next view   P  periscope up/down   Z  periscope magnification (cutaway: side/top)
 *   C  cutaway on/off   + / −  cutaway zoom
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
        if (views.mode === 'cutaway') views.toggleCutPlan();
        else if (views.mode === 'periscope') views.toggleZoom();
        else return;
        break;
      case 'c':
        toggleCutaway(views);
        break;
      case '+':
      case '=':
      case '-':
        if (views.mode !== 'cutaway') return;
        views.zoomCut(key === '-' ? 1 / 1.25 : 1.25);
        break;
      case 'b':
        if (views.mode !== 'bridge' && views.mode !== 'periscope') return;
        reportViewBearing(ctrl, views, 'keyboard');
        break;
      case 'ArrowLeft':
      case 'ArrowRight': {
        const dir = key === 'ArrowLeft' ? -1 : 1;
        if (ctrl.ap.heading) ctrl.submit({ kind: 'adjustHeading', deltaDegrees: 10 * dir }, 'keyboard');
        else ctrl.submit({ kind: 'rudder', angle: 5 * dir, relative: true }, 'keyboard');
        break;
      }
      case 'ArrowUp':
      case 'ArrowDown': {
        const dir = key === 'ArrowUp' ? 1 : -1;
        if (e.shiftKey && ctrl.ap.speed) submitTelegraphStep(ctrl, dir, 'keyboard');
        else if (e.shiftKey) submitRpmStep(ctrl, 10 * dir, 'keyboard');
        else if (ctrl.ap.depth) ctrl.submit({ kind: 'adjustDepth', deltaMetres: -5 * dir }, 'keyboard');
        else ctrl.submit({ kind: 'planes', angle: -5 * dir, relative: true }, 'keyboard');
        break;
      }
      case ' ':
        if (ctrl.ap.depth && ctrl.ap.heading) ctrl.submit({ kind: 'holdCourse' }, 'keyboard');
        else if (!ctrl.ap.heading) ctrl.submit({ kind: 'rudder', angle: 0 }, 'keyboard');
        else ctrl.submit({ kind: 'planes', angle: 0 }, 'keyboard');
        break;
      case 'd':
        submitDive(ctrl, 'keyboard');
        break;
      case 's':
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
