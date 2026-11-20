/**
 * Instrument panel. Every instrument is a small component (created once,
 * updated ten times a second). Which instruments are in the main panel and
 * which under "Mer" follows who handles what (`instrumentLayout`): a system
 * the player takes over brings its instruments into view.
 * Adding an instrument = one entry in `INSTRUMENTS` and its id in `instrumentLayout`.
 */
import { formatSimTime, type Controller } from '../control/controller';
import type { CrewDuties } from '../control/crew';
import type { Telemetry } from '../sim/simulation';
import { h, type Component } from './dom';

const DEG = 180 / Math.PI;
const KN = 3600 / 1852;

const f = (v: number, d = 0) => v.toFixed(d).replace('.', ',').replace('-0,0', '0,0');
const signed = (v: number, d = 1) => (v > 0 ? '+' : '') + f(v, d);
const deg3 = (rad: number) => String(Math.round(((rad * DEG) % 360 + 360) % 360) % 360).padStart(3, '0');

/** Knots as "4,0", or "BACK 4,0" astern (below −0.05 knots). */
const knots = (kn: number) => (kn < -0.05 ? `BACK ${f(-kn, 1)}` : f(Math.max(0, kn), 1));

/** Net buoyancy within this is shown as "Neutral" [kg]. */
const TRIM_NEUTRAL_KG = 100;

type Instrument = Component<Telemetry>;

interface RowOptions {
  big?: boolean;
  /** Autopilot target shown after the value (e.g. "→ 32"). */
  setpoint?: (c: Controller) => string;
  /** Autopilot badge (not used: the screen controls show Auto / Hand). */
  ap?: (c: Controller) => boolean;
  /** CSS classes switched on by the reading (e.g. alarm). */
  classes?: (t: Telemetry) => Record<string, boolean>;
}

/** A label and a value, optionally with an autopilot target and badge. */
function row(label: string, value: (t: Telemetry, c: Controller) => string, c: Controller, o: RowOptions = {}): Instrument {
  const badge = o.ap ? h('span', { class: 'ap' }, 'AP') : null;
  const val = h('span', { class: o.big ? 'inst-value big' : 'inst-value' });
  const set = o.setpoint ? h('span', { class: 'inst-set' }) : null;
  const el = h('div', { class: 'inst-row' }, h('span', { class: 'inst-label' }, label, badge), h('span', null, val, set));
  return {
    el,
    update(t) {
      const v = value(t, c);
      if (val.textContent !== v) val.textContent = v;
      if (set && o.setpoint) {
        const s = o.setpoint(c);
        if (set.textContent !== s) set.textContent = s;
      }
      if (badge && o.ap) badge.classList.toggle('on', o.ap(c));
      if (o.classes) for (const [k, on] of Object.entries(o.classes(t))) val.classList.toggle(k, on);
    },
  };
}

/** Rudder or planes: angle and command, with a centred bar and a command mark. */
function surface(label: string, side: [string, string], c: Controller, angle: (t: Telemetry) => number, cmd: (t: Telemetry) => number, max: number): Instrument {
  const r = row(label, (t) => {
    const a = angle(t) * DEG;
    return `${a > 0.5 ? `${side[0]} ` : a < -0.5 ? `${side[1]} ` : ''}${f(Math.abs(a), 1)} (${signed(cmd(t) * DEG, 0)})`;
  }, c);
  const fill = h('div', { class: 'fill' });
  const mark = h('div', { class: 'mark' });
  const bar = h('div', { class: 'bar center' }, h('div', { class: 'zero' }), fill, mark);
  const maxDeg = max * DEG;
  return {
    el: h('div', null, r.el, bar),
    update(t) {
      r.update(t);
      const v = Math.max(-1, Math.min(1, (angle(t) * DEG) / maxDeg));
      fill.style.left = v >= 0 ? '50%' : `${50 + v * 50}%`;
      fill.style.width = `${Math.abs(v) * 50}%`;
      mark.style.left = `calc(${50 + Math.max(-1, Math.min(1, (cmd(t) * DEG) / maxDeg)) * 50}% - 1px)`;
    },
  };
}

/** A named level with a bar (tanks, HP air). */
function level(name: string, text: (t: Telemetry) => string, frac: (t: Telemetry) => number, flags?: (t: Telemetry) => string): Instrument {
  const flagEl = flags ? h('span', { class: 'flags' }) : null;
  const val = h('span');
  const fill = h('div', { class: 'fill' });
  return {
    el: h('div', null, h('div', { class: 'tank-name' }, h('span', null, name), h('span', null, flagEl, flagEl ? ' ' : null, val)), h('div', { class: 'bar' }, fill)),
    update(t) {
      const v = text(t);
      if (val.textContent !== v) val.textContent = v;
      if (flagEl && flags) flagEl.textContent = flags(t);
      fill.style.width = `${Math.max(0, Math.min(1, frac(t))) * 100}%`;
    },
  };
}

