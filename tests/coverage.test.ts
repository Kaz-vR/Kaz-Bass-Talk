// Coverage: every category uses the ingredients that make sense for it, and
// every must-have sound (data/coverage.json) exists with its identity intact.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { validatePatch } from '../src/schema';
import { INGREDIENTS, missing, type Coverage } from '../tools/lib/coverage';
import { ROOT } from '../tools/lib/data';
import { libraryPatches } from './helpers/audio';

const cov = JSON.parse(readFileSync(join(ROOT, 'data/coverage.json'), 'utf8')) as Coverage;
const lib = libraryPatches().map(({ file, json }) => ({ id: file.replace(/\.json$/, ''), patch: validatePatch(json).patch }));

describe('coverage', () => {
  it.each(Object.keys(cov.categories))('%s uses every sensible ingredient', (c) => {
    expect(missing(cov, c, lib.filter((e) => e.patch.meta.category === c).map((e) => e.patch))).toEqual([]);
  });

  it.each([...cov.iconic, ...cov.targets].map((s) => [s.name, s]))('%s exists and keeps its identity', (_n, s) => {
    const e = lib.find((x) => x.id === s.preset);
    expect(e, `${s.preset} is missing`).toBeTruthy();
    expect(e!.patch.meta.category).toBe(s.category);
    expect(s.requires.filter((r) => !INGREDIENTS[r](e!.patch))).toEqual([]);
  });

  it('every iconic preset carries the Iconic tag', () => {
    for (const s of [...cov.iconic, ...cov.targets]) expect(lib.find((x) => x.id === s.preset)!.patch.meta.iconic, s.preset).toBe(true);
  });
});
