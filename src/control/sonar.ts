/**
 * The passive sonar and being found. Once a second (deterministic, no
 * randomness):
 *
 *  - every vessel whose noise reaches the bow array with a signal excess
 *    above zero is a contact (S1, S2 …) with a measured true bearing; the
 *    bearing error shrinks with the excess. After `CLASSIFY_AFTER` seconds the
 *    sonar operator classifies it by its propeller (blades, rpm). A contact
 *    not heard for `LOSE_AFTER` seconds is lost.
 *  - every patrol vessel listens with its hull sonar and looks with its
 *    lookouts and radar: its awareness of the submarine grows with the
 *    signal excess and with a raised periscope or snorkel or a surfaced boat
 *    within sight, and decays slowly otherwise. At 1 the submarine is found.
 *
 *  - the boat's radar on the air adds to a corvette's awareness within reach
 *    of its radar warning receiver (radar.ts).
 *
 * The active sonar (`ping`): one ping gives an echo, a range and a bearing,
 * from every vessel whose echo excess (SL − 2·TL + TS − NL + AG − DT) is
 * above zero, and a marked target gets them as an observation. Every
 * corvette within hearing of the ping knows roughly where the boat is
 * (hunter.ts, `heard`).
 *
 * The levels come from the sonar equation in src/sim/acoustics.ts.
 */
import { terrainBlocks } from '../sim/seabed';
import {
  patrolSignalExcess,
  subReceiverNoise,
  subSignalExcess,
  subSourceLevel,
  transmissionLoss,
  vesselSourceLevel,
} from '../sim/acoustics';
import { ACOUSTICS } from '../sim/config/acoustics';
import { AREAS } from '../sim/config/areas';
import type { WreckDef } from '../sim/config/terrain';
import { WEAPONS } from '../sim/config/weapons';
import type { Creature } from '../sim/life';
import { bottomMask, bottomType, type BottomType } from '../sim/seabed';
import { DT } from '../sim/simulation';
import type { VesselKind } from '../sim/vessel';
import type { Controller } from './controller';

/** Seconds of listening before a contact is classified, and without signal before it is lost. */
export const CLASSIFY_AFTER = 20;
export const LOSE_AFTER = 20;
/** Seconds of waterfall history kept. */
export const HISTORY = 180;
/** A patrol vessel's sonar sits this deep [m]. */
const PATROL_SONAR_DEPTH = 5;
/** Awareness gained per second per dB of signal excess (and at zero excess), and lost per second when nothing gives the boat away. */
const AWARE_RATE = 0.04;
const AWARE_DECAY = 0.005;
/** Awareness gained per second while a mast or the hull shows within sight. */
const SIGHT_RATE = { periscope: 0.03, snorkel: 0.06, surfaced: 0.3, bubble: 0.08 } as const;
/** Air vented from the main ballast shallower than this [m] comes up as a big bubble on the surface. */
export const BUBBLE_DEPTH = 30;

export const CLASS_NAME: Record<VesselKind, string> = { freighter: 'lastfartyg', ferry: 'färja', fishing: 'fiskebåt', patrol: 'örlogsfartyg', sail: 'segelbåt' };

/** What the sonar operator calls a creature once classified. */
export const BIO_NAME = { clicks: 'kaskelot', song: 'knölval', pulse: 'vikval', whistle: 'späckhuggare', frt: 'sillstim' } as const;
/** How it sounds, for the classification line. */
const BIO_SOUND = { clicks: 'klickljud', song: 'sång', pulse: 'låga pulståg', whistle: 'visslingar', frt: 'tickande ljud' } as const;

/** The wrecks on the sea bed of an area (part of its terrain). */
export function areaWrecks(c: Controller): readonly WreckDef[] {
  const t = AREAS[c.sim.areaId].terrain;
  return t.kind === 'shelf' ? t.params.wrecks : [];
}

export interface SonarContact {
  label: string;
  /** The vessel's id, or a creature's (`bio`). */
  vesselId: string;
  /** A whale or a fish school, not a ship (it cannot be a target). */
  bio?: boolean;
  /** Measured true bearing [deg, 0–360). */
  bearing: number;
  /** Signal excess [dB]; larger = stronger. */
  excess: number;
  firstHeard: number;
  lastHeard: number;
  /** "lastfartyg", "färja" … once classified, else null. */
  classified: string | null;
  /** Propeller: blades and shaft speed [rpm], known once classified. */
  blades: number;
  rpm: number;
}

