/**
 * The status bar on phones (compact layout): the readings the screen
 * controls do not show, in one row. Depth, course and the ordered speed are
 * on the depth scale, the compass band and the telegraph. A tap opens the
 * full instrument panel.
 */
import { formatSimTime } from '../control/controller';
import type { Telemetry } from '../sim/simulation';
import { h } from './dom';

const KN = 3600 / 1852;
const f1 = (v: number) => v.toFixed(1).replace('.', ',');

/** Net buoyancy within this is shown as neutral [kg] (as the instrument panel). */
const TRIM_NEUTRAL_KG = 100;

export interface StatusBar {
  readonly el: HTMLElement;
  update(t: Telemetry): void;
}

/** The text of each field, from telemetry (pure, for the tests). */
export function statusFields(t: Telemetry): { time: string; speed: string; keel: string; trim: string; keelAlarm: boolean; trimWarn: boolean } {
  const kn = t.u * KN;
  const kg = t.netBuoyancy / 9.80665;
  const trim = t.submergedFraction <= 0.999 ? 'Ytläge' : kg < -TRIM_NEUTRAL_KG ? 'Tung' : kg > TRIM_NEUTRAL_KG ? 'Lätt' : 'Neutral';
  return {
    time: formatSimTime(t.t),
    speed: kn < -0.05 ? `back ${f1(-kn)} kn` : `${f1(Math.max(0, kn))} kn`,
    keel: t.grounded ? 'GRUND!' : `köl ${Math.round(Math.max(0, t.depthUnderKeel))} m`,
    trim,
    keelAlarm: t.grounded || t.depthUnderKeel < 5,
    trimWarn: trim === 'Tung' || trim === 'Lätt',
  };
}

/** Builds the status bar in `el` (a button: `onTap` opens or closes the instrument panel). */
export function createStatusBar(el: HTMLButtonElement, onTap: () => void): StatusBar {
  const time = h('span', { class: 'st-time' });
  const speed = h('span', { class: 'st-speed' });
  const keel = h('span', { class: 'st-keel' });
  const trim = h('span', { class: 'st-trim' });
  el.replaceChildren(time, speed, keel, trim, h('span', { class: 'st-more', 'aria-hidden': 'true' }, '▾'));
  el.addEventListener('click', onTap);
  const set = (n: HTMLElement, s: string) => {
    if (n.textContent !== s) n.textContent = s;
  };
  return {
    el,
    update(t) {
      const s = statusFields(t);
      set(time, s.time);
      set(speed, s.speed);
      set(keel, s.keel);
      set(trim, s.trim);
      keel.classList.toggle('alarm', s.keelAlarm);
      trim.classList.toggle('warn', s.trimWarn);
    },
  };
}
