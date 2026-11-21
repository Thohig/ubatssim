/**
 * Player settings, kept in the browser's localStorage (per device). Every
 * access is guarded: storage can be unavailable (private mode, blocked
 * site data), in which case defaults are used.
 */
export type TimeScale = 1 | 2 | 4 | 8 | 16;

/** The time compressions to choose from. */
export const TIME_SCALES: readonly TimeScale[] = [1, 2, 4, 8, 16];

export interface Settings {
  timeScale: TimeScale;
  particles: boolean;
  /** Light rays under the surface in daylight. */
  lightRays: boolean;
  /** The introduction (the crew and taking over) has been shown. */
  crewIntroSeen: boolean;
  /** Sound: master volume 0…1, machinery and alarms, surroundings, spoken acknowledgements. */
  volume: number;
  soundEffects: boolean;
  soundAmbience: boolean;
  voice: boolean;
  /** The start page's music, and its volume 0…1. */
  music: boolean;
  musicVolume: number;
  /** Expert mode: the player may take the manoeuvre over by hand (☰ → Besättning; Controller.options.expert). */
  expert: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  timeScale: 1,
  particles: true,
  lightRays: true,
  crewIntroSeen: false,
  volume: 0.6,
  soundEffects: true,
  soundAmbience: true,
  voice: false,
  music: true,
  musicVolume: 0.7,
  expert: false,
};

const KEY = 'ubatssim.settings';

export function loadSettings(): Settings {
  try {
    localStorage.removeItem('ubatssim.best'); // best times are no longer kept
    // Older settings may hold a game mode, an autopilot choice, touch buttons and showLog: those are gone and ignored.
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    const s = JSON.parse(raw) as Partial<Settings>;
    return {
      timeScale: TIME_SCALES.includes(s.timeScale as TimeScale) ? (s.timeScale as TimeScale) : 1,
      particles: s.particles !== false,
      lightRays: s.lightRays !== false,
      crewIntroSeen: s.crewIntroSeen === true,
      volume: typeof s.volume === 'number' && s.volume >= 0 && s.volume <= 1 ? s.volume : DEFAULT_SETTINGS.volume,
      soundEffects: s.soundEffects !== false,
      soundAmbience: s.soundAmbience !== false,
      voice: s.voice === true,
      music: s.music !== false,
      expert: s.expert === true,
      musicVolume: typeof s.musicVolume === 'number' && s.musicVolume >= 0 && s.musicVolume <= 1 ? s.musicVolume : DEFAULT_SETTINGS.musicVolume,
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