/** One line of the waterfall: the bearings heard at a time. */
export interface SonarSample {
  t: number;
  /** Bearing relative to the bow [deg, −180…180] and signal excess [dB]. */
  marks: { relative: number; excess: number }[];
}

/** "stark", "medel", "svag" for a signal excess [dB]. */
export const strength = (excess: number): string => (excess > 25 ? 'stark' : excess > 10 ? 'medel' : 'svag');

/** An echo of the boat's own ping. */
export interface PingEcho {
  /** A vessel's or a creature's id, or '' for a wreck or the scattering layer. */
  vesselId: string;
  /** What the operator makes of it when it is not a vessel ("vrak?", "fiskstim?"). */
  what?: string;
  /** The sonar contact it belongs to (S1 …), if any. */
  label: string | null;
  /** Measured true bearing [deg] and range [m]. */
  bearing: number;
  range: number;
}

export class Sonar {
  contacts: SonarContact[] = [];
  /** The echoes of the last ping, its time, and the pings so far (the sound plays one per new ping). */
  echoes: PingEcho[] = [];
  lastPing = -Infinity;
  pings = 0;
  history: SonarSample[] = [];
  /** Each patrol vessel's awareness of the submarine 0…1, by vessel id. */
  readonly awareness: Record<string, number> = {};
  /** The vessel that found the submarine (name), or null. */
  detectedBy: string | null = null;
  /** Patrol vessels that heard or saw the boat in the last update, by id (the hunt uses it). */
  readonly noticed: Record<string, boolean> = {};
  /** Where each patrol vessel heard "the boat" in the last update: a decoy's position [north, east] when it was louder, else null (the boat). */
  readonly heardFrom: Record<string, [number, number] | null> = {};
  /** The submarine's own radiated noise and the noise at its hydrophones [dB] (last update). */
  ownLevel = 0;
  ownNoise = 0;
  private steps = 0;
  private nextLabel = 1;
  private warned = new Set<string>();

  constructor(private readonly ctrl: Controller) {}

  /** The highest awareness of any patrol vessel 0…1 (0 with none about). */
  get risk(): number {
    return Math.max(0, ...Object.values(this.awareness));
  }

  /** Call once per simulation step; works once a second. */
  update(): void {
    if (this.steps++ % Math.round(1 / DT) !== 0) return;
    const c = this.ctrl;
    const sim = c.sim;
    const t = sim.telemetry();
    const now = sim.t;
    const water = sim.water;
    this.ownLevel = subSourceLevel({ speed: t.u, depth: t.depth, dieselRunning: t.dieselRunning });
    this.ownNoise = subReceiverNoise(t.u, sim.sea.hs);
    const heading = (t.heading * 180) / Math.PI;
    const marks: SonarSample['marks'] = [];

    const here: [number, number, number] = [sim.y[0]!, sim.y[1]!, Math.max(0, t.depth)];
    for (const k of c.world.contacts()) {
      const v = k.vessel;
      let tl = transmissionLoss(k.range, Math.max(0, t.depth), 0, water);
      // A ship's propeller and hull sit a few metres down.
      if (this.shadowed(here, [v.state.north, v.state.east, Math.max(1, v.def.draft / 2)])) tl += ACOUSTICS.terrainShadowLoss;
      const excess = subSignalExcess(vesselSourceLevel(v.def, v.state.speed), tl, this.ownNoise);

      // The patrol vessels listen and look for the submarine.
      if (v.def.kind === 'patrol') this.watch(v.def.id, v.def.name, k.range, t, v.state.speed, [v.state.north, v.state.east]);

      if (excess <= 0) continue;
      const truth = (k.bearing * 180) / Math.PI;
      // A deterministic wander of the measured bearing, smaller for a stronger signal [deg].
      const spread = 4 / (1 + excess / 4);
      const bearing = (((truth + spread * Math.sin(now * 0.37 + hash(v.def.id))) % 360) + 360) % 360;
      let contact = this.contacts.find((x) => x.vesselId === v.def.id);
      if (!contact) {
        contact = {
          label: `S${this.nextLabel++}`,
          vesselId: v.def.id,
          bearing,
          excess,
          firstHeard: now,
          lastHeard: now,
          classified: null,
          blades: v.def.blades,
          rpm: Math.round(v.def.propellerRps * 60),
        };
        this.contacts.push(contact);
        c.addLog(`Sonar: ny kontakt ${contact.label}, bäring ${deg3(bearing)}.`, 'info');
      }
      contact.bearing = bearing;
      contact.excess = excess;
      contact.lastHeard = now;
      if (!contact.classified && now - contact.firstHeard >= CLASSIFY_AFTER) {
        contact.classified = CLASS_NAME[v.def.kind];
        c.addLog(`Sonar: ${contact.label} är troligen ${article(contact.classified)} (${contact.blades ? `${contact.blades} blad, ${contact.rpm} rpm` : 'inget propellerljud, bara skrovet i vattnet'}).`, 'info');
      }
      marks.push({ relative: wrap180(bearing - heading), excess });
    }

    for (const k of c.world.bioContacts()) this.hearCreature(k.creature, k.range, k.bearing, here, heading, marks);

    for (const x of this.contacts.filter((x) => now - x.lastHeard > LOSE_AFTER)) c.addLog(`Sonar: ${x.label} tappad.`, 'info');
    this.contacts = this.contacts.filter((x) => now - x.lastHeard <= LOSE_AFTER);
    this.history.push({ t: now, marks });
    if (this.history.length > HISTORY) this.history.shift();
  }

