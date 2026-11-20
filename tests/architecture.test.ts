import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

function listTs(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? listTs(p) : p.endsWith('.ts') ? [p] : [];
  });
}

describe('architecture', () => {
  it('src/sim does not import three, DOM-bound or other layers', () => {
    const files = listTs(fileURLToPath(new URL('../src/sim', import.meta.url)));
    const forbidden = /from\s+['"](three|[^'"]*\/(render|ui|control|audio)\/[^'"]*)['"]/;
    for (const file of files) {
      const src = readFileSync(file, 'utf8');
      expect(src, file).not.toMatch(forbidden);
      expect(src, file).not.toMatch(/\b(window|document)\./);
    }
  });
});

describe('audio layer', () => {
  it('reads the simulation but does not import rendering, UI or control', () => {
    const files = listTs(fileURLToPath(new URL('../src/audio', import.meta.url)));
    for (const file of files) {
      expect(readFileSync(file, 'utf8'), file).not.toMatch(/from\s+['"](three|[^'"]*\/(render|ui|control)\/[^'"]*)['"]/);
    }
  });
});
