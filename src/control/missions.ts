/**
 * Optional missions by radio. Deterministic, once a second. With missions
 * on (the player's choice when the patrol starts), an order comes in over
 * the radio when one is due and the boat has an antenna above the water
 * (the periscope, the snorkel, the radar mast, or surfaced): one at a time,
 * each with a time limit. Missions are optional: one that is not done in
 * time, or is spoilt by a hunt, only goes out with a line in the log, and
 * the next one comes a while later. The kinds follow the threat level and
 * the area's patrol routes (areas.ts):
 *
 *   recce    go to a point on a shipping lane and look with the periscope
 *   attack   (war) sink a ship in the convoy
 *   transit  go to a point without a corvette hunting the boat on the way
 *   charge   charge the battery
 */
import type { AreaId } from '../sim/config/areas';
import { DT, type Telemetry } from '../sim/simulation';
import { AREA_INFO } from './areas';
import type { Controller } from './controller';
import type { ThreatId } from './patrol';

export type MissionKind = 'recce' | 'attack' | 'transit' | 'charge';

export interface Mission {
  kind: MissionKind;
  /** The radio order (log). */
  order: string;
  /** Short goal for the mission bar. */
  goal: string;
  /** The point to go to [north, east], if any (the buoy). */
  waypoint: [number, number] | null;
  /** Sim time it came in and by when it must be done [s]. */
  start: number;
  deadline: number;
}

export const MISSIONS = {
  /** First mission due this long after the start [s], then this long after the last one ended. */
  firstAt: 300,
  gap: 900,
  /** Time limit [s]. */
  limit: 7200,
  /** Recce: within this distance [m] of the point with the periscope up for `recceHold` s. */
  recceRange: 4000,
  recceHold: 30,
  /** Transit: within this distance [m] of the point. */
  transitRange: 500,
  /** Charge: to this state of charge, or this much more than at the start, whichever is lower; not above `chargeSkip`. */
  chargeTo: 0.98,
  chargeGain: 0.2,
  chargeSkip: 0.93,
  /** Attack: the convoy's position comes by radio this often [s] (the buoy), while an antenna is up. */
  convoyReport: 600,
};

const ORDER: Record<ThreatId, MissionKind[]> = {
  peace: ['recce', 'transit', 'charge'],
  tension: ['recce', 'transit', 'charge', 'recce'],
  war: ['recce', 'attack', 'transit', 'charge'],
};

/** The ships of the convoy at war (patrol.ts). */
const CONVOY = ['lastaren', 'balder'];

const mid = (route: [number, number][]): [number, number] => {
  const a = route[0]!;
  const b = route[route.length - 1]!;
  return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
};

const bearingName = (from: [number, number], to: [number, number]): string => {
  const deg = (((Math.atan2(to[1] - from[1], to[0] - from[0]) * 180) / Math.PI) + 360) % 360;
  return ['norr', 'nordost', 'öster', 'sydost', 'söder', 'sydväst', 'väster', 'nordväst'][Math.round(deg / 45) % 8]!;
};

const km = (m: number) => (m / 1000).toFixed(1).replace('.', ',');

export class Missions {
  current: Mission | null = null;
  done = 0;
  missed = 0;
  private issued = 0;
  private nextAt: number = MISSIONS.firstAt;
  private held = 0;
  private hunted = false;
  private chargeGoal = 1;
  private waitingLogged = false;
  private steps = 0;

  constructor(
    private readonly ctrl: Controller,
    readonly area: AreaId,
    readonly threat: ThreatId,
    readonly enabled: boolean,
  ) {}

  /** True if the boat can hear the radio: an antenna or the bridge above the water. */
  static hearsRadio(t: Telemetry, c: Controller): boolean {
    return t.bridgeDeckDepth < 0 || (t.periscope > 0.99 && t.periscopeHeadDepth < 0) || (t.snorkel > 0.99 && t.snorkelHeadDepth < 0) || c.radar.antennaHeight() > 0;
  }

  /** Call once per simulation step; works once a second. */
  update(): void {
    if (!this.enabled || this.steps++ % Math.round(1 / DT) !== 0) return;
    const c = this.ctrl;
    const now = c.sim.t;
    const t = c.sim.telemetry();
    const m = this.current;
    if (!m) {
      // Not in the middle of a hunt: a transit came in and was called off in the same second.
      if (now < this.nextAt || c.hunter.hunting) return;
      if (!Missions.hearsRadio(t, c)) {
        if (!this.waitingLogged) c.addLog('Radio: ett meddelande väntar. Gå upp till periskopdjup och hissa en mast för att ta emot det.', 'info');
        this.waitingLogged = true;
        return;
      }
      this.issue(now, t);
      return;
    }
    if (c.hunter.hunting) this.hunted = true;
    if (m.kind === 'attack' && now - this.reportedAt >= MISSIONS.convoyReport && Missions.hearsRadio(t, c)) {
      this.reportedAt = now;
      const at = this.convoyAt();
      if (at) {
        m.waypoint = at;
        c.addLog(`Radio: konvojen är nu ${km(Math.hypot(at[0] - t.position[0], at[1] - t.position[1]))} km ${bearingName([t.position[0], t.position[1]], at)} om dig. Bojen flyttad.`, 'info');
      }
    }
    if (this.met(m, t)) return this.end(`Uppdrag utfört: ${m.goal}.`, true);
    if (m.kind === 'transit' && this.hunted) return this.end('Uppdraget avbrutet: korvetterna jagar dig. Inget straff, ett nytt kommer senare.', false);
    if (now > m.deadline) this.end(`Uppdraget gick ut: ${m.goal}. Inget straff, ett nytt kommer senare.`, false);
  }

