/**
 * The mission bar at the top in the middle, above the log: one line with the
 * radio's mission, the way to its buoy and the time left. Hidden without a
 * mission. Text only, no layout reads (it updates ten times a second).
 */
import type { Mission } from '../control/missions';
import { h } from './dom';

/** "Uppdrag: spana i farleden (bojen) · 4,2 km 230° · 1 h 45 min kvar". */
export function missionLine(m: Mission, position: readonly number[], now: number): string {
  const parts = [`Uppdrag: ${m.goal}`];
  if (m.waypoint) {
    const dn = m.waypoint[0] - position[0]!;
    const de = m.waypoint[1] - position[1]!;
    const bearing = Math.round((((Math.atan2(de, dn) * 180) / Math.PI) + 360) % 360) % 360;
    parts.push(`${(Math.hypot(dn, de) / 1000).toFixed(1).replace('.', ',')} km ${String(bearing).padStart(3, '0')}°`);
  }
  const left = Math.max(0, m.deadline - now);
  const hours = Math.floor(left / 3600);
  const minutes = Math.floor((left % 3600) / 60);
  parts.push(`${hours ? `${hours} h ` : ''}${minutes} min kvar`);
  return parts.join(' · ');
}

export function createMissionBar(el: HTMLElement): (m: Mission | null, position: readonly number[], now: number) => void {
  const text = h('span', { class: 'mission-text' });
  el.replaceChildren(text);
  return (m, position, now) => {
    el.hidden = m === null;
    if (!m) return;
    const line = missionLine(m, position, now);
    if (text.textContent !== line) text.textContent = line;
  };
}
