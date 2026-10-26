// GRIND2: four filter → drive stages moved by one shared movement.
import { describe, expect, it } from 'vitest';
import { renderPatch } from '../src/engine/core/render';
import { heldNote, rms } from './helpers/audio';

const FS = 48000;
const saw = {
  meta: { name: 't' }, 'voice.analog': 0, 'amp_env.attack': 1, 'amp_env.sustain': 1, 'amp_env.release': 30, 'filter.cutoff': 20000, 'filter.resonance': 0,
  'filter.keytrack': 0, 'osc1.wave': 'saw', 'osc1.level': 0.8, 'osc1.unison_voices': 1, 'osc2.level': 0, 'sub.level': 0, 'texture.level': 0,
  'chorus.on': false, 'delay.on': false, 'reverb.on': false, 'tape.on': false, 'eq.on': false, 'dist.on': false,
};
const mono = (r: { left: Float32Array; right: Float32Array }) => Float64Array.from(r.left, (v, i) => 0.5 * (v + r.right[i]));
const diff = (a: Float64Array, b: Float64Array, from: number, to: number) => {
  let d = 0, e = 0;
  for (let i = from; i < to; i++) { d += (a[i] - b[i]) ** 2; e += a[i] ** 2 + b[i] ** 2; }
  return d / e;
};

describe('grind2', () => {
  const off = mono(renderPatch(saw, heldNote(36, 4), { seconds: 1 }));
  const ro = rms(Float32Array.from(off), 0.2 * FS, 0.9 * FS);
  for (const filter of ['vowel', 'notch', 'peak', 'band', 'comb', 'phaser']) {
    for (const timing of ['note', 'once', 'bar']) {
      it(`${filter} / ${timing}: changes the sound, finite, level kept`, () => {
        const p = { ...saw, 'g2.on': true, 'g2s1.filter': filter, 'g2.timing': timing, 'g2s2.on': false, 'g2.ott': 0.5 };
        const a = mono(renderPatch(p, heldNote(36, 4), { seconds: 1 }));
        expect(a.every(Number.isFinite)).toBe(true);
        expect(diff(off, a, 0.2 * FS, 0.9 * FS)).toBeGreaterThan(0.01);
        const ra = rms(Float32Array.from(a), 0.2 * FS, 0.9 * FS);
        expect(Math.abs(20 * Math.log10(ra / ro))).toBeLessThan(6);
      });
    }
  }
  it('the movement moves the sound over a held note (1/4 at 120: a cycle every 0.5 s)', () => {
    const a = mono(renderPatch({ ...saw, 'g2.on': true, 'g2.life': 0 }, heldNote(36, 4), { seconds: 1 }));
    const e = (t: number) => rms(Float32Array.from(a), t * FS, (t + 0.03) * FS);
    const v = [0.05, 0.15, 0.25, 0.35].map(e);
    expect(Math.max(...v) / Math.min(...v)).toBeGreaterThan(1.1);
  });
  it('every shape and the full chain stay under the limiter', () => {
    for (const shape of ['sine', 'random', 'ratchet', 'square']) {
      const p: Record<string, unknown> = { ...saw, 'g2.on': true, 'g2.shape': shape, 'g2.sat': 1, 'g2.ott': 1, 'g2.life': 1 };
      for (let n = 1; n <= 4; n++) { p[`g2s${n}.on`] = true; p[`g2s${n}.drive`] = 1; p[`g2s${n}.res`] = 1; p[`g2s${n}.dmod`] = 1; }
      const a = mono(renderPatch(p, heldNote(36, 4), { seconds: 1 }));
      expect(a.every(Number.isFinite)).toBe(true);
      expect(Math.max(...a.map(Math.abs))).toBeLessThan(1);
    }
  });
});
