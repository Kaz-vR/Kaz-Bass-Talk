// Modulation that keeps a held sound alive: LFO 3/4, the smooth random
// 'wander' shape, LFO fade-in, the slow bloom envelope (env 2), the slow
// drift source and the FX / width mod targets.
import { describe, expect, it } from 'vitest';
import { renderPatch } from '../src/engine/core/render';
import { powerSpectrum, centroid } from '../src/analysis/spectrum';
import { heldNote, rms } from './helpers/audio';

const FS = 48000;
const base = {
  meta: { name: 't' }, 'voice.analog': 0, 'sub.level': 0, 'filter.cutoff': 600, 'filter.keytrack': 0, 'filter.resonance': 0,
  'amp_env.attack': 1, 'amp_env.sustain': 1, 'osc1.level': 1, 'osc1.wave': 'saw',
};
const mono = (r: { left: Float32Array; right: Float32Array }) => Float64Array.from(r.left, (v, i) => 0.5 * (v + r.right[i]));
const brightness = (x: Float64Array, from: number, to: number) => centroid(powerSpectrum(x, FS, Math.round(from * FS), Math.round(to * FS), 2048));
/** Brightness trajectory in 50 ms windows. */
function track(x: Float64Array, from: number, to: number): number[] {
  const out: number[] = [];
  for (let t = from; t + 0.05 <= to; t += 0.05) out.push(brightness(x, t, t + 0.05));
  return out;
}
const maxStep = (b: number[]) => Math.max(...b.slice(1).map((v, i) => Math.abs(Math.log(v / b[i]))));
const spread = (b: number[]) => Math.max(...b) / Math.min(...b);
/** Side-channel RMS (stereo width). */
const side = (r: { left: Float32Array; right: Float32Array }, from: number, to: number) =>
  rms(Float32Array.from(r.left, (v, i) => 0.5 * (v - r.right[i])), from * FS, to * FS);

describe('wander LFO shape', () => {
  it('moves smoothly (no steps), unlike sample & hold', () => {
    const p = { ...base, 'lfo3.shape': 'wander', 'lfo3.rate': 2, 'mod1.source': 'lfo3', 'mod1.dest': 'filter_cutoff', 'mod1.amount': 0.35 };
    const wander = track(mono(renderPatch(p, heldNote(45, 16), { seconds: 6 })), 0.5, 5.5);
    const sh = track(mono(renderPatch({ ...p, 'lfo3.shape': 'sample_hold' }, heldNote(45, 16), { seconds: 6 })), 0.5, 5.5);
    expect(spread(wander)).toBeGreaterThan(1.3);
    expect(maxStep(wander)).toBeLessThan(maxStep(sh) * 0.6);
  });
  it('does not repeat from cycle to cycle', () => {
    const p = { ...base, 'lfo4.shape': 'wander', 'lfo4.rate': 1, 'mod1.source': 'lfo4', 'mod1.dest': 'filter_cutoff', 'mod1.amount': 0.35 };
    const b = track(mono(renderPatch(p, heldNote(45, 16), { seconds: 7 })), 0.5, 6.5);
    // Compare cycle 1 with cycle 3 (1 Hz → 20 windows per cycle): a periodic LFO would match.
    const diff = b.slice(0, 20).map((v, i) => Math.abs(Math.log(v / b[i + 40])));
    expect(Math.max(...diff)).toBeGreaterThan(0.1);
  });
});

describe('LFO fade-in', () => {
  it('lets the note start still and brings the wobble in later', () => {
    const p = { ...base, 'lfo1.rate': 6, 'lfo1.retrigger': true, 'lfo1.fade': 1500, 'mod1.source': 'lfo1', 'mod1.dest': 'filter_cutoff', 'mod1.amount': 0.3 };
    const x = mono(renderPatch(p, heldNote(45, 8), { seconds: 3 }));
    const early = spread(track(x, 0.05, 0.3)) - 1;
    const late = spread(track(x, 2, 2.4)) - 1;
    expect(late).toBeGreaterThan(0.3);
    expect(early).toBeLessThan(late * 0.25);
  });
});

