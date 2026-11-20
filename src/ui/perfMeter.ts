/**
 * Optional performance meter: add `?perf` to the address. Shows, per
 * rendered frame, the time spent on the physics (all fixed steps of the
 * frame), on rendering (3D scene and overlay) and on the HUD/sound, and the
 * physics time per step. Averages over one second.
 */
export interface PerfMeter {
  begin(): void;
  mark(part: 'sim' | 'render' | 'ui'): void;
  steps(n: number): void;
  end(): void;
}

const noop: PerfMeter = { begin() {}, mark() {}, steps() {}, end() {} };

export function createPerfMeter(enabled: boolean): PerfMeter {
  if (!enabled) return noop;
  const el = document.createElement('div');
  el.className = 'perf-meter';
  document.body.append(el);
  const sum = { sim: 0, render: 0, ui: 0 };
  let frames = 0;
  let stepCount = 0;
  let t = 0;
  let windowStart = performance.now();
  return {
    begin() {
      t = performance.now();
    },
    mark(part) {
      const now = performance.now();
      sum[part] += now - t;
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
      el.textContent = `${(frames / ((now - windowStart) / 1000)).toFixed(0)} bilder/s · fysik ${f(sum.sim)} ms (${perStep} µs/steg) · grafik ${f(sum.render)} ms · UI ${f(sum.ui)} ms`;
      sum.sim = sum.render = sum.ui = 0;
      frames = stepCount = 0;
      windowStart = now;
    },
  };
}
