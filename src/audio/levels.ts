/**
 * Sound levels from the simulation state. A pure function, so it can be
 * tested without an audio device: the engine (engine.ts) only turns these
 * numbers into Web Audio parameters. Gains are 0…1 before the master
 * volume; frequencies in Hz; rates in events per second.
 */
import type { Telemetry } from '../sim/simulation';

export type AudioView = 'external' | 'bridge' | 'periscope';
export type AudioConditions = 'day' | 'night' | 'fog';

export interface AudioInput {
  t: Telemetry;
  /** Motor power limit [W], to scale the motor sound. */
  maxPower: number;
  /** The low-pressure blower runs (surfaced, bridge manned). */
  lpBlower: boolean;
  view: AudioView;
  /** The camera is below the (wavy) water surface. */
  cameraUnderwater: boolean;
  conditions: AudioConditions;
  /** Significant wave height [m]. */
  seaHs: number;
  /** The area has an archipelago or coast in sight (gulls). */
  coastal: boolean;
  /** The nearest other vessel: range [m] and its propeller blade rate [Hz]. */
  ship?: { range: number; bladeRate: number };
}

export interface SoundLevels {
  motor: { gain: number; freq: number };
  /** Propeller: blade rate [Hz] modulates a noise band. */
  propeller: { gain: number; bladeRate: number };
  /** Another ship's propeller, heard through the hull: louder when near and when submerged. */
  shipNoise: { gain: number; bladeRate: number };
  cavitation: number;
  flow: { gain: number; cutoff: number };
  hydraulics: number;
  vent: number;
  flood: number;
  blow: number;
  pump: number;
  periscopeMotor: number;
  blower: number;
  /** Hull creaks per second (pressure changing). */
  creakRate: number;
  /** Echo sounder pings per second (0 = silent). */
  pingRate: number;
  /** Surroundings above the water. */
  wind: number;
  waves: number;
  /** Gull cries per second (day, near land, above water). */
  gullRate: number;
  /** Fog horn blasts per second. */
  foghornRate: number;
  /** Low-pass cutoff for the sounds from outside the hull [Hz]. */
  outsideCutoff: number;
}

const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
const DEG = Math.PI / 180;

/** Blades on the propeller (the blade rate is blades × rev/s). */
export const PROPELLER_BLADES = 7;
/** Ships are heard within this range [m]. */
export const SHIP_AUDIBLE_RANGE = 4000;
/** Depth [m] beyond which the hull creaks hard and the alarm sounds. */
export const CRUSH_WARNING_DEPTH = 250;

export function soundLevels(a: AudioInput): SoundLevels {
  const t = a.t;
  const rps = Math.abs(t.rps);
  const u = Math.abs(t.u);
  const depth = Math.max(0, t.depth);
  const mbt = t.tanks.filter((k) => k.kind === 'mainBallast');

  const power = clamp01(Math.abs(t.shaftPower) / a.maxPower);
  const motorOn = rps > 0.05 || Math.abs(t.rpsCmd) > 0.05;
  const motor = { gain: motorOn ? 0.12 + 0.5 * Math.sqrt(power) : 0, freq: 45 + 30 * rps };

  const propeller = { gain: 0.35 * clamp01(rps / 4), bladeRate: PROPELLER_BLADES * rps };
  const near = a.ship ? clamp01(1 - a.ship.range / SHIP_AUDIBLE_RANGE) : 0;
  const shipNoise = { gain: 0.4 * near * near * (t.submergedFraction > 0.99 ? 1 : 0.3), bladeRate: a.ship?.bladeRate ?? 0 };
  // Cavitation: a fast propeller near the surface, where the pressure is low.
  const cavitation = clamp01((rps - 2.6) / 1.4) * clamp01(1 - depth / 40) * 0.6;

  const flow = { gain: 0.45 * clamp01((u / 9) ** 2), cutoff: 250 + 120 * u };

  const moving = (cmd: number, now: number) => Math.abs(cmd - now) > 0.3 * DEG;
  const hydraulics = moving(t.rudderCmd, t.rudder) || moving(t.sternPlanesCmd, t.sternPlanes) ? 0.25 : 0;

  // Air rushes out while a vented tank still holds air; water pours in as it fills.
  const venting = mbt.filter((k) => k.ventOpen && k.fill < 0.995);
  const vent = venting.length ? 0.6 * Math.max(...venting.map((k) => clamp01((1 - k.fill) * 1.5))) : 0;
  const flood = venting.length ? 0.35 : 0;
  const blowing = mbt.some((k) => k.blowOpen);
  const blow = blowing ? 0.4 + 0.5 * clamp01(t.airPressure / 25e6) : 0;

  const pump = t.trimRemaining !== 0 || t.compRemaining !== 0 ? 0.2 : 0;
  const periscopeMotor = t.periscope > 0.001 && t.periscope < 0.999 ? 0.25 : 0;
  const blower = a.lpBlower ? 0.15 : 0;

  // Creaks follow the change of pressure: faster depth changes and deeper water.
  const creakRate = t.submergedFraction > 0.99 ? clamp01(Math.abs(t.depthRate) / 1.5) * (0.1 + depth / 150) + (depth > CRUSH_WARNING_DEPTH ? 1 : 0) : 0;

  // Echo sounder: pings get faster as the water under the keel runs out.
  const pingRate = t.depthUnderKeel < 10 ? 1 / (0.25 + Math.max(0, t.depthUnderKeel) / 8) : 0;

  const above = !a.cameraUnderwater;
  const onDeck = above && a.view !== 'periscope';
  const wind = onDeck ? 0.08 + 0.25 * clamp01(a.seaHs / 3) + 0.15 * clamp01(u / 8) : 0;
  const waves = above ? 0.1 + 0.4 * clamp01(a.seaHs / 3) : 0;
  const gullRate = onDeck && a.coastal && a.conditions === 'day' ? 0.12 : 0;
  const foghornRate = above && a.conditions === 'fog' ? 1 / 30 : 0;
  // Outside sounds are muffled through the water when the camera is under it.
  const outsideCutoff = a.cameraUnderwater ? 700 : 12000;

  return {
    motor,
    propeller,
    shipNoise,
    cavitation,
    flow,
    hydraulics,
    vent,
    flood,
    blow,
    pump,
    periscopeMotor,
    blower,
    creakRate,
    pingRate,
    wind,
    waves,
    gullRate,
    foghornRate,
    outsideCutoff,
  };
}
