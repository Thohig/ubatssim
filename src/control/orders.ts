/**
 * Every steering command – from the keyboard or the screen controls – becomes a
 * typed Order. Orders are queued and executed at the start of the next
 * simulation step. Angles are in degrees and speeds in knots here (the
 * operator's units); the controller converts to SI.
 */
import { SUBMARINE } from '../sim/config/submarine';
import type { CrewSystem } from './crew';

/** 'assist' = the crew's trim assistant and safety net (never takes a system over). */
export type OrderSource = 'keyboard' | 'touch' | 'console' | 'assist';

export type TankGroup = 'all' | 'fwd' | 'aft';
export type AutopilotAxis = 'all' | 'depth' | 'heading' | 'speed';

export type Order =
  | { kind: 'setDepth'; depth: number }
  | { kind: 'setHeading'; heading: number }
  | { kind: 'setSpeed'; knots: number }
  | { kind: 'adjustSpeed'; deltaKnots: number }
  | { kind: 'setRpm'; rpm: number }
  /** Rudder angle, positive = starboard. `relative` adds to the current command. */
  | { kind: 'rudder'; angle: number; relative?: boolean }
  /** Stern planes angle, positive = dive (bow down). */
  | { kind: 'planes'; angle: number; relative?: boolean }
  | { kind: 'mainBallast'; action: 'flood' | 'blow' | 'shut'; group: TankGroup }
  /** Trim transfer in litres, positive = aft → forward. */
  | { kind: 'trim'; litres: number }
  /** Compensation in litres, positive = flood from sea, negative = pump out. */
  | { kind: 'compensate'; litres: number }
  | { kind: 'autopilot'; axis: AutopilotAxis; on: boolean }
  /** Change the depth setpoint (engages the depth autopilot). Positive = deeper. */
  | { kind: 'adjustDepth'; deltaMetres: number }
  /** Change the heading setpoint (engages the heading autopilot). Positive = starboard. */
  | { kind: 'adjustHeading'; deltaDegrees: number }
  /** Hold the present depth and heading on autopilot. */
  | { kind: 'holdCourse' }
  /** Flood all main ballast; the vents shut automatically when the tanks are full. */
  | { kind: 'dive' }
  /** Blow all main ballast; a depth autopilot is sent to the surface. */
  | { kind: 'surface' }
  /** Raise or lower the search periscope. */
  | { kind: 'periscope'; up: boolean }
  /** Raise or lower the snorkel mast. */
  | { kind: 'snorkel'; up: boolean }
  /** Start or stop the diesel generators (they run only with air: surfaced or snorkelling). */
  | { kind: 'diesel'; on: boolean }
  /** Man the bridge, or clear it before diving. */
  | { kind: 'bridge'; manned: boolean }
  /** Report a true bearing [deg] to something seen through the periscope or from the bridge. */
  | { kind: 'reportBearing'; bearing: number }
  /**
   * Mark a target: a vessel at a true bearing [deg] seen through the
   * periscope or from the bridge, a sonar contact ("S1"), or an existing
   * target ("M2") to aim at.
   */
  | { kind: 'markTarget'; bearing?: number; label?: string }
  /**
   * Range the current target: with the stadimeter at the periscope's
   * bearing [deg] and magnification (index, null = by eye from the bridge),
   * or a range [m] typed in.
   */
  | { kind: 'rangeTarget'; bearing?: number; magnification?: number | null; range?: number }
  /** Fire at the current target from a tube (1–4; default the first loaded), as a salvo of `spread`. */
  | { kind: 'fireTorpedo'; tube?: number }
  /** Torpedoes per salvo, 1–3. */
  | { kind: 'setSpread'; count: number }
  /** A tube (1–4): make it ready (flood, open the door), secure it (shut, drain) or load it from the racks. */
  | { kind: 'tube'; tube: number; action: 'ready' | 'secure' | 'load' }
  /** One ping with the active sonar. */
  | { kind: 'ping' }
  /** A wire-guided torpedo: aim it again at its target, wake its seeker, give it a course [deg] or cut the wire. */
  | { kind: 'wire'; torpedo: number; action: 'update' | 'seek' | 'course' | 'cut'; course?: number }
  /** Shut or open the watertight doors between the compartments. */
  | { kind: 'doors'; shut: boolean }
  /** The compartment the drain pump takes first (null: the wettest). */
  | { kind: 'drain'; compartment: string | null }
  /** Launch a decoy on a true course [deg] (default: straight astern). */
  | { kind: 'decoy'; course?: number }
  /** Raise or lower the radar mast (the radar warning receiver listens whenever it is up). */
  | { kind: 'radarMast'; up: boolean }
  /** Transmit with the radar, or go silent. */
  | { kind: 'radar'; on: boolean }
  /** Hand a system (or all) to the crew (`crew: true`) or take it over (`crew: false`). See crew.ts. */
  | { kind: 'crew'; system: CrewSystem | 'all'; crew: boolean };

