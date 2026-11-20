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

/** Periscope depth (CO depth, keel ~16 m): the simplified "dive" goes here when no deeper target is set [m]. */
export const PERISCOPE_DEPTH = 13;

/** Simplified mode: the screen controls' depth scale goes this deep [m] (crush depth). */
export const HELM_MAX_DEPTH = 300;

/** One position of the engine-order telegraph. */
export interface TelegraphBell {
  /** Speed through the water [knots]; negative = astern. */
  knots: number;
  label: string;
  /** Spoken/accessible name, e.g. "Halv back". */
  name: string;
}

/**
 * The simplified mode's engine-order telegraph, astern to ahead. Astern
 * matches "back sakta|halv|full"; full astern is the speed autopilot's limit.
 */
export const TELEGRAPH: readonly TelegraphBell[] = [
  { knots: -6, label: 'Full', name: 'Full back' },
  { knots: -4, label: 'Halv', name: 'Halv back' },
  { knots: -2, label: 'Sakta', name: 'Sakta back' },
  { knots: 0, label: 'Stopp', name: 'Stopp' },
  { knots: 4, label: 'Sakta', name: 'Sakta fram' },
  { knots: 8, label: 'Halv', name: 'Halv fram' },
  { knots: 12, label: 'Full', name: 'Full fram' },
];

/**
 * The next telegraph position from a speed [knots] in direction `dir`
 * (+1 ahead, −1 astern): the nearest bell strictly beyond the speed, or the
 * end bell. A speed between two bells moves to the neighbour in that direction.
 */
export function telegraphStep(current: number, dir: 1 | -1): number {
  const eps = 1e-6;
  if (dir > 0) return TELEGRAPH.find((b) => b.knots > current + eps)?.knots ?? TELEGRAPH[TELEGRAPH.length - 1]!.knots;
  return [...TELEGRAPH].reverse().find((b) => b.knots < current - eps)?.knots ?? TELEGRAPH[0]!.knots;
}
