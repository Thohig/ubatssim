import { readFileSync } from 'node:fs';
import { relative } from 'node:path';
import { BaseSequencer, type TestSpecification } from 'vitest/node';

const durations = JSON.parse(readFileSync(new URL('./durations.json', import.meta.url), 'utf8')) as Record<string, number>;

/**
 * Splits the test files over the CI machines (`--shard=i/n`) by measured time
 * instead of by the hash of the path, which put most of the long files on one
 * machine. The times [s] are in `tests/durations.json` (`npm run
 * update-durations`); a file not there counts as the median. The longest file
 * goes to the machine with the least so far (LPT), and every machine computes
 * the same split. Within a run, the longest files start first.
 */
export class DurationSequencer extends BaseSequencer {
  private weight(spec: TestSpecification): number {
    const path = relative(this.ctx.config.root, spec.moduleId).split('\\').join('/');
    return durations[path] ?? MEDIAN;
  }

  private byWeight(files: TestSpecification[]): TestSpecification[] {
    return [...files].sort((a, b) => this.weight(b) - this.weight(a) || (a.moduleId < b.moduleId ? -1 : 1));
  }

  override async shard(files: TestSpecification[]): Promise<TestSpecification[]> {
    const { index, count } = this.ctx.config.shard!;
    const load = new Array<number>(count).fill(0);
    const mine: TestSpecification[] = [];
    for (const spec of this.byWeight(files)) {
      const k = load.indexOf(Math.min(...load));
      load[k]! += this.weight(spec);
      if (k === index - 1) mine.push(spec);
    }
    return mine;
  }

  override async sort(files: TestSpecification[]): Promise<TestSpecification[]> {
    return this.byWeight(files);
  }
}

const MEDIAN = (() => {
  const v = Object.values(durations).sort((a, b) => a - b);
  return v[Math.floor(v.length / 2)] ?? 1;
})();
