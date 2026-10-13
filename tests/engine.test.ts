import { describe, expect, it } from 'vitest';
import { renderPatch } from '../src/engine/core/render';
import { compileLoop, LoopPlayer } from '../src/engine/core/sequencer';
import { Synth } from '../src/engine/core/synth';
import { paramIndex, patchToArray, toEngineValue, getParam, validatePatch } from '../src/schema';
import { heldNote, loop, peak, rms } from './helpers/audio';

const FS = 48000;

function zeroCrossings(x: Float32Array, from: number, to: number): number {
  let n = 0;
  for (let i = from + 1; i < to; i++) if (x[i - 1] < 0 && x[i] >= 0) n++;
  return n;
}

const pureSine = {
  meta: { name: 'sine' },
  'osc1.wave': 'sine', 'osc1.level': 1, 'sub.level': 0,
  'filter.cutoff': 20000, 'filter.keytrack': 0, 'filter.resonance': 0,
  'amp_env.attack': 1, 'amp_env.sustain': 1,
};

describe('engine basics', () => {
  it('plays the right pitch (A4 = 440 Hz)', () => {
    const r = renderPatch(pureSine, heldNote(69, 4), { seconds: 2 });
    expect(zeroCrossings(r.left, FS / 2, FS * 1.5)).toBeGreaterThanOrEqual(439);
    expect(zeroCrossings(r.left, FS / 2, FS * 1.5)).toBeLessThanOrEqual(441);
  });

  it('sub plays one octave below the note', () => {
    const subOnly = { ...pureSine, 'osc1.level': 0, 'sub.level': 1, 'sub.octave': -1 };
    const r = renderPatch(subOnly, heldNote(57, 4), { seconds: 2 }); // A3 → sub at 110 Hz
    expect(zeroCrossings(r.left, FS / 2, FS * 1.5)).toBeGreaterThanOrEqual(109);
    expect(zeroCrossings(r.left, FS / 2, FS * 1.5)).toBeLessThanOrEqual(111);
  });

  it('is silent before the first note and after the release', () => {
    const r = renderPatch({ meta: { name: 'x' } }, heldNote(45, 1), { seconds: 1, tail: 1 });
    expect(peak(r.left.subarray(0, 64))).toBe(0);
    expect(rms(r.left, FS * 1.6, FS * 2)).toBeLessThan(1e-4);
  });

  it('removes DC from asymmetric distortion', () => {
    // Narrow pulse into hard asymmetric clipping; A2 = 110 Hz so 1 s is an exact
    // number of periods and the mean is a true DC measurement.
    const p = { ...pureSine, 'osc1.wave': 'pulse', 'osc1.pulse_width': 0.1, 'dist.type': 'hard', 'dist.drive': 0.9, 'sub.level': 0.8 };
    const r = renderPatch(p, heldNote(45, 8), { seconds: 3 });
    let m = 0;
    for (let i = 2 * FS; i < 3 * FS; i++) m += r.left[i];
    expect(Math.abs(m / FS)).toBeLessThan(1e-3);
  });

  it('renders deterministically', () => {
    const p = libraryPatch('neuro-growl');
    const a = renderPatch(p, loop('groove'), { seconds: 1 });
    const b = renderPatch(p, loop('groove'), { seconds: 1 });
    expect(Buffer.from(a.left.buffer).equals(Buffer.from(b.left.buffer))).toBe(true);
  });

  it('restarts the sub at the same phase on every note from silence (phase-stable)', () => {
    const subOnly = { ...pureSine, 'osc1.level': 0, 'sub.level': 1 };
    const l = { id: 't', name: 't', description: '', bpm: 120, length_beats: 4, notes: [
      { start: 0, dur: 0.5, note: 45, vel: 1 },
      { start: 2, dur: 0.5, note: 45, vel: 1 },
    ] };
    const r = renderPatch(subOnly, l, { seconds: 2 });
    const a = r.left.subarray(0, 4000);
    const b = r.left.subarray(FS, FS + 4000); // beat 2 at 120 BPM = 1 s
    let maxDiff = 0;
    for (let i = 0; i < a.length; i++) maxDiff = Math.max(maxDiff, Math.abs(a[i] - b[i]));
    expect(maxDiff).toBeLessThan(1e-4);
  });

  it('legato mode does not retrigger the amp envelope on overlapping notes', () => {
    const pluck = { ...pureSine, 'amp_env.decay': 150, 'amp_env.sustain': 0, 'voice.legato': true };
    const overlap = { id: 't', name: 't', description: '', bpm: 120, length_beats: 8, notes: [
      { start: 0, dur: 2.2, note: 57, vel: 1 },
      { start: 2, dur: 1, note: 60, vel: 1 },
    ] };
    const legato = renderPatch(pluck, overlap, { seconds: 2 });
    const retrig = renderPatch({ ...pluck, 'voice.legato': false }, overlap, { seconds: 2 });
    // Just after the second note starts (1.0 s), only the retriggered version is loud again.
    const l = rms(legato.left, FS * 1.005, FS * 1.04);
    const r = rms(retrig.left, FS * 1.005, FS * 1.04);
    expect(l).toBeLessThan(0.01);
    expect(r).toBeGreaterThan(l * 5);
  });

  it('glide slides pitch instead of jumping', () => {
    const p = { ...pureSine, 'voice.legato': true, 'voice.glide': 300 };
    const s = new Synth(FS);
    s.setParams(patchToArray(validatePatch(p).patch), true);
    const L = new Float32Array(FS), R = new Float32Array(FS);
    s.noteOn(57, 1);
    s.render(L, R, 0, FS / 4);
    s.noteOn(69, 1); // overlapping → slide from 220 to 440 Hz
    s.render(L, R, FS / 4, (3 * FS) / 4);
    const early = zeroCrossings(L, FS / 4, FS / 4 + 2400) / 0.05; // Hz over 50 ms just after the change
    expect(early).toBeGreaterThan(225);
    expect(early).toBeLessThan(430);
    expect(zeroCrossings(L, FS - 4800, FS) / 0.1).toBeCloseTo(440, -1);
  });
});

