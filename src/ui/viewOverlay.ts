/**
 * 2D overlay for the on-board views, drawn on a canvas above the 3D view
 * and below the HUD panels:
 *   bridge    – compass band with the looking direction and the buoy
 *   periscope – round mask, cross hair, magnification, and the bearing
 *               band outside the eyepiece: below it when there is room above
 *               the screen controls, else above it (`periscopeLayout`)
 */
import { PERISCOPE_ZOOM, type ViewMode } from './views';

export interface OverlayState {
  mode: ViewMode;
  /** True direction the camera looks [deg]. */
  bearing: number;
  /** True bearing to the scenario buoy [deg], if any. */
  waypointBearing: number | null;
  zoom: number;
  /** The periscope head is under water. */
  underwater: boolean;
  /** Vertical field of view [deg] (for placing the buoy marker). */
  fov: number;
  /** Top of the panels at the bottom of the screen [CSS px]: the periscope's bearing band stays above it. */
  clearBottom?: number;
  /** What the cross hair is on (`inCross` in wiring.ts), or null. */
  inCross?: string | null;
  /** Left edge of a panel beside the eyepiece at the horizon's height [CSS px] (the fire panel): the circle stays left of it. */
  clearRight?: number;
}

/** Room the periscope's bearing band needs above and below its line [px] (its box above, the buoy mark below). */
const BAND_ABOVE = 20;
const BAND_BELOW = 30;
/** Kept free at the top for the mission bar and the log, two lines that each may wrap once [px]. */
export const TOP_CLEAR = 144;
/** A circle this part of the screen's smaller side is good enough to keep the band clear of the log [–]. */
const FAIR = 0.25;
/** Half the gap in the middle of the cross hair, as a part of the eyepiece's radius. */
export const CROSS_GAP = 0.16;
/** Gap between the eyepiece and a panel beside it [px]. */
const SIDE_GAP = 6;
/** The eyepiece is never smaller than this part of the screen's smaller side, panel or not. */
const LEAST_BESIDE = 0.15;

/**
 * The eyepiece (centred on the screen, where the camera looks) and the
 * bearing band outside it: below the circle if a circle of at least 30 % of
 * the screen (or 25 %, and larger than above) still fits above the screen controls, else above it (under the
 * objective and the log, or on a low screen at the very top). A panel beside
 * it at the horizon's height (`clearRight`, its left edge) makes the circle
 * smaller, so that the horizon in it stays clear. Pure.
 */
export function periscopeLayout(w: number, h: number, clearBottom: number, clearRight = w): { r: number; bandY: number } {
  const cy = h / 2;
  const side = Math.min(w, h);
  // A panel beside the eyepiece (the fire panel in a small window) must not cover the horizon in it.
  const max = Math.min(side * 0.44, Math.max(side * LEAST_BESIDE, clearRight - w / 2 - SIDE_GAP));
  const below = Math.min(max, clearBottom - BAND_BELOW - BAND_ABOVE - cy);
  const above = Math.min(max, cy - TOP_CLEAR - BAND_ABOVE - BAND_BELOW);
  const least = Math.min(side * 0.3, max);
  const fair = Math.min(side * FAIR, max);
  if (below >= least || (below >= fair && below >= above)) return { r: below, bandY: cy + below + BAND_ABOVE };
  // Above, under the objective and the log; only on a low screen (a phone on its side) right at the top,
  // where the band lay under the log and the mode label on an ordinary desktop window (1280 × 800).
  if (above >= fair) return { r: above, bandY: cy - above - BAND_BELOW };
  const r = Math.max(40, Math.min(max, cy - 8 - BAND_ABOVE - BAND_BELOW));
  return { r, bandY: cy - r - BAND_BELOW };
}

const ACCENT = '#5fd3ff';
const WARN = '#ffb347';
const POINTS = ['N', 'NO', 'O', 'SO', 'S', 'SV', 'V', 'NV'];

const label = (deg: number) => {
  const d = ((Math.round(deg) % 360) + 360) % 360;
  return d % 45 === 0 ? POINTS[d / 45]! : String(d).padStart(3, '0');
};

/** Signed difference a − b in degrees, in (−180, 180]. */
const diff = (a: number, b: number) => ((((a - b) % 360) + 540) % 360) - 180;

