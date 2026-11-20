/** Rudder, stern planes, shaft speed limits and the periscope hoist: they follow their commands at limited rates. */
import type { Simulation } from '../simulation';
import type { Subsystem } from './types';

export interface ActuatorState {
  /** Rudder and stern plane angles [rad]. */
  rudder: number;
  sternPlanes: number;
  /** Periscope extension 0 (housed) … 1 (raised). */
  periscope: number;
}

export class Actuators implements Subsystem {
  readonly name = 'actuators';
  readonly state: ActuatorState = { rudder: 0, sternPlanes: 0, periscope: 0 };

  constructor(private readonly sim: Simulation) {}

  update(dt: number): void {
    const { cfg, commands } = this.sim;
    const a = cfg.actuators;
    const maxStep = a.slewRate * dt;
    const move = (cur: number, cmd: number, lim: number) => {
      const target = Math.max(-lim, Math.min(lim, cmd));
      return cur + Math.max(-maxStep, Math.min(maxStep, target - cur));
    };
    this.state.rudder = move(this.state.rudder, commands.rudder, a.rudderMax);
    this.state.sternPlanes = move(this.state.sternPlanes, commands.sternPlanes, a.planesMax);
    const p = cfg.propulsion;
    commands.rps = Math.max(-p.maxRps, Math.min(p.maxRps, commands.rps));
    const mastStep = dt / cfg.periscope.raiseTime;
    const mastTarget = commands.periscopeUp ? 1 : 0;
    this.state.periscope += Math.max(-mastStep, Math.min(mastStep, mastTarget - this.state.periscope));
  }
}
