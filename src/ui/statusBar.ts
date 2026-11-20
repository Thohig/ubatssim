/**
 * The status bar on phones (compact layout): the readings the screen
 * controls do not show, in one row. Depth, course and the ordered speed are
 * on the depth scale, the compass band and the telegraph. The battery shows
 * always; water inside the hull while there is any. A tap opens the full
 * instrument panel.
 */
import { formatSimTime } from '../control/controller';
import type { Telemetry } from '../sim/simulation';
import { h } from './dom';

const KN = 3600 / 1852;
const f1 = (v: number) => v.toFixed(1).replace('.', ',');

/** The water under the keel shows below this [m]. */
const KEEL_SHOWN = 300;

/** Net buoyancy within this is shown as neutral [kg] (as the instrument panel). */
const TRIM_NEUTRAL_KG = 100;

export interface StatusBar {
  readonly el: HTMLElement;
  update(t: Telemetry): void;
}

/** The text of each field, from telemetry (pure, for the tests). */
export function statusFields(t: Telemetry): {
  time: string;
  speed: string;
  keel: string;
  trim: string;
  battery: string;
  leak: string;
  keelAlarm: boolean;
  trimWarn: boolean;
  batteryWarn: boolean;
} {
  const kn = t.u * KN;
  const kg = t.netBuoyancy / 9.80665;
  const trim = t.submergedFraction <= 0.999 ? 'Ytläge' : kg < -TRIM_NEUTRAL_KG ? 'Tung' : kg > TRIM_NEUTRAL_KG ? 'Lätt' : 'Neutral';
  return {
    // Minutes and seconds in the first hour: the bar is narrow.
    time: t.t < 3600 ? formatSimTime(t.t).slice(3) : formatSimTime(t.t),
    speed: kn < -0.05 ? `back ${f1(-kn)} kn` : `${f1(Math.max(0, kn))} kn`,
    // The water under the keel only where it matters (the bar is narrow).
    keel: t.grounded ? 'GRUND!' : t.depthUnderKeel < KEEL_SHOWN ? `köl ${Math.round(Math.max(0, t.depthUnderKeel))} m` : '',
    trim,
    battery: `${Math.round(t.battery * 100)} %${t.batteryPower < -1000 ? '↑' : ''}`,
    leak: (() => {
      const water = t.compartments.reduce((s, x) => s + x.water, 0);
      const open = t.compartments.some((x) => x.holeArea > 0);
      return open || water > 0.05 ? `LÄCKA ${water.toFixed(1).replace('.', ',')} m³` : '';
    })(),
    keelAlarm: t.grounded || t.depthUnderKeel < 5,
    trimWarn: trim === 'Tung' || trim === 'Lätt',
    batteryWarn: t.battery < 0.3,
  };
}

/** Builds the status bar in `el` (a button: `onTap` opens or closes the instrument panel). */
export function createStatusBar(el: HTMLButtonElement, onTap: () => void): StatusBar {
  const time = h('span', { class: 'st-time' });
  const speed = h('span', { class: 'st-speed' });
  const keel = h('span', { class: 'st-keel' });
  const trim = h('span', { class: 'st-trim' });
  const battery = h('span', { class: 'st-battery', title: 'Batteriets laddning' });
  const leak = h('span', { class: 'st-leak' });
  el.replaceChildren(time, speed, keel, trim, battery, leak, h('span', { class: 'st-more', 'aria-hidden': 'true' }, '▾'));
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
      keel.hidden = s.keel === '';
      set(trim, s.trim);
      set(battery, s.battery);
      set(leak, s.leak);
      leak.hidden = s.leak === '';
      keel.classList.toggle('alarm', s.keelAlarm);
      trim.classList.toggle('warn', s.trimWarn);
      battery.classList.toggle('warn', s.batteryWarn);
    },
  };
}
