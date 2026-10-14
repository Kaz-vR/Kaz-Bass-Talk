// The quality critic must catch known-bad sounds for the right reason and
// pass the library.
import { describe, expect, it } from 'vitest';
import { analyzePatch, measureLife, type RawMeasures } from '../src/analysis';
import { renderPatch } from '../src/engine/core/render';
import { analysisSetup } from '../src/quality/categories';
import { judge, limitsFor } from '../src/quality/critic';
import { libraryPatches, loop } from './helpers/audio';
import { applyAllowances } from '../tools/lib/allow';

const groove = loop('groove');
const base = { meta: { name: 'bad' }, 'osc1.wave': 'saw', 'osc1.level': 0.8, 'sub.level': 0.4, 'voice.analog': 0 };

// Each sound is broken in one deliberate way.
const BAD: [string, object, string][] = [
  ['fizzy (folded to bits, top boosted)', { ...base, 'filter.cutoff': 20000, 'dist.type': 'fold', 'dist.drive': 1, 'eq.high_gain': 12, 'ott.amount': 1 }, 'aliasDb'],
  ['harsh (hard clip, 3.5 kHz boost)', { ...base, 'osc1.unison_voices': 7, 'osc1.unison_detune': 30, 'filter.cutoff': 20000, 'dist.type': 'hard', 'dist.drive': 0.7, 'eq.high_gain': 12, 'eq.mid_gain': 8, 'eq.mid_freq': 3500 }, 'harshDb'],
  ['muddy (300 Hz boost)', { ...base, 'filter.cutoff': 700, 'eq.mid_gain': 12, 'eq.mid_freq': 300 }, 'mudDb'],
  ['thin (band-pass, no sub)', { ...base, 'sub.level': 0, 'filter.type': 'bandpass', 'filter.cutoff': 2500, 'filter.keytrack': 0 }, 'fundamentalDb'],
  ['whistling (resonance at max)', { ...base, 'filter.cutoff': 900, 'filter.resonance': 1, 'filter.keytrack': 0 }, 'whistleDb'],
  ['uneven (fixed 90 Hz low-pass)', { ...base, 'sub.level': 0, 'filter.cutoff': 90, 'filter.keytrack': 0, 'filter.resonance': 0 }, 'noteSpreadDb'],
  ['slammed into the limiter', { ...base, 'dist.type': 'hard', 'dist.drive': 0.6, 'output.gain': 12 }, 'limiterDb'],
];

describe('critic rejects known-bad sounds for the right reason', () => {
  it.each(BAD)('%s', (_name, patch, code) => {
    const v = judge(analyzePatch(patch, groove).raw);
    expect(v.pass).toBe(false);
    expect(v.issues.map((i) => i.code)).toContain(code);
    expect(v.issues[0].message.length).toBeGreaterThan(10);
  });
});

describe('critic checks that need no render', () => {
  const ok: RawMeasures = {
    centroidHz: 200, highDb: -30, subShare: 0.4, lowMidShare: 0.3, harshDb: -20, mudDb: 0, flatness: 0.01, widthDb: -20, sideLowDb: -90,
    attackMs: 5, decayMs: 1000, sustainDb: -2, releaseMs: 100, movementDb: 1, fundamentalDb: { low: -1, mid: -1, high: -2 },
    noteSpreadDb: 1, aliasDb: -80, whistleDb: 2, peak: 0.7, limiterDb: 0, dc: 0, textureDb: null, brightOct: 1, airDb: -40, tailDb: -20,
  };
  it('passes a clean measurement', () => expect(judge(ok).pass).toBe(true));
  it('flags a stereo low end', () => expect(judge({ ...ok, sideLowDb: -6 }).issues[0].code).toBe('sideLowDb'));
  it('flags DC', () => expect(judge({ ...ok, dc: 0.01 }).issues[0].code).toBe('dc'));
  it('flags a texture bed that buries the bass', () => expect(judge({ ...ok, textureDb: -3 }).issues[0].code).toBe('textureDb'));
  it('passes a texture bed under the bass', () => expect(judge({ ...ok, textureDb: -20 }).pass).toBe(true));
  it('skips aliasing when it is not measurable', () => expect(judge({ ...ok, aliasDb: null }).pass).toBe(true));
  it('gives aggressive families wider limits', () => {
    const edgy = { ...ok, harshDb: -5.5 };
    expect(judge(edgy).pass).toBe(false);
    expect(judge(edgy, 'distorted').pass).toBe(true);
    expect(limitsFor('distorted').harshDb.max).toBeGreaterThan(limitsFor().harshDb.max!);
  });
});

