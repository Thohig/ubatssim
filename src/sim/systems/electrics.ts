/**
 * Batteries, diesel generators and the electrical load.
 *
 *   load = shaft power / η + hotel load + drain pump
 *   the generators (when the diesels run) cover the load and charge the battery,
 *   limited by the cells' charge acceptance; the battery covers the rest.
 *
 * The diesels need air: the boat on the surface, or the snorkel raised with
 * its head above the water. When a wave covers the head the head valve shuts
 * and the diesels run on the boat's own air for a few seconds, then stop.
 * With an empty battery the motor gets only what the generators give.
 */
import { RIGID_STATE_SIZE } from '../rigidBody';
import { propellerForces } from '../propulsion';
import { waterDensity } from '../environment';
import type { Simulation } from '../simulation';
import type { Subsystem } from './types';

/** The bridge deck must be this far above the water for the diesels to draw air through the sail [m]. */
const SURFACE_AIR_FREEBOARD = 0.3;

export class Electrics implements Subsystem {
  readonly name = 'electrics';
  /** State of charge 0…1. */
  soc: number;
  /** Generator output now [W] (ramps up after a start). */
  generator = 0;
  /** Seconds without air at the induction (0 while air comes in). */
  starved = 0;
  /** True while the diesels run. */
  dieselRunning = false;
  /** Electrical load [W] and battery power [W, positive = discharge] at the last step. */
  load = 0;
  batteryPower = 0;
  /** What the motor may take now [W, shaft]. */
  powerLimit: number;

  constructor(private readonly sim: Simulation, soc?: number) {
    this.soc = Math.min(1, Math.max(0, soc ?? sim.cfg.electrics.initialCharge));
    this.powerLimit = sim.cfg.propulsion.maxPower;
  }

  /** Air reaches the diesels now: surfaced, or the snorkel head above the water. */
  airAtInduction(): boolean {
    const sim = this.sim;
    if (sim.bodyPointDepth(sim.cfg.bridge.deck) < -SURFACE_AIR_FREEBOARD) return true;
    return sim.actuators.snorkel > 0.99 && sim.bodyPointDepth(sim.snorkelHead()) < -sim.cfg.snorkel.headClearance;
  }

  update(dt: number): void {
    const sim = this.sim;
    const e = sim.cfg.electrics;
    const p = sim.cfg.propulsion;
    const air = this.airAtInduction();
    this.starved = air ? 0 : this.starved + dt;
    const engineFlooded = sim.systems.flooding.fill('engine') > sim.cfg.damage.disableFill;
    // Running diesels ride out a wave over the snorkel head on the boat's own air; stopped ones need air to start.
    const breathing = air || (this.dieselRunning && this.starved <= sim.cfg.snorkel.airGrace);
    this.dieselRunning = sim.commands.diesel && breathing && !engineFlooded;
    this.generator = this.dieselRunning ? Math.min(e.generatorPower, this.generator + e.generatorRamp * dt) : 0;

    // The motor's power at the present state (no regeneration when it brakes).
    const n = sim.y[RIGID_STATE_SIZE]!; // the shaft speed follows the rigid-body state
    const rho = waterDensity(Math.max(0, sim.y[2]!), sim.water);
    const u = sim.kinematics().u;
    const motor = propellerForces(p, n, u, sim.commands.rps, rho, this.powerLimit).motorTorque;
    const shaft = Math.max(0, 2 * Math.PI * n * motor);
    const drain = sim.systems.flooding.drainRunning ? e.drainPumpPower : 0;
    this.load = shaft / e.motorEfficiency + e.hotelLoad + drain;

    const accept = this.soc < e.taperFrom ? 1 : 1 - ((1 - e.acceptAtFull) * (this.soc - e.taperFrom)) / (1 - e.taperFrom);
    const genUsed = Math.min(this.generator, this.load + e.generatorPower * accept);
    this.batteryPower = this.load - genUsed;
    this.soc = Math.min(1, Math.max(0, this.soc - (this.batteryPower * dt) / e.batteryCapacity));

    // An empty battery leaves the motor what the generators give beyond the other loads.
    const fromGenerators = Math.max(0, this.generator - e.hotelLoad - drain) * e.motorEfficiency;
    const f = Math.min(1, this.soc / e.lowCharge);
    let limit = fromGenerators + f * (p.maxPower - fromGenerators);
    if (sim.systems.flooding.fill('motor') > sim.cfg.damage.disableFill) limit = 0;
    this.powerLimit = Math.min(p.maxPower, limit);
  }
}
