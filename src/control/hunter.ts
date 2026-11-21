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
}

/** A fixed pseudo-random value in −1…1 (deterministic errors). */
const noise = (t: number, key: number) => Math.sin(t * 0.71 + key * 3.1) * Math.cos(t * 0.29 + key * 1.3);

export class Hunter {
  readonly hunts: Record<string, Hunt> = {};
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
    return (this.hunts[id] ??= { state: 'patrol', lkp: null, lkpDepth: null, lastContact: -Infinity, lastPing: -Infinity, lastAttack: -Infinity, charges: W.charges, leg: 0, legGoal: null });
  }

  /** The boat launched a torpedo: every corvette within hearing knows roughly where it is. */
  heardLaunch(): void {
    const c = this.ctrl;
    for (const k of c.world.contacts()) {
      const v = k.vessel;
      if (v.def.kind !== 'patrol' || v.state.sinking) continue;
      const tl = transmissionLoss(k.range, Math.max(0, c.sim.y[2]!), 5, c.sim.water);
      if (WEAPONS.torpedo.launchNoise - tl - patrolNoise(v.state.speed) + ACOUSTICS.patrolArrayGain - ACOUSTICS.patrolThreshold <= 0) continue;
      c.sonar.alert(v.def.id, 0.5);
      const h = this.hunt(v.def.id);
      this.estimate(h, v, 0.6);
      if (h.charges > 0 && (h.state === 'patrol' || h.state === 'suspicion')) this.enter(v, h, 'search');
    }
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
        this.estimate(h, v, aware);
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
      if ((h.state === 'search' || h.state === 'attack') && now - h.lastPing >= W.pingInterval) this.ping(v, h);
      if (h.state !== 'patrol' && now - h.lastContact > W.giveUp) this.enter(v, h, 'patrol');
      if (h.state === 'attack' && h.charges <= 0 && now - h.lastAttack > W.attackInterval) {
        c.addLog(`Sonar: ${v.def.name} har inga sjunkbomber kvar och bryter anfallet.`, 'info');
        c.sonar.calm(v.def.id, 0.3);
        this.enter(v, h, 'patrol');
      }
      if (h.state === 'attack' && now - h.lastContact > W.giveUp / 2) this.enter(v, h, 'search');
      this.steer(v, h, now);
    }
  }

  private enter(v: Vessel, h: Hunt, state: HuntState): void {
    if (h.state === state) return;
    h.state = state;
    const c = this.ctrl;
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
  private estimate(h: Hunt, v: Vessel, aware: number): void {
    const sim = this.ctrl.sim;
    const dn = sim.y[0]! - v.state.north;
    const de = sim.y[1]! - v.state.east;
    const range = Math.hypot(dn, de);
    const bearing = Math.atan2(de, dn) + 0.03 * noise(sim.t, v.def.id.length + 5);
    const believed = range * (1 + (0.1 + 0.4 * (1 - Math.min(1, aware))) * noise(sim.t, v.def.id.length));
    h.lkp = [v.state.north + believed * Math.cos(bearing), v.state.east + believed * Math.sin(bearing)];
    h.lastContact = sim.t;
  }

  /** An active ping: an echo gives the boat's position and depth. */
  private ping(v: Vessel, h: Hunt): void {
    const c = this.ctrl;
    const sim = c.sim;
    h.lastPing = sim.t;
    this.pings++;
    const dn = sim.y[0]! - v.state.north;
    const de = sim.y[1]! - v.state.east;
    const range = Math.hypot(dn, de);
    if (range > W.pingRange) return;
    // The hull sonar is blind astern, in its own wake (the baffles).
    const rel = Math.atan2(de, dn) - v.state.heading;
    if (Math.abs(Math.atan2(Math.sin(rel), Math.cos(rel))) > W.baffles) return;
    const depth = Math.max(0, sim.y[2]!);
    // Its own speed drowns a weak echo: fast, it is deaf.
    const echo = W.pingLevel - 2 * transmissionLoss(range, depth, 5, sim.water) + W.targetStrength - patrolNoise(v.state.speed) + ACOUSTICS.patrolArrayGain - W.pingThreshold;
    if (echo <= 0) return;
    h.lkp = [sim.y[0]!, sim.y[1]!];
    h.lkpDepth = Math.max(10, depth + 8 * noise(sim.t, v.def.id.length + 3));
    h.lastContact = sim.t;
    c.sonar.alert(v.def.id, 1);
    c.sonar.found(v.def.name);
    this.enter(v, h, 'attack');
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
      v.goal = h.lkp;
      v.goalSpeed = W.attack;
      const d = Math.hypot(h.lkp[0] - v.state.north, h.lkp[1] - v.state.east);
      if (d < W.dropDistance && now - h.lastAttack >= W.attackInterval && h.charges > 0) {
        h.lastAttack = now;
        h.charges -= WEAPONS.depthCharge.pattern;
        this.ctrl.world.dropCharges(v, h.lkpDepth ?? 50);
        // Run on past the drop before turning back: aim beyond the position.
        h.lkp = [h.lkp[0] + 400 * Math.cos(v.state.heading), h.lkp[1] + 400 * Math.sin(v.state.heading)];
      }
      return;
    }
    // Search: to the last known position, then an expanding square around it.
    v.goalSpeed = W.search;
    if (!h.legGoal) h.legGoal = h.lkp;
    if (Math.hypot(h.legGoal[0] - v.state.north, h.legGoal[1] - v.state.east) < 80) {
      h.leg++;
      const len = W.searchLeg * Math.ceil(h.leg / 2);
      const dir = ((h.leg - 1) % 4) * (Math.PI / 2);
      h.legGoal = [h.legGoal[0] + len * Math.cos(dir), h.legGoal[1] + len * Math.sin(dir)];
    }
    v.goal = h.legGoal;
  }
}
