/**
 * Corvettes that hunt. Each patrol vessel (`kind: 'patrol'`) is in one of
 * four states, driven by its awareness of the submarine (sonar.ts) and
 * deterministic:
 *
 *   patrol     its route at its own speed
 *   suspicion  awareness ≥ 0.5: turns towards where it heard or saw
 *              something and slows down to listen better
 *   search     awareness ≥ 0.8, or a torpedo launch heard: runs to the last
 *              known position and searches in an expanding square, pinging
 *              with its active sonar; an echo gives the boat's position
 *              and depth (and it is found)
 *   attack     found: runs over the position and drops a pattern of depth
 *              charges set to the depth it measured, then turns and pings
 *              again
 *
 * Corvettes with the same `group` (VesselDef) hunt together. The one that
 * starts a search or an attack calls the others, which search from its
 * position; an echo is shared by all of them. With two or more attacking,
 * one is the striker, running in and dropping, and the others direct: they
 * stand off `directorStandoff` metres at listening speed and ping, where
 * their own speed does not deafen them. After each pattern the striker and
 * a director change places (the creeping attack). A corvette alone hunts as
 * before.
 *
 * Without contact for `giveUp` seconds, or with its depth charges spent, it
 * goes back to patrolling. The last
 * known position carries an error that shrinks with the awareness; the
 * hunt never reads the boat's true position except through a ping's echo.
 */
import { patrolNoise, transmissionLoss } from '../sim/acoustics';
import { ACOUSTICS } from '../sim/config/acoustics';
import { WEAPONS } from '../sim/config/weapons';
import { DT } from '../sim/simulation';
import type { Vessel } from '../sim/vessel';
import type { Controller } from './controller';

const W = WEAPONS.corvette;

export type HuntState = 'patrol' | 'suspicion' | 'search' | 'attack';

export const HUNT_NAME: Record<HuntState, string> = { patrol: 'patrull', suspicion: 'misstänker', search: 'söker', attack: 'anfaller' };

interface Hunt {
  state: HuntState;
  /** Last known position [north, east] and depth [m] of the boat, as the corvette believes. */
  lkp: [number, number] | null;
  lkpDepth: number | null;
  lastContact: number;
  lastPing: number;
  lastAttack: number;
  /** Depth charges left. */
  charges: number;
  /** Expanding square: the leg it is on and the point it is heading for. */
  leg: number;
  legGoal: [number, number] | null;
  /** The search started close enough (`searchCommit`) that it does not give up on the way. */
  committed: boolean;
}

/** A fixed pseudo-random value in −1…1 (deterministic errors). */
const noise = (t: number, key: number) => Math.sin(t * 0.71 + key * 3.1) * Math.cos(t * 0.29 + key * 1.3);

/** A director stands this far [m] from where the boat is believed to be. */
const DIRECTOR_STANDOFF = 1500;

export class Hunter {
  readonly hunts: Record<string, Hunt> = {};
  /** The striker of each hunting group (vessel id), by group. */
  readonly strikers: Record<string, string> = {};
  /** Active sonar pings so far (the sound plays one per new ping). */
  pings = 0;
  /** False: the patrol vessels only follow their routes (the demo behind the start page). */
  enabled = true;
  private steps = 0;

  constructor(private readonly ctrl: Controller) {}

  /** The state of a patrol vessel (patrol if it has not started). */
  state(id: string): HuntState {
    return this.hunts[id]?.state ?? 'patrol';
  }

  /** True once a patrol vessel has dropped all its depth charges. */
  spent(id: string): boolean {
    return (this.hunts[id]?.charges ?? 1) <= 0;
  }

  /** True while any corvette searches for or attacks the boat. */
  get hunting(): boolean {
    return Object.values(this.hunts).some((h) => h.state === 'search' || h.state === 'attack');
  }

