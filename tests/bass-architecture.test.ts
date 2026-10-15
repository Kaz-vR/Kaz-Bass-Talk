// The dark-bass architecture (tools/bank/bass-templates.ts): every dark bass
// uses exactly one octave template, its oscillators and sub sit where the
// template puts them, the sub is a clean sine, oscillators are high-passed
// before the drive, and stereo starts at 250 Hz.
import { describe, expect, it } from 'vitest';
import { TEMPLATE_TAG, type BassTemplate } from '../tools/bank/bass-templates';
import { libraryPatches } from './helpers/audio';

const EXPECT: Record<BassTemplate, { sub: number; o1: number; o2?: number; o2Silent?: boolean }> = {
  A: { sub: -1, o1: 0, o2: 0 }, B: { sub: -1, o1: 0, o2: 12 }, C: { sub: -1, o1: 0, o2: 7 }, D: { sub: -2, o1: -12, o2: 0 },
  E: { sub: -1, o1: 0, o2Silent: true }, F: { sub: -1, o1: 0, o2Silent: true }, G: { sub: -1, o1: 0, o2: 6 },
};
const byTag = new Map(Object.entries(TEMPLATE_TAG).map(([t, tag]) => [tag, t as BassTemplate]));
const basses = libraryPatches().filter(({ json }) => json.meta.category === 'bass' && ['bank', 'terror'].includes(json.meta.collection as string));

describe('dark bass architecture', () => {
  it.each(basses.map((b) => [b.file, b.json]))('%s follows its octave template', (_f, p) => {
    const tags = (p.meta.tags as string[]).filter((t) => byTag.has(t));
    expect(tags.length, 'exactly one template tag').toBe(1);
    const t = byTag.get(tags[0])!;
    const e = EXPECT[t];
    expect(p['sub.wave']).toBe('sine');
    expect(p['sub.octave']).toBe(e.sub);
    expect(p['osc1.semi']).toBe(e.o1);
    if (e.o2Silent) expect(p['osc2.level']).toBe(0);
    else {
      expect(p['osc2.semi']).toBe(e.o2);
      expect(p['osc2.level'] as number).toBeGreaterThan(0);
      expect(p['osc2.highpass'] as number).toBeGreaterThanOrEqual(120);
    }
    if (t === 'B') expect((p['osc2.level'] as number) / (p['osc1.level'] as number)).toBeLessThanOrEqual(0.71); // at least 3 dB under
    expect(p['osc1.highpass'] as number).toBeGreaterThanOrEqual(t === 'D' ? 60 : 120);
    expect(p['output.crossover']).toBe(250);
    expect(p['fx.lowcut'] as number).toBeGreaterThanOrEqual(250);
  });
});
