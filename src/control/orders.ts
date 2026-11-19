/**
 * Every steering command – from the keyboard or the console – becomes a
 * typed Order. Orders are queued and executed at the start of the next
 * simulation step. Angles are in degrees and speeds in knots here (the
 * operator's units); the controller converts to SI.
 */
export type OrderSource = 'keyboard' | 'console';

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
  | { kind: 'autopilot'; axis: AutopilotAxis; on: boolean };

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
      return `Fart ${fmt(o.knots)} knop, ja`;
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
  }
}
