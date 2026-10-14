// The randomizer: rolls are valid, levelled sounds built from the bank,
// locked boxes stay exactly as they were, and the same seed rolls the same sound.
import { describe, expect, it } from 'vitest';
import { roll } from '../src/generator/randomizer';
import { renderPatch } from '../src/engine/core/render';
import { params, validatePatch } from '../src/schema';
import { libraryPatches, loop, peak } from './helpers/audio';

const bank = libraryPatches().filter(({ json }) => json.meta.category).map(({ json }) => validatePatch(json).patch);
const base = { basedOn: 'pad', weirdness: 0.5, locked: new Set<string>(), current: bank[0], bank, loop: loop('chords'), seed: 7 };

describe('randomizer', () => {
  it('rolls a valid, audible, unclipped sound with a name and a hint', () => {
    for (const w of [0, 0.5, 1]) {
      const r = roll({ ...base, weirdness: w, seed: 11 + w * 100 });
      expect(validatePatch(r.patch).issues).toEqual([]);
      expect(r.name.length).toBeGreaterThan(2);
      expect(r.hint).toMatch(/Behaves most like/);
      const out = renderPatch(r.patch, loop('chords'), { seconds: 1.5, sampleRate: 24000 });
      expect(peak(out.left, out.right)).toBeGreaterThan(0.01);
      expect(peak(out.left, out.right)).toBeLessThanOrEqual(1);
    }
  }, 60000);

  it('keeps locked boxes exactly as they are', () => {
    const locked = new Set(['filter', 'fx', 'lfo1']);
    const r = roll({ ...base, weirdness: 1, locked, current: bank[3], seed: 99 });
    for (const p of params.filter((d) => locked.has(d.group))) expect(r.patch[p.id], p.id).toEqual(bank[3][p.id]);
  }, 60000);

  it('the same seed rolls the same sound', () => {
    expect(roll(base).patch).toEqual(roll(base).patch);
  }, 60000);
});
