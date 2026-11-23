/**
 * The navigation panel: the chart (north up, centred on the boat) and the
 * passive sonar (a waterfall of bearings over time). Opened with Karta / K
 * and Sonar / H. Drawn on a 2D canvas at ~10 Hz while open; its size is kept
 * by a ResizeObserver (never read during the update).
 *
 *  Chart: depth shading sampled from the sea bed the physics uses (so what
 *  the chart shows is what the boat can hit), the track, the buoy, the
 *  lighthouses, sonar bearing lines, vessels in sight from a raised
 *  periscope or the bridge, radar echoes (green crosses), the last ping's
 *  echoes (rings) and the bearings of corvette radars the radar warning
 *  receiver hears (red). "Radar" in the head turns the radar on and off.
 *  Sonar: bearing relative to the bow across, time downwards (newest at
 *  the top), brighter for a stronger signal; the contacts and the boat's
 *  own noise and the risk of being found below. "Ping" in the head sends
 *  one ping with the active sonar.
 *
 * The pure helpers (`chartScales`, `depthColor`, `chartPoint`) are tested.
 */
import type { Controller } from '../control/controller';
import type { Lighthouse } from '../control/areas';
import { strength } from '../control/sonar';
import { solutionAt } from '../control/fireControl';
import { cavitationSpeed } from '../sim/acoustics';
import { h } from './dom';

export type NavMode = 'chart' | 'sonar';

export interface NavContext {
  ctrl: Controller;
  waypoint: [number, number] | null;
  lighthouses: readonly Lighthouse[];
}

/** Half the chart's width [m] at each zoom step. */
export const chartScales = [750, 2000, 5000, 12000] as const;

/** Chart colour for a sea bed depth [m] (negative = land). */
export function depthColor(depth: number): string {
  if (depth < 0) return '#6b6450';
  if (depth < 10) return '#7fb7c9';
  if (depth < 30) return '#4f8fae';
  if (depth < 60) return '#356f92';
  if (depth < 120) return '#245677';
  if (depth < 250) return '#183f5c';
  return '#0f2c44';
}

/** Canvas point [px] for a position [north, east] on a chart centred on `centre`, `half` metres to the edge. */
export function chartPoint(p: [number, number], centre: [number, number], half: number, w: number, hgt: number): [number, number] {
  const s = Math.min(w, hgt) / 2 / half;
  return [w / 2 + (p[1] - centre[1]) * s, hgt / 2 - (p[0] - centre[0]) * s];
}

const DEG = Math.PI / 180;
const KN = 1852 / 3600;
/** Samples across the depth shading (each direction). */
const GRID = 72;
/** Vessels are seen from the periscope or the bridge within this range [m]. */
const SIGHT = 8000;

export interface NavPanel {
  readonly mode: NavMode | null;
  toggle(mode: NavMode): void;
  close(): void;
  /** Call ~10 times a second; draws only while open. */
  update(ctx: NavContext): void;
}

/** What the buttons in the head do: one ping, and the radar on or off. */
export interface NavActions {
  ping(): void;
  radar(): void;
}

/** Seconds a ping's echoes stay on the chart. */
const ECHO_LIFE = 60;

