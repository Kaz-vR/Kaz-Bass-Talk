// Polyphony: chords play every note at its own pitch, voice stealing doesn't
// click, mono mode keeps its note stack, only the lowest note carries the sub,
// and a full 8-voice pad stays within the CPU budget.
import { describe, expect, it } from 'vitest';
import { renderPatch } from '../src/engine/core/render';
import { bandPower, powerSpectrum } from '../src/analysis/spectrum';
import type { Loop } from '../src/engine/core/sequencer';
import { rms } from './helpers/audio';

const FS = 48000;
const hz = (n: number) => 440 * Math.pow(2, (n - 69) / 12);
const base = {
  meta: { name: 't' }, 'voice.analog': 0, 'sub.level': 0, 'osc1.wave': 'sine', 'osc1.level': 0.6, 'filter.cutoff': 20000,
  'amp_env.attack': 5, 'amp_env.sustain': 1, 'amp_env.release': 50, 'comp.amount': 0,
};
const chord = (notes: number[], dur = 2, gap = 0): Loop => ({
  id: 'c', name: 'c', description: '', bpm: 120, length_beats: 16,
  notes: notes.map((note, i) => ({ start: i * gap, dur, note, vel: 0.8 })),
});
const mono = (r: { left: Float32Array; right: Float32Array }) => Float64Array.from(r.left, (v, i) => 0.5 * (v + r.right[i]));
const peakAt = (s: ReturnType<typeof powerSpectrum>, f: number) => bandPower(s, f * 0.985, f * 1.015);

describe('polyphony', () => {
  it('plays every note of a chord at its own pitch', () => {
    const notes = [57, 60, 64, 67];
    const x = mono(renderPatch({ ...base, 'voice.polyphony': 4 }, chord(notes), { seconds: 1 }));
    const s = powerSpectrum(x, FS, 0.3 * FS, 0.9 * FS, 16384);
    const total = bandPower(s, 50, 2000);
    for (const n of notes) expect(peakAt(s, hz(n)) / total, `note ${n}`).toBeGreaterThan(0.1);
  });

  it('mono mode keeps one note at a time (the newest)', () => {
    const x = mono(renderPatch({ ...base, 'voice.polyphony': 1 }, chord([57, 64], 2, 0.5), { seconds: 0.6 }));
    const s = powerSpectrum(x, FS, 0.3 * FS, 0.58 * FS, 8192);
    expect(peakAt(s, hz(64))).toBeGreaterThan(peakAt(s, hz(57)) * 100);
  });

  it('steals the oldest note when all voices are busy', () => {
    const x = mono(renderPatch({ ...base, 'voice.polyphony': 2 }, chord([57, 60, 64], 3, 0.25), { seconds: 1.2 }));
    const s = powerSpectrum(x, FS, 0.7 * FS, 1.2 * FS, 16384);
    expect(peakAt(s, hz(57))).toBeLessThan(peakAt(s, hz(64)) * 0.01);
    expect(peakAt(s, hz(60)) / peakAt(s, hz(64))).toBeGreaterThan(0.3);
  });

  it('voice stealing does not click', () => {
    const r = renderPatch({ ...base, 'voice.polyphony': 2, 'osc1.wave': 'sine' }, chord([45, 52, 57, 64], 3, 0.25), { seconds: 1.2 });
    const x = mono(r);
    // Largest sample-to-sample step stays near what a 330 Hz sine at this level does on its own.
    let maxStep = 0;
    for (let i = 1; i < x.length; i++) maxStep = Math.max(maxStep, Math.abs(x[i] - x[i - 1]));
    const sineStep = TWO_PI_STEP(hz(64)) * rms(r.left, 0.9 * FS, 1.1 * FS) * Math.SQRT2 * 2;
    expect(maxStep).toBeLessThan(sineStep * 1.5);
  });

  it('only the lowest held note carries the sub', () => {
    const p = { ...base, 'voice.polyphony': 3, 'osc1.level': 0, 'sub.level': 0.8, 'sub.octave': -1 };
    const x = mono(renderPatch(p, chord([48, 55, 60]), { seconds: 1 }));
    const s = powerSpectrum(x, FS, 0.3 * FS, 0.9 * FS, 16384);
    const low = peakAt(s, hz(36));
    expect(peakAt(s, hz(43))).toBeLessThan(low * 0.01);
    expect(peakAt(s, hz(48))).toBeLessThan(low * 0.01);
  });

  it('released notes ring out and the synth goes idle', () => {
    const r = renderPatch({ ...base, 'voice.polyphony': 4, 'amp_env.release': 300 }, chord([57, 60, 64], 0.5), { seconds: 0.3, tail: 1.5 });
    expect(rms(r.left, 0.3 * FS, 0.4 * FS)).toBeGreaterThan(1e-3);
    expect(rms(r.left, 1.5 * FS, 1.8 * FS)).toBeLessThan(1e-5);
  });

  it('an 8-voice wide pad stays within the CPU budget', () => {
    const pad = {
      ...base, 'voice.polyphony': 8, 'osc1.wave': 'saw', 'osc1.unison_voices': 3, 'osc2.wave': 'saw', 'osc2.unison_voices': 2, 'osc2.level': 0.4,
      'filter.cutoff': 1500, 'drive.amount': 0.4, 'dist.drive': 0.3, 'dist.mix': 0.6, 'tape.wow': 0.3, 'tape.drive': 0.4,
      'chorus.mix': 0.3, 'reverb.mix': 0.3, 'delay.mix': 0.2, 'texture.level': 0.5, 'texture.type': 'air',
    };
    const loop = chord([45, 52, 57, 60, 64, 67, 71, 74], 4);
    renderPatch(pad, loop, { seconds: 0.3 });
    const c0 = process.cpuUsage();
    renderPatch(pad, loop, { seconds: 2 });
    const c = process.cpuUsage(c0);
    const cpu = ((c.user + c.system) / 1000 / 2000) * 100;
    console.log(`8-voice pad: ${cpu.toFixed(1)}% (this machine)`);
    // CLAUDE.md: ~20% on a laptop for a full 8-voice pad; containers run ~3x slower.
    expect(cpu).toBeLessThan(60);
  });
});

function TWO_PI_STEP(f: number): number {
  return (2 * Math.PI * f) / FS;
}
