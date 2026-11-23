/**
 * The order registry: what each kind of order does to the controller. Kept
 * apart from controller.ts, which runs the step; the members of Controller
 * marked @internal are there for this file.
 */
import type { Simulation } from '../sim/simulation';
import { WEAPONS } from '../sim/config/weapons';
import type { Controller } from './controller';
import { AXES, CREW_SYSTEMS, MAX_DIVE_DEPTH, type CrewDuties } from './crew';
import type { Target } from './fireControl';
import { isReady, tubeState } from './torpedoRoom';
import type { Order, OrderKind, OrderOf, TankGroup } from './orders';
import { LIMITS } from './parser';

const DEG = Math.PI / 180;
const KNOT = 1852 / 3600;
/** The bridge deck must be at least this far above the water to man it [m]. */
export const BRIDGE_FREEBOARD = 0.5;

export type Kinematics = ReturnType<Simulation['kinematics']>;

/** How one kind of order is handled (see `ORDERS`). */
export interface OrderRule<O extends Order> {
  apply(c: Controller, o: O, k: Kinematics): void;
  /**
   * Who handles which system after the order (true = the crew): a rudder
   * order takes the heading over, a depth target hands the depth to the
   * crew. Checked against the scenario's locks; ballast and trim are switched
   * here (the axes by `apply`). Ignored for the crew's own orders ('assist').
   */
  effects?: (o: O, c: Controller) => Partial<CrewDuties>;
  /** A message if the order cannot be carried out now. */
  refuse?: (c: Controller, o: O) => string | null;
}

/**
 * The order registry: for every kind of order, what it does (`apply`),
 * when it is refused (`refuse`, a message) and whether it engages the depth
 * or heading autopilot (`steering`, refused where those are not allowed).
 * TypeScript refuses to compile if an order kind is missing. The
 * acknowledgement texts are in orders.ts.
 */
/** Any depth under water, for refusing a dive during an emergency blow. */
const DIVE_REFUSE_DEPTH = 30;
/** Said when the safety net holds a depth target to `MAX_DIVE_DEPTH`. */
export const MAX_DIVE_TEXT = `Största dykdjup är ${MAX_DIVE_DEPTH} m med skyddsnätet på: besättningen går dit.`;

