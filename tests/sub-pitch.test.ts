// The matrix's Sub pitch moves the sub alone; the oscillators keep their pitch.
import { describe, expect, it } from 'vitest';
import { renderPatch } from '../src/engine/core/render';
import { heldNote } from './helpers/audio';

const FS = 48000;
/** Rising zero crossings per second over a stretch of the render: the fundamental. */
function freq(x: Float32Array, from: number, to: number): number {
  let n = 0;
  for (let i = Math.round(from * FS) + 1; i < to * FS; i++) if (x[i - 1] < 0 && x[i] >= 0) n++;
  return n / (to - from);
}
const base = {
  meta: { name: 't' }, 'voice.analog': 0, 'amp_env.attack': 1, 'amp_env.sustain': 1, 'filter.cutoff': 20000, 'reverb.on': false, 'chorus.on': false, 'delay.on': false,
  'tape.on': false, 'texture.level': 0, 'env3.on': true, 'env3.attack': 1, 'env3.sustain': 1, 'mod1.source': 'env3', 'mod1.dest': 'sub_pitch', 'mod1.on': true,
};

describe('sub pitch', () => {
  it('moves the sub (an octave down at -50%)', () => {
    const p = { ...base, 'osc1.level': 0, 'osc2.level': 0, 'sub.level': 0.8, 'sub.wave': 'sine' };
    const still = freq(renderPatch({ ...p, 'mod1.amount': 0 }, heldNote(48, 4), { seconds: 0.8 }).left, 0.2, 0.7);
    const down = freq(renderPatch({ ...p, 'mod1.amount': -0.5 }, heldNote(48, 4), { seconds: 0.8 }).left, 0.2, 0.7);
    expect(down / still).toBeCloseTo(0.5, 1);
  });
  it('the sub octave reaches -4 and +4 (low notes fold up above 20 Hz)', () => {
    const p = { ...base, 'osc1.level': 0, 'osc2.level': 0, 'sub.level': 0.8, 'sub.wave': 'sine', 'mod1.amount': 0 };
    const f = (oct: number, note = 60) => freq(renderPatch({ ...p, 'sub.octave': oct }, heldNote(note, 4), { seconds: 0.8 }).left, 0.2, 0.7);
    const c4 = 261.63;
    expect(f(4) / (c4 * 16)).toBeCloseTo(1, 1);
    expect(f(0) / c4).toBeCloseTo(1, 1);
    expect(f(-4, 72) / ((c4 * 2) / 16)).toBeCloseTo(1, 1);
    // C2 four octaves down would be 4 Hz: it folds up to between 20 and 40 Hz
    const low = f(-4, 36);
    expect(low).toBeGreaterThan(19);
    expect(low).toBeLessThan(42);
  });
  it('leaves the oscillators alone', () => {
    const p = { ...base, 'osc1.wave': 'sine', 'osc1.level': 0.8, 'osc1.unison_voices': 1, 'osc2.level': 0, 'sub.level': 0 };
    const still = freq(renderPatch({ ...p, 'mod1.amount': 0 }, heldNote(48, 4), { seconds: 0.8 }).left, 0.2, 0.7);
    const moved = freq(renderPatch({ ...p, 'mod1.amount': -0.5 }, heldNote(48, 4), { seconds: 0.8 }).left, 0.2, 0.7);
    expect(Math.abs(moved / still - 1)).toBeLessThan(0.02);
  });
});
