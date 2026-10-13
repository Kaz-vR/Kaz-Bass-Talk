// The quality critic must catch known-bad sounds for the right reason and
// pass the library.
import { describe, expect, it } from 'vitest';
import { analyzePatch, type RawMeasures } from '../src/analysis';
import { judge, limitsFor } from '../src/quality/critic';
import { libraryPatches, loop } from './helpers/audio';

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
    noteSpreadDb: 1, aliasDb: -80, whistleDb: 2, peak: 0.7, limiterDb: 0, dc: 0,
  };
  it('passes a clean measurement', () => expect(judge(ok).pass).toBe(true));
  it('flags a stereo low end', () => expect(judge({ ...ok, sideLowDb: -6 }).issues[0].code).toBe('sideLowDb'));
  it('flags DC', () => expect(judge({ ...ok, dc: 0.01 }).issues[0].code).toBe('dc'));
  it('skips aliasing when it is not measurable', () => expect(judge({ ...ok, aliasDb: null }).pass).toBe(true));
  it('gives aggressive families wider limits', () => {
    const edgy = { ...ok, harshDb: -5.5 };
    expect(judge(edgy).pass).toBe(false);
    expect(judge(edgy, 'distorted').pass).toBe(true);
    expect(limitsFor('distorted').harshDb.max).toBeGreaterThan(limitsFor().harshDb.max!);
  });
});

describe('every library patch passes the critic', () => {
  for (const { file, json } of libraryPatches()) {
    it(file, () => {
      const v = judge(analyzePatch(json, groove).raw, json.meta.family);
      expect(v.issues.map((i) => i.message)).toEqual([]);
    });
  }
});