export const ORDERS: { [K in OrderKind]: OrderRule<OrderOf<K>> } = {
  setDepth: {
    effects: () => ({ depth: true }),
    refuse: (c, o) => c.refuseUnderBlow(o.depth),
    apply: (c, o) => {
      if (!c.ap.depth) c.resetDepthLoops();
      c.setpoints.depth = o.depth;
      if (c.options.crew.safetyNet && o.depth > MAX_DIVE_DEPTH) {
        c.setpoints.depth = MAX_DIVE_DEPTH;
        c.afterAck.push(MAX_DIVE_TEXT);
      }
      c.ap.depth = true;
      c.conn.onDepthOrder();
      c.checkBallastForDepth();
      c.ascent.onDepthOrder();
    },
  },
  setHeading: {
    effects: () => ({ heading: true }),
    apply: (c, o) => {
      if (!c.ap.heading) c.autopilot.headingPid.reset();
      c.setpoints.heading = o.heading;
      c.ap.heading = true;
      c.ascent.onHeadingOrder();
    },
  },
  setSpeed: {
    effects: () => ({ speed: true }),
    apply: (c, o) => {
      c.setpoints.speed = o.knots;
      c.ap.speed = true;
      c.ascent.onSpeedOrder();
    },
  },
  adjustSpeed: {
    effects: () => ({ speed: true }),
    apply: (c, o, k) => {
      const base = c.ap.speed ? c.setpoints.speed : Math.round(k.u / KNOT);
      c.setpoints.speed = Math.max(LIMITS.minSpeed, Math.min(LIMITS.maxSpeed, base + o.deltaKnots));
      c.ap.speed = true;
      c.ascent.onSpeedOrder();
    },
  },
  setRpm: {
    effects: () => ({ speed: false }),
    apply: (c, o) => {
      c.manual.rpm = o.rpm;
      c.ap.speed = false;
    },
  },
  rudder: {
    effects: () => ({ heading: false }),
    apply: (c, o) => {
      const sim = c.sim;
      const current = c.ap.heading ? sim.commands.rudder / DEG : c.manual.rudder;
      const max = Math.round(sim.cfg.actuators.rudderMax / DEG);
      c.manual.rudder = Math.max(-max, Math.min(max, o.relative ? Math.round(current + o.angle) : o.angle));
      c.ap.heading = false;
    },
  },
  planes: {
    effects: () => ({ depth: false }),
    apply: (c, o) => {
      const sim = c.sim;
      const current = c.ap.depth ? sim.commands.sternPlanes / DEG : c.manual.planes;
      const max = Math.round(sim.cfg.actuators.planesMax / DEG);
      c.manual.planes = Math.max(-max, Math.min(max, o.relative ? Math.round(current + o.angle) : o.angle));
      c.ap.depth = false;
    },
  },
  mainBallast: {
    effects: () => ({ ballast: false }),
    refuse: (c, o) => (o.action === 'flood' ? c.refuseDiveWithBridgeManned() : null),
    apply: (c, o) => {
      const sim = c.sim;
      c.shutVentsWhenFull = false;
      c.aftBlowAt = null;
      // The player handles the ballast now: an emergency blow is theirs to carry through or stop.
      c.blowCommitted = false;
      const ids = groupIds(o.group);
      if (o.action === 'flood') sim.setVents(true, ids);
      else if (o.action === 'blow') sim.setBlow(true, ids);
      else {
        sim.setVents(false, ids);
        sim.setBlow(false, ids);
      }
    },
  },
  trim: {
    effects: () => ({ trim: false }),
    apply: (c, o) => {
      c.sim.requestTrimTransfer(o.litres / 1000);
    },
  },
  compensate: {
    effects: () => ({ trim: false }),
    apply: (c, o) => {
      c.sim.requestCompensation(o.litres / 1000);
    },
  },
  autopilot: {
    effects: (o) => Object.fromEntries((o.axis === 'all' ? AXES : [o.axis]).map((a) => [a, o.on])),
    apply: (c, o, k) => {
      const sim = c.sim;
      const axes = o.axis === 'all' ? (['depth', 'heading', 'speed'] as const) : ([o.axis] as const);
      for (const axis of axes) {
        if (o.on && !c.ap[axis]) {
          if (axis === 'depth') {
            c.setpoints.depth = Math.round(k.depth);
            c.resetDepthLoops();
          } else if (axis === 'heading') {
            c.setpoints.heading = Math.round(k.heading / DEG) % 360;
            c.autopilot.headingPid.reset();
          } else {
            c.setpoints.speed = Math.round(k.u / KNOT);
            c.autopilot.speedPid.reset();
          }
        }
        if (!o.on) {
          // Hand over without a jump: keep the last automatic command.
          if (axis === 'depth' && c.ap.depth) c.manual.planes = Math.round(sim.commands.sternPlanes / DEG);
          if (axis === 'heading' && c.ap.heading) c.manual.rudder = Math.round(sim.commands.rudder / DEG);
          if (axis === 'speed' && c.ap.speed) c.manual.rpm = Math.round(c.rpsCmd * 60);
        }
        c.ap[axis] = o.on;
      }
    },
  },
  adjustDepth: {
    effects: () => ({ depth: true }),
    apply: (c, o, k) => {
      const base = c.ap.depth ? c.setpoints.depth : Math.round(k.depth);
      if (!c.ap.depth) c.resetDepthLoops();
      let depth = Math.max(0, Math.min(LIMITS.maxDepth, base + o.deltaMetres));
      if (c.options.crew.safetyNet && o.deltaMetres > 0) {
        // Shallow water: never deeper than the safety limit (or the present target, if already below it).
        depth = Math.min(depth, Math.max(base, c.assist.depthLimit()));
      }
      c.setpoints.depth = depth;
      c.ap.depth = true;
      c.conn.onDepthOrder();
      c.checkBallastForDepth();
    },
  },
  adjustHeading: {
    effects: () => ({ heading: true }),
    apply: (c, o, k) => {
      const base = c.ap.heading ? c.setpoints.heading : Math.round(k.heading / DEG);
      if (!c.ap.heading) c.autopilot.headingPid.reset();
      c.setpoints.heading = (((base + o.deltaDegrees) % 360) + 360) % 360;
      c.ap.heading = true;
    },
  },
  holdCourse: {
    effects: () => ({ depth: true, heading: true }),
    apply: (c, _o, k) => {
      c.setpoints.depth = Math.round(k.depth);
      c.setpoints.heading = Math.round(k.heading / DEG) % 360;
      c.resetDepthLoops();
      c.autopilot.headingPid.reset();
      c.ap.depth = true;
      c.ap.heading = true;
    },
  },
  dive: {
    refuse: (c) => c.refuseUnderBlow(DIVE_REFUSE_DEPTH) ?? c.refuseDiveWithBridgeManned(),
    apply: (c) => {
      c.sim.setVents(true);
      c.shutVentsWhenFull = true;
      c.aftBlowAt = null;
    },
  },
  surface: {
    apply: (c) => {
      if (c.blowMainBallast()) c.afterAck.push('Huvudballasten för blåses först, så att fören kommer upp. Akter om 15 s.');
      if (c.ap.depth) c.setpoints.depth = 0;
    },
  },
  periscope: {
    apply: (c, o) => {
      c.sim.commands.periscopeUp = o.up;
    },
  },
  snorkel: {
    apply: (c, o) => {
      c.sim.commands.snorkelUp = o.up;
    },
  },
  radarMast: {
    apply: (c, o) => {
      c.sim.commands.radarUp = o.up;
      if (!o.up) c.radar.transmitting = false;
    },
  },
  radar: {
    refuse: (c, o) => (o.on && !c.sim.commands.radarUp ? 'Radarmasten är nere. Hissa den först.' : null),
    apply: (c, o) => {
      c.radar.transmitting = o.on;
      if (o.on && c.radar.antennaHeight() <= 0) c.afterAck.push('Radarn sänder när antennen är över vattnet.');
    },
  },
  wire: {
    refuse: (c, o) => c.wire.refusal(o.torpedo, o.action),
    apply: (c, o) => {
      c.afterAck.push(c.wire.act(o.torpedo, o.action, o.course));
    },
  },
  doors: {
    apply: (c, o) => {
      c.sim.commands.doorsShut = o.shut;
      // The player's call now: the crew does not open them again by itself.
      c.plant.doorsByCrew = false;
    },
  },
  drain: {
    refuse: (c, o) => (o.compartment !== null && !c.sim.systems.flooding.compartments.some((x) => x.id === o.compartment) ? `Det finns ingen avdelning ${o.compartment}.` : null),
    apply: (c, o) => {
      c.sim.systems.flooding.drainTarget = o.compartment;
    },
  },
  decoy: {
    refuse: (c) => (c.decoys <= 0 ? 'Inga lockmål kvar.' : null),
    apply: (c, o, k) => {
      const course = o.course === undefined ? (k.heading + Math.PI) % (2 * Math.PI) : (((o.course % 360) + 360) % 360) * DEG;
      const d = c.world.launchDecoy(course);
      c.decoys--;
      const deg = String(Math.round((course / DEG + 360) % 360) % 360).padStart(3, '0');
      c.afterAck.push(`Lockmål ${d.id} ute på kurs ${deg}°: det låter som ubåten i ${Math.round(WEAPONS.decoy.life / 60)} min. ${c.decoys} kvar.`);
    },
  },
  ping: {
    refuse: (c) => {
      const wait = c.sonar.pingWait();
      return wait > 0 ? `Sonaren kan pinga igen om ${Math.ceil(wait)} s.` : null;
    },
    apply: (c) => c.sonar.ping(),
  },
  tube: {
    effects: () => ({ torpedoRoom: false }),
    refuse: (c, o) => {
      const plan = c.fire.room.planFor(o.tube - 1, o.action);
      return typeof plan === 'string' ? plan : null;
    },
    apply: (c, o) => c.fire.room.order(o.tube - 1, o.action),
  },
  markTarget: {
    refuse: (c, o) => {
      if (o.label) {
        const label = o.label.toUpperCase();
        if (label.startsWith('M')) return c.fire.targets.some((t) => t.label === label) ? null : `Inget mål ${label}.`;
        const k = c.sonar.contacts.find((x) => x.label === label);
        if (!k) return `Ingen sonarkontakt ${label}.`;
        return k.bio ? `${label} är biologisk${k.classified ? ` (${k.classified})` : ''}, inget mål.` : null;
      }
      // Through the periscope or from the bridge: a vessel in the cross hair.
      const r = c.fire.findInSight(((o.bearing ?? 0) * Math.PI) / 180);
      return typeof r === 'string' ? r : null;
    },
    apply: (c, o) => {
      if (!o.label) {
        const t = c.fire.markInSight(((o.bearing ?? 0) * Math.PI) / 180);
        if (t) c.afterAck.push(`${t.label} är ${t.name}.`);
        return;
      }
      const label = o.label.toUpperCase();
      if (label.startsWith('M')) {
        c.fire.current = label;
        return;
      }
      const k = c.sonar.contacts.find((x) => x.label === label)!;
      const v = c.world.vessels.find((x) => x.def.id === k.vesselId)!;
      const t = c.fire.targetFor(v);
      c.fire.observe(t, { bearing: (k.bearing * Math.PI) / 180, sigma: Math.PI / 180 });
      c.afterAck.push(`${t.label} är ${k.label}. Eldledningen följer bäringarna.`);
    },
  },
  rangeTarget: {
    refuse: (c, o) => {
      const t = c.fire.target;
      if (!t) return 'Inget mål. Markera målet först (Mål).';
      if (o.range !== undefined) return null;
      const v = c.fire.vessel(t);
      const seen = c.fire.inSight().find((x) => x.vessel === v);
      if (!seen) return 'Målet syns inte: hissa periskopet eller bemanna bryggan.';
      if (o.bearing !== undefined && Math.abs(((((o.bearing * Math.PI) / 180 - seen.bearing) % (2 * Math.PI)) + 3 * Math.PI) % (2 * Math.PI) - Math.PI) > (3 * Math.PI) / 180) {
        return 'Målet är inte i hårkorset.';
      }
      return null;
    },
    apply: (c, o) => {
      const t = c.fire.target!;
      if (o.range !== undefined) {
        const b = t.solution ? Math.atan2(t.solution.position[1] - c.sim.y[1]!, t.solution.position[0] - c.sim.y[0]!) : t.obs.at(-1)?.bearing ?? 0;
        c.fire.observe(t, { bearing: b, sigma: (5 * Math.PI) / 180, range: o.range, rangeError: 0.08 });
        return;
      }
      const v = c.fire.vessel(t)!;
      const seen = c.fire.inSight().find((x) => x.vessel === v)!;
      const m = c.fire.stadimeter(v, seen.range, o.magnification === undefined ? 0 : o.magnification);
      c.fire.observe(t, { bearing: seen.bearing, sigma: (0.3 * Math.PI) / 180, range: m.range, rangeError: m.error });
      c.afterAck.push(`${t.label}: avstånd ${Math.round(m.range / 10) * 10} m.`);
    },
  },
  setSpread: {
    refuse: (_c, o) => (o.count >= 1 && o.count <= 3 ? null : 'Spridningen är 1, 2 eller 3 torpeder.'),
    apply: (c, o) => {
      c.fire.spread = o.count;
    },
  },
  fireTorpedo: {
    refuse: (c, o) => {
      const t = c.fire.target;
      if (!t) return 'Inget mål. Markera målet först (Mål).';
      if (!t.solution) return `Ingen lösning på ${t.label} ännu.`;
      const tubes = c.fire.tubes;
      if (o.tube !== undefined && !tubes[o.tube - 1]?.loaded) return `Tub ${o.tube} är inte laddad.`;
      if (o.tube !== undefined && !isReady(tubes[o.tube - 1]!)) return `Tub ${o.tube} är inte klar: ${tubeState(tubes[o.tube - 1]!)}.`;
      if (!tubes.some((x) => x.loaded)) return c.fire.reserve > 0 || tubes.some((x) => x.plan.includes('load')) ? 'Alla tuber är tomma. Omladdning pågår.' : 'Inga torpeder kvar.';
      if (!tubes.some(isReady)) {
        const busy = tubes.filter((x) => x.loaded && (x.plan[0] === 'flood' || x.plan[0] === 'open'));
        if (busy.length) return `Tuberna görs klara (${Math.ceil(Math.min(...busy.map((x) => x.left + (x.plan.length > 1 ? WEAPONS.tubes.openTime : 0))))} s).`;
        return 'Ingen tub är klar. Gör en tub klar: tryck på den, eller i panelen Torped.';
      }
      const aim = c.fire.aim();
      if (!aim) return `Torpeden hinner inte ikapp ${t.label}.`;
      if (aim.distance > WEAPONS.torpedo.range - 200) return `${t.label} är utom räckhåll (${(aim.distance / 1000).toFixed(1).replace('.', ',')} km).`;
      return null;
    },
    apply: (c, o) => {
      const fire = c.fire;
      const t = fire.target as Target;
      const aim = fire.aim()!;
      const tubes = fire.tubes.map((x, i) => ({ x, i })).filter(({ x }) => isReady(x));
      const first = o.tube !== undefined ? tubes.findIndex(({ i }) => i === o.tube! - 1) : 0;
      const salvo = [...tubes.slice(first), ...tubes.slice(0, first)].slice(0, fire.spread);
      const spread = (WEAPONS.spreadAngle * Math.PI) / 180;
      salvo.forEach(({ i }, k) => {
        fire.room.fired(i);
        const offset = (k - (salvo.length - 1) / 2) * spread;
        const torpedo = c.world.launch({
          course: (aim.course + offset + 2 * Math.PI) % (2 * Math.PI),
          depth: aim.depth,
          seekAfter: Math.max(WEAPONS.torpedo.arming, aim.distance - WEAPONS.torpedo.seekBefore),
        });
        c.torpedoesFired++;
        c.wire.launched(torpedo, t.label);
        const deg = String(Math.round(((aim.course + offset) * 180) / Math.PI + 360) % 360).padStart(3, '0');
        const run = Math.round(aim.time);
        c.afterAck.push(`Torped ${torpedo.state.id} gick från tub ${i + 1} mot ${t.label}: kurs ${deg}°, gångtid ${Math.floor(run / 60)} min ${run % 60} s.`);
      });
    },
  },
  diesel: {
    effects: () => ({ charging: false }),
    refuse: (c, o) =>
      o.on && c.sim.systems.flooding.fill('engine') > c.sim.cfg.damage.disableFill ? 'Maskinrummet är vattenfyllt. Dieslarna kan inte startas.' : null,
    apply: (c, o) => {
      c.sim.commands.diesel = o.on;
      if (o.on && !c.sim.systems.electrics.airAtInduction()) c.plant.dieselNeedsAir = true;
    },
  },
  bridge: {
    refuse: (c, o) => {
      if (!o.manned) return null;
      if (c.sim.bodyPointDepth(c.sim.cfg.bridge.deck) > -BRIDGE_FREEBOARD) return 'Bryggan är under vatten. Gå till ytläge först.';
      if (c.sim.tanks.some((t) => t.ventOpen)) return 'Ubåten dyker: ventilerna till huvudballasten är öppna.';
      return null;
    },
    apply: (c, o) => {
      c.bridgeManned = o.manned;
    },
  },
  crew: {
    // 'all' leaves locked systems as they are.
    effects: (o, c) =>
      Object.fromEntries((o.system === 'all' ? CREW_SYSTEMS.filter((x) => c.options.locks[x] === undefined) : [o.system]).map((x) => [x, o.crew])),
    apply: (c, o) => {
      const systems = o.system === 'all' ? CREW_SYSTEMS.filter((x) => c.options.locks[x] === undefined) : [o.system];
      for (const x of systems) c.setDuty(x, o.crew);
    },
  },
  reportBearing: {
    apply: (c, o) => {
      const sim = c.sim;
      // Something can be seen from a raised periscope above the water or from the bridge.
      const lookout = c.bridgeManned || (sim.actuators.periscope > 0.99 && sim.bodyPointDepth(sim.periscopeHead()) < 0);
      const contacts: Record<string, number> = {};
      for (const k of c.world.contacts()) contacts[k.vessel.def.id] = (k.bearing * 180) / Math.PI;
      c.lastBearing = { bearing: o.bearing, t: sim.t, position: [sim.y[0]!, sim.y[1]!], lookout, contacts };
      if (!lookout) c.addLog('Ingen utkik: hissa periskopet eller bemanna bryggan för att se något.', 'error');
    },
  },
};

function groupIds(g: TankGroup): string[] | undefined {
  return g === 'fwd' ? ['mbt_fwd'] : g === 'aft' ? ['mbt_aft'] : undefined;
}