  private hunt(id: string): Hunt {
    return (this.hunts[id] ??= { state: 'patrol', lkp: null, lkpDepth: null, lastContact: -Infinity, lastPing: -Infinity, lastAttack: -Infinity, charges: W.charges, leg: 0, legGoal: null, committed: false });
  }

  /** The boat launched a torpedo: every corvette within hearing knows roughly where it is. */
  heardLaunch(): void {
    this.heard(WEAPONS.torpedo.launchNoise, 0.5, 0.6, true);
  }

  /**
   * A sound from the boat (a launch, a muzzle door, its own ping) at
   * `level` [dB re 1 µPa at 1 m]: every corvette that hears it gains
   * `alert` awareness and an estimate of the position as good as `quality`
   * (0…1); with `search` it starts searching there. Returns how many heard it.
   */
  heard(level: number, alert: number, quality: number, search: boolean): number {
    const c = this.ctrl;
    let n = 0;
    for (const k of c.world.contacts()) {
      const v = k.vessel;
      if (v.def.kind !== 'patrol' || v.state.sinking) continue;
      let tl = transmissionLoss(k.range, Math.max(0, c.sim.y[2]!), 5, c.sim.water);
      if (c.sonar.shadowed([c.sim.y[0]!, c.sim.y[1]!, Math.max(0, c.sim.y[2]!)], [v.state.north, v.state.east, 5])) tl += ACOUSTICS.terrainShadowLoss;
      if (level - tl - patrolNoise(v.state.speed) + ACOUSTICS.patrolArrayGain - ACOUSTICS.patrolThreshold <= 0) continue;
      n++;
      c.sonar.alert(v.def.id, alert);
      if (!this.enabled) continue;
      const h = this.hunt(v.def.id);
      this.estimate(h, v, quality);
      if (search && h.charges > 0 && (h.state === 'patrol' || h.state === 'suspicion')) this.enter(v, h, 'search');
    }
    return n;
  }

  /**
   * Someone else (a patrol aircraft, a coastal radar) reports the boat near
   * `at` [north, east]: the corvette searches there.
   */
  cue(v: Vessel, at: [number, number]): void {
    if (!this.enabled || v.state.sinking) return;
    const h = this.hunt(v.def.id);
    h.lkp = [at[0], at[1]];
    h.lastContact = this.ctrl.sim.t;
    if (h.charges > 0 && (h.state === 'patrol' || h.state === 'suspicion')) this.enter(v, h, 'search');
  }

  /** Call once per step; works once a second. */
  update(): void {
    if (!this.enabled || this.steps++ % Math.round(1 / DT) !== 0) return;
    const c = this.ctrl;
    const now = c.sim.t;
    for (const v of c.world.vessels) {
      if (v.def.kind !== 'patrol') continue;
      const h = this.hunt(v.def.id);
      if (v.state.sinking) {
        v.goal = null;
        continue;
      }
      const aware = c.sonar.awareness[v.def.id] ?? 0;
      if (c.sonar.noticed[v.def.id]) {
        h.lastContact = now;
        this.estimate(h, v, aware, c.sonar.heardFrom[v.def.id] ?? undefined);
      }
      // Spent: back on patrol for good. It used to turn on the boat again a second later and break off at once,
      // four log lines every two seconds for as long as it could hear the boat.
      if (h.charges <= 0 && h.state === 'patrol') {
        this.steer(v, h, now);
        continue;
      }
      // Transitions.
      if (h.state === 'patrol' && aware >= 0.5) this.enter(v, h, 'suspicion');
      if (h.state === 'suspicion' && aware >= 0.8) this.enter(v, h, 'search');
      if (h.state !== 'attack' && aware >= 1) this.enter(v, h, 'attack');
      if ((h.state === 'search' || h.state === 'attack' || v.def.activeSonar) && now - h.lastPing >= W.pingInterval) this.ping(v, h);
      // On its way to where it believes the boat is, a searching corvette does not give up (the clock starts there).
      const enRoute = h.state === 'search' && h.leg === 0 && h.committed;
      if (h.state !== 'patrol' && !enRoute && now - h.lastContact > W.giveUp) this.enter(v, h, 'patrol');
      if (h.state === 'attack' && h.charges <= 0 && now - h.lastAttack > W.attackInterval) {
        c.addLog(`Sonar: ${v.def.name} har inga sjunkbomber kvar och bryter anfallet.`, 'info');
        c.sonar.calm(v.def.id, 0.3);
        this.enter(v, h, 'patrol');
      }
      if (h.state === 'attack' && now - h.lastContact > W.giveUp / 2) this.enter(v, h, 'search');
      this.steer(v, h, now);
    }
  }

