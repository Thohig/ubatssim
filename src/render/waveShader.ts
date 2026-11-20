/**
 * The sea surface on the GPU. The vertex shader adds the same sum of
 * regular waves as the physics (src/sim/waves.ts) and its slope for the
 * normals, so nothing is computed per vertex on the CPU.
 *
 * Precision: GLSL floats are 32-bit. The phase of each component at the
 * grid's centre is therefore computed here in double precision every frame
 * (`packWaves`); the shader only adds k·(local offset), with offsets of a
 * few hundred metres. `elevationFromPacked` is the shader's formula in
 * TypeScript, and a test checks it against the physics.
 */
import type { WaveComponent } from '../sim/waves';

/** Components the shader has room for (the sea states use 7). */
export const MAX_WAVES = 8;

export interface PackedWaves {
  count: number;
  /** Per component: amplitude, wave number, direction (north, east) and the phase at the grid centre. */
  amp: Float32Array;
  k: Float32Array;
  dirN: Float32Array;
  dirE: Float32Array;
  phase0: Float32Array;
}

export function createPacked(): PackedWaves {
  return {
    count: 0,
    amp: new Float32Array(MAX_WAVES),
    k: new Float32Array(MAX_WAVES),
    dirN: new Float32Array(MAX_WAVES),
    dirE: new Float32Array(MAX_WAVES),
    phase0: new Float32Array(MAX_WAVES),
  };
}

/** Fills the shader parameters for a grid centred at (north0, east0) at time t. */
export function packWaves(comps: readonly WaveComponent[], north0: number, east0: number, t: number, out: PackedWaves): PackedWaves {
  out.count = Math.min(MAX_WAVES, comps.length);
  for (let i = 0; i < MAX_WAVES; i++) {
    const c = comps[i];
    if (!c || i >= out.count) {
      out.amp[i] = 0;
      continue;
    }
    out.amp[i] = c.a;
    out.k[i] = c.k;
    out.dirN[i] = c.dn;
    out.dirE[i] = c.de;
    // Phase at the centre, reduced to [0, 2π) in double precision.
    const ph = c.k * (c.dn * north0 + c.de * east0) - c.omega * t + c.phase;
    out.phase0[i] = ((ph % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
  }
  return out;
}

/** The shader's elevation formula: offsets (dn, de) [m] from the grid centre. */
export function elevationFromPacked(p: PackedWaves, dn: number, de: number): number {
  let h = 0;
  for (let i = 0; i < p.count; i++) h += p.amp[i]! * Math.cos(p.k[i]! * (p.dirN[i]! * dn + p.dirE[i]! * de) + p.phase0[i]!);
  return h;
}

/** GLSL: uniforms and a function giving (elevation, ∂η/∂north, ∂η/∂east) at a local offset. */
export const WAVE_GLSL = /* glsl */ `
uniform float uWaveAmp[${MAX_WAVES}];
uniform float uWaveK[${MAX_WAVES}];
uniform float uWaveDirN[${MAX_WAVES}];
uniform float uWaveDirE[${MAX_WAVES}];
uniform float uWavePhase0[${MAX_WAVES}];
uniform float uWaveHalf;
vec3 seaWave(float dn, float de) {
  float h = 0.0;
  float gn = 0.0;
  float ge = 0.0;
  for (int i = 0; i < ${MAX_WAVES}; i++) {
    float arg = uWaveK[i] * (uWaveDirN[i] * dn + uWaveDirE[i] * de) + uWavePhase0[i];
    float a = uWaveAmp[i];
    h += a * cos(arg);
    float s = -a * uWaveK[i] * sin(arg);
    gn += s * uWaveDirN[i];
    ge += s * uWaveDirE[i];
  }
  // Fade to the flat far water over the outer 15 % of the grid.
  float edge = max(abs(dn), abs(de)) / uWaveHalf;
  float fade = clamp((1.0 - edge) / 0.15, 0.0, 1.0);
  return vec3(h, gn, ge) * fade;
}
`;
