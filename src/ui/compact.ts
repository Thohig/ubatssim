/**
 * The compact layout for phones: a status bar instead of the instrument
 * panel, one log line, one view button and a telegraph lever (style.css).
 * The same media query is used in CSS and, for behaviour, here.
 */
export const COMPACT_QUERY = '(max-width: 840px), (max-height: 500px)';

/** True when the compact (phone) layout is in use. */
export function isCompact(): boolean {
  try {
    return typeof window.matchMedia === 'function' && window.matchMedia(COMPACT_QUERY).matches;
  } catch {
    return false;
  }
}

/** A phone on its side: the fire panel and the objective share the top right corner. */
export const LANDSCAPE_PHONE_QUERY = '(max-height: 500px)';

/** True on a phone on its side (see `LANDSCAPE_PHONE_QUERY`). */
export function isLandscapePhone(): boolean {
  try {
    return typeof window.matchMedia === 'function' && window.matchMedia(LANDSCAPE_PHONE_QUERY).matches;
  } catch {
    return false;
  }
}
