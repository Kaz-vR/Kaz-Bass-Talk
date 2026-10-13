// Style checks for the preset bank: every preset earns its place (stamped
// by tools/analyze-library.ts and re-verified on a sample here), sits in its
// category's LORN fingerprint zone (via the critic test) and with the rest of
// the bank; deliberately fake-complex and off-style test sounds are caught.
import { describe, expect, it } from 'vitest';
import { analyzePatch } from '../src/analysis';
import { earnsItsPlace } from '../src/quality/ablation';
import { analysisSetup, categories } from '../src/quality/categories';
import { outliers, type Vibe } from '../src/quality/consistency';
import { judge } from '../src/quality/critic';
import { paramHash } from '../src/quality/stamp';
import { validatePatch } from '../src/schema';
import { libraryPatches, loop } from './helpers/audio';

const bank = libraryPatches().filter(({ json }) => json.meta.category);

describe('preset bank', () => {
  it('every preset names a known category', () => {
    const ids = new Set(categories.map((c) => c.id));
    for (const { file, json } of bank) expect(ids, file).toContain(json.meta.category);
  });

  it.each(bank.map((e) => [e.file, e.json]))('%s earns its place (stamp matches the sound)', (_f, json) => {
    const checks = json.meta.checks;
    expect(checks, 'run npm run analyze:library').toBeTruthy();
    expect(checks.hash, 'sound changed since the check: run npm run analyze:library').toBe(paramHash(validatePatch(json).patch));
    expect(checks.failing).toEqual([]);
    expect(checks.earns).toBe(true);
  });

  it('every preset sits with the rest of the bank', () => {
    const odd = outliers(bank.map(({ json }) => ({ name: json.meta.name, vibe: json.meta.vibe as Vibe })));
    expect(odd.map((o) => `${o.name}: ${o.key} ${o.value} (median ${o.median})`)).toEqual([]);
  });

  it('a re-run of earns-its-place agrees with the stamp (sample preset)', () => {
    // One preset per run, chosen by the bank size so the sample moves as the bank grows.
    const { json } = bank[(bank.length * 5 + 3) % bank.length];
    const setup = analysisSetup(json.meta);
    const res = earnsItsPlace(json, loop(setup.loop), { seconds: setup.opts.loopSeconds, sampleRate: 32000 });
    expect(res.filter((r) => !r.pass).map((r) => r.ingredient.label)).toEqual([]);
  }, 120000);
});

describe('style checks catch off-style and fake-complex sounds', () => {
  const pad = {
    meta: { name: 'test pad', category: 'pad' }, 'voice.polyphony': 6, 'osc1.wave': 'saw', 'osc1.unison_voices': 3, 'osc1.unison_detune': 15,
    'amp_env.attack': 300, 'amp_env.sustain': 1, 'amp_env.release': 800, 'filter.cutoff': 1500, 'sub.level': 0,
  };
  it('a clean, dry, mono pad is off-style', () => {
    const setup = analysisSetup(pad.meta);
    const clean = { ...pad, 'osc1.unison_voices': 1, 'amp_env.release': 80 };
    const v = judge(analyzePatch(clean, loop(setup.loop), { ...setup.opts, life: false }).raw, undefined, 'pad');
    const codes = v.issues.map((i) => i.code);
    expect(codes).toContain('vibeTail');
    expect(codes).toContain('vibeDirt');
  });
  it('an ingredient that does nothing is caught', () => {
    const p = { ...pad, 'crush.mix': 0.05, 'crush.bits': 12, 'eq.highcut': 5000, 'reverb.mix': 0.3, 'fx.lowcut': 250 };
    const res = earnsItsPlace(p, loop('chords'), { seconds: 4, sampleRate: 32000 });
    expect(res.find((r) => r.ingredient.id === 'crush')!.pass).toBe(false);
    expect(res.find((r) => r.ingredient.id === 'reverb')!.pass).toBe(true);
  }, 120000);
});
