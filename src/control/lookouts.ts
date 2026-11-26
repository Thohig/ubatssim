/**
 * Eyes above the water other than the corvettes: patrol aircraft and
 * coastal radar stations. Once a second (deterministic):
 *
 *  - each one sees a raised periscope, a snorkel or a surfaced boat within
 *    its reach (an aircraft's radar from height reaches far; a station's is
 *    limited by its radar horizon and by land in the way), and its
 *    awareness of the boat grows like a corvette's (in `Sonar.awareness`,
 *    under its own id); at 1 the boat is found.
 *  - at 0.5 it reports the boat: every corvette searches there
 *    (`Hunter.cue`), and the log says so.
 *  - the boat's radar warning receiver hears their radars while its antenna
 *    is above the water, as it hears a corvette's (radar.ts).
 */
import { LOOKOUTS as L } from '../sim/config/lookouts';
import { terrainBlocks } from '../sim/seabed';
import { DT } from '../sim/simulation';
import type { Controller } from './controller';
import { radarHorizon } from './radar';

/** A coastal radar station on high ground. */
export interface RadarStation {
  id: string;
  /** Swedish display name ("kustradarn på Eggøy"). */
  name: string;
  /** [north, east] [m], on land. */
  position: [number, number];
  /** Height of the antenna above the sea [m]. */
  height: number;
}

/** Height above the water of what a radar can see [m]: periscope, snorkel, the surfaced boat's sail. */
const TARGET_HEIGHT = { periscope: 1.5, snorkel: 2, surfaced: 7 } as const;
/** Seconds without hearing a radar before the radar warner warns of it again. */
const ESM_QUIET = 60;
const DEG = Math.PI / 180;

export class Lookouts {
  stations: readonly RadarStation[] = [];
  /**
   * They look for the boat (threat tension or war, and the test situations).
   * Off at peace: the aircraft fly and the radar warner hears their radars,
   * but nobody hunts the boat.
   */
  watching = true;
  /** Lookouts that have reported the boat (once each). */
  private reported = new Set<string>();
  private lastHeard: Record<string, number> = {};
  private steps = 0;

  constructor(private readonly ctrl: Controller) {}

  /** Call once per simulation step; works once a second. */
  update(): void {
    if (this.steps++ % Math.round(1 / DT) !== 0) return;
    const c = this.ctrl;
    if (!c.world.aircraft.length && !this.stations.length) return;
    const sim = c.sim;
    const t = sim.telemetry();
    const here: [number, number] = [sim.y[0]!, sim.y[1]!];
    // What shows above the water, highest first.
    const shows: (keyof typeof TARGET_HEIGHT)[] = [];
    if (t.bridgeDeckDepth < 0) shows.push('surfaced');
    if (t.snorkel > 0.99 && t.snorkelHeadDepth < 0) shows.push('snorkel');
    if (t.periscope > 0.99 && t.periscopeHeadDepth < 0) shows.push('periscope');
    const antenna = c.radar.antennaHeight();

    for (const a of c.world.aircraft) {
      if (!a.state.present) continue;
      const r = Math.hypot(a.state.north - here[0], a.state.east - here[1]);
      let rate = 0;
      for (const w of shows) if (r < L.aircraftSight[w]) rate = Math.max(rate, L.sightRate[w]);
      if (c.radar.active && r < L.aircraftEsm) rate += L.esmRate;
      if (this.watching) this.aware(a.def.id, a.def.name, rate, here);
      if (antenna > 0 && r < radarHorizon(antenna, a.state.altitude) && r < L.aircraftRadarReach) this.heard(a.def.id, 'flygradar', a.state.north, a.state.east, r, L.aircraftRadarReach);
    }

    for (const s of this.stations) {
      const r = Math.hypot(s.position[0] - here[0], s.position[1] - here[1]);
      const clear = (h: number) => r < Math.min(L.stationRange, radarHorizon(s.height, h)) && !terrainBlocks(sim.acousticGround, [s.position[0], s.position[1], -s.height], [here[0], here[1], -h], 100);
      if (this.watching) {
        let rate = 0;
        for (const w of shows) if (clear(TARGET_HEIGHT[w])) rate = Math.max(rate, L.stationRate[w] * Math.max(0, 1 - r / L.stationSight[w]));
        this.aware(s.id, s.name, rate, here);
      }
      if (antenna > 0 && clear(antenna)) this.heard(s.id, 'kustradar', s.position[0], s.position[1], r, L.stationRange);
    }
  }

  /** One lookout's awareness: up by `rate`, or slowly down. */
  private aware(id: string, name: string, rate: number, here: [number, number]): void {
    const c = this.ctrl;
    const s = c.sonar;
    const now = Math.min(1, Math.max(0, (s.awareness[id] ?? 0) + (rate > 0 ? rate : -L.decay)));
    s.awareness[id] = now;
    if (now >= 0.5 && !this.reported.has(id)) {
      this.reported.add(id);
      // It reports where it saw something, roughly.
      const at: [number, number] = [here[0] + L.reportError * Math.sin(c.sim.t * 0.7), here[1] + L.reportError * Math.cos(c.sim.t * 0.9)];
      const corvettes = c.world.vessels.filter((v) => v.def.kind === 'patrol' && !v.state.sinking);
      c.addLog(`Varning: ${name} har sett något${corvettes.length ? ' och anropar korvetterna' : ''}. Sänk masterna och gå djupt.`, 'error');
      for (const v of corvettes) {
        s.alert(v.def.id, L.cueAlert);
        c.hunter.cue(v, at);
      }
    }
    if (now >= 1) s.found(name);
  }

  /** The boat's radar warning receiver hears a radar. */
  private heard(id: string, what: string, n: number, e: number, range: number, reach: number): void {
    const c = this.ctrl;
    const now = c.sim.t;
    const bearing = ((Math.atan2(e - c.sim.y[1]!, n - c.sim.y[0]!) / DEG) % 360 + 360) % 360;
    const strength = range < reach / 3 ? 'stark' : range < (2 * reach) / 3 ? 'medel' : 'svag';
    if (now - (this.lastHeard[id] ?? -Infinity) > ESM_QUIET) {
      c.addLog(`Radarvarnare: ${what} i bäring ${String(Math.round(bearing) % 360).padStart(3, '0')}°, ${strength}.`, 'error');
    }
    this.lastHeard[id] = now;
    c.radar.esm = [...c.radar.esm.filter((x) => x.vesselId !== id), { vesselId: id, bearing, strength }];
  }
}
