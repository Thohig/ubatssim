/**
 * Instrument panel. Every instrument is a small component (created once,
 * updated ten times a second), and the panel's layout per game mode is
 * data (`LAYOUT`): which instruments in the main panel, which under "Mer".
 * Adding an instrument = one entry in `INSTRUMENTS` and its id in `LAYOUT`.
 */
import { formatSimTime, type Controller } from '../control/controller';
import type { GameMode } from '../control/gameMode';
import type { Telemetry } from '../sim/simulation';
import { h, type Component } from './dom';

const DEG = 180 / Math.PI;
const KN = 3600 / 1852;

const f = (v: number, d = 0) => v.toFixed(d).replace('.', ',').replace('-0,0', '0,0');
const signed = (v: number, d = 1) => (v > 0 ? '+' : '') + f(v, d);
const deg3 = (rad: number) => String(Math.round(((rad * DEG) % 360 + 360) % 360) % 360).padStart(3, '0');

/** Knots as "4,0", or "BACK 4,0" astern (below −0.05 knots). */
const knots = (kn: number) => (kn < -0.05 ? `BACK ${f(-kn, 1)}` : f(Math.max(0, kn), 1));

/** Net buoyancy within this is shown as "Neutral" in the simplified panel [kg]. */
const TRIM_NEUTRAL_KG = 100;

type Instrument = Component<Telemetry>;

interface RowOptions {
  big?: boolean;
  /** Autopilot target shown after the value (e.g. "→ 32"). */
  setpoint?: (c: Controller) => string;
  /** Autopilot badge (realistic panel only). */
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
const INSTRUMENTS: Record<string, (c: Controller, simple: boolean) => Instrument> = {
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
  depth: (c, simple) =>
    row('Djup (m)', (t) => f(t.depth, 1), c, {
      big: true,
      setpoint: (k) => (k.ap.depth ? (k.surfaceHold ? '→ yta' : `→ ${f(k.setpoints.depth)}`) : ''),
      ap: simple ? undefined : (k) => k.ap.depth,
    }),
  speed: (c, simple) =>
    row('Fart (knop)', (t) => knots(t.u * KN), c, {
      big: true,
      setpoint: (k) => (k.ap.speed ? `→ ${knots(k.setpoints.speed)}` : ''),
      ap: simple ? undefined : (k) => k.ap.speed,
    }),
  heading: (c, simple) =>
    row('Kurs (°)', (t) => deg3(t.heading), c, {
      big: true,
      setpoint: (k) => (k.ap.heading ? `→ ${String(Math.round(k.setpoints.heading) % 360).padStart(3, '0')}` : ''),
      ap: simple ? undefined : (k) => k.ap.heading,
    }),
  keel: (c, simple) =>
    row('Under köl (m)', (t) => (t.grounded ? 'GRUND!' : f(Math.max(0, t.depthUnderKeel), 1)), c, {
      big: simple,
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
  net: (c) => row('Flytkraftsöverskott (kg)', (t) => signed(t.netBuoyancy / 9.80665, 0), c),
};

/**
 * The panel per game mode: the simplified panel leads with the targets, the
 * water under the keel and the trim, and keeps rudder and planes under "Mer".
 */
export const LAYOUT: Record<GameMode, { main: string[]; more: string[] }> = {
  simplified: {
    main: ['time', 'sep', 'depth', 'speed', 'heading', 'keel', 'trim', 'sep'],
    more: ['pitch', 'rudder', 'planes', 'sep', 'depthRate', 'sog', 'current', 'roll', 'rpm', 'power', 'sep', 'tanks', 'air', 'net'],
  },
  realistic: {
    main: ['time', 'sep', 'depth', 'speed', 'heading', 'pitch', 'keel', 'sep', 'rudder', 'planes'],
    more: ['depthRate', 'sog', 'current', 'roll', 'rpm', 'power', 'sep', 'tanks', 'air', 'net'],
  },
};

/**
 * Builds the panel for the controller's game mode (create it again after a
 * mode switch) and returns its update function.
 */
export function createInstruments(el: HTMLElement, ctrl: Controller): (t: Telemetry) => void {
  const simple = ctrl.options.mode === 'simplified';
  const layout = LAYOUT[ctrl.options.mode];
  const make = (id: string) => INSTRUMENTS[id]!(ctrl, simple);
  const main = layout.main.map(make);
  const more = layout.more.map(make);
  // On narrow screens the panel starts compact; the button shows the rest.
  const toggle = h('button', { type: 'button', class: 'inst-toggle', 'aria-expanded': 'false' }, 'Mer ▾');
  toggle.addEventListener('click', () => {
    const expanded = el.classList.toggle('expanded');
    toggle.textContent = expanded ? 'Mindre ▴' : 'Mer ▾';
    toggle.setAttribute('aria-expanded', String(expanded));
  });
  el.replaceChildren(...main.map((x) => x.el), h('div', { class: 'inst-more' }, ...more.map((x) => x.el)), toggle);
  const all = [...main, ...more];
  return (t) => {
    for (const x of all) x.update(t);
  };
}