  /** The other corvettes of a corvette's group, afloat. */
  private partners(v: Vessel): Vessel[] {
    const g = v.def.group;
    if (!g) return [];
    return this.ctrl.world.vessels.filter((o) => o !== v && o.def.kind === 'patrol' && o.def.group === g && !o.state.sinking);
  }

  /** What a corvette believes about the boat goes to its group. */
  private share(v: Vessel, h: Hunt, attack: boolean): void {
    for (const o of this.partners(v)) {
      const oh = this.hunt(o.def.id);
      if (!h.lkp) continue;
      oh.lkp = [h.lkp[0], h.lkp[1]];
      oh.lkpDepth = h.lkpDepth;
      oh.lastContact = h.lastContact;
      if (attack) {
        this.ctrl.sonar.alert(o.def.id, 1);
        this.enter(o, oh, 'attack');
      }
    }
  }

  /** The group's striker: kept while it can drop; else the one with charges nearest where the boat is believed to be. */
  private striker(v: Vessel, h: Hunt): string {
    const g = v.def.group!;
    const attackers = [v, ...this.partners(v)].filter((o) => this.hunt(o.def.id).state === 'attack' && this.hunt(o.def.id).charges > 0);
    const now = this.strikers[g];
    if (now && attackers.some((o) => o.def.id === now)) return now;
    const lkp = h.lkp ?? [v.state.north, v.state.east];
    const d = (o: Vessel) => Math.hypot(lkp[0] - o.state.north, lkp[1] - o.state.east);
    const best = [...attackers].sort((a, b) => d(a) - d(b))[0] ?? v;
    this.strikers[g] = best.def.id;
    return best.def.id;
  }

  private enter(v: Vessel, h: Hunt, state: HuntState): void {
    if (h.state === state) return;
    h.state = state;
    const c = this.ctrl;
    // Starting a search or an attack: the rest of the group is called in.
    if ((state === 'search' || state === 'attack') && v.def.group) {
      if (!h.lkp) this.estimate(h, v, c.sonar.awareness[v.def.id] ?? 0.5);
      for (const o of this.partners(v)) {
        const oh = this.hunt(o.def.id);
        if (oh.charges <= 0 || (oh.state !== 'patrol' && oh.state !== 'suspicion')) continue;
        c.addLog(`Sonar: ${v.def.name} ropar på ${o.def.name}.`, 'info');
        oh.lkp = h.lkp ? [h.lkp[0], h.lkp[1]] : null;
        oh.lastContact = c.sim.t;
        c.sonar.alert(o.def.id, Math.max(0, 0.85 - (c.sonar.awareness[o.def.id] ?? 0)));
        this.enter(o, oh, 'search');
      }
    }
    // Starting a hunt: from where it believes the boat is now.
    if (state !== 'patrol' && !h.lkp) this.estimate(h, v, c.sonar.awareness[v.def.id] ?? 0.5);
    const name = v.def.name;
    if (state === 'patrol') {
      v.goal = null;
      v.goalSpeed = null;
      h.lkp = null;
      c.addLog(`Sonar: ${name} har gett upp och går tillbaka till sin patrull.`, 'info');
    } else if (state === 'suspicion') {
      c.addLog(`Sonar: ${name} saktar in och svänger mot oss.`, 'info');
    } else if (state === 'search') {
      h.leg = 0;
      h.legGoal = null;
      // Close enough to go and look: then it does not give up on the way (see `update`).
      h.committed = h.lkp !== null && Math.hypot(h.lkp[0] - v.state.north, h.lkp[1] - v.state.east) <= W.searchCommit;
      c.addLog(`Sonar: ${name} söker med aktiv sonar!`, 'error');
    } else {
      c.addLog(`Sonar: ${name} går in för anfall!`, 'error');
    }
  }

