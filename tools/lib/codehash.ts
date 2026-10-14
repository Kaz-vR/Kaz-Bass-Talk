// DEV ONLY. A hash of the code and data that *judge* a sound: analysis,
// quality critic, rules, style checks, their limits and the audition loops.
// The engine is deliberately not in it: a preset's own audio fingerprint
// (src/quality/stamp.ts) proves whether its sound changed. Stamps made with
// an older judge hash, or whose fingerprint no longer matches, are stale.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(new URL('../..', import.meta.url).pathname);
const SOURCES = ['src/analysis', 'src/quality', 'data/loops'];
const FILES = ['data/quality.json', 'data/categories.json'];

let cached: string | null = null;

export function judgeHash(): string {
  if (cached) return cached;
  const files = [...FILES];
  for (const dir of SOURCES) for (const f of readdirSync(join(ROOT, dir)).sort()) files.push(`${dir}/${f}`);
  let h = 0x811c9dc5;
  for (const f of files) {
    // The fingerprint itself lives in src/quality but doesn't judge anything.
    if (f === 'src/quality/stamp.ts') continue;
    const s = f + readFileSync(join(ROOT, f), 'utf8');
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
  }
  cached = h.toString(16).padStart(8, '0');
  return cached;
}
