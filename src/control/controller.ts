/**
 * Glue between orders, autopilot and the simulation. One call to `step()`
 * advances the whole system by one fixed time step:
 *   drain order queue → update setpoints/manual commands → autopilot →
 *   write plant commands → sim.step()
 */
import type { Simulation } from '../sim/simulation';
import { DT } from '../sim/simulation';
import { Autopilot, type AutopilotInput } from './autopilot';
import { OrderQueue } from './orderQueue';
import { acknowledgement, type Order, type OrderSource, type TankGroup } from './orders';

const DEG = Math.PI / 180;
const KNOT = 1852 / 3600;

export type LogKind = 'ack' | 'error' | 'info';

export interface LogEntry {
  /** Simulation time [s]. */
  t: number;
  text: string;
  kind: LogKind;
  source?: OrderSource;
}

/** Formats simulation time as [hh:mm:ss]. */
export function formatSimTime(t: number): string {
  const s = Math.floor(t);
  const hh = String(Math.floor(s / 3600)).padStart(2, '0');
  const mm = String(Math.floor((s % 3600) / 60)).padStart(2, '0');
  const ss = String(s % 60).padStart(2, '0');
  return `${hh}:${mm}:${ss}`;
}

export interface AutopilotState {
  depth: boolean;
  heading: boolean;
  speed: boolean;
}

export class Controller {
  readonly queue = new OrderQueue();
  readonly autopilot = new Autopilot();
  readonly log: LogEntry[] = [];
  private listeners: ((e: LogEntry) => void)[] = [];

  /** Setpoints in operator units: m, degrees, knots. */
  setpoints = { depth: 0, heading: 0, speed: 0 };
  ap: AutopilotState = { depth: false, heading: false, speed: false };
  /** Manual commands in operator units: degrees and rpm. */
  manual = { rudder: 0, planes: 0, rpm: 0 };
  private rpsCmd = 0;

  constructor(readonly sim: Simulation) {
    const tel = sim.telemetry();
    this.setpoints = { depth: Math.round(tel.depth), heading: Math.round(tel.heading / DEG) % 360, speed: 0 };
    this.manual.rpm = (sim.commands.rps * 60);
    this.rpsCmd = sim.commands.rps;
  }

  onLog(fn: (e: LogEntry) => void): void {
    this.listeners.push(fn);
  }

  addLog(text: string, kind: LogKind, source?: OrderSource): void {
    const e: LogEntry = { t: this.sim.t, text, kind, source };
    this.log.push(e);
    if (this.log.length > 500) this.log.shift();
    for (const fn of this.listeners) fn(e);
  }

  submit(order: Order, source: OrderSource): void {
    this.queue.push(order, source);
  }

  step(): void {
    for (const { order, source } of this.queue.drain()) {
      this.apply(order);
      this.addLog(acknowledgement(order), 'ack', source);
    }
    const sim = this.sim;
    const tel = sim.telemetry();
    const input: AutopilotInput = {
      depth: tel.depth,
      depthRate: tel.depthRate,
      pitch: tel.pitch,
      pitchRate: tel.q,
      heading: tel.heading,
      yawRate: tel.r,
      speed: tel.u,
    };

    sim.commands.sternPlanes = this.ap.depth ? this.autopilot.planes(this.setpoints.depth, input, DT) : this.manual.planes * DEG;
    sim.commands.rudder = this.ap.heading ? this.autopilot.rudder(this.setpoints.heading * DEG, input, DT) : this.manual.rudder * DEG;

    const maxRps = sim.cfg.propulsion.maxRps;
    let target: number;
    if (this.ap.speed) {
      const v = this.setpoints.speed * KNOT;
      const ff = Math.sign(v) * sim.rpsForSpeed(Math.abs(v));
      target = this.autopilot.rps(v, ff, input, DT);
    } else {
      target = this.manual.rpm / 60;
    }
    target = Math.max(-maxRps, Math.min(maxRps, target));
    const slew = this.autopilot.tuning.rpsSlew * DT;
    this.rpsCmd += Math.max(-slew, Math.min(slew, target - this.rpsCmd));
    sim.commands.rps = this.rpsCmd;

    sim.step();
  }

