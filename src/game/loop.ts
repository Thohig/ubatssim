/**
 * Fixed time steps from the frame clock: real time (times the time
 * compression) is accumulated and whole steps of DT are run. At most
 * `maxStepsPerFrame` × compression steps per frame, counting no more than ×4
 * (`MAX_SCALE_STEPS`): if the device cannot keep up, the backlog is dropped
 * and the game runs slower than the chosen compression instead of stalling.
 * With ×8 and ×16 a frame at 30 frames per second needs 27 and 53 steps.
 */
import { DT } from '../sim/simulation';

/** Longest frame gap counted [s] (a hidden tab or a breakpoint). */
const MAX_FRAME_GAP = 0.25;
/** The step limit grows with the compression up to this factor: ×16 at 25 frames per second, not 400 steps in one frame. */
const MAX_SCALE_STEPS = 4;

export class FixedStepLoop {
  private acc = 0;

  constructor(readonly maxStepsPerFrame = 25) {}

  /**
   * Runs the steps due after `elapsed` seconds of real time.
   * @returns the number of steps run
   */
  advance(elapsed: number, scale: number, running: boolean, step: () => void): number {
    if (running) this.acc += Math.min(MAX_FRAME_GAP, elapsed) * scale;
    const max = this.maxStepsPerFrame * Math.min(scale, MAX_SCALE_STEPS);
    let steps = 0;
    // A step is due when the accumulated time reaches DT (within rounding: 0.05 s is five steps).
    while (this.acc >= DT - 1e-9 && steps < max) {
      step();
      this.acc -= DT;
      steps++;
    }
    if (steps >= max) this.acc = 0;
    return steps;
  }
}
