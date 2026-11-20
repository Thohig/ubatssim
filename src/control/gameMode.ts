/**
 * The two ways to play. Both run the same simulation; they differ only in
 * how player input becomes orders and whether the assistant may add orders.
 *   simplified – the player sets depth and heading targets; the trim
 *                assistant and the safety net help.
 *   realistic  – the player moves rudder and planes and trims the boat.
 */
export type GameMode = 'simplified' | 'realistic';

export const GAME_MODES: readonly GameMode[] = ['simplified', 'realistic'];

export const GAME_MODE_NAME: Record<GameMode, string> = {
  simplified: 'Förenklad simulering',
  realistic: 'Realistisk simulering',
};

export const GAME_MODE_TEXT: Record<GameMode, string> = {
  simplified: 'Du anger djup och kurs, och spelet hjälper till att trimma.',
  realistic: 'Du sköter roder, ballast och trim själv.',
};

/** Depth the simplified "dive" goes to when no deeper target is set [m]. */
export const PERISCOPE_DEPTH = 18;
