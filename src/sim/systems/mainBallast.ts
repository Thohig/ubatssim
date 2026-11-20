/** Main ballast tanks and the high-pressure air: vents, blowing, the low-pressure blower. */
import { airForFill, updateMainBallast } from '../airSystem';
import { waterDensity } from '../environment';
import type { Simulation } from '../simulation';
import type { TankState } from '../tanks';
import type { Subsystem } from './types';

export class MainBallast implements Subsystem {
  readonly name = 'mainBallast';

  constructor(private readonly sim: Simulation) {}

  update(dt: number): void {
    const sim = this.sim;
    sim.tankDefs.forEach((def, i) => {
      if (def.kind !== 'mainBallast') return;
      const s = sim.tanks[i]!;
      const d = sim.tankWorldDepths(def);
      updateMainBallast(def, s, sim.air, sim.cfg.air, d.bottom, d.top, waterDensity(Math.max(0, d.centre), sim.water), dt, sim.water, sim.commands.lpBlower);
    });
  }

  setVents(open: boolean, ids?: string[]): void {
    this.forTanks(ids, (s) => {
      s.ventOpen = open;
      if (open) s.blowOpen = false;
    });
  }

  setBlow(open: boolean, ids?: string[]): void {
    this.forTanks(ids, (s) => {
      s.blowOpen = open;
      if (open) s.ventOpen = false;
    });
  }

  /** Sets every main ballast tank to a fill fraction with consistent air content (start conditions). */
  setFill(fill: number): void {
    const sim = this.sim;
    sim.tankDefs.forEach((def, i) => {
      if (def.kind !== 'mainBallast') return;
      const s = sim.tanks[i]!;
      const d = sim.tankWorldDepths(def);
      s.water = fill * def.volume;
      s.airPV = airForFill(def, fill, d.bottom, d.top, waterDensity(Math.max(0, d.centre), sim.water), sim.water);
    });
  }

  private forTanks(ids: string[] | undefined, fn: (s: TankState) => void): void {
    this.sim.tankDefs.forEach((def, i) => {
      if (def.kind === 'mainBallast' && (!ids || ids.includes(def.id))) fn(this.sim.tanks[i]!);
    });
  }
}