  /**
   * Where the corvette believes the boat is from listening or looking: the
   * bearing is good, the range is not (passive sonar gives no range). The
   * error along the bearing is 10–50 % of the range, less the surer it is.
   */
  private estimate(h: Hunt, v: Vessel, aware: number, from?: [number, number]): void {
    const sim = this.ctrl.sim;
    // What it heard: the boat, or a decoy taken for it.
    const dn = (from ? from[0] : sim.y[0]!) - v.state.north;
    const de = (from ? from[1] : sim.y[1]!) - v.state.east;
    const range = Math.hypot(dn, de);
    const bearing = Math.atan2(de, dn) + 0.03 * noise(sim.t, v.def.id.length + 5);
    const believed = range * (1 + (0.1 + 0.4 * (1 - Math.min(1, aware))) * noise(sim.t, v.def.id.length));
    h.lkp = [v.state.north + believed * Math.cos(bearing), v.state.east + believed * Math.sin(bearing)];
    h.lastContact = sim.t;
  }

  /** The echo excess [dB] of a target at (n, e, depth) with target strength `ts`, or −∞ out of range or in the baffles. */
  private echo(v: Vessel, n: number, e: number, depth: number, ts: number): number {
    const sim = this.ctrl.sim;
    const dn = n - v.state.north;
    const de = e - v.state.east;
    const range = Math.hypot(dn, de);
    if (range > W.pingRange) return -Infinity;
    // The hull sonar is blind astern, in its own wake (the baffles).
    const rel = Math.atan2(de, dn) - v.state.heading;
    if (Math.abs(Math.atan2(Math.sin(rel), Math.cos(rel))) > W.baffles) return -Infinity;
    // Its own speed drowns a weak echo: fast, it is deaf.
    let excess = W.pingLevel - 2 * transmissionLoss(range, depth, 5, sim.water) + ts - patrolNoise(v.state.speed) + ACOUSTICS.patrolArrayGain - W.pingThreshold;
    // Behind a ridge, deep in a canyon or behind a seamount the ping does not reach.
    const sonar = this.ctrl.sonar;
    if (sonar.shadowed([v.state.north, v.state.east, 5], [n, e, depth])) excess -= 2 * ACOUSTICS.terrainShadowLoss;
    // Close above the bottom the echo drowns in the bottom's (rock: much, mud: little).
    const mask = sonar.reverbMask(n, e, depth);
    if (mask > 0) excess -= mask;
    // Inside the deep scattering layer the hull's echo is hard to tell from the layer's.
    const layer = sonar.scatteringLayer();
    if (layer !== null && Math.abs(depth - layer) < ACOUSTICS.dslHalf) excess -= ACOUSTICS.dslMask;
    return excess;
  }

