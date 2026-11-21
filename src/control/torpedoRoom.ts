/**
 * The torpedo room: four bow tubes and the racks. A tube fires only when it
 * is ready: a torpedo in, the tube flooded and the muzzle door open. Each
 * step takes time (WEAPONS.tubes):
 *
 *   ready   flood the tube, then open the muzzle door (a corvette near by
 *           may hear the door)
 *   secure  shut the door, then drain the tube
 *   load    secure it if needed, then a torpedo from the racks on the
 *           loading rail (one tube at a time)
 *
 * Fired, a tube is left empty, flooded and open. The crew (duty
 * `torpedoRoom`) secures and reloads empty tubes and makes the loaded ones
 * ready once a target is marked; the player can do it all with `tube`
 * orders. Firing is always the player's order.
 *
 * The torpedoes weigh: what differs from the design loadout (all tubes
 * loaded, the racks full) goes to the simulation as point masses
 * (`Simulation.payload`), so a salvo or a reload changes the trim. The
 * water that floods a tube around a torpedo comes from, and drains back to,
 * the tanks round the tubes (WRT) and weighs the same; a fired torpedo is
 * replaced by sea water filling its tube (`tubeWater − annulusWater`),
 * which stays in those tanks. Deterministic.
 */
import { WEAPONS } from '../sim/config/weapons';
import type { PayloadMass } from '../sim/simulation';
import type { Controller } from './controller';

const W = WEAPONS.tubes;

export type TubeTask = 'flood' | 'open' | 'shut' | 'drain' | 'load';
export type TubeAction = 'ready' | 'secure' | 'load';

export interface Tube {
  /** A torpedo is in the tube. */
  loaded: boolean;
  flooded: boolean;
  /** The muzzle door is open. */
  open: boolean;
  /** Steps left to do, the first under way. */
  plan: TubeTask[];
  /** Seconds left of the step under way. */
  left: number;
  /** Seconds left of loading (0 when not loading), for the cutaway and the panels. */
  loading: number;
}

const TIME: Record<TubeTask, number> = { flood: W.floodTime, open: W.openTime, shut: W.shutTime, drain: W.drainTime, load: W.reloadTime };

/** What a tube is doing, in a word or two (panels). */
export const TASK_TEXT: Record<TubeTask, string> = { flood: 'vattenfylls', open: 'öppnar luckan', shut: 'stänger luckan', drain: 'länsas', load: 'laddas' };

/** True when the tube can fire now. */
export const isReady = (t: Tube): boolean => t.loaded && t.flooded && t.open && t.plan.length === 0;

/** A short state for a tube: "klar", "laddad", "tom", or what it is doing with the seconds left. */
export function tubeState(t: Tube): string {
  const task = t.plan[0];
  if (task) return `${TASK_TEXT[task]}, ${Math.ceil(t.left)} s`;
  if (isReady(t)) return 'klar';
  if (t.loaded) return t.open ? 'laddad, luckan öppen' : t.flooded ? 'laddad, vattenfylld' : 'laddad';
  return t.open ? 'tom, luckan öppen' : t.flooded ? 'tom, vattenfylld' : 'tom';
}

export class TorpedoRoom {
  readonly tubes: Tube[] = Array.from({ length: W.count }, () => ({ loaded: true, flooded: false, open: false, plan: [], left: 0, loading: 0 }));
  /** Torpedoes left in the racks. */
  reserve: number = W.reserve;
  /** Sea water taken in by firing [kg] (in the tanks round the tubes). */
  private seaWater = 0;
  private steps = 0;
  private payloadKey = '';

  constructor(private readonly ctrl: Controller) {}

