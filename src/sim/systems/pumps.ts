/** Trim pump (between the trim tanks) and compensating pump (to and from the sea). */
import type { Simulation } from '../simulation';
import type { Subsystem } from './types';

export class Pumps implements Subsystem {
  readonly name = 'pumps';
  /** Remaining trim transfer [m^3], positive = aft → forward. */
  trimRemaining = 0;
  /** Remaining compensating transfer [m^3], positive = flood from sea. */
  compRemaining = 0;

  constructor(private readonly sim: Simulation) {}

  update(dt: number): void {
    const sim = this.sim;
    const fwd = sim.tankById('trim_fwd');
    const aft = sim.tankById('trim_aft');
    if (fwd && aft && this.trimRemaining !== 0) {
      const dir = Math.sign(this.trimRemaining);
      const [from, to] = dir > 0 ? [aft, fwd] : [fwd, aft];
      const room = to.def.volume - to.s.water;
      const dv = Math.min(sim.cfg.pumps.trimRate * dt, Math.abs(this.trimRemaining), from.s.water, room);
      from.s.water -= dv;
      to.s.water += dv;
      this.trimRemaining -= dir * dv;
      if (dv <= 0 || Math.abs(this.trimRemaining) < 1e-9) this.trimRemaining = 0;
    }

    const comp = sim.tankById('comp');
    if (comp && this.compRemaining !== 0) {
      const dir = Math.sign(this.compRemaining);
      const limit = dir > 0 ? comp.def.volume - comp.s.water : comp.s.water;
      const dv = Math.min(sim.cfg.pumps.compRate * dt, Math.abs(this.compRemaining), limit);
      comp.s.water += dir * dv;
      this.compRemaining -= dir * dv;
      if (dv <= 0 || Math.abs(this.compRemaining) < 1e-9) this.compRemaining = 0;
    }
  }
}
