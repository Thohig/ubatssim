/**
 * Who handles each of the boat's systems: the crew or the player. There is
 * one game; every game starts with the crew handling everything, and the
 * player takes over (and hands back) whatever they want, at any time.
 *
 *   depth, heading, speed – the crew = the autopilot for that axis holds the
 *       player's target (depth, course, telegraph); the player = planes,
 *       rudder or shaft speed by hand. These are the controller's `ap` flags.
 *   ballast   – the crew clears the bridge, dives on a depth target and blows
 *               for the surface; the player floods, blows and shuts the tanks.
 *   trim      – the trim assistant compensates and trims; or the player does.
 *   safetyNet – emergency blow near crush depth, depth limit over the sea bed
 *               and the keel warning; or none.
 *
 * Changes are `crew` orders (queued, acknowledged, refused by a scenario's
 * locks). Manual orders take a system over implicitly (a rudder order takes
 * the heading, a trim order the trim), see `Controller.ORDERS`.
 */

export type CrewSystem = 'depth' | 'heading' | 'speed' | 'ballast' | 'trim' | 'safetyNet';

export const CREW_SYSTEMS: readonly CrewSystem[] = ['depth', 'heading', 'speed', 'ballast', 'trim', 'safetyNet'];

/** Systems that are an autopilot axis (crew = autopilot on). */
export const AXES = ['depth', 'heading', 'speed'] as const;
export type Axis = (typeof AXES)[number];
export const isAxis = (s: CrewSystem): s is Axis => (AXES as readonly string[]).includes(s);

/** Who handles each system: true = the crew. */
export type CrewDuties = Record<CrewSystem, boolean>;

/** A scenario's fixed choices: true = the crew must handle it, false = the player must. */
export type CrewLocks = Partial<Record<CrewSystem, boolean>>;

/** Names in the interface. */
export const CREW_NAME: Record<CrewSystem, string> = {
  depth: 'Djup',
  heading: 'Kurs',
  speed: 'Fart',
  ballast: 'Ballast och brygga',
  trim: 'Trim',
  safetyNet: 'Skyddsnät',
};

/** Who does the work, in a sentence: [crew handles it, the player handles it]. */
export const CREW_ROLE: Record<CrewSystem, [string, string]> = {
  depth: ['Djupstyraren håller djupmålet (Auto).', 'Du styr djuprodret (Hand).'],
  heading: ['Rorsmannen håller kursmålet (Auto).', 'Du styr rodret (Hand).'],
  speed: ['Maskinen följer telegrafen.', 'Du styr propellervarvet.'],
  ballast: ['Besättningen sköter ballasten och bryggan.', 'Du fyller, blåser och stänger huvudballasten och klarar bryggan.'],
  trim: ['Trimassistenten kompenserar och trimmar.', 'Du kompenserar och trimmar.'],
  safetyNet: ['Nödblåsning, djupgräns över botten och varning för grunt vatten.', 'Inget skyddsnät.'],
};

/** Why a locked system cannot change: [the crew must handle it, the player must]. */
export const LOCK_TEXT: Record<CrewSystem, [string, string]> = {
  depth: ['Här håller djupstyraren djupet.', 'Här styr du djupet själv med djuprodret (Hand).'],
  heading: ['Här håller rorsmannen kursen.', 'Här styr du kursen själv med rodret (Hand).'],
  speed: ['Här följer maskinen telegrafen.', 'Här styr du varvtalet själv.'],
  ballast: ['Här sköter besättningen ballasten.', 'Här sköter du ballasten själv.'],
  trim: ['Här sköter trimassistenten trimmet.', 'Här trimmar du själv.'],
  safetyNet: ['Här är skyddsnätet alltid på.', 'Här finns inget skyddsnät.'],
};

/** In a list: "trimmet", "ballasten och bryggan" … (what the player handled). */
export const CREW_NOUN: Record<CrewSystem, string> = {
  depth: 'djupet',
  heading: 'kursen',
  speed: 'farten',
  ballast: 'ballasten',
  trim: 'trimmet',
  safetyNet: 'utan skyddsnät',
};

/** Swedish list: "a, b och c". */
export function swedishList(items: readonly string[]): string {
  if (items.length <= 1) return items.join('');
  return `${items.slice(0, -1).join(', ')} och ${items[items.length - 1]!}`;
}

/** Periscope depth (CO depth, keel ~16 m): "Dyk" goes here when no deeper target is set [m]. */
export const PERISCOPE_DEPTH = 13;

/** The screen controls' depth scale goes this deep [m] (crush depth). */
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
 * The engine-order telegraph, astern to ahead. Astern
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
