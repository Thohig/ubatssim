/**
 * The scenario objective at the top in the middle. Usually one line: the
 * step, the goal, the hold time and the buoy. A tap shows the hint and the
 * whole list of objectives. The box opens by itself for a while when a new
 * objective starts or its hint changes (the crew took a system over or gave
 * it back), and folds again so that it does not take up the view.
 */
import type { Controller } from '../control/controller';
import { waypointInfo, type Objective, type ScenarioRunner } from '../control/scenarios';
import { h } from './dom';

/** The hint for whoever handles the objective's system now: the crew (`hintCrew`) or the player (`hint`). */
export function objectiveHint(obj: Objective, ctrl: Controller): string {
  return obj.system && obj.hintCrew && ctrl.duty(obj.system) ? obj.hintCrew : obj.hint;
}

/** Seconds the box stays open after a new objective or hint. */
export const OBJECTIVE_SHOW = 6;
/** Seconds the box stays open after a tap. */
export const OBJECTIVE_TAP_SHOW = 10;

export interface ObjectiveBox {
  readonly el: HTMLElement;
  /**
   * Shows the runner's objective. `dt` is the time [s] since the last call
   * while the game runs (0 while paused, so the box does not fold behind a menu).
   */
  update(runner: ScenarioRunner | null, dt: number): void;
  /** Opens or folds the box (a tap, or the O key). */
  toggle(): void;
  readonly expanded: boolean;
}

const setText = (el: HTMLElement, text: string) => {
  if (el.textContent !== text) el.textContent = text;
};

export function createObjective(el: HTMLElement): ObjectiveBox {
  const step = h('span', { class: 'obj-step' });
  const text = h('span', { class: 'obj-text' });
  const hold = h('span', { class: 'obj-hold' });
  const nav = h('span', { class: 'obj-nav' });
  const chevron = h('span', { class: 'obj-chev', 'aria-hidden': 'true' });
  const head = h('button', { class: 'obj-head', type: 'button', 'aria-expanded': 'false', title: 'Visa tipset och alla mål (O)' }, step, text, hold, nav, chevron);
  const hint = h('div', { class: 'obj-hint' });
  const list = h('ol', { class: 'obj-list' });
  const body = h('div', { class: 'obj-body' }, hint, list);
  el.replaceChildren(head, body);
  el.hidden = true;

  let runner: ScenarioRunner | null = null;
  /** What the box last opened by itself for (runner, objective, hint). */
  let shownKey = '';
  let listKey = '';
  /** Seconds the box stays open; Infinity is "until tapped". */
  let openFor = 0;

  const render = () => {
    const open = openFor > 0;
    el.classList.toggle('expanded', open);
    head.setAttribute('aria-expanded', String(open));
    setText(chevron, open ? '▴' : '▾');
  };

  const box: ObjectiveBox = {
    el,
    get expanded() {
      return openFor > 0;
    },
    toggle() {
      openFor = openFor > 0 ? 0 : OBJECTIVE_TAP_SHOW;
      render();
    },
    update(r, dt) {
      const p = r && r.status === 'running' ? r.progress : null;
      const obj = p?.objective;
      if (!r || !p || !obj) {
        el.hidden = true;
        runner = null;
        return;
      }
      if (r !== runner) {
        runner = r;
        shownKey = '';
        listKey = '';
      }
      el.hidden = false;
      const hintText = objectiveHint(obj, r.ctrl);
      const key = `${p.index}|${hintText}`;
      if (key !== shownKey) {
        shownKey = key;
        openFor = Math.max(openFor, OBJECTIVE_SHOW);
      } else if (openFor > 0) {
        openFor = Math.max(0, openFor - dt);
      }
      setText(step, `${p.index + 1}/${p.total}`);
      setText(text, obj.text);
      setText(hold, obj.holdSeconds ? `${Math.floor(p.held)}/${obj.holdSeconds} s` : '');
      const wp = r.scenario.waypoint;
      if (wp) {
        const w = waypointInfo(r.ctrl.sim.telemetry(), wp);
        setText(nav, `Boj ${Math.round(w.distance)} m ${String(Math.round(w.bearing) % 360).padStart(3, '0')}°`);
      } else setText(nav, '');
      setText(hint, hintText);
      if (listKey !== String(p.index)) {
        listKey = String(p.index);
        list.replaceChildren(
          ...r.scenario.objectives.map((o, i) =>
            h('li', { class: i < p.index ? 'done' : i === p.index ? 'current' : 'next' }, i < p.index ? `✓ ${o.text}` : o.text),
          ),
        );
      }
      render();
    },
  };
  head.addEventListener('click', () => box.toggle());
  return box;
}