  /** One patrol vessel's sonar, lookouts and radar. */
  private watch(id: string, name: string, range: number, t: ReturnType<Controller['sim']['telemetry']>, speed: number, at: [number, number]): void {
    const c = this.ctrl;
    let tl = transmissionLoss(range, Math.max(0, t.depth), PATROL_SONAR_DEPTH, c.sim.water);
    if (this.shadowed([c.sim.y[0]!, c.sim.y[1]!, Math.max(0, t.depth)], [at[0], at[1], PATROL_SONAR_DEPTH])) tl += ACOUSTICS.terrainShadowLoss;
    let excess = patrolSignalExcess(this.ownLevel, tl, speed);
    // A decoy heard better than the boat is taken for the boat.
    let from: [number, number] | null = null;
    for (const d of c.world.decoys) {
      const r = Math.hypot(d.north - at[0], d.east - at[1]);
      const e = patrolSignalExcess(WEAPONS.decoy.level, transmissionLoss(r, d.depth, PATROL_SONAR_DEPTH, c.sim.water), speed);
      if (e > excess) {
        excess = e;
        from = [d.north, d.east];
      }
    }
    this.heardFrom[id] = from;
    let rate = excess > 0 ? AWARE_RATE * (1 + excess / 5) : 0;
    const A = ACOUSTICS;
    if (t.periscope > 0.99 && t.periscopeHeadDepth < 0 && range < A.sightPeriscope) rate += SIGHT_RATE.periscope;
    if (t.snorkel > 0.99 && t.snorkelHeadDepth < 0 && range < A.sightSnorkel) rate += SIGHT_RATE.snorkel;
    if (t.bridgeDeckDepth < 0 && range < A.sightSurfaced) rate += SIGHT_RATE.surfaced;
    if (this.venting(t) && range < A.sightPeriscope) rate += SIGHT_RATE.bubble;
    if (c.radar.heardAt(range)) rate += WEAPONS.radar.esmAware;
    this.noticed[id] = rate > 0;
    const before = this.awareness[id] ?? 0;
    const now = Math.min(1, Math.max(0, before + (rate > 0 ? rate : -AWARE_DECAY)));
    this.awareness[id] = now;
    if (now >= 0.5 && !this.warned.has(id)) {
      this.warned.add(id);
      c.addLog(`Varning: ${name} kan ha hört eller sett något. Gå djupare och saktare, och sänk masterna.`, 'error');
    } else if (now < 0.3) this.warned.delete(id);
    if (now >= 1) this.found(name);
  }

  /** Air coming out of open vents shallow enough to show as a bubble on the surface. */
  venting(t: ReturnType<Controller['sim']['telemetry']>): boolean {
    return t.depth > 0 && t.depth < BUBBLE_DEPTH && t.tanks.some((x) => x.kind === 'mainBallast' && x.ventOpen && x.fill < 0.98);
  }

  /** Seconds until the sonar may ping again (0 = now). */
  pingWait(): number {
    return Math.max(0, WEAPONS.ping.interval - (this.ctrl.sim.t - this.lastPing));
  }