  private apply(o: Order): void {
    const sim = this.sim;
    const tel = sim.telemetry();
    switch (o.kind) {
      case 'setDepth':
        if (!this.ap.depth) this.resetDepthLoops();
        this.setpoints.depth = o.depth;
        this.ap.depth = true;
        break;
      case 'setHeading':
        if (!this.ap.heading) this.autopilot.headingPid.reset();
        this.setpoints.heading = o.heading;
        this.ap.heading = true;
        break;
      case 'setSpeed':
        this.setpoints.speed = o.knots;
        this.ap.speed = true;
        break;
      case 'adjustSpeed': {
        const base = this.ap.speed ? this.setpoints.speed : Math.round(tel.u / KNOT);
        this.setpoints.speed = Math.max(-6, Math.min(20, base + o.deltaKnots));
        this.ap.speed = true;
        break;
      }
      case 'setRpm':
        this.manual.rpm = o.rpm;
        this.ap.speed = false;
        break;
      case 'rudder': {
        const current = this.ap.heading ? sim.commands.rudder / DEG : this.manual.rudder;
        const max = sim.cfg.actuators.rudderMax / DEG;
        this.manual.rudder = Math.max(-max, Math.min(max, o.relative ? Math.round(current + o.angle) : o.angle));
        this.ap.heading = false;
        break;
      }
      case 'planes': {
        const current = this.ap.depth ? sim.commands.sternPlanes / DEG : this.manual.planes;
        const max = sim.cfg.actuators.planesMax / DEG;
        this.manual.planes = Math.max(-max, Math.min(max, o.relative ? Math.round(current + o.angle) : o.angle));
        this.ap.depth = false;
        break;
      }
      case 'mainBallast': {
        const ids = groupIds(o.group);
        if (o.action === 'flood') sim.setVents(true, ids);
        else if (o.action === 'blow') sim.setBlow(true, ids);
        else {
          sim.setVents(false, ids);
          sim.setBlow(false, ids);
        }
        break;
      }
      case 'trim':
        sim.requestTrimTransfer(o.litres / 1000);
        break;
      case 'compensate':
        sim.requestCompensation(o.litres / 1000);
        break;
      case 'autopilot': {
        const axes = o.axis === 'all' ? (['depth', 'heading', 'speed'] as const) : ([o.axis] as const);
        for (const axis of axes) {
          if (o.on && !this.ap[axis]) {
            if (axis === 'depth') {
              this.setpoints.depth = Math.round(tel.depth);
              this.resetDepthLoops();
            } else if (axis === 'heading') {
              this.setpoints.heading = Math.round(tel.heading / DEG) % 360;
              this.autopilot.headingPid.reset();
            } else {
              this.setpoints.speed = Math.round(tel.u / KNOT);
              this.autopilot.speedPid.reset();
            }
          }
          if (!o.on) {
            // Hand over without a jump: keep the last automatic command.
            if (axis === 'depth' && this.ap.depth) this.manual.planes = Math.round(sim.commands.sternPlanes / DEG);
            if (axis === 'heading' && this.ap.heading) this.manual.rudder = Math.round(sim.commands.rudder / DEG);
            if (axis === 'speed' && this.ap.speed) this.manual.rpm = Math.round(this.rpsCmd * 60);
          }
          this.ap[axis] = o.on;
        }
        break;
      }
    }
  }

  private resetDepthLoops(): void {
    this.autopilot.depthPid.reset();
    this.autopilot.pitchPid.reset();
  }
}

function groupIds(g: TankGroup): string[] | undefined {
  return g === 'fwd' ? ['mbt_fwd'] : g === 'aft' ? ['mbt_aft'] : undefined;
}