export function createViewOverlay(canvas: HTMLCanvasElement): (s: OverlayState | null) => void {
  const ctx = canvas.getContext('2d')!;
  let w = 0;
  let h = 0;
  const resize = () => {
    const dpr = Math.min(window.devicePixelRatio, 2);
    w = window.innerWidth;
    h = window.innerHeight;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  };
  resize();
  window.addEventListener('resize', resize);

  /** Horizontal compass band centred at (cx, y), `span` degrees across `width` px. */
  const band = (cx: number, y: number, width: number, span: number, bearing: number, wp: number | null, inside = false) => {
    const pxPerDeg = width / span;
    ctx.save();
    ctx.fillStyle = 'rgba(4, 16, 24, 0.6)';
    ctx.fillRect(cx - width / 2, y - 16, width, 34);
    ctx.strokeStyle = '#cfe8f2';
    ctx.fillStyle = '#cfe8f2';
    ctx.font = '11px ui-monospace, Menlo, monospace';
    ctx.textAlign = 'center';
    const step = span > 60 ? 5 : 1;
    const first = Math.ceil((bearing - span / 2) / step) * step;
    for (let d = first; d <= bearing + span / 2; d += step) {
      const x = cx + (d - bearing) * pxPerDeg;
      const major = d % (span > 60 ? 30 : 10) === 0;
      ctx.globalAlpha = major ? 1 : 0.6;
      ctx.beginPath();
      ctx.moveTo(x, y + 16);
      ctx.lineTo(x, y + (major ? 6 : 11));
      ctx.stroke();
      if (major) ctx.fillText(label(d), x, y + 2);
    }
    ctx.globalAlpha = 1;
    if (wp !== null) {
      const dx = diff(wp, bearing);
      const x = cx + Math.max(-span / 2, Math.min(span / 2, dx)) * pxPerDeg;
      ctx.fillStyle = '#ffcc22';
      ctx.beginPath();
      ctx.moveTo(x, y + 18);
      ctx.lineTo(x - 6, y + 28);
      ctx.lineTo(x + 6, y + 28);
      ctx.fill();
    }
    const readout = String(((Math.round(bearing) % 360) + 360) % 360).padStart(3, '0') + '°';
    ctx.font = 'bold 13px ui-monospace, Menlo, monospace';
    if (inside) {
      // The periscope: the bearing on a plate in the band, over its middle, and nothing above the band. Above it,
      // the readout went under the log when a log line wrapped (1280 × 800).
      const pw = ctx.measureText(readout).width + 12;
      ctx.fillStyle = 'rgba(4, 16, 24, 0.95)';
      ctx.fillRect(cx - pw / 2, y - 16, pw, 18);
      ctx.fillStyle = ACCENT;
      ctx.fillText(readout, cx, y - 2);
      ctx.beginPath();
      ctx.moveTo(cx, y + 9);
      ctx.lineTo(cx - 5, y + 3);
      ctx.lineTo(cx + 5, y + 3);
      ctx.fill();
    } else {
      ctx.fillStyle = ACCENT;
      ctx.beginPath();
      ctx.moveTo(cx, y - 16);
      ctx.lineTo(cx - 6, y - 24);
      ctx.lineTo(cx + 6, y - 24);
      ctx.fill();
      ctx.fillText(readout, cx, y - 28);
    }
    ctx.restore();
  };

  return (s) => {
    ctx.clearRect(0, 0, w, h);
    canvas.hidden = !s || s.mode === 'external';
    if (!s || s.mode === 'external') return;

    if (s.mode === 'bridge') {
      // Below the mode indicator and the scenario objective.
      band(w / 2, 165, Math.min(560, w - 32), 120, s.bearing, s.waypointBearing);
      return;
    }

    // Periscope: everything outside the eyepiece circle is black.
    const { r, bandY } = periscopeLayout(w, h, s.clearBottom ?? h, s.clearRight ?? w);
    const cx = w / 2;
    const cy = h / 2;
    ctx.save();
    ctx.fillStyle = '#000';
    ctx.beginPath();
    ctx.rect(0, 0, w, h);
    ctx.arc(cx, cy, r, 0, Math.PI * 2, true);
    ctx.fill('evenodd');
    // Vignette at the rim.
    const g = ctx.createRadialGradient(cx, cy, r * 0.8, cx, cy, r);
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(1, 'rgba(0,0,0,0.85)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();
    // Cross hair with a gap in the middle and stadia ticks on the horizontal line. The gap is wide (`CROSS_GAP`):
    // a ship on the horizon sits in it, where a narrow one put the line and its ticks right through a small ship.
    ctx.strokeStyle = 'rgba(20, 20, 20, 0.85)';
    ctx.lineWidth = 1.5;
    const gap = r * CROSS_GAP;
    ctx.beginPath();
    ctx.moveTo(cx - r, cy);
    ctx.lineTo(cx - gap, cy);
    ctx.moveTo(cx + gap, cy);
    ctx.lineTo(cx + r, cy);
    ctx.moveTo(cx, cy - r);
    ctx.lineTo(cx, cy - gap);
    ctx.moveTo(cx, cy + gap);
    ctx.lineTo(cx, cy + r);
    for (let i = 1; i <= 8; i++) {
      const dx = (i * r) / 9;
      if (dx < gap) continue;
      for (const sx of [-1, 1]) {
        ctx.moveTo(cx + sx * dx, cy - 5);
        ctx.lineTo(cx + sx * dx, cy + 5);
      }
    }
    ctx.stroke();
    ctx.restore();

    // The bearing band, outside the eyepiece, spans the field of view of the circle's width.
    const hFov = (2 * Math.atan(Math.tan((s.fov * Math.PI) / 360) * (w / h)) * 180) / Math.PI;
    const width = Math.min(2 * r, w - 32);
    band(cx, bandY, width, (hFov * width) / w, s.bearing, s.waypointBearing, true);

    ctx.save();
    ctx.font = 'bold 14px ui-monospace, Menlo, monospace';
    ctx.textAlign = 'center';
    ctx.fillStyle = ACCENT;
    ctx.fillText(`${PERISCOPE_ZOOM[s.zoom]!.label}`, cx + r * 0.7, cy - r * 0.7);
    if (s.underwater) {
      ctx.fillStyle = WARN;
      ctx.fillText('PERISKOPET ÄR UNDER VATTEN', cx, cy - r * 0.5);
    } else if (s.inCross) {
      // Aiming: the cross hair is on a ship (a mark would take it). Under the horizon, on a dark plate.
      const y = cy + Math.min(r * 0.35, 60);
      const tw = ctx.measureText(s.inCross).width + 16;
      ctx.fillStyle = 'rgba(0, 0, 0, 0.55)';
      ctx.fillRect(cx - tw / 2, y - 15, tw, 22);
      ctx.fillStyle = ACCENT;
      ctx.fillText(s.inCross, cx, y);
    }
    ctx.restore();
  };
}