  /**
   * One active ping: echoes with range and bearing from the vessels within
   * reach, as observations of marked targets, and a sound every corvette
   * within hearing hears. Logs what came back.
   */
  ping(): void {
    const c = this.ctrl;
    const sim = c.sim;
    const P = WEAPONS.ping;
    const now = sim.t;
    this.lastPing = now;
    this.pings++;
    const k0 = sim.kinematics();
    const noise = subReceiverNoise(k0.u, sim.sea.hs);
    const echoes: PingEcho[] = [];
    const here: [number, number, number] = [sim.y[0]!, sim.y[1]!, Math.max(0, k0.depth)];
    for (const k of c.world.contacts()) {
      const v = k.vessel;
      if (k.range > P.range || v.state.sinking) continue;
      let tl = transmissionLoss(k.range, Math.max(0, k0.depth), Math.max(1, v.def.draft / 2), sim.water);
      if (this.shadowed(here, [v.state.north, v.state.east, Math.max(1, v.def.draft / 2)])) tl += ACOUSTICS.terrainShadowLoss;
      const excess = P.level - 2 * tl + (P.targetStrength[v.def.kind] ?? 15) - noise + ACOUSTICS.subArrayGain - P.threshold;
      if (excess <= 0) continue;
      const key = v.def.id.length * 13 + v.def.id.charCodeAt(0);
      const range = k.range * (1 + P.rangeError * Math.sin(now * 0.91 + key));
      const bearing = k.bearing + P.bearingError * Math.cos(now * 0.53 + key);
      const label = this.contacts.find((x) => x.vesselId === v.def.id)?.label ?? null;
      echoes.push({ vesselId: v.def.id, label, bearing: (((bearing * 180) / Math.PI) % 360 + 360) % 360, range });
      const t = c.fire.targets.find((x) => x.vesselId === v.def.id);
      if (t) c.fire.observe(t, { bearing, sigma: P.bearingError, range, rangeError: P.rangeError });
    }
    // Whales and schools, and wrecks on the bottom: echoes too, which the operator has to tell from ships.
    const echoOf = (n: number, e: number, depth: number, ts: number, range: number, key: number): { range: number; bearing: number } | null => {
      if (range > P.range) return null;
      let tl = transmissionLoss(range, Math.max(0, k0.depth), depth, sim.water);
      if (this.shadowed(here, [n, e, depth])) tl += ACOUSTICS.terrainShadowLoss;
      const mask = this.reverbMask(n, e, depth);
      if (P.level - 2 * tl + ts - noise + ACOUSTICS.subArrayGain - P.threshold - mask <= 0) return null;
      const b = Math.atan2(e - here[1], n - here[0]);
      return {
        range: range * (1 + P.rangeError * Math.sin(now * 0.91 + key)),
        bearing: ((((b + P.bearingError * Math.cos(now * 0.53 + key)) * 180) / Math.PI) % 360 + 360) % 360,
      };
    };
    for (const k of c.world.bioContacts()) {
      const cr = k.creature;
      const e = echoOf(cr.state.north, cr.state.east, Math.max(1, cr.state.depth), cr.targetStrength, k.range, cr.def.id.length * 11);
      if (!e) continue;
      const label = this.contacts.find((x) => x.vesselId === cr.def.id)?.label ?? null;
      echoes.push({ vesselId: cr.def.id, label, what: cr.def.kind === 'school' ? 'fiskstim?' : 'val?', ...e });
    }
    for (const w of areaWrecks(c)) {
      const top = sim.acousticGround(w.at[0], w.at[1]) - w.height;
      const range = Math.hypot(w.at[0] - here[0], w.at[1] - here[1]);
      const e = echoOf(w.at[0], w.at[1], top, WEAPONS.ping.wreckStrength, range, w.name.length * 5);
      if (e) echoes.push({ vesselId: '', label: null, what: 'vrak?', ...e });
    }
    echoes.sort((a, b) => a.range - b.range);
    this.echoes = echoes;
    const text = echoes
      .slice(0, 4)
      .map((e) => `${e.label ?? (e.what ? `eko (${e.what})` : 'eko')} ${deg3(e.bearing)} ${e.range >= 1000 ? `${(e.range / 1000).toFixed(1).replace('.', ',')} km` : `${Math.round(e.range)} m`}`)
      .join(', ');
    c.afterAck.push(echoes.length ? `Sonar: ekon från ${text}.` : 'Sonar: inget eko.');
    const layer = this.scatteringLayer();
    if (layer !== null) c.afterAck.push(`Sonar: diffust eko från spridningsskiktet på ${Math.round(layer)} m.`);
    c.hunter.heard(P.level, 0.6, 0.9, true);
  }

