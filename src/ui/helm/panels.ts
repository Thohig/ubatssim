/**
 * The panels Ballast, Trim, Fart and El under the screen controls: each
 * system's state and its controls. A button in a panel gives an ordinary
 * order, which takes the system over from the crew (the order registry's
 * `effects`); the panel's header (index.ts) hands it back. Nödblåsning in
 * the Ballast panel is the exception: its orders leave the ballast to whoever has it.
 */
import type { Controller } from '../../control/controller';
import type { CrewSystem } from '../../control/crew';
import { LIMITS } from '../../control/parser';
import type { Telemetry } from '../../sim/simulation';
import { h } from '../dom';
import { isReady, tubeState } from '../../control/torpedoRoom';
import { submitEmergencyBlow } from '../keyboard';
import { DEG, fmt, setText } from './mappings';

export type Panel = 'ballast' | 'trim' | 'speed' | 'power' | 'torpedo';
export const PANELS: readonly Panel[] = ['ballast', 'trim', 'speed', 'power', 'torpedo'];
export const PANEL_SYSTEM: Record<Panel, CrewSystem> = { ballast: 'ballast', trim: 'trim', speed: 'speed', power: 'charging', torpedo: 'torpedoRoom' };
export const PANEL_TITLE: Record<Panel, string> = { ballast: 'Ballast', trim: 'Trim', speed: 'Fart', power: 'El', torpedo: 'Torped' };

/** A button that acts once on press (no repeat). */
export type TapButton = (label: string, title: string, run: (c: Controller) => void, className?: string) => HTMLButtonElement;

export interface PanelView {
  el: HTMLElement;
  update(t: Telemetry, c: Controller): void;
}

/** The five panels, built with the helm's button factory. */
export function createPanels(tapButton: TapButton): Record<Panel, PanelView> {
  return { ballast: ballastPanel(tapButton), trim: trimPanel(tapButton), speed: speedPanel(tapButton), power: powerPanel(tapButton), torpedo: torpedoPanel(tapButton) };
}

/**
 * The torpedo room: each tube's state with Klar (flood, open the door),
 * Säkra (shut, drain) and Ladda (from the racks), and the racks.
 */
function torpedoPanel(tapButton: TapButton): PanelView {
  const rows = [0, 1, 2, 3].map((i) => {
    const state = h('span', { class: 'helm-panel-value helm-tube-state' });
    const ready = tapButton('Klar', `Gör tub ${i + 1} klar: vattenfyll och öppna mynningsluckan`, (c) => c.submit({ kind: 'tube', tube: i + 1, action: 'ready' }, 'touch'));
    const secure = tapButton('Säkra', `Säkra tub ${i + 1}: stäng mynningsluckan och länsa`, (c) => c.submit({ kind: 'tube', tube: i + 1, action: 'secure' }, 'touch'));
    const load = tapButton('Ladda', `Ladda tub ${i + 1} från stället`, (c) => c.submit({ kind: 'tube', tube: i + 1, action: 'load' }, 'touch'));
    return { el: h('div', { class: 'helm-panel-row' }, h('span', { class: 'helm-panel-label' }, `Tub ${i + 1}`), state, ready, secure, load), state, ready, secure, load };
  });
  const store = h('span', { class: 'helm-panel-value' });
  const el = h(
    'div',
    { class: 'helm-panel-body', hidden: true },
    ...rows.map((r) => r.el),
    h('div', { class: 'helm-panel-row' }, h('span', { class: 'helm-panel-label' }, 'Stället'), store),
  );
  return {
    el,
    update(_t: Telemetry, c: Controller) {
      const room = c.fire.room;
      room.tubes.forEach((tube, i) => {
        const r = rows[i]!;
        setText(r.state, tubeState(tube));
        r.state.classList.toggle('ready', isReady(tube));
        r.ready.disabled = !tube.loaded || isReady(tube) || tube.plan.includes('open');
        r.secure.disabled = !tube.open && !tube.flooded;
        r.load.disabled = tube.loaded || room.reserve === 0;
      });
      setText(store, `${room.reserve} ${room.reserve === 1 ? 'torped' : 'torpeder'}`);
    },
  };
}

/** A labelled level bar. */
export function level(label: string) {
  const text = h('span');
  const fill = h('div', { class: 'fill' });
  const flags = h('span', { class: 'flags' });
  return {
    el: h('div', { class: 'helm-level' }, h('div', { class: 'tank-name' }, h('span', null, label), h('span', null, flags, ' ', text)), h('div', { class: 'bar' }, fill)),
    set(value: string, frac: number, flag = '') {
      setText(text, value);
      setText(flags, flag);
      fill.style.width = `${Math.max(0, Math.min(1, frac)) * 100}%`;
    },
  };
}

