// Behaviour of the "expensive sound" stages: oversampling, split-band
// distortion, tape, bitcrusher, compressor, delay.
import { describe, expect, it } from 'vitest';
import { renderPatch } from '../src/engine/core/render';
import { fft, heldNote, rms } from './helpers/audio';

const FS = 48000;
const base = {
  meta: { name: 't' }, 'voice.analog': 0, 'sub.level': 0, 'filter.cutoff': 20000, 'filter.keytrack': 0,
  'filter.resonance': 0, 'amp_env.attack': 1, 'amp_env.sustain': 1,
};

/** Energy share (dB) of content that is NOT at a harmonic of f0, above 200 Hz. */
function inharmonicDb(x: Float32Array, f0: number, from = FS): number {
  const N = 32768;
  const re = new Float64Array(N), im = new Float64Array(N);
  for (let i = 0; i < N; i++) {
    const t = (2 * Math.PI * i) / (N - 1);
    re[i] = x[from + i] * (0.35875 - 0.48829 * Math.cos(t) + 0.14128 * Math.cos(2 * t) - 0.01168 * Math.cos(3 * t));
  }
  fft(re, im);
  let harm = 0, other = 0;
  for (let k = Math.round((200 * N) / FS); k < N / 2; k++) {
    const f = (k * FS) / N;
    const e = re[k] ** 2 + im[k] ** 2;
    const d = Math.abs(f / f0 - Math.round(f / f0)) * f0;
    if (d < 8) harm += e;
    else other += e;
  }
  return 10 * Math.log10(other / (harm + other));
}

describe('oversampled distortion', () => {
  it('a hard-clipped saw on a high note stays clean (aliasing ≤ -50 dB)', () => {
    const p = { ...base, 'osc1.wave': 'saw', 'osc1.level': 1, 'dist.type': 'hard', 'dist.drive': 0.8 };
    const r = renderPatch(p, heldNote(76, 8), { seconds: 2 }); // E5 ≈ 659 Hz
    expect(inharmonicDb(r.left, 440 * 2 ** ((76 - 69) / 12))).toBeLessThan(-50);
  });

  it('the wavefolder stays clean too', () => {
    const p = { ...base, 'osc1.wave': 'saw', 'osc1.level': 1, 'dist.type': 'fold', 'dist.drive': 0.5, 'filter.cutoff': 3000 };
    const r = renderPatch(p, heldNote(57, 8), { seconds: 2 });
    expect(inharmonicDb(r.left, 220)).toBeLessThan(-50);
  });
});

describe('split-band distortion', () => {
  it('keeps the low end clean when dist.clean_below is set', () => {
    // A low sine through heavy hard clipping: with the split, its harmonics mostly vanish.
    const sine = { ...base, 'osc1.wave': 'sine', 'osc1.level': 1, 'dist.type': 'hard', 'dist.drive': 1 };
    const full = renderPatch(sine, heldNote(33, 8), { seconds: 2 }); // 55 Hz
    const split = renderPatch({ ...sine, 'dist.clean_below': 250 }, heldNote(33, 8), { seconds: 2 });
    const above = (x: Float32Array) => {
      const N = 32768, re = new Float64Array(N), im = new Float64Array(N);
      for (let i = 0; i < N; i++) re[i] = x[FS + i];
      fft(re, im);
      let hi = 0, all = 0;
      for (let k = 1; k < N / 2; k++) {
        const e = re[k] ** 2 + im[k] ** 2;
        all += e;
        if ((k * FS) / N > 120) hi += e;
      }
      return hi / all;
    };
    // (The residue is the ladder filter's own gentle saturation, present in both.)
    expect(above(split.left)).toBeLessThan(above(full.left) * 0.2);
  });
});

describe('the sub is untouched by voice effects', () => {
  const subOnly = { ...base, 'osc1.level': 0, 'sub.level': 1 };
  it.each([
    ['tape', { 'tape.drive': 1, 'tape.wow': 1 }],
    ['bitcrusher', { 'crush.mix': 1, 'crush.bits': 3, 'crush.rate': 20 }],
    ['distortion', { 'dist.drive': 1, 'dist.type': 'fold' }],
  ] as const)('%s', (_name, fx) => {
    const a = renderPatch(subOnly, heldNote(45, 4), { seconds: 1 });
    const b = renderPatch({ ...subOnly, ...fx }, heldNote(45, 4), { seconds: 1 });
    let maxDiff = 0;
    for (let i = 0; i < a.left.length; i++) maxDiff = Math.max(maxDiff, Math.abs(a.left[i] - b.left[i]));
    expect(maxDiff).toBeLessThan(1e-3);
  });
});

it('tape age only adds quiet hiss on top of the sub', () => {
  const subOnly = { ...base, 'osc1.level': 0, 'sub.level': 1 };
  const a = renderPatch(subOnly, heldNote(45, 4), { seconds: 1 });
  const b = renderPatch({ ...subOnly, 'tape.age': 1 }, heldNote(45, 4), { seconds: 1 });
  const diff = new Float32Array(a.left.length);
  for (let i = 0; i < diff.length; i++) diff[i] = a.left[i] - b.left[i];
  expect(rms(diff)).toBeLessThan(0.002); // ≈ -54 dBFS
});

describe('chorus hyper and the FX OTT', () => {
  const p = { ...base, 'osc1.wave': 'saw', 'osc1.level': 1, 'filter.cutoff': 3000, 'chorus.on': true, 'chorus.mix': 0.8, 'chorus.depth': 0.7, 'chorus.lowcut': 150 };
  it('hyper spreads the sound wide, at about the same level', () => {
    const side = (mode: string) => {
      const r = renderPatch({ ...p, 'chorus.mode': mode }, heldNote(57, 1), { seconds: 1 });
      const s2 = new Float32Array(r.left.length), m2 = new Float32Array(r.left.length);
      for (let i = 0; i < s2.length; i++) { s2[i] = 0.5 * (r.left[i] - r.right[i]); m2[i] = 0.5 * (r.left[i] + r.right[i]); }
      return { side: rms(s2, 0.3 * FS, 0.9 * FS), mid: rms(m2, 0.3 * FS, 0.9 * FS) };
    };
    const c = side('classic'), h = side('hyper');
    expect(h.side).toBeGreaterThan(c.side);
    expect(Math.abs(20 * Math.log10(h.mid / c.mid))).toBeLessThan(6);
  });
  it('OTT depth pulls a dying tail up against its attack', () => {
    const q = { ...base, 'osc1.wave': 'saw', 'osc1.level': 1, 'amp_env.attack': 1, 'amp_env.decay': 600, 'amp_env.sustain': 0 };
    const ratio = (depth: number) => {
      const r = renderPatch({ ...q, 'ott.depth': depth }, heldNote(57, 1), { seconds: 1 });
      return rms(r.left, 0.5 * FS, 0.6 * FS) / rms(r.left, 0.02 * FS, 0.08 * FS);
    };
    expect(ratio(1)).toBeGreaterThan(ratio(0) * 1.5);
  });
});
