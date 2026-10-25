// GRIND: the moving filter → drive chain before the main filter.
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

describe('grind', () => {
  const off = mono(renderPatch(saw, heldNote(36, 4), { seconds: 1 }));
  it('off changes nothing', () => {
    const b = mono(renderPatch({ ...saw, 'grind.on': false, 'grind1.drive': 1 }, heldNote(36, 4), { seconds: 1 }));
    expect(diff(off, b, 0, FS)).toBe(0);
  });
  for (const filter of ['notch', 'peak', 'band', 'comb', 'phaser']) {
    for (const [move, sync] of [['note', false], ['note', true], ['wander', false], ['wander', true]] as const) {
      it(`${filter} / ${move}${sync ? ' synced' : ''}: changes the sound, stays finite and level-matched`, () => {
        const p = { ...saw, 'grind.on': true, 'grind1.filter': filter, 'grind1.move': move, 'grind1.sync': sync, 'grind2.on': false, 'grind3.on': false, 'grind4.on': false };
        const a = mono(renderPatch(p, heldNote(36, 4), { seconds: 1 }));
        expect(a.every(Number.isFinite)).toBe(true);
        expect(diff(off, a, 0.2 * FS, 0.9 * FS)).toBeGreaterThan(0.01);
        const ra = rms(Float32Array.from(a), 0.2 * FS, 0.9 * FS), ro = rms(Float32Array.from(off), 0.2 * FS, 0.9 * FS);
        expect(ra / ro).toBeGreaterThan(0.2);
        expect(ra / ro).toBeLessThan(4);
      });
    }
  }
  it('the filter moves: the sound changes over a held note', () => {
    const p = { ...saw, 'grind.on': true, 'grind1.move': 'note', 'grind1.rate': 0.3, 'grind1.range': 3 };
    const a = mono(renderPatch(p, heldNote(36, 4), { seconds: 1.2 }));
    const seg = (t: number) => a.subarray(Math.round(t * FS), Math.round((t + 0.05) * FS));
    const s1 = seg(0.2), s2 = seg(0.9);
    let d = 0, e = 0;
    for (let i = 0; i < s1.length; i++) { d += Math.abs(Math.abs(s1[i]) - Math.abs(s2[i])); e += Math.abs(s1[i]); }
    expect(d / e).toBeGreaterThan(0.05);
  });
  it('all four stages with full drive stay under the limiter', () => {
    const p: Record<string, unknown> = { ...saw, 'grind.on': true };
    for (let n = 1; n <= 4; n++) { p[`grind${n}.drive`] = 1; p[`grind${n}.res`] = 1; }
    const a = mono(renderPatch(p, heldNote(36, 4), { seconds: 1 }));
    expect(a.every(Number.isFinite)).toBe(true);
    expect(Math.max(...a.map(Math.abs))).toBeLessThan(1);
  });
});

describe('grind migration', () => {
  it('beat becomes note with Sync on, formant becomes peak', async () => {
    const { validatePatch } = await import('../src/schema');
    const { patch } = validatePatch({ meta: { name: 't' }, 'grind1.move': 'beat', 'grind2.filter': 'formant' });
    expect(patch['grind1.move']).toBe('note');
    expect(patch['grind1.sync']).toBe(true);
    expect(patch['grind2.filter']).toBe('peak');
  });
});