/** `onMark` makes a sonar contact the target (a tap on its line in the sonar list). */
export function createNavPanel(root: HTMLElement, onMark?: (label: string) => void, actions?: NavActions): NavPanel {
  let mode: NavMode | null = null;
  let zoom = 1;
  let size = { w: 0, h: 0 };
  let track: [number, number][] = [];
  let trackCtrl: Controller | null = null;
  let shading: { key: string; canvas: HTMLCanvasElement } | null = null;

  const tab = (m: NavMode, label: string) => {
    const b = h('button', { type: 'button', class: 'helm-tab', role: 'tab', 'data-nav': m }, label);
    b.addEventListener('click', () => set(m));
    return b;
  };
  const tabs = { chart: tab('chart', 'Sjökort'), sonar: tab('sonar', 'Sonar') };
  const zoomOut = h('button', { type: 'button', class: 'helm-tab', title: 'Visa större område', 'aria-label': 'Zooma ut' }, '−');
  const zoomIn = h('button', { type: 'button', class: 'helm-tab', title: 'Visa mindre område', 'aria-label': 'Zooma in' }, '+');
  zoomOut.addEventListener('click', () => (zoom = Math.min(chartScales.length - 1, zoom + 1)));
  zoomIn.addEventListener('click', () => (zoom = Math.max(0, zoom - 1)));
  const zoomBox = h('span', { class: 'nav-zoom' }, zoomOut, zoomIn);
  const pingBtn = h('button', { type: 'button', class: 'helm-tab nav-action', title: 'En ping med den aktiva sonaren (A). Ger avstånd, men hörs långt.' }, 'Ping');
  pingBtn.addEventListener('click', () => actions?.ping());
  const radarBtn = h('button', { type: 'button', class: 'helm-tab nav-action', title: 'Radarn: sänd eller tyst (X). Hissar radarmasten.' }, 'Radar');
  radarBtn.addEventListener('click', () => actions?.radar());
  const close = h('button', { type: 'button', class: 'helm-panel-close', 'aria-label': 'Stäng' }, '✕');
  close.addEventListener('click', () => set(null));
  const canvas = h('canvas', { class: 'nav-canvas' });
  const info = h('div', { class: 'nav-info' });
  root.replaceChildren(h('div', { class: 'helm-panel-head' }, h('div', { class: 'helm-tabs', role: 'tablist' }, tabs.chart, tabs.sonar), radarBtn, pingBtn, zoomBox, close), canvas, info);
  root.hidden = true;
  if (typeof ResizeObserver !== 'undefined') {
    new ResizeObserver((e) => {
      const r = e[0]?.contentRect;
      if (r) size = { w: r.width, h: r.height };
    }).observe(canvas);
  }

  function set(m: NavMode | null): void {
    mode = m;
    root.hidden = m === null;
    root.dataset.mode = m ?? '';
    tabs.chart.classList.toggle('on', m === 'chart');
    tabs.sonar.classList.toggle('on', m === 'sonar');
    zoomBox.hidden = m !== 'chart';
    radarBtn.hidden = m !== 'chart' || !actions;
    pingBtn.hidden = m !== 'sonar' || !actions;
    document.body.classList.toggle('nav-open', m !== null);
  }

  /** Lines of text; a [class, text] pair is styled, a [class, text, label] triple is a button marking that sonar contact. */
  const setInfo = (lines: (string | [string, string] | [string, string, string])[]) => {
    const key = JSON.stringify(lines);
    if (info.dataset.key === key) return;
    info.dataset.key = key;
    info.replaceChildren(
      ...lines.map((l) => {
        if (typeof l === 'string') return h('div', null, l);
        if (l.length === 3) return h('button', { type: 'button', class: `nav-contact ${l[0]}`, 'data-label': l[2], title: `Gör ${l[2]} till mål` }, l[1]);
        return h('div', { class: l[0] }, l[1]);
      }),
    );
  };
  info.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-label]');
    if (b?.dataset.label) onMark?.(b.dataset.label);
  });

  function context2d(): CanvasRenderingContext2D | null {
    let g: CanvasRenderingContext2D | null;
    try {
      g = canvas.getContext('2d');
    } catch {
      return null;
    }
    if (!g || size.w === 0 || size.h === 0) return null;
    const dpr = window.devicePixelRatio || 1;
    const w = Math.round(size.w * dpr);
    const hh = Math.round(size.h * dpr);
    if (canvas.width !== w || canvas.height !== hh) {
      canvas.width = w;
      canvas.height = hh;
    }
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, size.w, size.h);
    return g;
  }

  function drawChart(ctx: NavContext): void {
    const c = ctx.ctrl;
    const sim = c.sim;
    const pos: [number, number] = [sim.y[0]!, sim.y[1]!];
    const half = chartScales[zoom]!;
    const g = context2d();
    const { w, h: H } = size;
    if (g) {
      // Depth shading, sampled again when the boat has moved a tenth of the view or the scale changed.
      const step = half / 10;
      const cn = Math.round(pos[0] / step) * step;
      const ce = Math.round(pos[1] / step) * step;
      const key = `${c.sim.areaId} ${half} ${cn} ${ce}`;
      if (!shading || shading.key !== key) {
        const off = document.createElement('canvas');
        off.width = GRID;
        off.height = GRID;
        const og = off.getContext('2d');
        if (og) {
          const span = half * 2.4; // a margin around the view
          for (let i = 0; i < GRID; i++) {
            for (let j = 0; j < GRID; j++) {
              const n = cn + span / 2 - ((i + 0.5) / GRID) * span;
              const e = ce - span / 2 + ((j + 0.5) / GRID) * span;
              og.fillStyle = depthColor(sim.ground(n, e));
              og.fillRect(j, i, 1, 1);
            }
          }
        }
        shading = { key, canvas: off };
      }
      const span = half * 2.4;
      const [x0, y0] = chartPoint([cn + span / 2, ce - span / 2], pos, half, w, H);
      const [x1, y1] = chartPoint([cn - span / 2, ce + span / 2], pos, half, w, H);
      g.imageSmoothingEnabled = true;
      g.drawImage(shading.canvas, x0, y0, x1 - x0, y1 - y0);

      const pt = (p: [number, number]) => chartPoint(p, pos, half, w, H);
      // Track.
      if (track.length > 1) {
        g.strokeStyle = 'rgba(255, 255, 255, 0.55)';
        g.lineWidth = 1.5;
        g.beginPath();
        track.forEach((p, i) => {
          const [x, y] = pt(p);
          if (i === 0) g.moveTo(x, y);
          else g.lineTo(x, y);
        });
        g.stroke();
      }
      // Sonar bearings: lines from the boat towards each contact.
      const [bx, by] = pt(pos);
      g.lineWidth = 1;
      g.font = '11px system-ui, sans-serif';
      for (const k of c.sonar.contacts) {
        const a = k.bearing * DEG;
        const len = Math.hypot(w, H);
        const ex = bx + Math.sin(a) * len;
        const ey = by - Math.cos(a) * len;
        g.strokeStyle = k.classified === 'örlogsfartyg' ? 'rgba(255, 107, 107, 0.8)' : k.bio && k.classified ? 'rgba(120, 210, 190, 0.6)' : 'rgba(255, 179, 71, 0.7)';
        g.setLineDash([4, 4]);
        g.beginPath();
        g.moveTo(bx, by);
        g.lineTo(ex, ey);
        g.stroke();
        g.setLineDash([]);
        const lx = bx + Math.sin(a) * Math.min(w, H) * 0.42;
        const ly = by - Math.cos(a) * Math.min(w, H) * 0.42;
        g.fillStyle = '#ffd08a';
        g.fillText(k.label, lx + 3, ly - 3);
      }
      // Targets: the solution's position now and two minutes of its course (fire control).
      for (const tg of c.fire.targets) {
        if (!tg.solution) continue;
        const now = sim.t;
        const p = solutionAt(tg.solution, now);
        const [x, y] = pt(p);
        const [x2, y2] = pt([p[0] + tg.solution.velocity[0] * 120, p[1] + tg.solution.velocity[1] * 120]);
        const col = tg.solution.quality === 'bra' ? '#6be3a1' : tg.solution.quality === 'ok' ? '#5fd3ff' : '#ffb347';
        g.strokeStyle = col;
        g.fillStyle = col;
        g.lineWidth = tg.label === c.fire.current ? 2 : 1;
        g.beginPath();
        g.moveTo(x, y - 6);
        g.lineTo(x + 6, y);
        g.lineTo(x, y + 6);
        g.lineTo(x - 6, y);
        g.closePath();
        g.stroke();
        g.beginPath();
        g.moveTo(x, y);
        g.lineTo(x2, y2);
        g.stroke();
        g.fillText(tg.label, x + 8, y + 4);
      }
      // Our decoys: small hollow diamonds with their course.
      g.strokeStyle = '#ffd08a';
      for (const d of c.world.decoys) {
        const [x, y] = pt([d.north, d.east]);
        g.beginPath();
        g.moveTo(x, y - 4);
        g.lineTo(x + 4, y);
        g.lineTo(x, y + 4);
        g.lineTo(x - 4, y);
        g.closePath();
        g.moveTo(x, y);
        g.lineTo(x + Math.sin(d.heading) * 9, y - Math.cos(d.heading) * 9);
        g.stroke();
      }
      // The guidance wires: thin dashed lines from the boat to its wired torpedoes.
      g.strokeStyle = 'rgba(255, 255, 255, 0.45)';
      g.setLineDash([2, 3]);
      for (const tp of c.world.torpedoes) {
        if (!tp.state.wired) continue;
        const [x, y] = pt([tp.state.north, tp.state.east]);
        g.beginPath();
        g.moveTo(bx, by);
        g.lineTo(x, y);
        g.stroke();
      }
      g.setLineDash([]);
      // Our torpedoes, with their heading.
      for (const tp of c.world.torpedoes) {
        const s = tp.state;
        const [x, y] = pt([s.north, s.east]);
        g.fillStyle = '#ffffff';
        g.beginPath();
        g.arc(x, y, 2.5, 0, 2 * Math.PI);
        g.fill();
        g.strokeStyle = 'rgba(255,255,255,0.7)';
        g.beginPath();
        g.moveTo(x, y);
        g.lineTo(x + Math.sin(s.heading) * 10, y - Math.cos(s.heading) * 10);
        g.stroke();
      }
      // Radar echoes: green crosses.
      g.strokeStyle = '#6be3a1';
      g.lineWidth = 2;
      for (const e of c.radar.echoes) {
        const a = e.bearing * DEG;
        const [x, y] = pt([pos[0] + e.range * Math.cos(a), pos[1] + e.range * Math.sin(a)]);
        g.beginPath();
        g.moveTo(x - 5, y);
        g.lineTo(x + 5, y);
        g.moveTo(x, y - 5);
        g.lineTo(x, y + 5);
        g.stroke();
      }
      g.lineWidth = 1;
      // The last ping's echoes: rings where they came from, fading.
      const age = sim.t - c.sonar.lastPing;
      if (age < ECHO_LIFE) {
        g.strokeStyle = `rgba(95, 211, 255, ${1 - age / ECHO_LIFE})`;
        for (const e of c.sonar.echoes) {
          const a = e.bearing * DEG;
          const [x, y] = pt([pos[0] + e.range * Math.cos(a), pos[1] + e.range * Math.sin(a)]);
          g.beginPath();
          g.arc(x, y, 7, 0, 2 * Math.PI);
          g.stroke();
          if (e.label) {
            g.fillStyle = '#5fd3ff';
            g.fillText(e.label, x + 9, y + 4);
          }
        }
      }
      // Corvette radars heard by the radar warning receiver: short red lines towards them.
      g.strokeStyle = '#ff6b6b';
      g.lineWidth = 2;
      for (const r of c.radar.esm) {
        const a = r.bearing * DEG;
        const len = Math.min(w, H) * 0.3;
        g.beginPath();
        g.moveTo(bx + Math.sin(a) * 14, by - Math.cos(a) * 14);
        g.lineTo(bx + Math.sin(a) * len, by - Math.cos(a) * len);
        g.stroke();
      }
      g.lineWidth = 1;
      // Lighthouses.
      for (const l of ctx.lighthouses) {
        const [x, y] = pt(l.position);
        g.fillStyle = l.color === 'red' ? '#ff6b6b' : l.color === 'green' ? '#6be3a1' : '#ffffff';
        g.beginPath();
        g.arc(x, y, 3.5, 0, 2 * Math.PI);
        g.fill();
      }
      // Vessels in sight from a raised periscope or the bridge.
      const t = sim.telemetry();
      const lookout = c.bridgeManned || (t.periscope > 0.99 && t.periscopeHeadDepth < 0);
      if (lookout) {
        for (const k of c.world.contacts()) {
          if (k.range > SIGHT) continue;
          const [x, y] = pt([k.vessel.state.north, k.vessel.state.east]);
          g.fillStyle = '#ffd08a';
          g.fillRect(x - 3, y - 3, 6, 6);
          g.fillText(k.vessel.def.name, x + 5, y - 4);
        }
      }
      // The buoy, or an arrow at the edge towards it.
      if (ctx.waypoint) {
        let [x, y] = pt(ctx.waypoint);
        const m = 10;
        if (x < m || x > w - m || y < m || y > H - m) {
          const a = Math.atan2(x - w / 2, -(y - H / 2));
          const r = Math.min(w, H) / 2 - m;
          x = w / 2 + Math.sin(a) * r;
          y = H / 2 - Math.cos(a) * r;
          g.fillStyle = '#ffd166';
          g.beginPath();
          g.moveTo(x + Math.sin(a) * 8, y - Math.cos(a) * 8);
          g.lineTo(x + Math.sin(a + 2.4) * 7, y - Math.cos(a + 2.4) * 7);
          g.lineTo(x + Math.sin(a - 2.4) * 7, y - Math.cos(a - 2.4) * 7);
          g.closePath();
          g.fill();
        }
        g.fillStyle = '#ffd166';
        g.strokeStyle = '#000';
        g.beginPath();
        g.arc(x, y, 5, 0, 2 * Math.PI);
        g.fill();
        g.stroke();
      }
      // The boat: a triangle along the heading.
      const hd = t.heading;
      g.fillStyle = '#5fd3ff';
      g.beginPath();
      g.moveTo(bx + Math.sin(hd) * 9, by - Math.cos(hd) * 9);
      g.lineTo(bx + Math.sin(hd + 2.5) * 6, by - Math.cos(hd + 2.5) * 6);
      g.lineTo(bx + Math.sin(hd - 2.5) * 6, by - Math.cos(hd - 2.5) * 6);
      g.closePath();
      g.fill();
      // North and the scale.
      g.fillStyle = '#ffffff';
      g.font = 'bold 12px system-ui, sans-serif';
      g.fillText('N ↑', 8, 16);
      const bar = half / 2;
      const px = (Math.min(w, H) / 2 / half) * bar;
      g.fillRect(8, H - 12, px, 2);
      g.font = '11px system-ui, sans-serif';
      g.fillText(bar >= 1000 ? `${bar / 1000} km` : `${bar} m`, 8, H - 16);
    }
    const t = sim.telemetry();
    const lines: (string | [string, string])[] = [`Djup under kölen ${Math.max(0, t.depthUnderKeel).toFixed(0)} m · botten ${Math.max(0, t.seabedDepth).toFixed(0)} m`];
    if (ctx.waypoint) {
      const dn = ctx.waypoint[0] - pos[0];
      const de = ctx.waypoint[1] - pos[1];
      lines.push(`Bojen: ${Math.round(Math.hypot(dn, de))} m, bäring ${String(Math.round(((Math.atan2(de, dn) / DEG) + 360) % 360) % 360).padStart(3, '0')}°`);
    }
    for (const tg of c.fire.targets) {
      if (!tg.solution) continue;
      const v = tg.solution.velocity;
      lines.push(`${tg.label}${tg.label === c.fire.current ? ' (valt)' : ''}: ${tg.name}, ${Math.round(Math.hypot(v[0], v[1]) / KN)} kn, lösning ${tg.solution.quality}`);
    }
    if (c.world.torpedoes.length) lines.push(`${c.world.torpedoes.length} torped${c.world.torpedoes.length > 1 ? 'er' : ''} i vattnet.`);
    const mast = t.radar > 0.99 ? (t.radarHeadDepth < 0 ? 'uppe' : 'uppe, under vattnet') : t.radar > 0.01 ? 'rör sig' : 'nere';
    lines.push(c.radar.active ? ['nav-warn', `Radarn sänder (${c.radar.echoes.length} ekon). Korvetter hör den långt.`] : `Radarn tyst, masten ${mast}.`);
    for (const r of c.radar.esm) lines.push(['nav-alarm', `Radarvarnare: radar i bäring ${String(Math.round(r.bearing) % 360).padStart(3, '0')}°, ${r.strength}.`]);
    lines.push('Streckat: bäringar från sonaren. Rutor: fartyg i sikte. Kryss: radarekon. Ringar: ekon från pingen. Romber: mål med lösning (färg efter kvaliteten). Rött: radar som hörs.');
    setInfo(lines);
  }

  function drawSonar(ctx: NavContext): void {
    const c = ctx.ctrl;
    const s = c.sonar;
    const g = context2d();
    const { w, h: H } = size;
    if (g) {
      const top = 16;
      g.fillStyle = '#04121b';
      g.fillRect(0, top, w, H - top);
      const x = (rel: number) => ((rel + 180) / 360) * w;
      // The bow and the beams.
      g.strokeStyle = 'rgba(127, 163, 179, 0.35)';
      g.fillStyle = '#7fa3b3';
      g.font = '10px system-ui, sans-serif';
      g.textAlign = 'center';
      for (const [rel, label] of [[-180, ''], [-90, 'BB'], [0, 'För'], [90, 'SB'], [180, '']] as const) {
        g.beginPath();
        g.moveTo(x(rel), top);
        g.lineTo(x(rel), H);
        g.stroke();
        if (label) g.fillText(label, x(rel), 11);
      }
      // The waterfall: newest at the top, one row per second.
      const rows = s.history.length;
      const rowH = Math.max(1, (H - top) / 180);
      for (let i = 0; i < rows; i++) {
        const sample = s.history[rows - 1 - i]!;
        const y = top + i * rowH;
        for (const m of sample.marks) {
          const a = Math.min(1, 0.25 + m.excess / 40);
          g.fillStyle = `rgba(107, 227, 161, ${a})`;
          g.fillRect(x(m.relative) - 2, y, 4, Math.ceil(rowH));
        }
      }
      // Labels at the newest bearing of each contact.
      const heading = c.sim.kinematics().heading / DEG;
      g.fillStyle = '#ffd08a';
      // Contacts close in bearing get their labels on rows below each other, not on top of each other.
      const placed: { x: number; row: number; half: number }[] = [];
      const labels = s.contacts
        .map((k) => ({ label: k.label, x: x(((((k.bearing - heading + 180) % 360) + 360) % 360) - 180), half: g.measureText(k.label).width / 2 + 2 }))
        .sort((a, b) => a.x - b.x);
      for (const l of labels) {
        let row = 0;
        while (placed.some((p) => p.row === row && Math.abs(p.x - l.x) < p.half + l.half)) row++;
        placed.push({ x: l.x, row, half: l.half });
        g.fillText(l.label, l.x, top + 12 + row * 12);
      }
      g.textAlign = 'left';
    }
    const t = c.sim.telemetry();
    const kn = Math.abs(t.u) / KN;
    const loud = s.ownLevel > 135 ? 'hög' : s.ownLevel > 120 ? 'medel' : 'låg';
    const reasons = [
      kn > cavitationSpeed(t.depth) ? 'kavitation' : '',
      t.dieselRunning ? 'dieslarna' : '',
      t.snorkel > 0.99 && t.snorkelHeadDepth < 0 ? 'snorkeln syns' : '',
      t.periscope > 0.99 && t.periscopeHeadDepth < 0 ? 'periskopet syns' : '',
    ].filter(Boolean);
    const lines: (string | [string, string] | [string, string, string])[] = [];
    lines.push(`Egen ljudnivå: ${loud}${reasons.length ? ` (${reasons.join(', ')})` : ''}`);
    if (Object.keys(s.awareness).length) {
      const r = Math.round(s.risk * 100);
      lines.push([r >= 50 ? 'nav-alarm' : r >= 20 ? 'nav-warn' : '', `Risk att bli upptäckt: ${r} %`]);
    }
    if (s.contacts.length === 0) lines.push('Inga kontakter.');
    for (const k of s.contacts) {
      const target = c.fire.targets.find((x) => x.vesselId === k.vesselId);
      const text = `${k.label}${target ? ` = ${target.label}` : ''} · ${String(Math.round(k.bearing) % 360).padStart(3, '0')}° · ${strength(k.excess)}${k.classified ? (k.bio ? ` · biologisk, ${k.classified}` : k.blades ? ` · ${k.classified}, ${k.blades} blad, ${k.rpm} rpm` : ` · ${k.classified}, ingen propeller`) : ' · klassas …'}`;
      lines.push([target && target.label === c.fire.current ? 'on' : '', text, k.label]);
    }
    if (s.contacts.some((k) => !k.bio)) lines.push('Tryck på en kontakt för att göra den till mål.');
    const age = c.sim.t - s.lastPing;
    if (age < ECHO_LIFE) {
      const echoes = s.echoes.map((e) => `${e.label ?? (e.what ? `eko (${e.what})` : 'eko')} ${String(Math.round(e.bearing) % 360).padStart(3, '0')}° ${(e.range / 1000).toFixed(1).replace('.', ',')} km`);
      lines.push(['nav-warn', `Ping för ${Math.round(age)} s sedan: ${echoes.length ? echoes.join(', ') : 'inget eko'}.`]);
    }
    const wait = s.pingWait();
    lines.push(wait > 0 ? `Pingen är klar om ${Math.ceil(wait)} s.` : 'Ping (A) ger avstånd till kontakterna, men hörs långt.');
    setInfo(lines);
  }

  return {
    get mode() {
      return mode;
    },
    toggle(m: NavMode) {
      set(mode === m ? null : m);
    },
    close() {
      set(null);
    },
    update(ctx: NavContext) {
      // The track is kept while the panel is closed too.
      const sim = ctx.ctrl.sim;
      if (trackCtrl !== ctx.ctrl) {
        trackCtrl = ctx.ctrl;
        track = [];
        shading = null;
      }
      const p: [number, number] = [sim.y[0]!, sim.y[1]!];
      const last = track[track.length - 1];
      if (!last || Math.hypot(p[0] - last[0], p[1] - last[1]) > 25) {
        track.push(p);
        if (track.length > 3000) track.shift();
      }
      const on = ctx.ctrl.radar.transmitting;
      if (radarBtn.classList.contains('on') !== on) {
        radarBtn.classList.toggle('on', on);
        radarBtn.textContent = on ? 'Radar sänder' : 'Radar';
      }
      if (mode === 'chart') drawChart(ctx);
      else if (mode === 'sonar') drawSonar(ctx);
    },
  };
}