export type OrderKind = Order['kind'];
export type OrderOf<K extends OrderKind> = Extract<Order, { kind: K }>;

export interface QueuedOrder {
  order: Order;
  source: OrderSource;
}

const fmt = (n: number): string => {
  const r = Math.round(n * 10) / 10;
  return (Number.isInteger(r) ? r.toFixed(0) : r.toFixed(1)).replace('.', ',');
};

const groupText = (g: TankGroup): string => (g === 'fwd' ? ' för' : g === 'aft' ? ' akter' : '');

const axisText: Record<AutopilotAxis, string> = { all: '', depth: ' djup', heading: ' kurs', speed: ' fart' };

/** Acknowledgement in Swedish naval style, e.g. "Djup 120, ja". */
export function acknowledgement(o: Order): string {
  switch (o.kind) {
    case 'setDepth':
      return `Djup ${fmt(o.depth)}, ja`;
    case 'setHeading':
      return `Kurs ${fmt(o.heading).padStart(3, '0')}, ja`;
    case 'setSpeed':
      return o.knots < 0 ? `Back ${fmt(-o.knots)} knop, ja` : `Fart ${fmt(o.knots)} knop, ja`;
    case 'adjustSpeed':
      return `Fart ${o.deltaKnots > 0 ? 'öka' : 'minska'} ${fmt(Math.abs(o.deltaKnots))} knop, ja`;
    case 'setRpm':
      return `Varv ${fmt(o.rpm)}, ja`;
    case 'rudder': {
      if (o.relative) return `Roder ${fmt(Math.abs(o.angle))} ${o.angle > 0 ? 'styrbord' : 'babord'} till, ja`;
      if (o.angle === 0) return 'Roder midskepps, ja';
      return `Roder ${o.angle > 0 ? 'styrbord' : 'babord'} ${fmt(Math.abs(o.angle))}, ja`;
    }
    case 'planes': {
      if (o.relative) return `Djuproder ${fmt(Math.abs(o.angle))} ${o.angle > 0 ? 'ned' : 'upp'} till, ja`;
      if (o.angle === 0) return 'Djuproder noll, ja';
      return `Djuproder ${o.angle > 0 ? 'ned' : 'upp'} ${fmt(Math.abs(o.angle))}, ja`;
    }
    case 'mainBallast':
      return o.action === 'flood'
        ? `Fyll huvudballast${groupText(o.group)}, ja`
        : o.action === 'blow'
          ? `Blås huvudballast${groupText(o.group)}, ja`
          : `Stäng huvudballast${groupText(o.group)}, ja`;
    case 'trim':
      return `Trimma ${fmt(Math.abs(o.litres))} liter ${o.litres > 0 ? 'förut' : 'akterut'}, ja`;
    case 'compensate':
      return `Kompensera ${o.litres > 0 ? 'in' : 'ut'} ${fmt(Math.abs(o.litres))} liter, ja`;
    case 'autopilot':
      return `Autopilot${axisText[o.axis]} ${o.on ? 'på' : 'av'}, ja`;
    case 'adjustDepth':
      return `Djup ${fmt(Math.abs(o.deltaMetres))} m ${o.deltaMetres > 0 ? 'djupare' : 'grundare'}, ja`;
    case 'adjustHeading':
      return `Kurs ${fmt(Math.abs(o.deltaDegrees))}° ${o.deltaDegrees > 0 ? 'styrbord' : 'babord'}, ja`;
    case 'holdCourse':
      return 'Håll kurs och djup, ja';
    case 'dive':
      return 'Dyk, ja';
    case 'surface':
      return 'Ytläge, ja';
    case 'periscope':
      return `Periskop ${o.up ? 'upp' : 'ned'}, ja`;
    case 'snorkel':
      return `Snorkel ${o.up ? 'upp' : 'ned'}, ja`;
    case 'diesel':
      return o.on ? 'Starta dieslarna, ja' : 'Stoppa dieslarna, ja';
    case 'bridge':
      return o.manned ? 'Bemanna bryggan, ja' : 'Klart bryggan, ja';
    case 'reportBearing':
      return `Bäring ${String(Math.round(o.bearing) % 360).padStart(3, '0')}, ja`;
    case 'crew':
      return CREW_ACK[o.system][o.crew ? 0 : 1];
    case 'markTarget':
      return o.label ? `Mål ${o.label.toUpperCase()}, ja` : `Mål i bäring ${String(Math.round(o.bearing ?? 0) % 360).padStart(3, '0')}, ja`;
    case 'rangeTarget':
      return o.range !== undefined ? `Avstånd ${fmt(o.range)} meter, ja` : 'Avståndsmätning, ja';
    case 'fireTorpedo':
      return o.tube ? `Fyr tub ${o.tube}, ja` : 'Fyr, ja';
    case 'setSpread':
      return o.count === 1 ? 'En torped per salva, ja' : `Spridning ${o.count} torpeder, ja`;
    case 'tube':
      return `${o.action === 'ready' ? 'Klart' : o.action === 'secure' ? 'Säkra' : 'Ladda'} tub ${o.tube}, ja`;
    case 'ping':
      return 'Ping, ja';
    case 'wire':
      return o.action === 'update' ? `Torped ${o.torpedo} mot målet, ja` : o.action === 'seek' ? `Torped ${o.torpedo} sök, ja` : o.action === 'cut' ? `Kapa tråden till torped ${o.torpedo}, ja` : `Torped ${o.torpedo} kurs ${String(Math.round(o.course ?? 0) % 360).padStart(3, '0')}, ja`;
    case 'doors':
      return o.shut ? 'Stäng vattentäta dörrar, ja' : 'Öppna vattentäta dörrar, ja';
    case 'drain':
      return o.compartment ? `Länsa ${(SUBMARINE.compartments.find((x) => x.id === o.compartment)?.name ?? o.compartment).toLowerCase()} först, ja` : 'Länsa det blötaste först, ja';
    case 'decoy':
      return o.course === undefined ? 'Lockmål akterut, ja' : `Lockmål på kurs ${String(Math.round(o.course) % 360).padStart(3, '0')}, ja`;
    case 'radarMast':
      return `Radarmast ${o.up ? 'upp' : 'ned'}, ja`;
    case 'radar':
      return o.on ? 'Radar sänd, ja' : 'Radar tyst, ja';
  }
}

/** Acknowledgements for `crew` orders: [to the crew, taken over]. */
const CREW_ACK: Record<CrewSystem | 'all', [string, string]> = {
  depth: ['Djup på auto, ja', 'Djup på hand, ja'],
  heading: ['Kurs på auto, ja', 'Kurs på hand, ja'],
  speed: ['Fart på telegraf, ja', 'Fart på varv, ja'],
  ballast: ['Besättningen sköter ballasten, ja', 'Du sköter ballasten, ja'],
  trim: ['Trimassistenten tar trimmet, ja', 'Trimassistenten avlöst, ja'],
  charging: ['Maskinisten sköter laddningen, ja', 'Du sköter laddningen, ja'],
  fireControl: ['Eldledaren mäter avstånd, ja', 'Du mäter avstånd själv, ja'],
  torpedoRoom: ['Torpedrummet sköter tuberna, ja', 'Du sköter tuberna, ja'],
  safetyNet: ['Skyddsnät på, ja', 'Skyddsnät av, ja'],
  all: ['Besättningen sköter allt, ja', 'Du sköter allt, ja'],
};
