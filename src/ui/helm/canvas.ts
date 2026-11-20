/**
 * Drawing the screen controls on 2D canvases: the depth scale, the compass
 * band and the rudder and stern-plane gauges. A canvas is redrawn only when
 * what it shows has changed by about a pixel, and its size comes from a
 * ResizeObserver (reading it during an update would force a layout).
 */
import { HELM_MAX_DEPTH, PERISCOPE_DEPTH } from '../../control/crew';
import type { Telemetry } from '../../sim/simulation';
import { BAND_HALF_WIDTH, COMPASS_POINTS, bandFraction, bearing3, bearingTo, depthToFraction } from './mappings';

export interface Colors {
  text: string;
  muted: string;
  accent: string;
  warn: string;
  error: string;
  water: string;
  seabed: string;
}

export function colors(el: Element): Colors {
  const cs = getComputedStyle(el);
  const v = (name: string, fallback: string) => cs.getPropertyValue(name).trim() || fallback;
  return {
    text: v('--text', '#d8f1ff'),
    muted: v('--muted', '#7fa3b8'),
    accent: v('--accent', '#5fd3ff'),
    warn: v('--warn', '#ffd166'),
    error: v('--error', '#ff6b6b'),
    water: 'rgba(40, 120, 170, 0.25)',
    seabed: 'rgba(150, 110, 70, 0.55)',
  };
}

/**
 * The CSS size of each canvas, kept by a ResizeObserver: reading clientWidth
 * during an update would force a layout right after the panel's text changed.
 */
const sizes = new WeakMap<Element, { w: number; h: number }>();
export const observer =
  typeof ResizeObserver === 'undefined'
    ? null
    : new ResizeObserver((entries) => {
        for (const e of entries) sizes.set(e.target, { w: e.contentRect.width, h: e.contentRect.height });
      });
export const sizeOf = (el: Element) => sizes.get(el) ?? { w: 0, h: 0 };

/** A 2D context sized to the canvas's CSS box at device resolution, or null (no canvas support or no size yet). */
function canvas2d(canvas: HTMLCanvasElement): CanvasRenderingContext2D | null {
  let ctx: CanvasRenderingContext2D | null;
  try {
    ctx = canvas.getContext('2d');
  } catch {
    return null;
  }
  if (!ctx) return null;
  const dpr = window.devicePixelRatio || 1;
  const size = sizeOf(canvas);
  const w = Math.round(size.w * dpr);
  const hgt = Math.round(size.h * dpr);
  if (w === 0 || hgt === 0) return null;
  if (canvas.width !== w || canvas.height !== hgt) {
    canvas.width = w;
    canvas.height = hgt;
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, size.w, size.h);
  return ctx;
}

/** What each canvas last showed. */
const keys = new WeakMap<HTMLCanvasElement, string>();
/** Whether `key` differs from what the canvas last showed (and remembers it). */
function changed(canvas: HTMLCanvasElement, key: string): boolean {
  if (keys.get(canvas) === key) return false;
  keys.set(canvas, key);
  return true;
}

/**
 * The depth scale: water, sea bed, the safety net's limit (`limit`), ticks,
 * periscope depth, the present depth and the target (warn colour while the
 * finger is down, `preview`).
 */
export function drawDepthScale(canvas: HTMLCanvasElement, t: Telemetry, target: number | null, preview: boolean, limit: number, col: Colors): void {
  // Rounded to about a pixel: the scale is ~0.7 px/m at 30 m and coarser below.
  const size = sizeOf(canvas);
  if (!changed(canvas, `${size.w}x${size.h} ${Math.round(t.depth * 2)} ${target} ${preview} ${Math.round(t.seabedDepth)} ${limit}`)) return;
  const g = canvas2d(canvas);
  if (!g) return;
  const { w, h: H } = size;
  const y = (d: number) => depthToFraction(d) * H;
  g.fillStyle = col.water;
  g.fillRect(0, 0, w, H);
  // Sea bed.
  if (t.seabedDepth < HELM_MAX_DEPTH) {
    g.fillStyle = col.seabed;
    g.fillRect(0, y(t.seabedDepth), w, H - y(t.seabedDepth));
  }
  // Safety-net limit.
  if (limit < HELM_MAX_DEPTH) {
    g.strokeStyle = col.error;
    g.setLineDash([3, 3]);
    g.beginPath();
    g.moveTo(0, y(limit));
    g.lineTo(w, y(limit));
    g.stroke();
    g.setLineDash([]);
  }
  // Ticks.
  g.font = '9px system-ui, sans-serif';
  g.textBaseline = 'middle';
  for (const d of [10, 25, 50, 100, 200]) {
    g.fillStyle = col.muted;
    g.fillRect(0, y(d), 5, 1);
    g.fillText(String(d), 7, y(d));
  }
  // Periscope depth.
  g.fillStyle = col.accent;
  g.fillRect(w - 6, y(PERISCOPE_DEPTH) - 1, 6, 2);
  // Present depth.
  g.fillStyle = col.text;
  g.fillRect(0, y(t.depth) - 1, w, 2);
  // Target.
  if (target !== null) {
    const ty = y(target);
    g.fillStyle = preview ? col.warn : col.accent;
    g.beginPath();
    g.moveTo(w, ty);
    g.lineTo(w - 10, ty - 6);
    g.lineTo(w - 10, ty + 6);
    g.closePath();
    g.fill();
  }
}

