/**
 * The fire control panel: shown in the periscope view (the primary place to
 * attack) and on the bridge. Mål marks the vessel in the cross hair, Avst
 * ranges it with the stadimeter (more precisely at 6×), Spridning sets the
 * salvo and Fyr fires; the tubes show loaded, loading or empty. The
 * solution line gives range, course, speed and quality, the gyro course and
 * the running time. Every button submits an ordinary order (source 'touch');
 * T, R and F on the keyboard do the same.
 */
import type { Controller } from '../control/controller';
import { solutionAt } from '../control/fireControl';
import { h } from './dom';
import type { ViewState } from './views';
import { viewBearing } from './views';

const KN = 1852 / 3600;
const deg3 = (rad: number) => `${String(Math.round(((rad * 180) / Math.PI + 360) % 360) % 360).padStart(3, '0')}°`;
const mmss = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

/** The text of the solution line for the current target (pure, for the tests). */
export function solutionText(ctrl: Controller): string {
  const f = ctrl.fire;
  const t = f.target;
  if (!t) return 'Inget mål. Sätt hårkorset på ett fartyg och tryck Mål.';
  const s = t.solution;
  if (!s) return `${t.label} ${t.name}: ingen lösning än.`;
  const p = solutionAt(s, ctrl.sim.t);
  const range = Math.hypot(p[0] - ctrl.sim.y[0]!, p[1] - ctrl.sim.y[1]!);
  const speed = Math.hypot(s.velocity[0], s.velocity[1]);
  const course = Math.atan2(s.velocity[1], s.velocity[0]);
  const aim = f.aim();
  const fire = aim ? ` · skjut ${deg3(aim.course)}, gångtid ${mmss(aim.time)}` : ' · hinns inte ikapp';
  return `${t.label} ${t.name}: ${(range / 1000).toFixed(1).replace('.', ',')} km, kurs ${speed < 0.3 ? '–' : deg3(course)}, ${(speed / KN).toFixed(0)} kn, ${s.quality}${fire}`;
}

/** Fires-control order helpers, shared with the keyboard. */
export function markOrder(ctrl: Controller, views: ViewState): void {
  ctrl.submit({ kind: 'markTarget', bearing: Math.round(viewBearing(ctrl, views) * 10) / 10 }, 'touch');
}
export function rangeOrder(ctrl: Controller, views: ViewState): void {
  ctrl.submit({ kind: 'rangeTarget', bearing: viewBearing(ctrl, views), magnification: views.mode === 'periscope' ? views.zoom : null }, 'touch');
}

/** Shown in the periscope view and on the bridge, and while the chart or the sonar is open (`navOpen`). */
export function createFirePanel(root: HTMLElement, getCtrl: () => Controller | null, views: ViewState, navOpen: () => boolean = () => false): (ctrl: Controller) => void {
  const btn = (label: string, title: string, run: (c: Controller) => void, cls = '') => {
    const b = h('button', { type: 'button', class: `touch-btn fire-btn ${cls}`, title, 'aria-label': title }, label);
    b.addEventListener('click', () => {
      const c = getCtrl();
      if (c) run(c);
    });
    return b;
  };
  const mark = btn('Mål', 'Markera fartyget i hårkorset (T)', (c) => markOrder(c, views));
  const range = btn('Avst', 'Mät avståndet med stadimetern (R)', (c) => rangeOrder(c, views));
  const spread = btn('1 torped', 'Torpeder per salva', (c) => c.submit({ kind: 'setSpread', count: (c.fire.spread % 3) + 1 }, 'touch'));
  const fire = btn('Fyr', 'Skjut mot målet (F)', (c) => c.submit({ kind: 'fireTorpedo' }, 'touch'), 'fire-go');
  const tubes = [0, 1, 2, 3].map((i) => h('span', { class: 'fire-tube', title: `Tub ${i + 1}` }, String(i + 1)));
  const solution = h('div', { class: 'fire-solution' });
  const store = h('span', { class: 'fire-store' });
  root.replaceChildren(
    solution,
    h('div', { class: 'fire-row' }, mark, range, spread, fire),
    h('div', { class: 'fire-row fire-tubes' }, h('span', { class: 'fire-label' }, 'Tuber'), ...tubes, store),
  );
  root.hidden = true;

  const set = (el: HTMLElement, s: string) => {
    if (el.textContent !== s) el.textContent = s;
  };
  return (c) => {
    const lookout = views.mode === 'periscope' || views.mode === 'bridge';
    const show = lookout || navOpen();
    // Mål and Avst need the cross hair or the bridge; from the chart or the sonar the target is a sonar contact.
    mark.disabled = range.disabled = !lookout;
    root.hidden = !show;
    document.body.classList.toggle('fire-open', show);
    if (!show) return;
    const f = c.fire;
    set(solution, solutionText(c));
    solution.dataset.quality = f.target?.solution?.quality ?? '';
    set(spread, f.spread === 1 ? '1 torped' : `${f.spread} torpeder`);
    f.tubes.forEach((t, i) => {
      const el = tubes[i]!;
      el.classList.toggle('loaded', t.loaded);
      el.classList.toggle('loading', !t.loaded && t.loading > 0);
      set(el, t.loaded ? String(i + 1) : t.loading > 0 ? mmss(t.loading) : '–');
    });
    set(store, `${f.reserve} i förråd`);
    fire.disabled = !f.target?.solution || !f.tubes.some((t) => t.loaded);
  };
}
