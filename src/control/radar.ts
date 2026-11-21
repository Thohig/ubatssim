/**
 * The radar and the radar warning receiver (ESM) on the radar mast.
 *
 *  - Transmitting with the antenna above the water, every sweep
 *    (`WEAPONS.radar.sweep`) gives an echo from each vessel inside the radar
 *    horizon between the antenna and the vessel's mast (4.12·(√h₁ + √h₂) km).
 *    Small boats hide in the sea clutter close in, in a rough sea. An echo
 *    gives a range and a bearing: a marked target gets them as an
 *    observation, so the solution is good after a sweep or two.
 *  - The corvettes' ESM hears the radar further than the radar sees them
 *    (`esmFactor`); sonar.ts adds that to their awareness.
 *  - The boat's own ESM works whenever the antenna is above the water,
 *    transmitting or not: it warns of a corvette's radar sweeping over the
 *    boat, with its bearing.
 *
 * Deterministic: the errors are fixed functions of time.
 */
import { WEAPONS } from '../sim/config/weapons';
import type { Vessel } from '../sim/vessel';
import type { Controller } from './controller';

const R = WEAPONS.radar;
const DEG = Math.PI / 180;
/** Seconds without hearing a corvette's radar before the ESM warns of it again. */
const ESM_QUIET = 60;

/** The radar horizon [m] between two antennas `h1` and `h2` metres above the water. */
export const radarHorizon = (h1: number, h2: number): number => 4120 * (Math.sqrt(Math.max(0, h1)) + Math.sqrt(Math.max(0, h2)));

export interface RadarEcho {
  vesselId: string;
  /** Measured true bearing [deg] and range [m]. */
  bearing: number;
  range: number;
}

/** A fixed pseudo-random value in −1…1 (deterministic measurement noise). */
const noise = (t: number, key: number) => Math.sin(t * 0.83 + key * 1.7) * Math.cos(t * 0.37 + key * 0.9);

export class Radar {
  /** Ordered to transmit (it does while the antenna is above the water). */
  transmitting = false;
  /** Echoes of the last sweep, and when it was. */
  echoes: RadarEcho[] = [];
  lastSweep = -Infinity;
  /** Corvette radars the ESM hears now: their true bearing [deg] and a strength word. */
  esm: { vesselId: string; bearing: number; strength: string }[] = [];
  private steps = 0;
  private lastHeard: Record<string, number> = {};
  private announced = false;

  constructor(private readonly ctrl: Controller) {}

  /** Height of the antenna above the water [m] (≤ 0: under water). */
  antennaHeight(): number {
    const sim = this.ctrl.sim;
    return sim.actuators.radar > 0.99 ? -sim.bodyPointDepth(sim.radarHead()) : 0;
  }

  /** True while the radar is on the air. */
  get active(): boolean {
    return this.transmitting && this.antennaHeight() > 0;
  }

  /** True if a corvette at `range` [m] hears the boat's radar now (sonar.ts). */
  heardAt(range: number): boolean {
    return this.active && range < R.esmFactor * radarHorizon(this.antennaHeight(), R.patrolAntenna);
  }

  /** Call once per simulation step; works once a second, and sweeps every `sweep` seconds. */
  update(dt: number): void {
    if (this.steps++ % Math.round(1 / dt) !== 0) return;
    const c = this.ctrl;
    const sim = c.sim;
    const now = sim.t;
    const h = this.antennaHeight();
    if (h <= 0) {
      this.esm = [];
      if (this.echoes.length) this.echoes = [];
      this.announced = false;
      return;
    }
    this.listen(h, now);
    if (!this.transmitting) {
      this.echoes = [];
      this.announced = false;
      return;
    }
    if (now - this.lastSweep < R.sweep - 1e-9) return;
    this.lastSweep = now;
    this.sweep(h, now);
  }

  private sweep(h: number, now: number): void {
    const c = this.ctrl;
    const hs = c.sim.sea.hs;
    const echoes: RadarEcho[] = [];
    for (const k of c.world.contacts()) {
      const v = k.vessel;
      if (k.range > Math.min(R.maxRange, radarHorizon(h, R.targetHeight[v.def.kind] ?? 10))) continue;
      if (hs > R.clutterWave && (v.def.kind === 'fishing' || v.def.kind === 'sail') && k.range < R.clutterRange) continue;
      const key = v.def.id.length * 7 + v.def.id.charCodeAt(0);
      const range = k.range * (1 + R.rangeError * noise(now, key));
      const bearing = k.bearing + R.bearingError * noise(now, key + 3);
      echoes.push({ vesselId: v.def.id, bearing: ((bearing / DEG) % 360 + 360) % 360, range });
      const t = c.fire.targets.find((x) => x.vesselId === v.def.id);
      if (t) c.fire.observe(t, { bearing, sigma: R.bearingError, range, rangeError: R.rangeError });
    }
    this.echoes = echoes;
    if (!this.announced) {
      this.announced = true;
      c.addLog(echoes.length ? `Radar: ${echoes.length} ${echoes.length === 1 ? 'eko' : 'ekon'}, närmast ${km(Math.min(...echoes.map((e) => e.range)))}.` : 'Radar: inga ekon.', 'info');
    }
  }

  /** The boat's ESM: corvette radars that reach the antenna. */
  private listen(h: number, now: number): void {
    const c = this.ctrl;
    const heard: Radar['esm'] = [];
    for (const k of c.world.contacts()) {
      const v: Vessel = k.vessel;
      if (v.def.kind !== 'patrol' || v.state.sinking) continue;
      const reach = R.esmFactor * radarHorizon(h, R.patrolAntenna);
      if (k.range > reach) continue;
      const bearing = ((k.bearing / DEG) % 360 + 360) % 360;
      const strength = k.range < reach / 3 ? 'stark' : k.range < (2 * reach) / 3 ? 'medel' : 'svag';
      heard.push({ vesselId: v.def.id, bearing, strength });
      if (now - (this.lastHeard[v.def.id] ?? -Infinity) > ESM_QUIET) {
        c.addLog(`Radarvarnare: radar i bäring ${String(Math.round(bearing) % 360).padStart(3, '0')}°, ${strength}.`, 'error');
      }
      this.lastHeard[v.def.id] = now;
    }
    this.esm = heard;
  }
}

const km = (m: number) => (m >= 1000 ? `${(m / 1000).toFixed(1).replace('.', ',')} km` : `${Math.round(m)} m`);
