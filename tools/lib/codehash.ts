// DEV ONLY. A hash of everything a preset's checks depend on besides its own
// parameters: the engine, analysis and quality code and the data they read.
// Stamps made with an older hash are stale (the tests reject them).
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(new URL('../..', import.meta.url).pathname);
const SOURCES = ['src/engine/core', 'src/analysis', 'src/quality', 'data/loops'];
const FILES = ['data/schema.json', 'data/quality.json', 'data/categories.json', 'src/schema/index.ts'];

let cached: string | null = null;

export function codeHash(): string {
  if (cached) return cached;
  const files = [...FILES];
  for (const dir of SOURCES) for (const f of readdirSync(join(ROOT, dir)).sort()) files.push(`${dir}/${f}`);
  let h = 0x811c9dc5;
  for (const f of files) {
    const s = f + readFileSync(join(ROOT, f), 'utf8');
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
  }
  cached = h.toString(16).padStart(8, '0');
  return cached;
}