  /** One creature heard (or not) by the bow array: a contact like a ship's, classified as biological. */
  private hearCreature(cr: Creature, range: number, bearingRad: number, here: [number, number, number], heading: number, marks: SonarSample['marks']): void {
    const c = this.ctrl;
    const now = c.sim.t;
    const level = cr.sourceLevel(now, c.world.night);
    if (level === null) return;
    let tl = transmissionLoss(range, here[2], Math.max(1, cr.state.depth), c.sim.water);
    if (this.shadowed(here, [cr.state.north, cr.state.east, Math.max(1, cr.state.depth)])) tl += ACOUSTICS.terrainShadowLoss;
    const excess = subSignalExcess(level, tl, this.ownNoise);
    if (excess <= 0) return;
    const spread = 4 / (1 + excess / 4);
    const bearing = ((((bearingRad * 180) / Math.PI + spread * Math.sin(now * 0.37 + hash(cr.def.id))) % 360) + 360) % 360;
    let contact = this.contacts.find((x) => x.vesselId === cr.def.id);
    if (!contact) {
      contact = { label: `S${this.nextLabel++}`, vesselId: cr.def.id, bio: true, bearing, excess, firstHeard: now, lastHeard: now, classified: null, blades: 0, rpm: 0 };
      this.contacts.push(contact);
      c.addLog(`Sonar: ny kontakt ${contact.label}, bäring ${deg3(bearing)}.`, 'info');
    }
    contact.bearing = bearing;
    contact.excess = excess;
    contact.lastHeard = now;
    if (!contact.classified && now - contact.firstHeard >= CLASSIFY_AFTER) {
      contact.classified = BIO_NAME[cr.def.sound];
      c.addLog(`Sonar: ${contact.label} är biologisk, troligen ${cr.def.kind === 'school' ? 'ett' : cr.def.sound === 'whistle' ? 'en flock' : 'en'} ${contact.classified} (${BIO_SOUND[cr.def.sound]}).`, 'info');
    }
    marks.push({ relative: wrap180(bearing - heading), excess });
  }

  /** True if the terrain blocks the sound path between two points [north, east, depth]. */
  shadowed(a: readonly [number, number, number], b: readonly [number, number, number]): boolean {
    return terrainBlocks(this.ctrl.sim.acousticGround, a, b);
  }

  /** The bottom type under a point (seabed.ts). */
  bottomAt(n: number, e: number): BottomType {
    const g = this.ctrl.sim.acousticGround;
    const d = g(n, e);
    const step = 50;
    const dn = (g(n + step, e) - g(n - step, e)) / (2 * step);
    const de = (g(n, e + step) - g(n, e - step)) / (2 * step);
    return bottomType(AREAS[this.ctrl.sim.areaId].terrain.kind, -d, 1 - 1 / Math.hypot(dn, de, 1), n, e);
  }

  /**
   * How much the bottom's reverberation masks an echo from a point at a
   * depth [dB]: 0 more than `bottomReverbHeight` above the bottom.
   */
  reverbMask(n: number, e: number, depth: number): number {
    const above = this.ctrl.sim.acousticGround(n, e) - depth;
    if (above >= ACOUSTICS.bottomReverbHeight) return 0;
    return bottomMask(this.bottomAt(n, e), above);
  }

  /**
   * The middle of the deep scattering layer under the boat [m], or null where
   * the water is too shallow for it to form. Deep by day, near the surface at night.
   */
  scatteringLayer(): number | null {
    const sim = this.ctrl.sim;
    if (sim.acousticGround(sim.y[0]!, sim.y[1]!) < ACOUSTICS.dslMinWater) return null;
    return this.ctrl.world.night ? ACOUSTICS.dslNight : ACOUSTICS.dslDay;
  }

  /** A patrol vessel has found the boat (by listening, looking or its active sonar). */
  found(name: string): void {
    if (this.detectedBy !== null) return;
    this.detectedBy = name;
    this.ctrl.addLog(`${name[0]!.toUpperCase()}${name.slice(1)} har upptäckt ubåten!`, 'error');
  }

  /** Sets a patrol vessel's awareness down to at most `value` (it has given up). */
  calm(id: string, value: number): void {
    this.awareness[id] = Math.min(this.awareness[id] ?? 0, value);
  }

  /** Raises a patrol vessel's awareness (e.g. it heard a torpedo launch). */
  alert(id: string, amount: number): void {
    this.awareness[id] = Math.min(1, (this.awareness[id] ?? 0) + amount);
  }
}

const deg3 = (b: number) => `${String(Math.round(b) % 360).padStart(3, '0')}°`;
const wrap180 = (d: number) => ((((d + 180) % 360) + 360) % 360) - 180;
/** "ett lastfartyg", "en färja". */
const article = (name: string) => (name === 'färja' || name === 'fiskebåt' || name === 'segelbåt' ? `en ${name}` : `ett ${name}`);
/** A fixed phase per vessel id. */
function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 1000;
  return h;
}
