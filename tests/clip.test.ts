// The transparent soft clippers (sub only, osc 1 + 2 only; loudness-matched) and the true-peak limiter.
import { describe, expect, it } from 'vitest';
import { softClip } from '../src/engine/core/dsp';
import { Limiter } from '../src/engine/core/fx';
import { renderPatch } from '../src/engine/core/render';
import { heldNote, rms } from './helpers/audio';

const FS = 48000;
const dry = {
  meta: { name: 't' }, 'voice.analog': 0, 'filter.cutoff': 20000, 'filter.keytrack': 0, 'filter.resonance': 0,
  'amp_env.attack': 1, 'amp_env.sustain': 1, 'dynamics.on': false, 'chorus.on': false, 'delay.on': false, 'reverb.on': false,
  'tape.on': false, 'dist.on': false, 'drive.on': false, 'eq.on': false, 'output.gain': -12,
};
const sub = { ...dry, 'osc1.level': 0, 'osc2.level': 0, 'sub.level': 0.8, 'sub.wave': 'sine' };
const mid = { ...dry, 'osc1.wave': 'saw', 'osc1.level': 0.8, 'osc2.level': 0, 'sub.level': 0 };
const tail = (x: Float32Array) => x.subarray(FS / 2, FS * 1.5);

describe('soft clippers', () => {
  it('leave everything under the knee alone and stay under the curve above it', () => {
    expect(softClip(0.3, 0.5, 0.25)).toBe(0.3);
    expect(softClip(-0.5, 0.5, 0.25)).toBe(-0.5);
    expect(softClip(2, 0.5, 0.25)).toBeLessThan(0.75);
    expect(softClip(-2, 0.5, 0.25)).toBeGreaterThan(-0.75);
    expect(softClip(0.6, 0.5, 0.25)).toBeGreaterThan(softClip(0.55, 0.5, 0.25));
  });

  for (const [name, patch, id] of [['sub', sub, 'sub.clip'], ['mid', mid, 'clip.mid']] as const) {
    it(`${name} clip at 0 changes nothing`, () => {
      const a = renderPatch(patch, heldNote(36), { sampleRate: FS, seconds: 1.5 });
      const b = renderPatch({ ...patch, [id]: 0 }, heldNote(36), { sampleRate: FS, seconds: 1.5 });
      expect(Array.from(b.left)).toEqual(Array.from(a.left));
    });

    it(`${name} clip keeps the loudness and adds density (harmonics) at 6 dB drive`, () => {
      const a = tail(renderPatch(patch, heldNote(48), { sampleRate: FS, seconds: 1.5 }).left);
      const b = tail(renderPatch({ ...patch, [id]: 6 }, heldNote(48), { sampleRate: FS, seconds: 1.5 }).left);
      const dRms = 20 * Math.log10(rms(b) / rms(a));
      expect(Math.abs(dRms)).toBeLessThan(0.5);
      // Different, not just louder: the residual after level matching is well above zero.
      let e = 0, s = 0;
      const g = rms(a) / rms(b);
      for (let i = 0; i < a.length; i++) {
        e += (a[i] - b[i] * g) ** 2;
        s += a[i] ** 2;
      }
      expect(10 * Math.log10(e / s)).toBeGreaterThan(-40);
    });
  }
});

describe('true-peak limiter', () => {
  it('catches a peak that falls between samples', () => {
    // A sine at fs/4 sampled 45° off its peaks: every sample is at 0.707 of the true peak.
    const lim = new Limiter(FS, -1);
    const a = 1.15; // true peak +1.2 dBFS; samples at -1.8 dBFS, under the -1 dB ceiling
    const out = new Float64Array(2);
    const ys: number[] = [];
    for (let n = 0; n < 4800; n++) {
      const x = a * Math.sin((Math.PI / 2) * n + Math.PI / 4);
      lim.process(x, x, out);
      ys.push(out[0]);
    }
    const settled = ys.slice(2400);
    const samplePeak = Math.max(...settled.map(Math.abs));
    // The reconstructed peak (samples / 0.707) stays at the ceiling.
    expect(samplePeak / Math.SQRT1_2).toBeLessThanOrEqual(lim.ceiling * 1.01);
  });
});