/**
 * The compass band ±60° around `centre` [deg]: ticks and compass points, the
 * buoy, the target (warn colour while the finger is down) and the lubber line.
 */
export function drawCompassBand(
  canvas: HTMLCanvasElement,
  t: Telemetry,
  heading: number,
  bandCentre: number,
  target: number | null,
  preview: boolean,
  waypoint: [number, number] | null,
  col: Colors,
): void {
  const buoy = waypoint ? Math.round(bearingTo(t, waypoint) * 2) : null;
  // Rounded to about a pixel: the band is ~2 px per degree.
  const size = sizeOf(canvas);
  if (!changed(canvas, `${size.w}x${size.h} ${Math.round(heading * 2)} ${Math.round(bandCentre * 2)} ${target} ${preview} ${buoy}`)) return;
  const g = canvas2d(canvas);
  if (!g) return;
  const { w, h: H } = size;
  const x = (b: number) => {
    const f = bandFraction(b, bandCentre);
    return f === null ? null : f * w;
  };
  g.fillStyle = col.water;
  g.fillRect(0, 0, w, H);
  g.font = '10px system-ui, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'top';
  // A narrow band (phones) labels only the compass points, so the labels do not run together.
  const numbers = (w / (2 * BAND_HALF_WIDTH)) * 30 >= 40;
  const start = Math.ceil((bandCentre - BAND_HALF_WIDTH) / 5) * 5;
  for (let b = start; b <= bandCentre + BAND_HALF_WIDTH; b += 5) {
    const px = x(b);
    if (px === null) continue;
    const n = ((b % 360) + 360) % 360;
    const major = n % 30 === 0 || n % 45 === 0;
    g.fillStyle = major ? col.text : col.muted;
    g.fillRect(px, H - (major ? 10 : 5), 1, major ? 10 : 5);
    if (major && (numbers || COMPASS_POINTS[n])) {
      const label = COMPASS_POINTS[n] ?? bearing3(n);
      g.fillStyle = COMPASS_POINTS[n] ? col.text : col.muted;
      g.fillText(label, px, 3);
    }
  }
  // Buoy.
  if (waypoint) {
    const px = x(bearingTo(t, waypoint));
    if (px !== null) {
      g.fillStyle = col.warn;
      g.beginPath();
      g.arc(px, H / 2 + 2, 4, 0, 2 * Math.PI);
      g.fill();
    }
  }
  // Target.
  if (target !== null) {
    const px = x(target);
    if (px !== null) {
      g.fillStyle = preview ? col.warn : col.accent;
      g.beginPath();
      g.moveTo(px, H - 12);
      g.lineTo(px - 6, H);
      g.lineTo(px + 6, H);
      g.closePath();
      g.fill();
    }
  }
  // Lubber line: the present heading.
  const hx = x(heading);
  if (hx !== null) {
    g.fillStyle = col.error;
    g.fillRect(hx - 1, 0, 2, H);
  }
}

/**
 * A rudder (horizontal, port left) or stern-plane gauge (vertical, "upp"
 * at the top): the ordered angle as a marker, the actual angle as a bar.
 */
export function drawGauge(canvas: HTMLCanvasElement, vertical: boolean, cmd: number, actual: number, max: number, preview: boolean, col: Colors): void {
  const size = sizeOf(canvas);
  if (!changed(canvas, `${size.w}x${size.h} ${cmd} ${Math.round(actual * 2)} ${preview}`)) return;
  const g = canvas2d(canvas);
  if (!g) return;
  const { w, h: H } = size;
  const len = vertical ? H : w;
  const pos = (a: number) => (0.5 + Math.max(-1, Math.min(1, a / max)) / 2) * len;
  g.fillStyle = col.water;
  g.fillRect(0, 0, w, H);
  g.font = '9px system-ui, sans-serif';
  g.fillStyle = col.muted;
  for (const a of [-20, -10, 0, 10, 20]) {
    const p = pos(a);
    if (vertical) g.fillRect(0, p, a === 0 ? w : 6, 1);
    else g.fillRect(p, H - (a === 0 ? H : 6), 1, a === 0 ? H : 6);
  }
  g.textBaseline = 'top';
  if (vertical) {
    g.fillText('UPP', 3, 3);
    g.textBaseline = 'bottom';
    g.fillText('NED', 3, H - 3);
  } else {
    g.fillText('BB', 3, 3);
    g.textAlign = 'right';
    g.fillText('SB', w - 3, 3);
    g.textAlign = 'left';
  }
  // Actual angle: a bar from zero.
  g.fillStyle = col.accent;
  const z = pos(0);
  const p = pos(actual);
  if (vertical) g.fillRect(w / 2 - 4, Math.min(z, p), 8, Math.max(2, Math.abs(p - z)));
  else g.fillRect(Math.min(z, p), H / 2 - 4, Math.max(2, Math.abs(p - z)), 8);
  // Ordered angle: a marker.
  g.fillStyle = preview ? col.warn : col.text;
  const m = pos(cmd);
  if (vertical) g.fillRect(4, m - 1, w - 8, 3);
  else g.fillRect(m - 1, 4, 3, H - 8);
}