  /** An active ping: an echo gives the boat's position and depth, or a decoy's (weaker) taken for it. */
  private ping(v: Vessel, h: Hunt): void {
    const c = this.ctrl;
    const sim = c.sim;
    h.lastPing = sim.t;
    this.pings++;
    const depth = Math.max(0, sim.y[2]!);
    const boat = this.echo(v, sim.y[0]!, sim.y[1]!, depth, W.targetStrength);
    let decoy: (typeof c.world.decoys)[number] | null = null;
    let best = boat;
    for (const d of c.world.decoys) {
      const e = this.echo(v, d.north, d.east, d.depth, WEAPONS.decoy.targetStrength);
      if (e > best) {
        best = e;
        decoy = d;
      }
    }
    if (best <= 0) return;
    const at = decoy ? { n: decoy.north, e: decoy.east, depth: decoy.depth } : { n: sim.y[0]!, e: sim.y[1]!, depth };
    h.lkp = [at.n, at.e];
    h.lkpDepth = Math.max(10, at.depth + 8 * noise(sim.t, v.def.id.length + 3));
    h.lastContact = sim.t;
    c.sonar.alert(v.def.id, 1);
    // Only the boat's own echo finds it.
    if (!decoy) c.sonar.found(v.def.name);
    this.enter(v, h, 'attack');
    this.share(v, h, true);
  }

  private steer(v: Vessel, h: Hunt, now: number): void {
    if (h.state === 'patrol') return;
    if (!h.lkp) return;
    if (h.state === 'suspicion') {
      v.goal = h.lkp;
      v.goalSpeed = W.listen;
      return;
    }
    if (h.state === 'attack') {
      // Hunting together: a director stands off and listens and pings while the striker runs in.
      if (v.def.group && this.partners(v).some((o) => this.hunt(o.def.id).state === 'attack') && this.striker(v, h) !== v.def.id) {
        const dn = v.state.north - h.lkp[0];
        const de = v.state.east - h.lkp[1];
        const d = Math.hypot(dn, de) || 1;
        v.goal = [h.lkp[0] + (dn / d) * DIRECTOR_STANDOFF, h.lkp[1] + (de / d) * DIRECTOR_STANDOFF];
        v.goalSpeed = Math.abs(d - DIRECTOR_STANDOFF) < 200 ? 0 : W.listen;
        return;
      }
      v.goal = h.lkp;
      v.goalSpeed = W.attack;
      const d = Math.hypot(h.lkp[0] - v.state.north, h.lkp[1] - v.state.east);
      if (d < W.dropDistance && now - h.lastAttack >= W.attackInterval && h.charges > 0) {
        h.lastAttack = now;
        h.charges -= WEAPONS.depthCharge.pattern;
        this.ctrl.world.dropCharges(v, h.lkpDepth ?? 50);
        // The creeping attack: after a pattern a director takes over as striker.
        if (v.def.group) {
          const next = this.partners(v).find((o) => this.hunt(o.def.id).state === 'attack' && this.hunt(o.def.id).charges > 0);
          if (next) {
            this.strikers[v.def.group] = next.def.id;
            this.ctrl.addLog(`Sonar: ${next.def.name} går in, ${v.def.name} lyssnar.`, 'info');
          }
        }
        // Run on past the drop before turning back: aim beyond the position.
        h.lkp = [h.lkp[0] + 400 * Math.cos(v.state.heading), h.lkp[1] + 400 * Math.sin(v.state.heading)];
      }
      return;
    }
    // Search: to the last known position, then an expanding square around it. (Running in at attack
    // speed took the escort in "Konvojen" straight into the torpedo aimed at the freighter.)
    v.goalSpeed = W.search;
    if (!h.legGoal) h.legGoal = h.lkp;
    if (Math.hypot(h.legGoal[0] - v.state.north, h.legGoal[1] - v.state.east) < 80) {
      // At the last known position the search starts, and so does the time to give up: an escort 5 km off
      // used to give up on a heard launch just before it got there.
      if (h.leg === 0) h.lastContact = now;
      h.leg++;
      const len = W.searchLeg * Math.ceil(h.leg / 2);
      const dir = ((h.leg - 1) % 4) * (Math.PI / 2);
      h.legGoal = [h.legGoal[0] + len * Math.cos(dir), h.legGoal[1] + len * Math.sin(dir)];
    }
    v.goal = h.legGoal;
  }
}
