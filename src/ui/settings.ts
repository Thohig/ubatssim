/**
 * Player settings, kept in the browser's localStorage (per device). Every
 * access is guarded: storage can be unavailable (private mode, blocked
 * site data), in which case defaults are used.
 */
export type TimeScale = 1 | 2 | 4;

export interface Settings {
  timeScale: TimeScale;
  particles: boolean;
  /** The introduction (the crew and taking over) has been shown. */
  crewIntroSeen: boolean;
  /** Sound: master volume 0…1, machinery and alarms, surroundings, spoken acknowledgements. */
  volume: number;
  soundEffects: boolean;
  soundAmbience: boolean;
  voice: boolean;
  /** The log book is shown; hidden, only errors show for a moment (style.css, body.log-hidden). */
  showLog: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  timeScale: 1,
  particles: true,
  crewIntroSeen: false,
  volume: 0.6,
  soundEffects: true,
  soundAmbience: true,
  voice: false,
  showLog: true,
};

const KEY = 'ubatssim.settings';

export function loadSettings(): Settings {
  try {
    localStorage.removeItem('ubatssim.best'); // best times are no longer kept
    // Older settings may hold a game mode, an autopilot choice and touch buttons: those are gone and ignored.
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    const s = JSON.parse(raw) as Partial<Settings>;
    return {
      timeScale: s.timeScale === 2 || s.timeScale === 4 ? s.timeScale : 1,
      particles: s.particles !== false,
      crewIntroSeen: s.crewIntroSeen === true,
      volume: typeof s.volume === 'number' && s.volume >= 0 && s.volume <= 1 ? s.volume : DEFAULT_SETTINGS.volume,
      soundEffects: s.soundEffects !== false,
      soundAmbience: s.soundAmbience !== false,
      voice: s.voice === true,
      showLog: s.showLog !== false,
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