const separator = (): Instrument => ({ el: h('div', { class: 'inst-sep' }), update() {} });

const trimState = (t: Telemetry) => {
  const kg = t.netBuoyancy / 9.80665;
  return t.submergedFraction <= 0.999 ? 'surface' : kg < -TRIM_NEUTRAL_KG ? 'heavy' : kg > TRIM_NEUTRAL_KG ? 'light' : 'neutral';
};

/** Every instrument, by id. */
const INSTRUMENTS: Record<string, (c: Controller) => Instrument> = {
  sep: () => separator(),
  time: () => {
    const v = h('span');
    return {
      el: h('div', { class: 'inst-row' }, h('span', { class: 'inst-label' }, 'Tid'), v),
      update(t) {
        v.textContent = formatSimTime(t.t);
      },
    };
  },
  depth: (c) =>
    row('Djup (m)', (t) => f(t.depth, 1), c, {
      big: true,
      setpoint: (k) => (k.ap.depth ? (k.surfaceHold ? '→ yta' : `→ ${f(k.setpoints.depth)}`) : ''),
    }),
  speed: (c) =>
    row('Fart (knop)', (t) => knots(t.u * KN), c, {
      big: true,
      setpoint: (k) => (k.ap.speed ? `→ ${knots(k.setpoints.speed)}` : ''),
    }),
  heading: (c) =>
    row('Kurs (°)', (t) => deg3(t.heading), c, {
      big: true,
      setpoint: (k) => (k.ap.heading ? `→ ${String(Math.round(k.setpoints.heading) % 360).padStart(3, '0')}` : ''),
    }),
  keel: (c) =>
    row('Under köl (m)', (t) => (t.grounded ? 'GRUND!' : f(Math.max(0, t.depthUnderKeel), 1)), c, {
      big: true,
      classes: (t) => ({ alarm: t.grounded || t.depthUnderKeel < 5 }),
    }),
  trim: (c) =>
    row('Trim', (t) => ({ surface: 'Ytläge', heavy: 'Tung', light: 'Lätt', neutral: 'Neutral' })[trimState(t)], c, {
      classes: (t) => ({ 'trim-heavy': trimState(t) === 'heavy', 'trim-light': trimState(t) === 'light' }),
    }),
  pitch: (c) => row('Stampvinkel (°)', (t) => signed(t.pitch * DEG), c),
  rudder: (c) => surface('Roder', ['SB', 'BB'], c, (t) => t.rudder, (t) => t.rudderCmd, c.sim.cfg.actuators.rudderMax),
  planes: (c) => surface('Djuproder', ['NED', 'UPP'], c, (t) => t.sternPlanes, (t) => t.sternPlanesCmd, c.sim.cfg.actuators.planesMax),
  depthRate: (c) => row('Djupändring (m/min)', (t) => signed(t.depthRate * 60, 1), c),
  sog: (c) => row('Över grund (knop, °)', (t) => `${f(t.speedOverGround * KN, 1)} ${deg3(t.courseOverGround)}`, c),
  current: (c) =>
    row('Ström (knop, mot °)', (t) => {
      const cs = Math.hypot(t.current[0], t.current[1]);
      return cs < 0.01 ? '–' : `${f(cs * KN, 1)} ${deg3(Math.atan2(t.current[1], t.current[0]))}`;
    }, c),
  roll: (c) => row('Krängning (°)', (t) => signed(t.roll * DEG), c),
  rpm: (c) => row('Varv (rpm)', (t) => `${f(t.rps * 60)} (${f(t.rpsCmd * 60)})`, c),
  power: (c) => row('Axeleffekt (kW)', (t) => f(t.shaftPower / 1000), c),
  tanks: (c) => {
    const items = c.sim.tankDefs.map((d, i) =>
      level(
        d.name,
        (t) => {
          const tk = t.tanks[i]!;
          return tk.volume >= 50 ? `${f(tk.fill * 100)} %` : `${f(tk.water * 1000)} l`;
        },
        (t) => t.tanks[i]!.fill,
        (t) => (t.tanks[i]!.blowOpen ? 'BLÅS' : t.tanks[i]!.ventOpen ? 'VENT' : ''),
      ),
    );
    return {
      el: h('div', null, h('div', { class: 'inst-label' }, 'Tankar'), ...items.map((x) => x.el)),
      update(t) {
        for (const x of items) x.update(t);
      },
    };
  },
  air: (c) => level('HP-luft (bar)', (t) => f(t.airPressure / 1e5), (t) => t.airPressure / c.sim.cfg.air.bottlePressure),
  battery: (c) =>
    row('Batteri (%)', (t) => f(t.battery * 100), c, {
      setpoint: () => {
        const t = c.sim.telemetry();
        return t.batteryPower < -1000 ? '↑ laddas' : '';
      },
      classes: (t) => ({ alarm: t.battery < 0.1, 'trim-heavy': t.battery >= 0.1 && t.battery < 0.3 }),
    }),
  load: (c) => row('Elförbrukning (kW)', (t) => f(t.electricalLoad / 1000), c),
  diesel: (c) =>
    row('Diesel', (t) => (t.dieselRunning ? `går, ${f(t.generatorPower / 1000)} kW` : t.dieselOrdered ? 'väntar på luft' : 'stopp'), c),
  snorkel: (c) => row('Snorkel', (t) => (t.snorkel > 0.99 ? (t.inductionAir ? 'uppe, luft' : 'uppe, stängd') : t.snorkel < 0.01 ? 'nere' : `${f(t.snorkel * 100)} %`), c),
  flood: (c) =>
    row('Vatten inne (m³)', (t) => {
      const water = t.compartments.reduce((s, x) => s + x.water, 0);
      const inflow = t.compartments.reduce((s, x) => s + x.inflow, 0);
      return `${f(water, 1)}${inflow > 0 ? ` +${f(inflow * 1000)} l/s` : ''}`;
    }, c, { classes: (t) => ({ alarm: t.compartments.some((x) => x.holeArea > 0 || x.water > 0.5) }) }),
  net: (c) => row('Flytkraftsöverskott (kg)', (t) => signed(t.netBuoyancy / 9.80665, 0), c),
};