  private met(m: Mission, t: Telemetry): boolean {
    const c = this.ctrl;
    const dist = m.waypoint ? Math.hypot(m.waypoint[0] - t.position[0], m.waypoint[1] - t.position[1]) : Infinity;
    switch (m.kind) {
      case 'recce': {
        const looking = t.periscope > 0.99 && t.periscopeHeadDepth < 0 && dist < MISSIONS.recceRange;
        this.held = looking ? this.held + 1 : 0;
        return this.held >= MISSIONS.recceHold;
      }
      case 'attack':
        return c.world.vessels.some((v) => CONVOY.includes(v.def.id) && v.state.sinking && !this.sunkBefore.has(v.def.id));
      case 'transit':
        return dist < MISSIONS.transitRange;
      case 'charge':
        return t.battery >= this.chargeGoal;
    }
  }

  private sunkBefore = new Set<string>();
  private reportedAt = 0;

  /** Where the convoy's first ship afloat is (the radio's report), or null. */
  private convoyAt(): [number, number] | null {
    const v = this.ctrl.world.vessels.find((x) => CONVOY.includes(x.def.id) && !x.state.sinking);
    return v ? [v.state.north, v.state.east] : null;
  }

  private issue(now: number, t: Telemetry): void {
    const c = this.ctrl;
    const p = AREA_INFO[this.area].patrol;
    const here: [number, number] = [t.position[0], t.position[1]];
    const order = ORDER[this.threat];
    let kind = order[this.issued % order.length]!;
    const convoyLeft = c.world.vessels.some((v) => CONVOY.includes(v.def.id) && !v.state.sinking);
    if (kind === 'attack' && !convoyLeft) kind = 'recce';
    // With the battery nearly full there is nothing to charge (above 0,85 it came almost never: a patrol at 6 knots uses ~4 % an hour).
    if (kind === 'charge' && t.battery > MISSIONS.chargeSkip) kind = 'recce';
    const n = this.issued++;
    let waypoint: [number, number] | null = null;
    let text: string;
    let goal: string;
    const limit = `${Math.round(MISSIONS.limit / 3600)} timmar`;
    if (kind === 'recce') {
      // A lane the boat is not already watching: one within range was done in half a minute.
      const lanes = p.lanes.map((_, i) => mid(p.lanes[(n + i) % p.lanes.length]!));
      const far = (w: [number, number]) => Math.hypot(w[0] - here[0], w[1] - here[1]);
      waypoint = lanes.find((w) => far(w) > MISSIONS.recceRange) ?? lanes.reduce((a, b) => (far(b) > far(a) ? b : a));
      const d = far(waypoint);
      text = `Spana efter trafik i farleden ${km(d)} km ${bearingName(here, waypoint)} om dig: gå inom ${km(MISSIONS.recceRange)} km från bojen och titta med periskopet en halv minut. Inom ${limit}.`;
      goal = 'spana i farleden (bojen)';
    } else if (kind === 'attack') {
      this.sunkBefore = new Set(c.world.vessels.filter((v) => v.state.sinking).map((v) => v.def.id));
      // The buoy at the convoy's position as reported, again every `convoyReport` s while an antenna is up.
      waypoint = this.convoyAt() ?? mid(p.convoy);
      this.reportedAt = now;
      const d = Math.hypot(waypoint[0] - here[0], waypoint[1] - here[1]);
      text = `Konvojen är ${km(d)} km ${bearingName(here, waypoint)} om dig (bojen). Sänk ett av lastfartygen. Inom ${limit}.`;
      goal = 'sänk ett fartyg i konvojen (bojen: senaste läget)';
    } else if (kind === 'transit') {
      waypoint = mid(p.convoy);
      const d = Math.hypot(waypoint[0] - here[0], waypoint[1] - here[1]);
      text = `Gå till mötespunkten ${km(d)} km ${bearingName(here, waypoint)} om dig utan att bli jagad på vägen. Inom ${limit}.`;
      goal = 'mötespunkten osedd (bojen)';
    } else {
      this.chargeGoal = Math.min(MISSIONS.chargeTo, t.battery + MISSIONS.chargeGain);
      text = `Ladda batteriet till ${Math.round(this.chargeGoal * 100)} % med dieslarna. Inom ${limit}.`;
      goal = `batteriet till ${Math.round(this.chargeGoal * 100)} %`;
    }
    this.current = { kind, order: text, goal, waypoint, start: now, deadline: now + MISSIONS.limit };
    this.held = 0;
    this.hunted = false;
    this.waitingLogged = false;
    c.addLog(`Radio: ${text}`, 'info');
  }

  private end(text: string, done: boolean): void {
    if (done) this.done++;
    else this.missed++;
    this.current = null;
    this.nextAt = this.ctrl.sim.t + MISSIONS.gap;
    this.ctrl.addLog(text, 'info');
  }
}
