// The plugin's generated data (tools/gen-plugin-data.ts) matches the shared
// JSON: the same parameters in the same order, and every bank and Classic
// Basses preset with the same values. Re-run the generator when this fails.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { params, patchToArray, validatePatch } from '../src/schema';
import { loadLibrary, ROOT } from '../tools/lib/data';

describe('plugin data', () => {
  it('Schema.h lists every parameter in schema order', () => {
    const h = readFileSync(join(ROOT, 'plugin/engine/generated/Schema.h'), 'utf8');
    const ids = [...h.matchAll(/^  \{ "([^"]+)"/gm)].map((m) => m[1]);
    expect(ids).toEqual(params.map((p) => p.id));
  });

  it('presets.json carries every preset with its current values', () => {
    const presets = JSON.parse(readFileSync(join(ROOT, 'plugin/resources/presets.json'), 'utf8')) as { name: string; values: number[] }[];
    const lib = loadLibrary().filter((e) => e.json.meta.collection === 'bank' || e.json.meta.collection === 'terror' || !e.json.meta.category);
    expect(presets.length).toBe(lib.length);
    const byName = new Map(presets.map((p) => [p.name, p.values]));
    for (const e of lib) expect(byName.get(e.json.meta.name), e.file).toEqual(Array.from(patchToArray(validatePatch(e.json).patch)));
  });
});
