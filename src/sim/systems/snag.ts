/**
 * Caught in a trawl. A fishing boat may tow a trawl net behind it
 * (`VesselDef.trawl`); a boat that runs into the net is held: the net and
 * its wires drag hard against going ahead (a quadratic and a linear term on
 * the surge speed through the water). Going astern for `SNAG.release`
 * seconds slips the net off. The world (world.ts) catches the boat; this
 * subsystem holds it and lets go.
 */
import { SNAG } from '../config/hazards';
import type { Simulation } from '../simulation';
import type { ForceContext, Subsystem } from './types';

export class Snag implements Subsystem {
  readonly name = 'snag';
  /** The vessel whose trawl holds the boat, or null. */
  holder: string | null = null;
  /** Seconds the held boat has gone astern. */
  private astern = 0;

  constructor(private readonly sim: Simulation) {}

  /** Caught in a vessel's trawl. */
  catch(vesselId: string): void {
    if (this.holder !== null) return;
    this.holder = vesselId;
    this.astern = 0;
  }

  /** The net is gone (the trawler cut it, or it sank). */
  release(): void {
    this.holder = null;
    this.astern = 0;
  }

  update(dt: number): void {
    if (this.holder === null) return;
    // Surge speed over the ground is close enough to tell ahead from astern.
    if (this.sim.y[7]! < -SNAG.asternSpeed) this.astern += dt;
    else this.astern = Math.max(0, this.astern - dt);
    if (this.astern >= SNAG.release) this.release();
  }

  forces({ nuR }: ForceContext, tau: Float64Array): void {
    if (this.holder === null) return;
    const u = nuR[0]!;
    if (u <= 0) return;
    tau[0]! -= SNAG.quadratic * u * u + SNAG.linear * u;
  }
}
