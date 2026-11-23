/**
 * The HP air compressors: they refill the air bottles while air reaches the
 * induction (surfaced, or snorkelling with the head above the water), up to
 * the bottles' working pressure. The compressors draw power from the
 * electrics while they run. With full bottles they stand still, so a boat that
 * never blows counts exactly as before.
 */
import type { Simulation } from '../simulation';
import type { Subsystem } from './types';

export class Compressor implements Subsystem {
  readonly name = 'compressor';
  /** True while the compressors run (read by the electrics as part of the load). */
  running = false;

  constructor(private readonly sim: Simulation) {}

  /** Bottle pressure the compressors fill to [Pa]. */
  get fullPressure(): number {
    return this.sim.cfg.air.bottlePressure;
  }

  update(dt: number): void {
    const sim = this.sim;
    const a = sim.cfg.air;
    const full = a.bottlePressure * a.bottleVolume;
    this.running = false;
    if (sim.air.bottlePV >= full) return;
    if (!sim.systems.electrics.airAtInduction()) return;
    if (sim.systems.flooding.fill('engine') > sim.cfg.damage.disableFill) return;
    this.running = true;
    sim.air.bottlePV = Math.min(full, sim.air.bottlePV + a.compressorRate * dt);
  }
}
