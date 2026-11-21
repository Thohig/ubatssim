/**
 * Life in the sea: whales and fish schools. Kinematic and deterministic,
 * like the vessels: they follow a route, and a whale dives and comes up to
 * breathe on a fixed cycle. They make sound (the passive sonar hears them,
 * and has to tell them from ships) and give echoes (the active sonar).
 *
 * - A whale clicks (a sperm whale, diving deep), sings (a humpback), gives
 *   low pulse trains (a minke whale) or whistles and calls (killer whales)
 *   for part of each `callPeriod`.
 * - A herring school stays in the deep scattering layer: deep by day,
 *   near the surface at night, when it also ticks (FRT).
 */
import { ACOUSTICS as A } from './config/acoustics';

export type CreatureKind = 'whale' | 'school';
export type CreatureSound = 'clicks' | 'song' | 'pulse' | 'whistle' | 'frt';

export interface CreatureDef {
  id: string;
  /** Swedish display name ("en kaskelot", "ett sillstim"). */
  name: string;
  kind: CreatureKind;
  sound: CreatureSound;
  /** Waypoints [north, east] [m], followed in a loop, and the speed [m/s]. */
  route: [number, number][];
  speed: number;
  /** Depth [m]: a whale's dive, a school's by day; `nightDepth` a school's at night. */
  depth: number;
  nightDepth?: number;
  /** A whale's dive and its time breathing at the surface [s]. */
  dive?: number;
  surface?: number;
  /** Vocal for `callOn` seconds of every `callPeriod` [s] (whales). */
  callPeriod?: number;
  callOn?: number;
  /** Body length, or the school's diameter [m]. */
  size: number;
  /** Offset of the cycles [s], so two whales do not breathe together. */
  phase?: number;
}

export interface CreatureState {
  north: number;
  east: number;
  depth: number;
  heading: number;
  speed: number;
  /** A whale at the surface blowing (for the graphics). */
  blowing: boolean;
}

/** Vertical speed of a diving whale [m/s] and of a school changing depth. */
const WHALE_VERTICAL = 1.5;
const SCHOOL_VERTICAL = 0.2;
const TURN_RATE = (4 * Math.PI) / 180;
const ARRIVAL = 80;

const wrap = (a: number) => {
  let x = (a + Math.PI) % (2 * Math.PI);
  if (x < 0) x += 2 * Math.PI;
  return x - Math.PI;
};

export class Creature {
  readonly state: CreatureState;
  private target = 1;

  constructor(
    readonly def: CreatureDef,
    night: boolean,
    ground?: (north: number, east: number) => number,
  ) {
    const [n0, e0] = def.route[0]!;
    const [n1, e1] = def.route[1] ?? def.route[0]!;
    const want = this.wantDepth(0, night);
    this.state = {
      north: n0,
      east: e0,
      depth: ground ? Math.max(1, Math.min(want, ground(n0, e0) - def.size / 2 - 5)) : want,
      heading: (Math.atan2(e1 - e0, n1 - n0) + 2 * Math.PI) % (2 * Math.PI),
      speed: def.speed,
      blowing: false,
    };
  }

  /** Where in its breathing cycle a whale is: true at the surface. */
  atSurface(t: number): boolean {
    const d = this.def;
    if (d.kind !== 'whale') return false;
    const dive = d.dive ?? 600;
    const surface = d.surface ?? 120;
    return (t + (d.phase ?? 0)) % (dive + surface) >= dive;
  }

  /** The depth it is heading for now [m]. */
  wantDepth(t: number, night: boolean): number {
    const d = this.def;
    if (d.kind === 'school') return night ? (d.nightDepth ?? d.depth) : d.depth;
    if (this.atSurface(t)) return 1;
    // Start up in time to reach the surface when the dive ends.
    const dive = d.dive ?? 600;
    const into = (t + (d.phase ?? 0)) % (dive + (d.surface ?? 120));
    return dive - into < d.depth / WHALE_VERTICAL ? 1 : d.depth;
  }

  /** Radiated sound now [dB re 1 µPa at 1 m], or null when silent. */
  sourceLevel(t: number, night: boolean): number | null {
    const d = this.def;
    if (d.sound === 'frt') return night ? (A.bioLevel.frt ?? 118) : null;
    const period = d.callPeriod ?? 300;
    const on = d.callOn ?? 120;
    // Sperm whales click while diving and foraging, not at the surface.
    if (d.sound === 'clicks' && this.state.depth < 50) return null;
    return (t + (d.phase ?? 0) * 0.7) % period < on ? (A.bioLevel[d.sound] ?? 160) : null;
  }

  /** Target strength for an active ping [dB]. */
  get targetStrength(): number {
    return A.bioTargetStrength[this.def.kind] ?? 10;
  }

  /**
   * One step. `ground` gives the water depth [m]: an animal keeps clear of
   * the bottom whatever depth it wants.
   */
  step(dt: number, t: number, night: boolean, ground?: (north: number, east: number) => number): void {
    const s = this.state;
    const d = this.def;
    const route = d.route;
    if (route.length > 1) {
      const [tn, te] = route[this.target]!;
      if (Math.hypot(tn - s.north, te - s.east) < ARRIVAL) this.target = (this.target + 1) % route.length;
      const [an, ae] = route[this.target]!;
      const want = Math.atan2(ae - s.east, an - s.north);
      const turn = Math.max(-TURN_RATE * dt, Math.min(TURN_RATE * dt, wrap(want - s.heading)));
      s.heading = (s.heading + turn + 2 * Math.PI) % (2 * Math.PI);
    }
    s.north += s.speed * Math.cos(s.heading) * dt;
    s.east += s.speed * Math.sin(s.heading) * dt;
    let goal = this.wantDepth(t, night);
    if (ground) goal = Math.max(1, Math.min(goal, ground(s.north, s.east) - d.size / 2 - 5));
    const v = (d.kind === 'whale' ? WHALE_VERTICAL : SCHOOL_VERTICAL) * dt;
    s.depth += Math.max(-v, Math.min(v, goal - s.depth));
    s.blowing = d.kind === 'whale' && s.depth < 3;
  }
}
