/**
 * The screen controls' pure parts: screen position ↔ depth, bearing, angle
 * and telegraph position, and the short texts. Exported for the tests.
 */
import { HELM_MAX_DEPTH, PERISCOPE_DEPTH, TELEGRAPH } from '../../control/crew';
import type { Telemetry } from '../../sim/simulation';

export const DEG = 180 / Math.PI;

/**
 * Depth scale: fraction 0…1 from the top for a depth. The scale is a square
 * root, so the shallow water where the boat dives and surfaces gets room.
 */
export const depthToFraction = (depth: number): number => Math.sqrt(Math.max(0, Math.min(HELM_MAX_DEPTH, depth)) / HELM_MAX_DEPTH);

/** The depth target for a fraction of the scale: 5 m steps, periscope depth when close to it. */
export function fractionToDepth(f: number): number {
  const d = HELM_MAX_DEPTH * Math.max(0, Math.min(1, f)) ** 2;
  if (Math.abs(d - PERISCOPE_DEPTH) < 3) return PERISCOPE_DEPTH;
  return Math.min(HELM_MAX_DEPTH, Math.round(d / 5) * 5);
}

/** Rudder or plane angle [deg] under a fraction 0…1 across a gauge (whole degrees, ±max). */
export const gaugeAngle = (f: number, max: number): number => Math.round((Math.max(0, Math.min(1, f)) - 0.5) * 2 * max);

/** The telegraph position (index in TELEGRAPH) under a fraction 0…1 along the lever. */
export const telegraphIndex = (f: number): number => Math.max(0, Math.min(TELEGRAPH.length - 1, Math.floor(Math.max(0, Math.min(1, f)) * TELEGRAPH.length)));

/** Half the compass band's width [deg]. */
export const BAND_HALF_WIDTH = 60;

/** The bearing [deg, 0–359] under a fraction 0…1 across the compass band centred on `centre` [deg], in 5° steps. */
export function bandBearing(f: number, centre: number): number {
  const b = centre + (Math.max(0, Math.min(1, f)) - 0.5) * 2 * BAND_HALF_WIDTH;
  return ((Math.round(b / 5) * 5) % 360 + 360) % 360;
}

/** Where a bearing [deg] lies across the band centred on `centre`: 0…1, or null outside it. */
export function bandFraction(bearing: number, centre: number): number | null {
  const d = ((bearing - centre + 540) % 360) - 180;
  return Math.abs(d) > BAND_HALF_WIDTH ? null : 0.5 + d / (2 * BAND_HALF_WIDTH);
}

export const bearing3 = (b: number): string => String(Math.round(((b % 360) + 360) % 360) % 360).padStart(3, '0');
export const COMPASS_POINTS: Record<number, string> = { 0: 'N', 45: 'NO', 90: 'O', 135: 'SO', 180: 'S', 225: 'SV', 270: 'V', 315: 'NV' };

/** True bearing [deg] from the boat to a point. */
export const bearingTo = (t: Telemetry, p: [number, number]): number => ((Math.atan2(p[1] - t.position[1], p[0] - t.position[0]) * DEG) + 360) % 360;

/** "5° ned", "12° SB", "0°". */
export function angleText(a: number, positive: string, negative: string): string {
  return a === 0 ? '0°' : `${Math.abs(a)}° ${a > 0 ? positive : negative}`;
}

/** One decimal with a decimal comma. */
export const fmt = (v: number): string => String(Math.round(v * 10) / 10).replace('.', ',');

export function setText(el: HTMLElement, text: string): void {
  if (el.textContent !== text) el.textContent = text;
}

export function setTitle(el: HTMLElement, title: string): void {
  if (el.title === title) return;
  el.title = title;
  el.setAttribute('aria-label', title);
}
