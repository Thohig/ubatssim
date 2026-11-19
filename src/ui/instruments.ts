import { formatSimTime, type Controller } from '../control/controller';
import type { Telemetry } from '../sim/simulation';

const DEG = 180 / Math.PI;
const KN = 3600 / 1852;

const f = (v: number, d = 0) => v.toFixed(d).replace('.', ',').replace('-0,0', '0,0');
const signed = (v: number, d = 1) => (v > 0 ? '+' : '') + f(v, d);

interface Refs {
  [k: string]: HTMLElement;
}

function row(label: string, key: string, big = false, setKey?: string, apKey?: string): string {
  return `<div class="inst-row"><span class="inst-label">${label}${apKey ? `<span class="ap" data-k="${apKey}">AP</span>` : ''}</span>
    <span><span class="inst-value${big ? ' big' : ''}" data-k="${key}"></span>${setKey ? `<span class="inst-set" data-k="${setKey}"></span>` : ''}</span></div>`;
}

function centredBar(key: string): string {
  return `<div class="bar center" data-k="${key}"><div class="zero"></div><div class="fill"></div><div class="mark"></div></div>`;
}

/** Instrument panel: depth, speed, heading, attitude, control surfaces, tanks, HP air. */
export function createInstruments(el: HTMLElement, ctrl: Controller): (t: Telemetry) => void {
  const sim = ctrl.sim;
  el.innerHTML = `
    <div class="inst-row"><span class="inst-label">Tid</span><span data-k="time"></span></div>
    <div class="inst-sep"></div>
    ${row('Djup (m)', 'depth', true, 'depthSet', 'apDepth')}
    ${row('Fart (knop)', 'speed', true, 'speedSet', 'apSpeed')}
    ${row('Kurs (°)', 'heading', true, 'headingSet', 'apHeading')}
    ${row('Stampvinkel (°)', 'pitch')}
    ${row('Under köl (m)', 'keel')}
    <div class="inst-sep"></div>
    ${row('Roder', 'rudder')}
    ${centredBar('rudderBar')}
    ${row('Djuproder', 'planes')}
    ${centredBar('planesBar')}
    <div class="inst-more">
      ${row('Djupändring (m/min)', 'depthRate')}
      ${row('Krängning (°)', 'roll')}
      ${row('Varv (rpm)', 'rpm')}
      ${row('Axeleffekt (kW)', 'power')}
      <div class="inst-sep"></div>
      <div class="inst-label">Tankar</div>
      ${sim.tankDefs
        .map(
          (d) => `<div class="tank-name"><span>${d.name}</span><span><span class="flags" data-k="flags_${d.id}"></span> <span data-k="tankv_${d.id}"></span></span></div>
          <div class="bar" data-k="tank_${d.id}"><div class="fill"></div></div>`,
        )
        .join('')}
      <div class="tank-name"><span>HP-luft (bar)</span><span data-k="air"></span></div>
      <div class="bar" data-k="airBar"><div class="fill"></div></div>
      ${row('Flytkraftsöverskott (kg)', 'net')}
    </div>
    <button type="button" class="inst-toggle" aria-expanded="false">Mer ▾</button>
  `;
  // On narrow screens the panel starts compact; the button shows the rest.
  const toggle = el.querySelector<HTMLButtonElement>('.inst-toggle')!;
  toggle.addEventListener('click', () => {
    const expanded = el.classList.toggle('expanded');
    toggle.textContent = expanded ? 'Mindre ▴' : 'Mer ▾';
    toggle.setAttribute('aria-expanded', String(expanded));
  });
  const refs: Refs = {};
  el.querySelectorAll<HTMLElement>('[data-k]').forEach((n) => (refs[n.dataset.k!] = n));
  const set = (k: string, text: string) => {
    const n = refs[k];
    if (n && n.textContent !== text) n.textContent = text;
  };
  const bar = (k: string, frac: number) => {
    const fill = refs[k]?.querySelector<HTMLElement>('.fill');
    if (fill) fill.style.width = `${Math.max(0, Math.min(1, frac)) * 100}%`;
  };
  const centred = (k: string, value: number, cmd: number, max: number) => {
    const b = refs[k];
    if (!b) return;
    const fill = b.querySelector<HTMLElement>('.fill')!;
    const mark = b.querySelector<HTMLElement>('.mark')!;
    const v = Math.max(-1, Math.min(1, value / max));
    fill.style.left = v >= 0 ? '50%' : `${50 + v * 50}%`;
    fill.style.width = `${Math.abs(v) * 50}%`;
    mark.style.left = `calc(${50 + Math.max(-1, Math.min(1, cmd / max)) * 50}% - 1px)`;
  };
  const ap = (k: string, on: boolean) => refs[k]?.classList.toggle('on', on);
  const maxR = sim.cfg.actuators.rudderMax * DEG;
  const maxP = sim.cfg.actuators.planesMax * DEG;
  const airMax = sim.cfg.air.bottlePressure;

  return (t) => {
    set('time', formatSimTime(t.t));
    set('depth', f(t.depth, 1));
    set('depthSet', ctrl.ap.depth ? `→ ${f(ctrl.setpoints.depth)}` : '');
    set('depthRate', signed(t.depthRate * 60, 1));
    set('speed', f(t.u * KN, 1));
    set('speedSet', ctrl.ap.speed ? `→ ${f(ctrl.setpoints.speed, 1)}` : '');
    set('heading', String(Math.round(t.heading * DEG) % 360).padStart(3, '0'));
    set('headingSet', ctrl.ap.heading ? `→ ${String(Math.round(ctrl.setpoints.heading) % 360).padStart(3, '0')}` : '');
    ap('apDepth', ctrl.ap.depth);
    ap('apSpeed', ctrl.ap.speed);
    ap('apHeading', ctrl.ap.heading);
    set('pitch', signed(t.pitch * DEG));
    set('keel', t.grounded ? 'GRUND!' : f(Math.max(0, t.depthUnderKeel), 1));
    refs['keel']?.classList.toggle('alarm', t.grounded || t.depthUnderKeel < 5);
    set('roll', signed(t.roll * DEG));
    const rud = t.rudder * DEG;
    set('rudder', `${rud > 0.5 ? 'SB ' : rud < -0.5 ? 'BB ' : ''}${f(Math.abs(rud), 1)} (${signed(t.rudderCmd * DEG, 0)})`);
    centred('rudderBar', rud, t.rudderCmd * DEG, maxR);
    const pl = t.sternPlanes * DEG;
    set('planes', `${pl > 0.5 ? 'NED ' : pl < -0.5 ? 'UPP ' : ''}${f(Math.abs(pl), 1)} (${signed(t.sternPlanesCmd * DEG, 0)})`);
    centred('planesBar', pl, t.sternPlanesCmd * DEG, maxP);
    set('rpm', `${f(t.rps * 60)} (${f(t.rpsCmd * 60)})`);
    set('power', f(t.shaftPower / 1000));
    for (const tk of t.tanks) {
      bar(`tank_${tk.id}`, tk.fill);
      set(`tankv_${tk.id}`, tk.volume >= 50 ? `${f(tk.fill * 100)} %` : `${f(tk.water * 1000)} l`);
      set(`flags_${tk.id}`, tk.blowOpen ? 'BLÅS' : tk.ventOpen ? 'VENT' : '');
    }
    set('air', f(t.airPressure / 1e5));
    bar('airBar', t.airPressure / airMax);
    set('net', signed(t.netBuoyancy / 9.80665, 0));
  };
}
