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
import {
  patrolSignalExcess,
  subReceiverNoise,
  subSignalExcess,
  subSourceLevel,
  transmissionLoss,
  vesselSourceLevel,
} from '../sim/acoustics';
import { ACOUSTICS } from '../sim/config/acoustics';
import { WEAPONS } from '../sim/config/weapons';
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
const SIGHT_RATE = { periscope: 0.03, snorkel: 0.06, surfaced: 0.3 } as const;

export const CLASS_NAME: Record<VesselKind, string> = { freighter: 'lastfartyg', ferry: 'färja', fishing: 'fiskebåt', patrol: 'örlogsfartyg' };

export interface SonarContact {
  label: string;
  vesselId: string;
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
  vesselId: string;
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

    for (const k of c.world.contacts()) {
      const v = k.vessel;
      const tl = transmissionLoss(k.range, Math.max(0, t.depth), 0, water);
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
        c.addLog(`Sonar: ${contact.label} är troligen ${article(contact.classified)} (${contact.blades} blad, ${contact.rpm} rpm).`, 'info');
      }
      marks.push({ relative: wrap180(bearing - heading), excess });
    }

    for (const x of this.contacts.filter((x) => now - x.lastHeard > LOSE_AFTER)) c.addLog(`Sonar: ${x.label} tappad.`, 'info');
    this.contacts = this.contacts.filter((x) => now - x.lastHeard <= LOSE_AFTER);
    this.history.push({ t: now, marks });
    if (this.history.length > HISTORY) this.history.shift();
  }

  /** One patrol vessel's sonar, lookouts and radar. */
  private watch(id: string, name: string, range: number, t: ReturnType<Controller['sim']['telemetry']>, speed: number, at: [number, number]): void {
    const c = this.ctrl;
    const tl = transmissionLoss(range, Math.max(0, t.depth), PATROL_SONAR_DEPTH, c.sim.water);
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
    for (const k of c.world.contacts()) {
      const v = k.vessel;
      if (k.range > P.range || v.state.sinking) continue;
      const tl = transmissionLoss(k.range, Math.max(0, k0.depth), Math.max(1, v.def.draft / 2), sim.water);
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
    this.echoes = echoes;
    const text = echoes
      .slice(0, 4)
      .map((e) => `${e.label ?? 'eko'} ${deg3(e.bearing)} ${e.range >= 1000 ? `${(e.range / 1000).toFixed(1).replace('.', ',')} km` : `${Math.round(e.range)} m`}`)
      .join(', ');
    c.afterAck.push(echoes.length ? `Sonar: ekon från ${text}.` : 'Sonar: inget eko.');
    c.hunter.heard(P.level, 0.6, 0.9, true);
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
const article = (name: string) => (name === 'färja' || name === 'fiskebåt' ? `en ${name}` : `ett ${name}`);
/** A fixed phase per vessel id. */
function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 1000;
  return h;
}