function ballastPanel(tapButton: TapButton): PanelView {
  const group = (g: 'fwd' | 'aft' | 'all', label: string) =>
    h(
      'div',
      { class: 'helm-panel-row' },
      h('span', { class: 'helm-panel-label' }, label),
      tapButton('Fyll', `Fyll huvudballast ${label.toLowerCase()}`, (c) => c.submit({ kind: 'mainBallast', action: 'flood', group: g }, 'touch')),
      tapButton('Blås', `Blås huvudballast ${label.toLowerCase()}`, (c) => c.submit({ kind: 'mainBallast', action: 'blow', group: g }, 'touch')),
      tapButton('Stäng', `Stäng huvudballast ${label.toLowerCase()}`, (c) => c.submit({ kind: 'mainBallast', action: 'shut', group: g }, 'touch')),
    );
  const fwd = level('Huvudballast för');
  const aft = level('Huvudballast akter');
  const air = level('HP-luft');
  const bridgeState = h('span', { class: 'helm-panel-label' });
  let manned = false;
  const bridgeBtn = tapButton('', '', (c) => c.submit({ kind: 'bridge', manned: !manned }, 'touch'));
  // Blows both tanks at any depth, full ahead, the surface as the target; the crew keeps the ballast.
  const emergency = tapButton('Nödblåsning', 'Nödblåsning: blås båda huvudballasttankarna på vilket djup som helst, full fart och djupmålet ytan (Shift + S)', (c) => submitEmergencyBlow(c, 'touch'), 'helm-emergency');
  const el = h(
    'div',
    { class: 'helm-panel-body', hidden: true },
    h('div', { class: 'helm-panel-row' }, emergency),
    fwd.el,
    aft.el,
    group('fwd', 'För'),
    group('aft', 'Akter'),
    group('all', 'Båda'),
    h('div', { class: 'helm-panel-row' }, bridgeState, bridgeBtn),
    air.el,
  );
  return {
    el,
    update(t: Telemetry, c: Controller) {
      const tank = (id: string) => t.tanks.find((x) => x.id === id);
      for (const [lv, id] of [
        [fwd, 'mbt_fwd'],
        [aft, 'mbt_aft'],
      ] as const) {
        const x = tank(id);
        if (x) lv.set(`${Math.round(x.fill * 100)} %`, x.fill, x.blowOpen ? 'BLÅS' : x.ventOpen ? 'VENT' : '');
      }
      air.set(`${Math.round(t.airPressure / 1e5)} bar`, t.airPressure / c.sim.cfg.air.bottlePressure);
      manned = c.bridgeManned;
      setText(bridgeState, manned ? 'Bryggan: bemannad' : 'Bryggan: utrymd');
      setText(bridgeBtn, manned ? 'Klart bryggan' : 'Bemanna');
      bridgeBtn.title = manned ? 'Klart bryggan: utrym den före dykning' : 'Bemanna bryggan (bara i ytläge)';
    },
  };
}

