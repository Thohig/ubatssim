/**
 * The sonar equation, broadband (config/acoustics.ts): source levels of the
 * vessels and of the submarine, transmission loss with spreading,
 * absorption and the layers of the water, and the noise at a receiver.
 * Pure and deterministic; the control layer (sonar.ts) uses it for the
 * passive sonar and for patrol vessels hearing the submarine.
 */
import { ACOUSTICS as A } from './config/acoustics';
import type { WaterProfile } from './config/waters';
import type { VesselDef } from './vessel';

const KN = 1852 / 3600;
const log10 = Math.log10;

/** Radiated noise of a vessel at a speed [m/s] [dB re 1 µPa at 1 m]. */
export function vesselSourceLevel(def: VesselDef, speed: number): number {
  const base = A.vesselLevel[def.kind] ?? 160;
  return base + A.vesselSpeedExponent * log10(Math.max(0.5, speed) / A.vesselReferenceSpeed);
}

export interface SubNoise {
  /** Speed through the water [m/s]. */
  speed: number;
  depth: number;
  dieselRunning: boolean;
}

/** Speed [knots] above which the submarine's propeller cavitates at a depth [m]. */
export const cavitationSpeed = (depth: number): number => A.cavitationSpeed + Math.max(0, depth) / 10;

/** Radiated noise of the submarine [dB re 1 µPa at 1 m]: speed, cavitation and the diesels. */
export function subSourceLevel(s: SubNoise): number {
  const kn = Math.abs(s.speed) / KN;
  let sl = A.subLevel + A.subSpeedExponent * log10(Math.max(2, kn) / 4);
  if (kn > cavitationSpeed(s.depth)) sl += A.cavitationLevel;
  if (s.dieselRunning) sl += A.dieselLevel;
  return sl;
}

/**
 * Transmission loss [dB] over a horizontal range [m] between two depths:
 * spherical spreading, absorption, and `layerLoss` for every layer of the
 * water whose middle lies between the two depths.
 */
export function transmissionLoss(range: number, depthA: number, depthB: number, water: WaterProfile): number {
  const r = Math.max(1, Math.hypot(range, depthA - depthB));
  let tl = 20 * log10(r) + (A.absorption * r) / 1000;
  const lo = Math.min(depthA, depthB);
  const hi = Math.max(depthA, depthB);
  for (const l of water.layers) {
    const mid = (l.top + l.bottom) / 2;
    if (lo < mid && hi > mid) tl += A.layerLoss;
  }
  return tl;
}

/** Ambient noise in a sea state [dB]. */
export const ambientNoise = (seaHs: number): number => A.ambient + A.ambientPerWave * seaHs;

/** Noise at the submarine's hydrophones: the sea and its own flow noise, added as powers [dB]. */
export function subReceiverNoise(speed: number, seaHs: number): number {
  const kn = Math.abs(speed) / KN;
  const self = A.selfNoise + A.selfNoiseExponent * log10(Math.max(1, kn) / 4);
  return 10 * log10(10 ** (ambientNoise(seaHs) / 10) + 10 ** (self / 10));
}

/** Signal excess at the submarine's sonar for a source [dB]; > 0 = heard. */
export function subSignalExcess(sourceLevel: number, tl: number, noise: number): number {
  return sourceLevel - tl - noise + A.subArrayGain - A.subThreshold;
}

/** Signal excess at a patrol vessel's sonar for the submarine [dB]; > 0 = heard. */
export function patrolSignalExcess(subLevel: number, tl: number): number {
  return subLevel - tl - A.patrolNoise + A.patrolArrayGain - A.patrolThreshold;
}