describe('real-time patch changes', () => {
  function maxStep(x: Float32Array, from: number, to: number): number {
    let m = 0;
    for (let i = from + 1; i < to; i++) m = Math.max(m, Math.abs(x[i] - x[i - 1]));
    return m;
  }

  function switchMidNote(base: object, id: string, value: number | string | boolean) {
    const s = new Synth(FS);
    s.setParams(patchToArray(validatePatch(base).patch), true);
    const L = new Float32Array(FS), R = new Float32Array(FS);
    s.noteOn(45, 1);
    s.render(L, R, 0, FS / 2);
    s.setParam(paramIndex(id), toEngineValue(getParam(id)!, value));
    s.render(L, R, FS / 2, FS / 2);
    return L;
  }

  // A smooth sine-ish tone makes any discontinuity stand out.
  const smooth = { ...pureSine, 'filter.cutoff': 2000, 'sub.level': 0.5 };

  it.each([
    ['filter.type', 'bandpass'],
    ['osc1.wave', 'triangle'],
    ['osc1.unison_voices', 5],
    ['sub.octave', -2],
    ['dist.type', 'fold'],
  ] as const)('switching %s mid-note does not click', (id, value) => {
    const L = switchMidNote({ ...smooth, 'dist.drive': 0.3 }, id, value);
    const before = maxStep(L, FS / 4, FS / 2 - 1);
    const after = maxStep(L, FS / 2 + 2000, FS);
    const around = maxStep(L, FS / 2 - 1, FS / 2 + 2000);
    expect(around).toBeLessThanOrEqual(Math.max(before, after) * 1.5 + 1e-3);
  });

  it('smooths a big cutoff jump instead of stepping', () => {
    const saw = { ...smooth, 'osc1.wave': 'saw', 'filter.cutoff': 100 };
    const L = switchMidNote(saw, 'filter.cutoff', 12000);
    // 2 ms after the change the level must still be in transition (not fully open).
    const r1 = rms(L, FS / 2 + 48, FS / 2 + 144);
    const r2 = rms(L, FS / 2 + 9600, FS / 2 + 14400);
    expect(r1).toBeLessThan(r2);
  });
});

describe('loop player', () => {
  it('fires notes on the exact sample', () => {
    const s = new Synth(FS);
    s.setParams(patchToArray(validatePatch({ ...pureSine, 'amp_env.attack': 0.5 }).patch), true);
    const p = new LoopPlayer(s);
    p.setLoop(compileLoop({ id: 't', name: 't', description: '', bpm: 120, length_beats: 4, notes: [{ start: 1, dur: 1, note: 69, vel: 1 }] }));
    p.start();
    const L = new Float32Array(FS), R = new Float32Array(FS);
    for (let i = 0; i < FS; i += 128) p.render(L, R, i, Math.min(128, FS - i));
    // beat 1 at 120 BPM = 24000 samples, plus the limiter's look-ahead latency.
    let first = -1;
    for (let i = 0; i < FS; i++) if (Math.abs(L[i]) > 1e-6) { first = i; break; }
    expect(first).toBeGreaterThanOrEqual(24000 + s.latency);
    expect(first).toBeLessThanOrEqual(24000 + s.latency + 2);
  });

  it('loops seamlessly', () => {
    const r = renderPatch(libraryPatch('acid-squelch'), loop('acid-16ths'), { seconds: 8 });
    const half = r.left.length / 2; // one loop = 8 beats at 128 BPM = 3.75 s
    expect(rms(r.left, 0, half)).toBeGreaterThan(0.05);
    expect(rms(r.left, half, r.left.length)).toBeGreaterThan(0.05);
  });
});

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
function libraryPatch(slug: string) {
  return JSON.parse(readFileSync(join(__dirname, '../data/library', `${slug}.json`), 'utf8'));
}