  /** The steps for an action on a tube from its present state, or why it cannot be done. */
  planFor(i: number, action: TubeAction): TubeTask[] | string {
    const t = this.tubes[i];
    if (!t) return `Det finns ingen tub ${i + 1}.`;
    // A new order replaces the plan; a step under way is dropped (nothing has changed yet).
    const secure: TubeTask[] = [...(t.open ? (['shut'] as const) : []), ...(t.flooded ? (['drain'] as const) : [])];
    if (action === 'ready') {
      if (!t.loaded) return `Tub ${i + 1} är tom. Ladda den först.`;
      return [...(t.flooded ? [] : (['flood'] as const)), ...(t.open ? [] : (['open'] as const))];
    }
    if (action === 'secure') return secure;
    if (t.loaded) return `Tub ${i + 1} är redan laddad.`;
    if (this.reserve - this.tubes.filter((x, k) => k !== i && x.plan.includes('load')).length <= 0) return 'Inga torpeder kvar i stället.';
    return [...secure, 'load'];
  }

  /** Starts an action on a tube (check `planFor` first). */
  order(i: number, action: TubeAction): void {
    const plan = this.planFor(i, action);
    const t = this.tubes[i];
    if (!t || typeof plan === 'string') return;
    t.plan = plan;
    t.left = plan[0] ? TIME[plan[0]] : 0;
  }

  /** A torpedo left tube `i`: it stays flooded with the door open. */
  fired(i: number): void {
    const t = this.tubes[i];
    if (!t) return;
    t.loaded = false;
    t.plan = [];
    t.left = 0;
    this.seaWater += W.tubeWater - W.annulusWater;
  }

  /** Call once per simulation step. */
  update(dt: number): void {
    const c = this.ctrl;
    if (c.options.crew.torpedoRoom && this.steps % Math.round(1 / dt) === 0) this.crew();
    this.steps++;
    // The loading rail takes one torpedo at a time: the first tube waiting for it.
    const rail = this.tubes.findIndex((t) => t.plan[0] === 'load');
    this.tubes.forEach((t, i) => {
      const task = t.plan[0];
      t.loading = task === 'load' ? t.left : 0;
      if (!task || (task === 'load' && i !== rail)) return;
      t.left -= dt;
      if (t.left > 0) return;
      this.done(i, task);
      t.plan.shift();
      t.left = t.plan[0] ? TIME[t.plan[0]] : 0;
      t.loading = 0;
      if (isReady(t)) c.addLog(`Tub ${i + 1} klar.`, 'info');
    });
    this.updatePayload();
  }

  private done(i: number, task: TubeTask): void {
    const t = this.tubes[i]!;
    const c = this.ctrl;
    if (task === 'flood') t.flooded = true;
    else if (task === 'drain') t.flooded = false;
    else if (task === 'shut') t.open = false;
    else if (task === 'open') {
      t.open = true;
      c.hunter.heard(W.doorNoise, 0.1, 0.3, false);
    } else {
      t.loaded = true;
      this.reserve--;
      c.addLog(`Tub ${i + 1} laddad.${this.reserve === 0 ? ' Stället är tomt.' : ''}`, 'info');
    }
  }

  /** The crew: empty tubes are secured and reloaded; with a target marked, loaded tubes are made ready. */
  private crew(): void {
    const target = this.ctrl.fire.current !== null;
    this.tubes.forEach((t, i) => {
      if (t.plan.length) return;
      if (!t.loaded) {
        const plan = this.planFor(i, 'load');
        if (typeof plan !== 'string') this.order(i, 'load');
        else if (t.open || t.flooded) this.order(i, 'secure');
      } else if (target && !isReady(t)) this.order(i, 'ready');
    });
  }

  /** What differs from the design loadout, as point masses in the simulation (only when it changes). */
  private updatePayload(): void {
    const masses: PayloadMass[] = [];
    this.tubes.forEach((t, i) => {
      if (!t.loaded) masses.push({ m: -W.torpedoMass, r: [W.tubeX, W.tubeY[Math.floor(i / 2)] ?? 0, W.tubeZ[i % 2] ?? 0] });
    });
    const rack = (this.reserve - W.reserve) * W.torpedoMass;
    if (rack !== 0) masses.push({ m: rack, r: [...W.rack] });
    if (this.seaWater !== 0) masses.push({ m: this.seaWater, r: [...W.wrt] });
    const key = masses.map((x) => `${x.m}@${x.r.join(',')}`).join(';');
    if (key === this.payloadKey) return;
    this.payloadKey = key;
    this.ctrl.sim.payload = masses;
  }
}
