// Measures every test file (`vitest run`, all of them) and writes the times [s]
// to tests/durations.json, which tests/sequencer.ts uses to split the files
// evenly over the CI machines. Run it when test files are added, split or
// become much slower: `npm run update-durations`.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';

const root = process.cwd();
const dir = mkdtempSync(join(tmpdir(), 'durations-'));
const out = join(dir, 'results.json');
try {
  execFileSync('npx', ['vitest', 'run', '--reporter=json', `--outputFile=${out}`], { stdio: ['ignore', 'ignore', 'inherit'] });
} catch {
  console.error('Some tests failed; the times are written anyway.');
}
const results = JSON.parse(readFileSync(out, 'utf8'));
rmSync(dir, { recursive: true, force: true });
const times = Object.fromEntries(
  results.testResults
    .map((t) => [relative(root, t.name).split('\\').join('/'), Math.round((t.endTime - t.startTime) / 100) / 10])
    .sort((a, b) => (a[0] < b[0] ? -1 : 1)),
);
writeFileSync(join(root, 'tests/durations.json'), `${JSON.stringify(times, null, 2)}\n`);
console.log(`tests/durations.json: ${Object.keys(times).length} files.`);
