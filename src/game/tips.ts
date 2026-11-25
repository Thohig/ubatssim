/**
 * The crew's tips the first time something happens: one line in the log,
 * shown once per player (the ids shown are kept in the settings). They
 * replace the old practice scenarios. No DOM; the log line does not touch
 * the simulation.
 */
import type { Telemetry } from '../sim/simulation';
import type { GameSession } from './session';

export interface Tip {
  id: string;
  when: (s: GameSession, t: Telemetry) => boolean;
  text: string;
}

export const TIPS: readonly Tip[] = [
  {
    id: 'mission',
    when: (s) => s.missions.current !== null,
    text: 'Uppdraget står överst. Bojen på kompassen och sjökortet visar vart du ska. Uppdragen är valfria: ett som går ut ger inget straff.',
  },
  {
    id: 'hunted',
    when: (s) => s.ctrl.hunter.hunting,
    text: 'Du är jagad. Gå djupt under språngskiktet, sakta till 4 knop, byt kurs och skjut ut ett lockmål (L).',
  },
  {
    id: 'suspected',
    when: (s) => Object.entries(s.ctrl.sonar.awareness).some(([id, a]) => a >= 0.5 && s.ctrl.world.vessels.some((v) => v.def.id === id && v.def.kind === 'patrol')),
    text: 'En korvett har hört eller sett något. Sakta in, håll masterna nere och gå under språngskiktet.',
  },
  {
    id: 'periscope',
    when: (_, t) => t.periscope > 0.99 && t.periscopeHeadDepth < 0,
    text: 'Periskopet är uppe. Dra i bilden för att vrida det, T markerar fartyget i hårkorset, R mäter avståndet och F skjuter. Ha det uppe kort tid.',
  },
  {
    id: 'contact',
    when: (s) => s.ctrl.sonar.contacts.some((k) => !k.bio),
    text: 'Sonaren hör ett fartyg. Öppna sonaren (H) för bäringen, och tryck på kontakten för att göra den till mål.',
  },
  {
    id: 'battery',
    when: (_, t) => t.battery < 0.5,
    text: 'Batteriet är under hälften. På periskopdjup med snorkeln uppe (N) startar maskinisten dieslarna. Låg fart laddar fortare.',
  },
  {
    id: 'deep',
    when: (_, t) => t.depth > 60,
    text: 'Under språngskiktet hör korvetterna dig sämre. Vattnet är tätare där, och besättningen trimmar för det.',
  },
  {
    id: 'depot',
    when: (s, t) => Math.hypot(s.patrol.depot[0] - t.position[0], s.patrol.depot[1] - t.position[1]) < 3000,
    text: 'Depåfartyget ligger här. Ligg stilla i ytläge intill det i fem minuter, så lastas torpeder och lockmål över.',
  },
  {
    id: 'torpedoes',
    when: (s) => s.ctrl.fire.room.reserve === 0,
    text: 'Stället är tomt. Depåfartyget fyller på: bojen visar vägen när inget uppdrag pågår.',
  },
  {
    id: 'night',
    when: (s) => s.patrol.conditions === 'night',
    text: 'Det är natt. Periskopet ser lite, men korvetterna ser dig också sämre. Sonaren och radarn ser i mörker.',
  },
];

/** Seconds of game time between two tips. */
export const TIP_GAP = 45;

export class Tips {
  private last = -Infinity;
  private readonly seen: Set<string>;

  constructor(seen: readonly string[], private readonly enabled: boolean) {
    this.seen = new Set(seen);
  }

  /** Logs the first tip due that has not been shown; returns its id (to keep), or null. */
  update(s: GameSession): string | null {
    if (!this.enabled || s.sim.t - this.last < TIP_GAP) return null;
    const t = s.sim.telemetry();
    const tip = TIPS.find((x) => !this.seen.has(x.id) && x.when(s, t));
    if (!tip) return null;
    this.seen.add(tip.id);
    this.last = s.sim.t;
    s.ctrl.addLog(`Tips: ${tip.text}`, 'info');
    return tip.id;
  }
}
