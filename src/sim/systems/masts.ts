/**
 * Drag of the wetted part of a raised mast (periscope or snorkel: a circular
 * cylinder, cross-flow in surge and sway), applied at the middle of the
 * wetted length.
 */
import { waterDensity } from '../environment';
import { mat3MulVec } from '../math/mat';
import type { Simulation } from '../simulation';
import type { ForceContext, Subsystem } from './types';

export type MastId = 'periscope' | 'snorkel';

export class Mast implements Subsystem {
  readonly name: string;

  constructor(
    private readonly sim: Simulation,
    readonly mast: MastId,
  ) {
    this.name = `${mast}Mast`;
  }

  forces({ pos, R, nuR: nu }: ForceContext, tau: Float64Array): void {
    const sim = this.sim;
    const ext = sim.actuators[this.mast];
    if (ext <= 0) return;
    const p = sim.cfg[this.mast];
    const base = p.base;
    const len = p.extension * ext;
    const wave = sim.surface ? sim.surface(pos[0] + R[0] * base[0], pos[1] + R[3] * base[0]) : 0;
    const depthOf = (z: number) => pos[2] + mat3MulVec(R, [base[0], base[1], z])[2] + wave;
    const dFoot = depthOf(base[2]);
    const dHead = depthOf(base[2] - len);
    if (dFoot <= 0) return; // the whole mast is in the air
    const wetFrac = dHead >= 0 ? 1 : dFoot / (dFoot - dHead);
    const wet = len * wetFrac;
    const zMid = base[2] - wet / 2;
    const k = 0.5 * waterDensity(Math.max(0, dFoot), sim.water) * p.dragCoefficient * p.diameter * wet;
    const u = nu[0]! + nu[4]! * zMid; // local surge speed: u + q·z
    const v = nu[1]! - nu[3]! * zMid + nu[5]! * base[0]; // local sway: v − p·z + r·x
    const X = -k * u * Math.abs(u);
    const Y = -k * v * Math.abs(v);
    tau[0]! += X;
    tau[1]! += Y;
    tau[3]! += -zMid * Y; // K = y·Z − z·Y
    tau[4]! += zMid * X; // M = z·X − x·Z
    tau[5]! += base[0] * Y; // N = x·Y − y·X
  }
}