describe('every Bass Atlas patch passes the critic', () => {
  // Bank presets carry stamped verdicts (tests/bank.test.ts) and a re-analyzed sample below.
  for (const { file, json } of libraryPatches().filter(({ json }) => !json.meta.category)) {
    it(file, () => {
      const setup = analysisSetup(json.meta);
      const v = applyAllowances(judge(analyzePatch(json, loop(setup.loop), setup.opts).raw, json.meta.family, json.meta.category), json.meta);
      expect(v.issues.map((i) => i.message)).toEqual([]);
    });
  }
});

describe('alive (terror family)', () => {
  const H = 7;
  const life = (p: object) => {
    const r = renderPatch(p, { id: 'h', name: 'h', description: '', bpm: 120, length_beats: H * 4, notes: [{ start: 0, dur: H * 2, note: 45, vel: 0.85 }] }, { seconds: H });
    return measureLife(Float64Array.from(r.left, (v, i) => 0.5 * (v + r.right[i])), 48000, 24000, H * 48000);
  };
  const base = { meta: { name: 't' }, 'voice.analog': 0, 'sub.level': 0.5, 'filter.cutoff': 900, 'amp_env.sustain': 1, 'osc1.wave': 'saw', 'osc1.level': 0.8 };
  const ok = judge(analyzePatch(base, groove).raw).pass;
  it('a static saw is not alive', () => {
    expect(ok).toBe(true);
    const l = life(base);
    expect(l.slowDb).toBeLessThan(limitsFor('terror').lifeSlowDb.min!);
    expect(l.fastDb).toBeLessThan(limitsFor('terror').lifeFastDb.min!);
  });
  it('a tempo-synced wobble is caught as mechanical', () => {
    const l = life({ ...base, 'lfo1.sync': '1/4', 'mod1.source': 'lfo1', 'mod1.dest': 'filter_cutoff', 'mod1.amount': 0.2 });
    expect(l.repeat).toBeGreaterThan(limitsFor('terror').lifeRepeat.max!);
  });
  it('slow smooth motion is not mistaken for repetition', () => {
    const l = life({ ...base, 'lfo1.rate': 0.15, 'mod1.source': 'lfo1', 'mod1.dest': 'filter_cutoff', 'mod1.amount': 0.2 });
    expect(l.repeat).toBeLessThan(0.3);
  });
  it('layered, non-repeating movement passes', () => {
    const l = life({ ...base, 'osc1.unison_voices': 5, 'osc1.unison_detune': 18, 'voice.analog': 0.6, 'tape.wow': 0.3,
      'lfo1.shape': 'wander', 'lfo1.rate': 0.4, 'lfo2.shape': 'wander', 'lfo2.rate': 2.3,
      'mod1.source': 'lfo1', 'mod1.dest': 'filter_cutoff', 'mod1.amount': 0.18, 'mod2.source': 'lfo2', 'mod2.dest': 'filter_cutoff', 'mod2.amount': 0.06 });
    const lim = limitsFor('terror');
    expect(l.slowDb).toBeGreaterThan(lim.lifeSlowDb.min!);
    expect(l.fastDb).toBeGreaterThan(lim.lifeFastDb.min!);
    expect(l.repeat).toBeLessThan(lim.lifeRepeat.max!);
  });
  it('a terror patch without a life measurement fails', () => {
    const raw = analyzePatch(base, groove, { life: false }).raw;
    expect(judge(raw, 'terror').issues.map((i) => i.code)).toContain('lifeSlowDb');
  });
});

describe('bank presets pass the critic (re-analyzed sample)', () => {
  const bank = libraryPatches().filter(({ json }) => json.meta.category);
  // Three presets per run, spread over the bank and moving as it grows.
  const sample = [0, 1, 2].map((k) => bank[(k * 53 + bank.length * 7) % bank.length]);
  for (const { file, json } of sample) {
    it(file, () => {
      const setup = analysisSetup(json.meta);
      const v = judge(analyzePatch(json, loop(setup.loop), setup.opts).raw, json.meta.family, json.meta.category);
      expect(v.issues.map((i) => i.message)).toEqual([]);
    }, 120000);
  }
});
