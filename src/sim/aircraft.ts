/**
 * Aircraft: a maritime patrol aircraft flying a search pattern. Kinematic
 * and deterministic: a route in a loop at a fixed height and speed with a
 * limited rate of turn. What it sees (masts, a surfaced boat) is worked out
 * in the control layer (control/lookouts.ts).
 */
export interface AircraftDef {
  id: string;
  /** Swedish display name ("spaningsplanet Örnen"). */
  name: string;
  /** Waypoints [north, east] [m], flown in a loop. */
  route: [number, number][];
  /** Height above the sea [m] and speed [m/s]. */
  altitude: number;
  speed: number;
  /** Largest rate of turn [rad/s]. */
  turnRate: number;
  /** Seconds after the start before it arrives over the first waypoint (0 = there from the start). */
  arrives?: number;
}

export interface AircraftState {
  north: number;
  east: number;
  altitude: number;
  heading: number;
  /** In the air over the area (false before it arrives). */
  present: boolean;
}

const ARRIVAL = 300;

const wrap = (a: number) => {
  let x = (a + Math.PI) % (2 * Math.PI);
  if (x < 0) x += 2 * Math.PI;
  return x - Math.PI;
};

export class Aircraft {
  readonly state: AircraftState;
  private target = 1;
  private t = 0;

  constructor(readonly def: AircraftDef) {
    const [n0, e0] = def.route[0]!;
    const [n1, e1] = def.route[1] ?? def.route[0]!;
    this.state = {
      north: n0,
      east: e0,
      altitude: def.altitude,
      heading: (Math.atan2(e1 - e0, n1 - n0) + 2 * Math.PI) % (2 * Math.PI),
      present: !(def.arrives && def.arrives > 0),
    };
  }

  step(dt: number): void {
    this.t += dt;
    const s = this.state;
    if (!s.present) {
      if (this.t < (this.def.arrives ?? 0)) return;
      s.present = true;
    }
    const route = this.def.route;
    if (route.length > 1) {
      const [tn, te] = route[this.target]!;
      if (Math.hypot(tn - s.north, te - s.east) < ARRIVAL) this.target = (this.target + 1) % route.length;
      const [an, ae] = route[this.target]!;
      const want = Math.atan2(ae - s.east, an - s.north);
      const turn = Math.max(-this.def.turnRate * dt, Math.min(this.def.turnRate * dt, wrap(want - s.heading)));
      s.heading = (s.heading + turn + 2 * Math.PI) % (2 * Math.PI);
    }
    s.north += this.def.speed * Math.cos(s.heading) * dt;
    s.east += this.def.speed * Math.sin(s.heading) * dt;
  }
}
