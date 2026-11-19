import { waypointInfo, type ScenarioRunner } from '../control/scenarios';

/** Banner with the current scenario objective and hint. */
export function updateObjective(el: HTMLElement, runner: ScenarioRunner | null): void {
  if (!runner || runner.status !== 'running') {
    el.hidden = true;
    return;
  }
  const p = runner.progress;
  const obj = p.objective;
  if (!obj) {
    el.hidden = true;
    return;
  }
  el.hidden = false;
  const hold = obj.holdSeconds ? ` <span class="obj-hold">${Math.floor(p.held)}/${obj.holdSeconds} s</span>` : '';
  const wp = runner.scenario.waypoint;
  let nav = '';
  if (wp) {
    const w = waypointInfo(runner.ctrl.sim.telemetry(), wp);
    nav = `<div class="obj-nav">Bojen: ${Math.round(w.distance)} m, bäring ${String(Math.round(w.bearing) % 360).padStart(3, '0')}°</div>`;
  }
  const html = `<div class="obj-title"><span class="obj-step">Mål ${p.index + 1}/${p.total}</span> ${escapeHtml(obj.text)}${hold}</div><div class="obj-hint">${escapeHtml(obj.hint)}</div>${nav}`;
  if (el.innerHTML !== html) el.innerHTML = html;
}

const escapeHtml = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