function trimPanel(tapButton: TapButton): PanelView {
  const net = h('span', { class: 'helm-panel-value' });
  const pumps = h('span', { class: 'helm-panel-value' });
  const fwd = level('Trimtank för');
  const aft = level('Trimtank akter');
  const comp = level('Kompenseringstank');
  const step = (label: string, title: string, order: (n: number) => Parameters<Controller['submit']>[0], n: number) =>
    tapButton(label, title, (c) => c.submit(order(n), 'touch'));
  const el = h(
    'div',
    { class: 'helm-panel-body', hidden: true },
    h('div', { class: 'helm-panel-row' }, h('span', { class: 'helm-panel-label' }, 'Flytkraft'), net),
    h('div', { class: 'helm-panel-row' }, h('span', { class: 'helm-panel-label' }, 'Pumpar'), pumps),
    comp.el,
    h(
      'div',
      { class: 'helm-panel-row' },
      h('span', { class: 'helm-panel-label' }, 'Kompensera'),
      step('In 100', 'Kompensera in 100 liter', (n) => ({ kind: 'compensate', litres: n }), 100),
      step('In 500', 'Kompensera in 500 liter', (n) => ({ kind: 'compensate', litres: n }), 500),
      step('Ut 100', 'Kompensera ut 100 liter', (n) => ({ kind: 'compensate', litres: -n }), 100),
      step('Ut 500', 'Kompensera ut 500 liter', (n) => ({ kind: 'compensate', litres: -n }), 500),
    ),
    fwd.el,
    aft.el,
    h(
      'div',
      { class: 'helm-panel-row' },
      h('span', { class: 'helm-panel-label' }, 'Trimma'),
      step('För 100', 'Trimma 100 liter förut', (n) => ({ kind: 'trim', litres: n }), 100),
      step('För 500', 'Trimma 500 liter förut', (n) => ({ kind: 'trim', litres: n }), 500),
      step('Akter 100', 'Trimma 100 liter akterut', (n) => ({ kind: 'trim', litres: -n }), 100),
      step('Akter 500', 'Trimma 500 liter akterut', (n) => ({ kind: 'trim', litres: -n }), 500),
    ),
  );
  return {
    el,
    update(t: Telemetry) {
      const kg = t.netBuoyancy / 9.80665;
      const state = t.submergedFraction <= 0.999 ? 'ytläge' : kg < -100 ? 'tung' : kg > 100 ? 'lätt' : 'neutral';
      setText(net, `${kg > 0 ? '+' : ''}${Math.round(kg)} kg · ${state} · stamp ${fmt(t.pitch * DEG)}°`);
      const parts = [
        t.compRemaining !== 0 ? `kompensering ${Math.round(Math.abs(t.compRemaining) * 1000)} l kvar` : '',
        t.trimRemaining !== 0 ? `trim ${Math.round(Math.abs(t.trimRemaining) * 1000)} l kvar` : '',
      ].filter(Boolean);
      setText(pumps, parts.length ? parts.join(' · ') : 'stilla');
      const tank = (id: string) => t.tanks.find((x) => x.id === id);
      for (const [lv, id] of [
        [fwd, 'trim_fwd'],
        [aft, 'trim_aft'],
        [comp, 'comp'],
      ] as const) {
        const x = tank(id);
        if (x) lv.set(`${Math.round(x.water * 1000)} l`, x.fill);
      }
    },
  };
}

/** Battery, diesels and snorkel, and the leaks with the drain pump. */
function powerPanel(tapButton: TapButton): PanelView {
  const battery = level('Batteri');
  const load = h('span', { class: 'helm-panel-value' });
  const diesel = h('span', { class: 'helm-panel-value' });
  const snorkel = h('span', { class: 'helm-panel-value' });
  const drain = h('span', { class: 'helm-panel-value' });
  const leaks = h('div', { class: 'helm-leaks' });
  const doors = h('span', { class: 'helm-panel-value' });
  const doorBtn = tapButton('Stäng', 'Stäng eller öppna de vattentäta dörrarna mellan avdelningarna', (c) => c.submit({ kind: 'doors', shut: !c.sim.commands.doorsShut }, 'touch'));
  // The drain pump's first choice: the wettest, or one compartment after another.
  const drainFirst = tapButton('det blötaste', 'Välj vilken avdelning länspumpen tar först', (c) => {
    const ids = [null, ...c.sim.systems.flooding.compartments.map((x) => x.id)];
    const next = ids[(ids.indexOf(c.sim.systems.flooding.drainTarget) + 1) % ids.length] ?? null;
    c.submit({ kind: 'drain', compartment: next }, 'touch');
  });
  const el = h(
    'div',
    { class: 'helm-panel-body', hidden: true },
    battery.el,
    h('div', { class: 'helm-panel-row' }, h('span', { class: 'helm-panel-label' }, 'Last'), load),
    h(
      'div',
      { class: 'helm-panel-row' },
      h('span', { class: 'helm-panel-label' }, 'Snorkel'),
      snorkel,
      tapButton('Upp', 'Hissa snorkeln', (c) => c.submit({ kind: 'snorkel', up: true }, 'touch')),
      tapButton('Ned', 'Sänk snorkeln', (c) => c.submit({ kind: 'snorkel', up: false }, 'touch')),
    ),
    h(
      'div',
      { class: 'helm-panel-row' },
      h('span', { class: 'helm-panel-label' }, 'Diesel'),
      diesel,
      tapButton('Start', 'Starta dieslarna', (c) => c.submit({ kind: 'diesel', on: true }, 'touch')),
      tapButton('Stopp', 'Stoppa dieslarna', (c) => c.submit({ kind: 'diesel', on: false }, 'touch')),
    ),
    h('div', { class: 'helm-panel-row' }, h('span', { class: 'helm-panel-label' }, 'Dörrar'), doors, doorBtn),
    h('div', { class: 'helm-panel-row' }, h('span', { class: 'helm-panel-label' }, 'Läns'), drain),
    h('div', { class: 'helm-panel-row' }, h('span', { class: 'helm-panel-label' }, 'Länsa först'), drainFirst),
    leaks,
  );
  const leakRows = new Map<string, ReturnType<typeof level>>();
  return {
    el,
    update(t: Telemetry) {
      const p = t.batteryPower;
      battery.set(`${Math.round(t.battery * 100)} %`, t.battery, p < -1000 ? 'LADDAS' : t.battery < 0.15 ? 'LÅGT' : '');
      setText(load, `${Math.round(t.electricalLoad / 1000)} kW${p < -1000 ? ` · laddar ${Math.round(-p / 1000)} kW` : ''}`);
      setText(diesel, t.dieselRunning ? `går, ${Math.round(t.generatorPower / 1000)} kW` : t.dieselOrdered ? 'väntar på luft' : 'stopp');
      setText(
        snorkel,
        t.snorkel > 0.99 ? (t.inductionAir ? 'uppe, luft' : 'uppe, ventilen stängd') : t.snorkel < 0.01 ? 'nere' : `${Math.round(t.snorkel * 100)} %`,
      );
      const shut = t.doors.reduce((a, b) => a + b, 0) / Math.max(1, t.doors.length);
      setText(doors, shut > 0.99 ? 'stängda' : shut < 0.01 ? 'öppna' : `${shut > 0.5 ? 'stängs' : 'öppnas'}…`);
      setText(doorBtn, shut > 0.5 ? 'Öppna' : 'Stäng');
      setText(drainFirst, t.drainTarget ? (t.compartments.find((x) => x.id === t.drainTarget)?.name.toLowerCase() ?? t.drainTarget) : 'det blötaste');
      const wet = t.compartments.filter((x) => x.water > 0.001 || x.holeArea > 0);
      setText(drain, wet.length === 0 ? 'torrt, ingen läcka' : t.drainPumpRunning ? 'länspumpen går' : 'länspumpen orkar inte på det här djupet');
      for (const x of t.compartments) {
        let row = leakRows.get(x.id);
        const show = x.water > 0.001 || x.holeArea > 0;
        if (show && !row) {
          row = level(x.name);
          leakRows.set(x.id, row);
          leaks.append(row.el);
        }
        if (!row) continue;
        row.el.hidden = !show;
        if (show) row.set(`${fmt(x.water)} m³${x.inflow > 0 ? ` · ${Math.round(x.inflow * 1000)} l/s in` : ''}`, x.water / x.volume, x.holeArea > 0 ? 'LÄCKA' : '');
      }
    },
  };
}

