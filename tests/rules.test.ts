import { describe, expect, it } from 'vitest';
import { checkRules, inRegion, safeRegions } from '../src/quality/rules';
import { validatePatch, type Patch } from '../src/schema';
import { libraryPatches } from './helpers/audio';

const P = (o: object, family?: string): Patch => validatePatch({ meta: { name: 't', family }, ...o }).patch;
const rules = (o: object, family: string) => checkRules(P(o, family), family).map((r) => r.rule);

describe('sound-design rules', () => {
  it('library patches break no rule outright', () => {
    for (const { file, json } of libraryPatches()) {
      const errors = checkRules(validatePatch(json).patch, json.meta.family).filter((r) => r.severity === 'error');
      expect(errors, file).toEqual([]);
    }
  });
  it('flags distortion reaching the sub', () => {
    expect(rules({ 'dist.drive': 0.6, 'dist.mix': 1, 'sub.level': 0 }, 'reese')).toContain('clean-low-end');
    expect(rules({ 'dist.drive': 0.6, 'dist.mix': 1, 'sub.level': 0, 'dist.clean_below': 150 }, 'reese')).not.toContain('clean-low-end');
    expect(rules({ 'dist.drive': 0.6, 'dist.mix': 1, 'sub.level': 0 }, 'distorted')).not.toContain('clean-low-end');
  });
  it('flags effects reaching the low end', () => {
    expect(rules({ 'chorus.mix': 0.5, 'fx.lowcut': 50 }, 'synthwave')).toContain('fx-low-cut');
    expect(rules({ 'chorus.mix': 0.5, 'fx.lowcut': 250 }, 'synthwave')).not.toContain('fx-low-cut');
  });
  it('flags envelopes that do not fit the family', () => {
    expect(rules({ 'amp_env.sustain': 1 }, '808')).toContain('envelope-family');
    expect(rules({ 'amp_env.sustain': 0 }, 'reese')).toContain('envelope-family');
  });
  it('flags static sustained patches but not deliberately static types', () => {
    const still = { 'voice.analog': 0, 'amp_env.sustain': 1 };
    expect(rules(still, 'reese')).toContain('movement');
    expect(rules(still, 'sub')).not.toContain('movement');
    expect(rules({ ...still, 'chorus.mix': 0.3 }, 'reese')).not.toContain('movement');
  });
  it('flags whistling resonance outside acid', () => {
    expect(rules({ 'filter.resonance': 0.9 }, 'analog')).toContain('resonance');
    expect(rules({ 'filter.resonance': 0.9 }, 'acid')).not.toContain('resonance');
  });
});

describe('safe regions', () => {
  const lib = libraryPatches().map(({ json }) => validatePatch(json).patch);
  const regions = safeRegions(lib);
  it('every library patch lies inside its own family region', () => {
    for (const p of lib) expect(inRegion(p, regions[p.meta.family as string])).toBe(true);
  });
  it('a far-off setting falls outside', () => {
    const p = { ...lib[0], 'filter.cutoff': 20000, 'filter.resonance': 1 } as Patch;
    expect(inRegion(p, regions[p.meta.family as string])).toBe(false);
  });
});
