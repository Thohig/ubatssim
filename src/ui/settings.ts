/**
 * Player settings, kept in the browser's localStorage (per device). Every
 * access is guarded: storage can be unavailable (private mode, blocked
 * site data), in which case defaults are used.
 */
import type { GameMode } from '../control/gameMode';

export type TimeScale = 1 | 2 | 4;
export type TouchMode = 'auto' | 'on' | 'off';

export interface Settings {
  mode: GameMode;
  timeScale: TimeScale;
  /** Realistic mode: allow depth/heading autopilot in free play. */
  autopilot: boolean;
  touch: TouchMode;
  particles: boolean;
  /** The simplified mode's introduction has been shown. */
  introSeen: boolean;
  /** Sound: master volume 0…1, machinery and alarms, surroundings, spoken acknowledgements. */
  volume: number;
  soundEffects: boolean;
  soundAmbience: boolean;
  voice: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  mode: 'simplified',
  timeScale: 1,
  autopilot: true,
  touch: 'auto',
  particles: true,
  introSeen: false,
  volume: 0.6,
  soundEffects: true,
  soundAmbience: true,
  voice: false,
};

const KEY = 'ubatssim.settings';

export function loadSettings(): Settings {
  try {
    localStorage.removeItem('ubatssim.best'); // best times were removed in favour of two game modes
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    const s = JSON.parse(raw) as Partial<Settings>;
    return {
      mode: s.mode === 'realistic' ? 'realistic' : 'simplified',
      timeScale: s.timeScale === 2 || s.timeScale === 4 ? s.timeScale : 1,
      autopilot: s.autopilot !== false,
      touch: s.touch === 'on' || s.touch === 'off' ? s.touch : 'auto',
      particles: s.particles !== false,
      introSeen: s.introSeen === true,
      volume: typeof s.volume === 'number' && s.volume >= 0 && s.volume <= 1 ? s.volume : DEFAULT_SETTINGS.volume,
      soundEffects: s.soundEffects !== false,
      soundAmbience: s.soundAmbience !== false,
      voice: s.voice === true,
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