/** Every instrument under "Mer", in order (those in the main panel are left out there). */
const ALL_MORE = ['pitch', 'rudder', 'planes', 'sep', 'depthRate', 'sog', 'current', 'roll', 'rpm', 'power', 'sep', 'load', 'diesel', 'snorkel', 'flood', 'sep', 'net', 'tanks', 'air'];

/**
 * The panel for who handles what: the main panel leads with depth, speed,
 * course, the water under the keel and the trim; what the player takes over
 * joins it (planes and pitch for the depth, the rudder for the course, the
 * shaft for the speed, buoyancy and tanks for the trim, tanks and HP air for
 * the ballast, the diesels and the load for the charging). Water inside the
 * hull joins it while there is any (`flooded`). Everything else is under "Mer".
 */
export function instrumentLayout(d: CrewDuties, flooded = false): { main: string[]; more: string[] } {
  const main = ['time', 'sep', 'depth', 'speed', 'heading', 'keel', 'trim', 'battery'];
  if (flooded) main.push('flood');
  const extra: string[] = [];
  if (!d.depth) extra.push('pitch', 'planes');
  if (!d.heading) extra.push('rudder');
  if (!d.speed) extra.push('rpm', 'power');
  if (!d.trim) extra.push('net');
  if (!d.trim || !d.ballast) extra.push('tanks');
  if (!d.ballast) extra.push('air');
  if (!d.charging) extra.push('diesel', 'snorkel', 'load');
  if (extra.length) main.push('sep', ...extra);
  main.push('sep');
  const more = ALL_MORE.filter((id) => id === 'sep' || !main.includes(id));
  // No separator first, last or twice in a row.
  const tidy = more.filter((id, i) => id !== 'sep' || (i > 0 && i < more.length - 1 && more[i - 1] !== 'sep'));
  return { main, more: tidy };
}

/** A key that changes when the layout does (rebuild the panel then). */
export const layoutKey = (d: CrewDuties, flooded = false): string => instrumentLayout(d, flooded).main.join(',');

/** Builds the panel for who handles what now (create it again when that changes) and returns its update function. */
export function createInstruments(el: HTMLElement, ctrl: Controller, flooded = false): (t: Telemetry) => void {
  const layout = instrumentLayout(ctrl.duties(), flooded);
  const make = (id: string) => INSTRUMENTS[id]!(ctrl);
  const main = layout.main.map(make);
  const more = layout.more.map(make);
  // Phones show the panel only when the status bar is tapped (statusBar.ts), and then all of it.
  el.replaceChildren(...main.map((x) => x.el), h('div', { class: 'inst-more' }, ...more.map((x) => x.el)));
  const all = [...main, ...more];
  return (t) => {
    for (const x of all) x.update(t);
  };
}
