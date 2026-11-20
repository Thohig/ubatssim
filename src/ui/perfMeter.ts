/**
 * Optional performance meter: add `?perf` to the address. Shows, per
 * rendered frame, the time spent on the physics (all fixed steps of the
 * frame), on rendering (3D scene and overlay) and on the HUD/sound, and the
 * physics time per step. Averages over one second. Also what the graphics
 * card holds (geometries, textures, shader programs): it should not grow
 * when a game is started again.
 */
export interface PerfMeter {
  begin(): void;
  mark(part: 'sim' | 'render' | 'ui'): void;
  steps(n: number): void;
  /** Where to read what the graphics card holds (`renderer.info`). */
  memory(read: () => { geometries: number; textures: number; programs: number }): void;
  end(): void;
}

const noop: PerfMeter = { begin() {}, mark() {}, steps() {}, memory() {}, end() {} };

export function createPerfMeter(enabled: boolean): PerfMeter {
  if (!enabled) return noop;
  const el = document.createElement('div');
  el.className = 'perf-meter';
  document.body.append(el);
  const sum = { sim: 0, render: 0, ui: 0 };
  let frames = 0;
  let maxRender = 0;
  let stepCount = 0;
  let t = 0;
  let windowStart = performance.now();
  let readMemory: (() => { geometries: number; textures: number; programs: number }) | null = null;
  return {
    memory(read) {
      readMemory = read;
    },
    begin() {
      t = performance.now();
    },
    mark(part) {
      const now = performance.now();
      sum[part] += now - t;
      if (part === 'render') maxRender = Math.max(maxRender, now - t);
      t = now;
    },
    steps(n) {
      stepCount += n;
    },
    end() {
      frames++;
      const now = performance.now();
      if (now - windowStart < 1000) return;
      const f = (x: number) => (x / frames).toFixed(1);
      const perStep = stepCount ? ((sum.sim / stepCount) * 1000).toFixed(0) : '–';
      el.textContent = `${(frames / ((now - windowStart) / 1000)).toFixed(0)} bilder/s · fysik ${f(sum.sim)} ms (${perStep} µs/steg) · grafik ${f(sum.render)} ms (max ${maxRender.toFixed(0)}) · UI ${f(sum.ui)} ms`;
      const m = readMemory?.();
      if (m) el.textContent += ` · GPU ${m.geometries} geom, ${m.textures} tex, ${m.programs} prog`;
      sum.sim = sum.render = sum.ui = 0;
      frames = stepCount = 0;
      maxRender = 0;
      windowStart = now;
    },
  };
}
