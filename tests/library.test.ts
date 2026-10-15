import { describe, expect, it } from 'vitest';
import { validatePatch } from '../src/schema';
import { libraryPatches, loops } from './helpers/audio';

describe('patch library', () => {
  const lib = libraryPatches();

  it('has a patch for every bass type', () => {
    expect(lib.length).toBeGreaterThanOrEqual(51);
  });

  it.each(lib.map((e) => [e.file, e.json]))('%s is complete and valid', (_file, json) => {
    const { issues } = validatePatch(json);
    expect(issues).toEqual([]);
    expect(json.meta.name).toBeTruthy();
    expect(json.meta.description.length).toBeGreaterThan(20);
    expect(json.meta.tags.length).toBeGreaterThanOrEqual(3);
  });

  it('has unique names', () => {
    const names = lib.map((e) => e.json.meta.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it('has no hidden octave: every register shows on the oscillators and the sub', () => {
    expect(lib.filter(({ json }) => (json['voice.octave'] ?? 0) !== 0).map((e) => e.file)).toEqual([]);
  });

  it('only references audition loops that exist', () => {
    const ids = new Set(loops().map((l) => l.id));
    for (const { json } of lib) if (json.meta.audition) expect(ids).toContain(json.meta.audition);
  });
});

describe('audition loops', () => {
  it.each(loops().map((l) => [l.id, l]))('%s is well-formed', (_id, l) => {
    expect(l.bpm).toBeGreaterThan(40);
    expect(l.notes.length).toBeGreaterThan(0);
    for (const n of l.notes) {
      expect(n.start).toBeGreaterThanOrEqual(0);
      expect(n.start).toBeLessThan(l.length_beats);
      expect(n.dur).toBeGreaterThan(0);
      expect(n.vel).toBeGreaterThan(0);
      expect(n.vel).toBeLessThanOrEqual(1);
      expect(Number.isInteger(n.note)).toBe(true);
    }
  });

  it('includes the default loop', () => {
    expect(loops().map((l) => l.id)).toContain('groove');
  });
});
