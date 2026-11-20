/**
 * Other vessels: surface ships that follow a route at constant speed with a
 * limited rate of turn. Kinematic only (no hull physics), deterministic and
 * cheap, so the world can hold many of them.
 */
import type { Vec3 } from './math/vec3';

/** 'patrol': a corvette with a hull sonar and lookouts, which can find the submarine (control/sonar.ts). */
export type VesselKind = 'freighter' | 'ferry' | 'fishing' | 'patrol';

export interface VesselDef {
  id: string;
  /** Swedish display name. */
  name: string;
  kind: VesselKind;
  /** Length, beam and draft [m]. */
  length: number;
  beam: number;
  draft: number;
  /** Speed through the water [m/s]. */
  speed: number;
  /** Largest rate of turn [rad/s]. */
  turnRate: number;
  /** Waypoints [north, east] [m]. */
  route: [number, number][];
  /** After the last waypoint: start again from the first ('loop') or turn back along the route ('shuttle'). */
  repeat: 'loop' | 'shuttle';
  /** Shaft speed of the propeller [rev/s], for the sound. */
  propellerRps: number;
  /** Number of propeller blades. */
  blades: number;
}

export interface VesselState {
  north: number;
  east: number;
  /** Heading [rad, 0..2π]. */
  heading: number;
  speed: number;
}

const wrap = (a: number) => {
  let x = (a + Math.PI) % (2 * Math.PI);
  if (x < 0) x += 2 * Math.PI;
  return x - Math.PI;
};

/** Accept a waypoint as reached within this distance [m]. */
const ARRIVAL = 60;

export class Vessel {
  readonly state: VesselState;
  private target = 1;
  private direction: 1 | -1 = 1;

  constructor(readonly def: VesselDef) {
    const [n0, e0] = def.route[0]!;
    const [n1, e1] = def.route[1] ?? def.route[0]!;
    this.state = { north: n0, east: e0, heading: (Math.atan2(e1 - e0, n1 - n0) + 2 * Math.PI) % (2 * Math.PI), speed: def.speed };
  }

  step(dt: number): void {
    const s = this.state;
    const route = this.def.route;
    if (route.length > 1) {
      const [tn, te] = route[this.target]!;
      if (Math.hypot(tn - s.north, te - s.east) < ARRIVAL) this.nextWaypoint();
      const [an, ae] = route[this.target]!;
      const want = Math.atan2(ae - s.east, an - s.north);
      const turn = Math.max(-this.def.turnRate * dt, Math.min(this.def.turnRate * dt, wrap(want - s.heading)));
      s.heading = (s.heading + turn + 2 * Math.PI) % (2 * Math.PI);
    }
    s.north += s.speed * Math.cos(s.heading) * dt;
    s.east += s.speed * Math.sin(s.heading) * dt;
  }

  /** Position [north, east, 0] (on the surface). */
  get position(): Vec3 {
    return [this.state.north, this.state.east, 0];
  }

  private nextWaypoint(): void {
    const n = this.def.route.length;
    if (this.def.repeat === 'loop') {
      this.target = (this.target + 1) % n;
      return;
    }
    if (this.target + this.direction >= n || this.target + this.direction < 0) this.direction = this.direction === 1 ? -1 : 1;
    this.target += this.direction;
  }
}
