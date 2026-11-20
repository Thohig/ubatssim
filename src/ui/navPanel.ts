/**
 * The navigation panel: the chart (north up, centred on the boat) and the
 * passive sonar (a waterfall of bearings over time). Opened with Karta / K
 * and Sonar / H. Drawn on a 2D canvas at ~10 Hz while open; its size is kept
 * by a ResizeObserver (never read during the update).
 *
 *  Chart: depth shading sampled from the sea bed the physics uses (so what
 *  the chart shows is what the boat can hit), the track, the buoy, the
 *  lighthouses, sonar bearing lines, and vessels in sight from a raised
 *  periscope or the bridge.
 *  Sonar: bearing relative to the bow across, time downwards (newest at
 *  the top), brighter for a stronger signal; the contacts and the boat's
 *  own noise and the risk of being found below.
 *
 * The pure helpers (`chartScales`, `depthColor`, `chartPoint`) are tested.
 */
import type { Controller } from '../control/controller';
import type { Lighthouse } from '../control/areas';
import { strength } from '../control/sonar';
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

export function createNavPanel(root: HTMLElement): NavPanel {
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
  const close = h('button', { type: 'button', class: 'helm-panel-close', 'aria-label': 'Stäng' }, '✕');
  close.addEventListener('click', () => set(null));
  const canvas = h('canvas', { class: 'nav-canvas' });
  const info = h('div', { class: 'nav-info' });
  root.replaceChildren(h('div', { class: 'helm-panel-head' }, h('div', { class: 'helm-tabs', role: 'tablist' }, tabs.chart, tabs.sonar), zoomBox, close), canvas, info);
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
    document.body.classList.toggle('nav-open', m !== null);
  }

  const setInfo = (lines: (string | [string, string])[]) => {
    const key = JSON.stringify(lines);
    if (info.dataset.key === key) return;
    info.dataset.key = key;
    info.replaceChildren(...lines.map((l) => (typeof l === 'string' ? h('div', null, l) : h('div', { class: l[0] }, l[1]))));
  };

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
        g.strokeStyle = k.classified === 'örlogsfartyg' ? 'rgba(255, 107, 107, 0.8)' : 'rgba(255, 179, 71, 0.7)';
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
    lines.push('Streckat: bäringar från sonaren. Rutor: fartyg i sikte från periskopet eller bryggan.');
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
      for (const k of s.contacts) {
        const rel = ((((k.bearing - heading + 180) % 360) + 360) % 360) - 180;
        g.fillText(k.label, x(rel), top + 12);
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
    const lines: (string | [string, string])[] = [];
    lines.push(`Egen ljudnivå: ${loud}${reasons.length ? ` (${reasons.join(', ')})` : ''}`);
    if (Object.keys(s.awareness).length) {
      const r = Math.round(s.risk * 100);
      lines.push([r >= 50 ? 'nav-alarm' : r >= 20 ? 'nav-warn' : '', `Risk att bli upptäckt: ${r} %`]);
    }
    if (s.contacts.length === 0) lines.push('Inga kontakter.');
    for (const k of s.contacts) {
      lines.push(`${k.label} · ${String(Math.round(k.bearing) % 360).padStart(3, '0')}° · ${strength(k.excess)}${k.classified ? ` · ${k.classified}, ${k.blades} blad, ${k.rpm} rpm` : ' · klassas …'}`);
    }
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
      if (mode === 'chart') drawChart(ctx);
      else if (mode === 'sonar') drawSonar(ctx);
    },
  };
}
