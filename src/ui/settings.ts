/**
 * Player settings, kept in the browser's localStorage (per device). Every
 * access is guarded: storage can be unavailable (private mode, blocked
 * site data), in which case defaults are used.
 */
export type TimeScale = 1 | 2 | 4;
export type TouchMode = 'auto' | 'on' | 'off';

export interface Settings {
  timeScale: TimeScale;
  /** Allow depth/heading autopilot in free play. */
  autopilot: boolean;
  touch: TouchMode;
  particles: boolean;
}

export const DEFAULT_SETTINGS: Settings = { timeScale: 1, autopilot: true, touch: 'auto', particles: true };

const KEY = 'ubatssim.settings';
const BEST_KEY = 'ubatssim.best';

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    const s = JSON.parse(raw) as Partial<Settings>;
    return {
      timeScale: s.timeScale === 2 || s.timeScale === 4 ? s.timeScale : 1,
      autopilot: s.autopilot !== false,
      touch: s.touch === 'on' || s.touch === 'off' ? s.touch : 'auto',
      particles: s.particles !== false,
    };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(s: Settings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    // Storage unavailable: settings last for this visit only.
  }
}

/** Best completion times per scenario [s of sim time]. */
export function loadBestTimes(): Record<string, number> {
  try {
    const raw = localStorage.getItem(BEST_KEY);
    return raw ? (JSON.parse(raw) as Record<string, number>) : {};
  } catch {
    return {};
  }
}

/** Records a time; returns true if it is a new best. */
export function recordBestTime(id: string, seconds: number): boolean {
  const best = loadBestTimes();
  if (best[id] !== undefined && best[id] <= seconds) return false;
  best[id] = seconds;
  try {
    localStorage.setItem(BEST_KEY, JSON.stringify(best));
  } catch {
    // ignore
  }
  return true;
}