function speedPanel(tapButton: TapButton): PanelView {
  const speed = h('span', { class: 'helm-panel-value' });
  const rpm = h('span', { class: 'helm-panel-value' });
  const rpmStep = (delta: number) =>
    tapButton(`Varv ${delta > 0 ? '+' : '−'}${Math.abs(delta)}`, `Propellervarv ${delta > 0 ? '+' : '−'}${Math.abs(delta)} rpm`, (c) => {
      const now = Math.round(c.sim.telemetry().rpsCmd * 60);
      const next = Math.max(-LIMITS.maxRpmAstern, Math.min(LIMITS.maxRpm, now + delta));
      c.submit({ kind: 'setRpm', rpm: next }, 'touch');
    });
  const el = h(
    'div',
    { class: 'helm-panel-body', hidden: true },
    h('div', { class: 'helm-panel-row' }, h('span', { class: 'helm-panel-label' }, 'Fart'), speed),
    h('div', { class: 'helm-panel-row' }, h('span', { class: 'helm-panel-label' }, 'Varv'), rpm),
    h(
      'div',
      { class: 'helm-panel-row' },
      h('span', { class: 'helm-panel-label' }, 'Fartmål'),
      tapButton('−1 knop', 'Fartmål 1 knop lägre', (c) => c.submit({ kind: 'adjustSpeed', deltaKnots: -1 }, 'touch')),
      tapButton('+1 knop', 'Fartmål 1 knop högre', (c) => c.submit({ kind: 'adjustSpeed', deltaKnots: 1 }, 'touch')),
    ),
    h('div', { class: 'helm-panel-row' }, h('span', { class: 'helm-panel-label' }, 'Varv'), rpmStep(-10), rpmStep(10), tapButton('Stopp', 'Propellervarv 0', (c) => c.submit({ kind: 'setRpm', rpm: 0 }, 'touch'))),
  );
  return {
    el,
    update(t: Telemetry) {
      const kn = (t.u * 3600) / 1852;
      setText(speed, kn < -0.05 ? `back ${fmt(-kn)} knop` : `${fmt(Math.max(0, kn))} knop`);
      setText(rpm, `${Math.round(t.rps * 60)} rpm (order ${Math.round(t.rpsCmd * 60)}) · ${Math.round(t.shaftPower / 1000)} kW`);
    },
  };
}
