import type { Controller } from '../control/controller';
import { markOrder, rangeOrder } from './firePanel';
import { PERISCOPE_DEPTH, TELEGRAPH, telegraphStep } from '../control/crew';
import { LIMITS } from '../control/parser';
import type { OrderSource } from '../control/orders';
import { cycleView, reportViewBearing, toggleCutaway, togglePeriscope, type ViewState } from './views';

/**
 * "Dyk": flood the main ballast and, unless a deeper target is already set,
 * aim the depth autopilot at periscope depth (on Hand the depth stays the player's).
 */
export function submitDive(ctrl: Controller, source: OrderSource): void {
  ctrl.submit({ kind: 'dive' }, source);
  if (ctrl.ap.depth && ctrl.setpoints.depth < PERISCOPE_DEPTH) ctrl.submit({ kind: 'setDepth', depth: PERISCOPE_DEPTH }, source);
}

/** "Yta": the surface as the depth target, a normal ascent (the crew blows the main ballast near the surface). */
export function submitSurface(ctrl: Controller, source: OrderSource): void {
  ctrl.submit({ kind: 'setDepth', depth: 0 }, source);
}

/**
 * "Nödblåsning": blow all main ballast at any depth ("ytläge"), full ahead
 * and the surface as the depth target. The crew keeps the ballast.
 */
export function submitEmergencyBlow(ctrl: Controller, source: OrderSource): void {
  ctrl.submit({ kind: 'surface' }, source);
  ctrl.submit({ kind: 'setSpeed', knots: Math.max(...TELEGRAPH.map((b) => b.knots)) }, source);
  ctrl.submit({ kind: 'setDepth', depth: 0 }, source);
}

/** Radar on (raising the mast if it is down) or silent. */
export function submitRadarToggle(ctrl: Controller, source: OrderSource): void {
  if (ctrl.radar.transmitting) {
    ctrl.submit({ kind: 'radar', on: false }, source);
    return;
  }
  if (!ctrl.sim.commands.radarUp) ctrl.submit({ kind: 'radarMast', up: true }, source);
  ctrl.submit({ kind: 'radar', on: true }, source);
}

/** "Periskopdjup": the depth target at periscope depth (surfaced, the crew handling the ballast dives). */
export function submitPeriscopeDepth(ctrl: Controller, source: OrderSource): void {
  ctrl.submit({ kind: 'setDepth', depth: PERISCOPE_DEPTH }, source);
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
 *   D  dive   S  surface (a normal ascent)   Shift+S  emergency blow
 *   V  next view   P  periscope up/down   Z  periscope magnification (cutaway: side/top)
 *   C  cutaway on/off   + / −  cutaway zoom
 *   B  report the bearing of the cross hair / bridge look
 *   N  snorkel up/down   G  diesels start/stop
 *   A  one ping with the active sonar   Y  radar mast up/down   X  radar transmit/silent (raises the mast)
 *   T  mark the vessel in the cross hair   R  range it   F  fire (periscope or bridge)
 * In the periscope view ←/→ train the periscope and Shift+←/→ steer.
 */
export function bindKeyboard(getCtrl: () => Controller | null, views: ViewState): void {
  window.addEventListener('keyup', (e) => {
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') views.trainDir = 0;
  });
  window.addEventListener('keydown', (e) => {
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
      case 't':
        if (views.mode !== 'bridge' && views.mode !== 'periscope') return;
        markOrder(ctrl, views);
        break;
      case 'r':
        if (views.mode !== 'bridge' && views.mode !== 'periscope') return;
        rangeOrder(ctrl, views);
        break;
      case 'f':
        ctrl.submit({ kind: 'fireTorpedo' }, 'keyboard');
        break;
      case 'n':
        ctrl.submit({ kind: 'snorkel', up: !ctrl.sim.commands.snorkelUp }, 'keyboard');
        break;
      case 'a':
        ctrl.submit({ kind: 'ping' }, 'keyboard');
        break;
      case 'y':
        ctrl.submit({ kind: 'radarMast', up: !ctrl.sim.commands.radarUp }, 'keyboard');
        break;
      case 'x':
        submitRadarToggle(ctrl, 'keyboard');
        break;
      case 'g':
        ctrl.submit({ kind: 'diesel', on: !ctrl.sim.commands.diesel }, 'keyboard');
        break;
      case 's':
        if (e.shiftKey) submitEmergencyBlow(ctrl, 'keyboard');
        else submitSurface(ctrl, 'keyboard');
        break;
      default:
        return;
    }
    e.preventDefault();
  });
}
