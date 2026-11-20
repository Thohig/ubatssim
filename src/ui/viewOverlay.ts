/**
 * 2D overlay for the on-board views, drawn on a canvas above the 3D view
 * and below the HUD panels:
 *   bridge    – compass band with the looking direction and the buoy
 *   periscope – round mask, cross hair, bearing scale, magnification
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
  const band = (cx: number, y: number, width: number, span: number, bearing: number, wp: number | null) => {
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
    ctx.fillStyle = ACCENT;
    ctx.beginPath();
    ctx.moveTo(cx, y - 16);
    ctx.lineTo(cx - 6, y - 24);
    ctx.lineTo(cx + 6, y - 24);
    ctx.fill();
    ctx.font = 'bold 13px ui-monospace, Menlo, monospace';
    ctx.fillText(String(((Math.round(bearing) % 360) + 360) % 360).padStart(3, '0') + '°', cx, y - 28);
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
    const r = Math.min(w, h) * 0.44;
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
    // Cross hair with a gap in the middle and stadia ticks on the horizontal line.
    ctx.strokeStyle = 'rgba(20, 20, 20, 0.85)';
    ctx.lineWidth = 1.5;
    const gap = r * 0.06;
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
      for (const sx of [-1, 1]) {
        ctx.moveTo(cx + sx * dx, cy - 5);
        ctx.lineTo(cx + sx * dx, cy + 5);
      }
    }
    ctx.stroke();
    ctx.restore();

    // The bearing band spans the horizontal field of view.
    const hFov = (2 * Math.atan(Math.tan((s.fov * Math.PI) / 360) * (w / h)) * 180) / Math.PI;
    const width = Math.min(2 * r, w - 32);
    // Low in the eyepiece, but above the screen controls and the fire panel, which would hide it.
    const bandY = Math.max(cy + 46, Math.min(cy + r - 40, (s.clearBottom ?? h) - 34));
    band(cx, bandY, width, (hFov * width) / w, s.bearing, s.waypointBearing);

    ctx.save();
    ctx.font = 'bold 14px ui-monospace, Menlo, monospace';
    ctx.textAlign = 'center';
    ctx.fillStyle = ACCENT;
    ctx.fillText(`${PERISCOPE_ZOOM[s.zoom]!.label}`, cx + r * 0.7, cy - r * 0.7);
    if (s.underwater) {
      ctx.fillStyle = WARN;
      ctx.fillText('PERISKOPET ÄR UNDER VATTEN', cx, cy - r * 0.5);
    }
    ctx.restore();
  };
}
