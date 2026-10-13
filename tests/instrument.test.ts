// Instrument additions for the preset bank: delayed vibrato, breath (attack
// chiff and sustained), and the long envelope ranges risers and bells need.
import { describe, expect, it } from 'vitest';
import { renderPatch } from '../src/engine/core/render';
import { bandPower, powerSpectrum } from '../src/analysis/spectrum';
import { heldNote, rms } from './helpers/audio';

const FS = 48000;
const base = {
  meta: { name: 't' }, 'voice.analog': 0, 'sub.level': 0, 'osc1.wave': 'sine', 'osc1.level': 0.7, 'filter.cutoff': 20000,
  'amp_env.attack': 2, 'amp_env.sustain': 1, 'comp.amount': 0,
};
const mono = (r: { left: Float32Array; right: Float32Array }) => Float64Array.from(r.left, (v, i) => 0.5 * (v + r.right[i]));
/** Zero-crossing pitch over a window (clean sine). */
function zcHz(x: Float64Array, from: number, to: number): number {
  let n = 0, first = -1, last = -1;
  for (let i = Math.round(from * FS) + 1; i < Math.round(to * FS); i++) {
    if (x[i - 1] < 0 && x[i] >= 0) {
      const t = i - 1 + x[i - 1] / (x[i - 1] - x[i]);
      if (first < 0) first = t;
      last = t;
      n++;
    }
  }
  return ((n - 1) * FS) / (last - first);
}
const spreadCents = (x: Float64Array, from: number, to: number) => {
  const f: number[] = [];
  for (let t = from; t < to; t += 0.04) f.push(zcHz(x, t, t + 0.04));
  return 1200 * Math.log2(Math.max(...f) / Math.min(...f));
};

describe('delayed vibrato', () => {
  it('starts straight, then wobbles by about the set depth', () => {
    const p = { ...base, 'vibrato.depth': 30, 'vibrato.rate': 5, 'vibrato.delay': 500, 'vibrato.fade': 200 };
    const x = mono(renderPatch(p, heldNote(57, 6), { seconds: 2.5 }));
    expect(spreadCents(x, 0.05, 0.45)).toBeLessThan(4);
    const late = spreadCents(x, 1.2, 2.2);
    expect(late).toBeGreaterThan(35);
    expect(late).toBeLessThan(80);
  });
});

describe('breath', () => {
  it('chiff is a noise burst at the attack that dies away', () => {
    const p = { ...base, 'osc1.level': 0, 'breath.chiff': 1, 'breath.decay': 80 };
    const r = renderPatch(p, heldNote(57, 4), { seconds: 1 });
    expect(rms(r.left, 0.005 * FS, 0.05 * FS)).toBeGreaterThan(rms(r.left, 0.6 * FS, 0.9 * FS) * 20);
  });
  it('sustained breath follows the note and sits where its tone says', () => {
    const dark = mono(renderPatch({ ...base, 'osc1.level': 0, 'breath.level': 0.8, 'breath.tone': 0.1 }, heldNote(57, 4), { seconds: 1 }));
    const airy = mono(renderPatch({ ...base, 'osc1.level': 0, 'breath.level': 0.8, 'breath.tone': 0.9 }, heldNote(57, 4), { seconds: 1 }));
    const ratio = (x: Float64Array) => { const s = powerSpectrum(x, FS, 0.3 * FS, 0.9 * FS, 8192); return bandPower(s, 3000, 12000) / bandPower(s, 200, 1500); };
    expect(rms(Float32Array.from(dark), 0.3 * FS, 0.9 * FS)).toBeGreaterThan(1e-3);
    expect(ratio(airy)).toBeGreaterThan(ratio(dark) * 10);
  });
  it('goes through the filter', () => {
    const open = mono(renderPatch({ ...base, 'osc1.level': 0, 'breath.level': 0.8, 'breath.tone': 0.8 }, heldNote(57, 4), { seconds: 1 }));
    const shut = mono(renderPatch({ ...base, 'osc1.level': 0, 'breath.level': 0.8, 'breath.tone': 0.8, 'filter.cutoff': 300 }, heldNote(57, 4), { seconds: 1 }));
    expect(rms(Float32Array.from(shut), 0.3 * FS, 0.9 * FS)).toBeLessThan(rms(Float32Array.from(open), 0.3 * FS, 0.9 * FS) * 0.3);
  });
});

describe('long envelopes', () => {
  it('env 2 can rise over many seconds (risers)', () => {
    const p = { ...base, 'env2.attack': 8000, 'env2.sustain': 1, 'mod1.source': 'env2', 'mod1.dest': 'pitch', 'mod1.amount': 0.5 };
    const x = mono(renderPatch(p, heldNote(45, 24), { seconds: 9 }));
    const f1 = zcHz(x, 1, 1.2), f2 = zcHz(x, 4, 4.2), f3 = zcHz(x, 8.5, 8.7);
    expect(f2).toBeGreaterThan(f1 * 1.2);
    expect(f3).toBeGreaterThan(f2 * 1.2);
  });
  it('a bell can ring for many seconds', () => {
    const p = { ...base, 'amp_env.decay': 12000, 'amp_env.sustain': 0 };
    const r = renderPatch(p, heldNote(69, 24), { seconds: 7 });
    expect(rms(r.left, 6 * FS, 6.5 * FS)).toBeGreaterThan(rms(r.left, 0.1 * FS, 0.5 * FS) * 0.05);
  });
});
