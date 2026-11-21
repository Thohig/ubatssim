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
 *   charging  – the crew runs the diesels whenever they can get air (surfaced
 *               or snorkelling) and the battery needs it; or the player
 *               starts and stops them. Raising the snorkel is always the player's call.
 *   fireControl – the fire controller ranges the current target through the
 *               raised periscope and advises course changes for the target
 *               motion analysis; or the player ranges (Avst). Firing is
 *               always the player's order.
 *   torpedoRoom – the torpedo room secures and reloads empty tubes and makes
 *               the loaded ones ready once a target is marked; or the player
 *               does it with tube orders (torpedoRoom.ts).
 *   safetyNet – emergency blow near crush depth, depth limit over the sea bed
 *               and the keel warning; or none.
 *
 * Changes are `crew` orders (queued, acknowledged, refused by a scenario's
 * locks). Manual orders take a system over implicitly (a rudder order takes
 * the heading, a trim order the trim), see `ORDERS` in orderRegistry.ts.
 */

export type CrewSystem = 'depth' | 'heading' | 'speed' | 'ballast' | 'trim' | 'charging' | 'fireControl' | 'torpedoRoom' | 'safetyNet';

export const CREW_SYSTEMS: readonly CrewSystem[] = ['depth', 'heading', 'speed', 'ballast', 'trim', 'charging', 'fireControl', 'torpedoRoom', 'safetyNet'];

/**
 * The manoeuvre: what the crew always handles unless the player is in expert mode (`Controller.options.expert`).
 * The player gives speed, course and depth; the crew chooses how (conn.ts).
 */
export const MANOEUVRE_SYSTEMS: readonly CrewSystem[] = ['depth', 'heading', 'speed', 'ballast', 'trim', 'safetyNet'];

/** Refusal of a hand order outside expert mode. */
export const EXPERT_TEXT = 'Besättningen sköter manövern. Slå på Expertläge under ☰ → Besättning för att styra själv.';

/** True if a scenario's locks make the player handle part of the manoeuvre (it is then played in expert mode). */
export const needsExpert = (locks: CrewLocks | undefined): boolean =>
  MANOEUVRE_SYSTEMS.some((s) => s !== 'safetyNet' && locks?.[s] === false);

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
  charging: 'Laddning',
  fireControl: 'Eldledning',
  torpedoRoom: 'Torpedrum',
  safetyNet: 'Skyddsnät',
};

/** Who does the work, in a sentence: [crew handles it, the player handles it]. */
export const CREW_ROLE: Record<CrewSystem, [string, string]> = {
  depth: ['Djupstyraren håller djupmålet (Auto).', 'Du styr djuprodret (Hand).'],
  heading: ['Rorsmannen håller kursmålet (Auto).', 'Du styr rodret (Hand).'],
  speed: ['Maskinen följer telegrafen.', 'Du styr propellervarvet. Telegrafen lämnar farten till besättningen.'],
  ballast: ['Fyller och blåser huvudballasten efter djupmålet och klarar bryggan vid dykning.', 'Du fyller, blåser och stänger huvudballasten och klarar bryggan.'],
  trim: ['Trimassistenten kompenserar och trimmar.', 'Du kompenserar och trimmar.'],
  charging: ['Maskinisten startar dieslarna och laddar batteriet när snorkeln är uppe eller ubåten ligger i ytläge.', 'Du startar och stoppar dieslarna.'],
  fireControl: ['Eldledaren mäter avståndet till målet genom periskopet och ger råd om kursbyten.', 'Du mäter avståndet själv (Avst i periskopet).'],
  torpedoRoom: ['Torpedrummet laddar om tuberna och gör dem klara när ett mål är markerat.', 'Du gör tuberna klara, säkrar och laddar om dem.'],
  safetyNet: ['Nödblåsning nära krossdjupet och vid läckage, djupgräns över botten och varning för grunt vatten.', 'Inget skyddsnät.'],
};

/** Why a locked system cannot change: [the crew must handle it, the player must]. */
export const LOCK_TEXT: Record<CrewSystem, [string, string]> = {
  depth: ['Här håller djupstyraren djupet.', 'Här styr du djupet själv med djuprodret (Hand).'],
  heading: ['Här håller rorsmannen kursen.', 'Här styr du kursen själv med rodret (Hand).'],
  speed: ['Här följer maskinen telegrafen.', 'Här styr du varvtalet själv.'],
  ballast: ['Här sköter besättningen ballasten.', 'Här sköter du ballasten själv.'],
  trim: ['Här sköter trimassistenten trimmet.', 'Här trimmar du själv.'],
  charging: ['Här sköter maskinisten laddningen.', 'Här startar och stoppar du dieslarna själv.'],
  fireControl: ['Här sköter eldledaren avståndsmätningen.', 'Här mäter du avståndet själv.'],
  torpedoRoom: ['Här sköter torpedrummet tuberna.', 'Här sköter du tuberna själv.'],
  safetyNet: ['Här är skyddsnätet alltid på.', 'Här finns inget skyddsnät.'],
};

/** In a list: "trimmet", "ballasten och bryggan" … (what the player handled). */
export const CREW_NOUN: Record<CrewSystem, string> = {
  depth: 'djupet',
  heading: 'kursen',
  speed: 'farten',
  ballast: 'ballasten',
  trim: 'trimmet',
  charging: 'laddningen',
  fireControl: 'eldledningen',
  torpedoRoom: 'tuberna',
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
 * The engine-order telegraph, astern to ahead. Full ahead is the top speed
 * (an order a little beyond it, so the shaft runs at full power). Astern
 * matches "back sakta|halv|full"; full astern is likewise the top speed astern
 * and the speed autopilot's limit.
 */
export const TELEGRAPH: readonly TelegraphBell[] = [
  /** The top speed astern (~6.8 knots at 108 rpm): full power astern. */
  { knots: -7, label: 'Full', name: 'Full back' },
  { knots: -4, label: 'Halv', name: 'Halv back' },
  { knots: -2, label: 'Sakta', name: 'Sakta back' },
  { knots: 0, label: 'Stopp', name: 'Stopp' },
  { knots: 4, label: 'Sakta', name: 'Sakta fram' },
  { knots: 8, label: 'Halv', name: 'Halv fram' },
  /** Cruising speed under water: the step from 8 to 19 knots was too large. */
  { knots: 12, label: 'Marsch', name: 'Marschfart' },
  /** The top speed (~18.9 knots at 240 rpm in salt water): full power. */
  { knots: 19, label: 'Full', name: 'Full fram' },
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
