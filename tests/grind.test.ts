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

describe('grind mix, low cut and the noise bed', () => {
  const on = { ...saw, 'grind.on': true, 'grind1.drive': 0.8 };
  const render = (p: Record<string, unknown>) => mono(renderPatch(p as never, heldNote(36, 4), { seconds: 1 }));
  it('mix 0 is the dry sound', () => {
    expect(diff(render({ ...on, 'grind.mix': 0 }), render(saw), 0.2 * FS, 0.9 * FS)).toBeLessThan(1e-6);
  });
  it('a high low cut leaves most of the sound clean', () => {
    const full = diff(render(on), render(saw), 0.2 * FS, 0.9 * FS);
    const cut = diff(render({ ...on, 'grind.lowcut': 2000 }), render(saw), 0.2 * FS, 0.9 * FS);
    expect(cut).toBeLessThan(full);
  });
  it('a full low cut keeps the level (the drives match any input level, so the highs alone are not boosted)', () => {
    const lc = rms(Float32Array.from(render({ ...on, 'grind.lowcut': 2000 })), 0.2 * FS, 0.9 * FS), dry = rms(Float32Array.from(render(saw)), 0.2 * FS, 0.9 * FS);
    expect(Math.abs(20 * Math.log10(lc / dry))).toBeLessThan(1.5);
  });
  it('the noise bed goes through GRIND, except on Direct out', () => {
    const tex = { ...saw, 'osc1.level': 0, 'texture.type': 'tape hiss', 'texture.level': 0.8 };
    const dry = render(tex), wet = render({ ...tex, 'grind.on': true, 'grind1.drive': 0.9, 'grind1.filter': 'comb' });
    expect(diff(dry, wet, 0.2 * FS, 0.9 * FS)).toBeGreaterThan(0.01);
    const direct = { ...tex, 'texture.direct': true };
    expect(diff(render(direct), render({ ...direct, 'grind.on': true, 'grind1.drive': 0.9, 'grind1.filter': 'comb' }), 0.2 * FS, 0.9 * FS)).toBeLessThan(1e-6);
  });
});

describe('four-band EQ', () => {
  const render = (p: Record<string, unknown>) => mono(renderPatch({ ...saw, 'eq.on': true, ...p } as never, heldNote(36, 4), { seconds: 1 }));
  it('is flat by default', () => {
    expect(diff(render({}), render({ 'eq.on': false }), 0.2 * FS, 0.9 * FS)).toBeLessThan(1e-6);
  });
  it('a bell boost changes the sound, scale 0 flattens it, a notch at 0 dB still cuts', () => {
    const flat = render({});
    expect(diff(flat, render({ 'eq.b2_gain': 9 }), 0.2 * FS, 0.9 * FS)).toBeGreaterThan(0.01);
    expect(diff(flat, render({ 'eq.b2_gain': 9, 'eq.scale': 0 }), 0.2 * FS, 0.9 * FS)).toBeLessThan(1e-6);
    expect(diff(flat, render({ 'eq.b2_type': 'notch', 'eq.b2_freq': 130 }), 0.2 * FS, 0.9 * FS)).toBeGreaterThan(0.01);
  });
  it('the old EQ loads as the same bands', async () => {
    const { validatePatch } = await import('../src/schema');
    const { patch } = validatePatch({ meta: { name: 't' }, 'eq.low_gain': -2, 'eq.mid_gain': -3, 'eq.mid_freq': 320, 'eq.high_gain': -1 });
    expect([patch['eq.b1_gain'], patch['eq.b2_gain'], patch['eq.b2_freq'], patch['eq.b4_gain'], patch['eq.b1_freq'], patch['eq.b4_freq']]).toEqual([-2, -3, 320, -1, 100, 5000]);
  });
});

describe('grind key, one shot and OTT', () => {
  const one = { ...saw, 'grind.on': true, 'grind2.on': false, 'grind3.on': false, 'grind4.on': false, 'grind1.filter': 'band', 'grind1.range': 0, 'grind1.drive': 0 };
  const at = (p: Record<string, unknown>, note: number) => mono(renderPatch(p as never, heldNote(note, 4), { seconds: 0.6 }));
  it('KEY moves the filter with the note', () => {
    // a band at 500 Hz: two octaves up the note's partials fall into a different place; with KEY the band follows
    const k = { ...one, 'grind.key': true }, nk = one;
    const ratio = (p: Record<string, unknown>) => rms(Float32Array.from(at(p, 60)), 0.2 * FS, 0.5 * FS) / rms(Float32Array.from(at(p, 36)), 0.2 * FS, 0.5 * FS);
    expect(Math.abs(Math.log(ratio(k)) - Math.log(ratio(nk)))).toBeGreaterThan(0.05);
  });
  it('ONE SHOT sweeps once and stays: the end of a held note no longer moves', () => {
    const p = { ...saw, 'grind.on': true, 'grind2.on': false, 'grind3.on': false, 'grind4.on': false, 'grind1.move': 'note', 'grind1.rate': 0.5, 'grind1.range': 3, 'grind.oneshot': true };
    const a = mono(renderPatch(p as never, heldNote(36, 4), { seconds: 1.6 }));
    const seg = (t: number) => rms(Float32Array.from(a), Math.round(t * FS), Math.round((t + 0.1) * FS));
    expect(Math.abs(seg(1.2) / seg(1.4) - 1)).toBeLessThan(0.05);
  });
  it('OTT squashes a decaying note: louder, and its tail comes up much more than its attack', () => {
    const p = { ...saw, 'grind.on': true, 'amp_env.decay': 200, 'amp_env.sustain': 0.3, 'amp_env.release': 600 };
    const loop = { id: 'x', name: 'x', description: '', bpm: 120, length_beats: 8, notes: [{ start: 0, dur: 1, note: 36, vel: 0.9 }] };
    const db = (x: Float64Array, a: number, b: number) => 10 * Math.log10(Array.from(x.subarray(Math.round(a * FS), Math.round(b * FS))).reduce((s, v) => s + v * v, 0) / ((b - a) * FS));
    const a = mono(renderPatch(p as never, loop as never, { seconds: 1.6, tail: 0 }));
    const b = mono(renderPatch({ ...p, 'grind.ott': 1 } as never, loop as never, { seconds: 1.6, tail: 0 }));
    expect(b.every(Number.isFinite)).toBe(true);
    const lift = (t0: number, t1: number) => db(b, t0, t1) - db(a, t0, t1);
    expect(lift(0.3, 0.45)).toBeGreaterThan(4);
    expect(lift(0.75, 0.95)).toBeGreaterThan(lift(0.01, 0.06) + 6);
  });
});
