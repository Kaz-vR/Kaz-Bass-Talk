import { fileURLToPath } from 'node:url';
// DEV ONLY. Load library patches and loops from disk.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Loop } from '../../src/engine/core/sequencer';

export const ROOT = fileURLToPath(new URL('../..', import.meta.url));
export const LIBRARY_DIR = join(ROOT, 'data/library');
export const LOOPS_DIR = join(ROOT, 'data/loops');
export const DEFAULT_LOOP = 'groove';

export interface LibraryEntry {
  file: string;
  path: string;
  json: Record<string, unknown> & { meta: { name: string; audition?: string; [k: string]: unknown } };
}

export function loadLibrary(): LibraryEntry[] {
  return readdirSync(LIBRARY_DIR)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .map((file) => {
      const path = join(LIBRARY_DIR, file);
      return { file, path, json: JSON.parse(readFileSync(path, 'utf8')) };
    });
}

export function loadLoops(): Map<string, Loop> {
  const m = new Map<string, Loop>();
  for (const f of readdirSync(LOOPS_DIR).filter((f) => f.endsWith('.json'))) {
    const loop = JSON.parse(readFileSync(join(LOOPS_DIR, f), 'utf8')) as Loop;
    m.set(loop.id, loop);
  }
  return m;
}