describe('env 2 (bloom)', () => {
  it('opens a held note slowly over seconds', () => {
    const p = { ...base, 'filter.cutoff': 300, 'env2.attack': 2000, 'env2.sustain': 1, 'mod1.source': 'env2', 'mod1.dest': 'filter_cutoff', 'mod1.amount': 0.4 };
    const x = mono(renderPatch(p, heldNote(45, 8), { seconds: 3 }));
    const b = [0.1, 0.8, 1.6, 2.5].map((t) => brightness(x, t, t + 0.1));
    expect(b[1]).toBeGreaterThan(b[0]);
    expect(b[2]).toBeGreaterThan(b[1]);
    expect(b[3]).toBeGreaterThan(b[0] * 1.3);
  });
});

describe('slow drift source', () => {
  it('wanders over several seconds', () => {
    const p = { ...base, 'mod1.source': 'drift_slow', 'mod1.dest': 'filter_cutoff', 'mod1.amount': 0.6 };
    const x = mono(renderPatch(p, heldNote(45, 16), { seconds: 12 }));
    const b = [1, 3, 5, 7, 9, 11].map((t) => brightness(x, t, t + 0.3));
    expect(spread(b)).toBeGreaterThan(1.2);
  });
});

describe('FX and width mod targets', () => {
  const wide = { ...base, 'filter.cutoff': 3000, 'osc1.unison_voices': 5, 'osc1.unison_detune': 25, 'osc1.unison_spread': 1 };
  it('width can collapse to mono and widen, and the low end stays mono', () => {
    const narrow = renderPatch({ ...wide, 'mod1.source': 'velocity', 'mod1.dest': 'width', 'mod1.amount': -1 }, heldNote(45, 4), { seconds: 1.5 });
    const normal = renderPatch(wide, heldNote(45, 4), { seconds: 1.5 });
    const wider = renderPatch({ ...wide, 'mod1.source': 'velocity', 'mod1.dest': 'width', 'mod1.amount': 0.8 }, heldNote(45, 4), { seconds: 1.5 });
    expect(side(narrow, 0.5, 1.4)).toBeLessThan(side(normal, 0.5, 1.4) * 0.05);
    expect(side(wider, 0.5, 1.4)).toBeGreaterThan(side(normal, 0.5, 1.4) * 1.5);
  });
  it('reverb mix can be brought in by modulation', () => {
    const p = { ...base, 'reverb.mix': 0, 'reverb.size': 0.7, 'mod1.source': 'velocity', 'mod1.dest': 'reverb_mix', 'mod1.amount': 0.6 };
    const dry = renderPatch({ ...p, 'mod1.amount': 0 }, heldNote(45, 1), { seconds: 0.5, tail: 1 });
    const wet = renderPatch(p, heldNote(45, 1), { seconds: 0.5, tail: 1 });
    expect(rms(wet.left, 0.9 * FS, 1.4 * FS)).toBeGreaterThan(rms(dry.left, 0.9 * FS, 1.4 * FS) * 5 + 1e-4);
  });
  it('modulated delay time stays clean and bounded', () => {
    const p = { ...base, 'delay.mix': 0.4, 'delay.feedback': 0.5, 'lfo2.shape': 'wander', 'lfo2.rate': 3, 'mod1.source': 'lfo2', 'mod1.dest': 'delay_time', 'mod1.amount': 1 };
    const r = renderPatch(p, heldNote(45, 1), { seconds: 2, tail: 2 });
    for (const v of r.left) expect(Number.isFinite(v)).toBe(true);
    expect(rms(r.left, 2.2 * FS, 3 * FS)).toBeGreaterThan(1e-4);
  });
});

describe('random LFO shapes from the start', () => {
  it('a slow wander moves during its first cycle (no flat start)', () => {
    const p = { ...base, 'lfo1.shape': 'wander', 'lfo1.rate': 0.1, 'mod1.source': 'lfo1', 'mod1.dest': 'filter_cutoff', 'mod1.amount': 0.4 };
    const x = mono(renderPatch(p, heldNote(45, 8), { seconds: 4 }));
    expect(spread([0.3, 1.5, 2.7, 3.6].map((t) => brightness(x, t, t + 0.3)))).toBeGreaterThan(1.05);
  });
});
