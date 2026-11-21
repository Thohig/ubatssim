/**
 * Wire guidance: a torpedo stays connected to the boat by its wire after
 * the launch, and the fire control can steer it:
 *
 *   update  aim it again at its target's present solution: a new gyro
 *           course from where it is now, and the seeker wakes `seekBefore`
 *           short of the new intercept point (the solution got better after
 *           the shot)
 *   seek    wake the seeker now
 *   course  a new gyro course [deg]
 *   cut     cut the wire (it runs on, on its own)
 *
 * The wire parts when the boat goes faster than `wireSpeed` for
 * `wireGrace` seconds, or turns more than `wireTurn` from its heading at
 * the launch. Deterministic.
 */
import { WEAPONS } from '../sim/config/weapons';
import { interceptTime, type Torpedo } from '../sim/torpedo';
import { solutionAt, type Solution } from './fireControl';
import type { Controller } from './controller';

const T = WEAPONS.torpedo;

const wrap = (a: number) => {
  let x = (a + Math.PI) % (2 * Math.PI);
  if (x < 0) x += 2 * Math.PI;
  return x - Math.PI;
};

interface WireLink {
  /** The target it was fired at (M1 …). */
  target: string;
  /** The boat's heading at the launch [rad]. */
  heading: number;
  /** Seconds the boat has gone too fast. */
  fast: number;
}

export type WireAction = 'update' | 'seek' | 'course' | 'cut';

export class WireGuidance {
  private readonly links = new Map<number, WireLink>();

  constructor(private readonly ctrl: Controller) {}

  /** A torpedo just fired at a target (label). */
  launched(t: Torpedo, target: string): void {
    this.links.set(t.state.id, { target, heading: this.ctrl.sim.kinematics().heading, fast: 0 });
  }

  /** The torpedoes still on their wire, oldest first. */
  wired(): Torpedo[] {
    return this.ctrl.world.torpedoes.filter((t) => t.state.wired && t.state.phase !== 'done');
  }

  /** The target label a torpedo was fired at. */
  targetOf(id: number): string | null {
    return this.links.get(id)?.target ?? null;
  }

  /** Why an action cannot be done, or null. */
  refusal(id: number, action: WireAction): string | null {
    const t = this.ctrl.world.torpedoes.find((x) => x.state.id === id);
    if (!t || t.state.phase === 'done') return `Torped ${id} är inte i vattnet.`;
    if (!t.state.wired) return `Torped ${id} har ingen tråd.`;
    if (action === 'update') {
      const label = this.targetOf(id);
      const target = this.ctrl.fire.targets.find((x) => x.label === label);
      if (!target?.solution) return `Ingen lösning på ${label ?? 'målet'}.`;
      if (!this.aimFrom(t, target.solution)) return `Torped ${id} hinner inte ikapp ${label}.`;
    }
    return null;
  }

  /** Carries out an action (check `refusal` first); returns a line for the log. */
  act(id: number, action: WireAction, courseDeg?: number): string {
    const t = this.ctrl.world.torpedoes.find((x) => x.state.id === id)!;
    const o = t.orders;
    if (action === 'cut') {
      t.state.wired = false;
      return `Tråden till torped ${id} kapad. Den går vidare på egen hand.`;
    }
    if (action === 'seek') {
      o.seekAfter = Math.min(o.seekAfter, t.state.run);
      return `Torped ${id} söker nu.`;
    }
    if (action === 'course') {
      o.course = ((((courseDeg ?? 0) % 360) + 360) % 360) * (Math.PI / 180);
      return `Torped ${id} på ny kurs ${deg3(o.course)}.`;
    }
    const target = this.ctrl.fire.targets.find((x) => x.label === this.targetOf(id))!;
    const aim = this.aimFrom(t, target.solution!)!;
    o.course = aim.course;
    o.seekAfter = Math.max(t.state.run, t.state.run + aim.distance - T.seekBefore);
    return `Torped ${id} styrd mot ${target.label}: kurs ${deg3(aim.course)}, ${Math.round(aim.time)} s kvar.`;
  }

  /** The intercept from the torpedo's position now, or null. */
  private aimFrom(t: Torpedo, s: Solution): { course: number; distance: number; time: number } | null {
    const p = solutionAt(s, this.ctrl.sim.t);
    const from: [number, number] = [t.state.north, t.state.east];
    const time = interceptTime(from, p, s.velocity, T.speed);
    if (time === null) return null;
    const at: [number, number] = [p[0] + s.velocity[0] * time, p[1] + s.velocity[1] * time];
    const distance = Math.hypot(at[0] - from[0], at[1] - from[1]);
    if (t.state.run + distance > T.range) return null;
    return { course: (Math.atan2(at[1] - from[1], at[0] - from[0]) + 2 * Math.PI) % (2 * Math.PI), distance, time };
  }

  /** Call once per step: the wires part when the boat goes too fast or turns too far. */
  update(dt: number): void {
    if (this.links.size === 0) return;
    const c = this.ctrl;
    const k = c.sim.kinematics();
    for (const t of c.world.torpedoes) {
      const link = this.links.get(t.state.id);
      if (!link || !t.state.wired) continue;
      if (t.state.phase === 'done') {
        t.state.wired = false;
        continue;
      }
      link.fast = Math.abs(k.u) > T.wireSpeed ? link.fast + dt : 0;
      const turned = Math.abs(wrap(k.heading - link.heading)) > T.wireTurn;
      if (link.fast > T.wireGrace || turned) {
        t.state.wired = false;
        c.addLog(`Tråden till torped ${t.state.id} har gått av (${turned ? 'ubåten svängde för långt' : 'för hög fart'}).`, 'error');
      }
    }
    for (const id of [...this.links.keys()]) if (!c.world.torpedoes.some((t) => t.state.id === id)) this.links.delete(id);
  }
}

const deg3 = (rad: number) => `${String(Math.round(((rad * 180) / Math.PI + 360) % 360) % 360).padStart(3, '0')}°`;
