// Behaviour of the engine additions made for full bass-directory coverage.
import { describe, expect, it } from 'vitest';
import { renderPatch } from '../src/engine/core/render';
import { powerSpectrum, centroid, bandPower } from '../src/analysis/spectrum';
import { heldNote, rms } from './helpers/audio';

const FS = 48000;
const base = {
  meta: { name: 't' }, 'voice.analog': 0, 'sub.level': 0, 'filter.cutoff': 20000, 'filter.keytrack': 0, 'filter.resonance': 0,
  'amp_env.attack': 1, 'amp_env.sustain': 1, 'osc1.level': 1,
};
const mono = (r: { left: Float32Array; right: Float32Array }) => Float64Array.from(r.left, (v, i) => 0.5 * (v + r.right[i]));
const brightness = (x: Float64Array, from: number, to: number) => centroid(powerSpectrum(x, FS, Math.round(from * FS), Math.round(to * FS), 4096));
/** Pitch by autocorrelation (robust for harmonically rich tones), 40-400 Hz. */
function autocorrHz(x: Float32Array, from: number, to: number) {
  const a = Math.round(from * FS), n = Math.round((to - from) * FS) - 1200;
  let best = 0, bestLag = 0;
  for (let lag = Math.round(FS / 400); lag <= Math.round(FS / 40); lag++) {
    let c = 0;
    for (let i = 0; i < n; i++) c += x[a + i] * x[a + i + lag];
    if (c > best) { best = c; bestLag = lag; }
  }
  return FS / bestLag;
}


describe('FM operators', () => {
  it('FM punch is bright at the attack and settles', () => {
    const r = renderPatch({ ...base, 'osc1.wave': 'sine', 'fm.punch': 0.8, 'fm.decay': 250, 'fm.ratio': 1 }, heldNote(45, 4), { seconds: 1.5 });
    const x = mono(r);
    expect(brightness(x, 0, 0.05)).toBeGreaterThan(brightness(x, 0.8, 1.2) * 2);
  });
  it('operator 2 and feedback add harmonics', () => {
    const plain = mono(renderPatch({ ...base, 'osc1.wave': 'sine', 'fm.amount': 0.3 }, heldNote(45, 4), { seconds: 1 }));
    const rich = mono(renderPatch({ ...base, 'osc1.wave': 'sine', 'fm.amount': 0.3, 'fm2.amount': 0.6, 'fm2.ratio': 3, 'fm.feedback': 0.6 }, heldNote(45, 4), { seconds: 1 }));
    expect(brightness(rich, 0.3, 0.9)).toBeGreaterThan(brightness(plain, 0.3, 0.9) * 1.3);
  });
});

describe('transient layer', () => {
  it('adds a short burst on each note that is gone a moment later', () => {
    const one = { id: 'o', name: 'o', description: '', bpm: 120, length_beats: 8, notes: [{ start: 0, dur: 2, note: 45, vel: 1 }] };
    const r = renderPatch({ ...base, 'osc1.level': 0, 'click.level': 1, 'click.type': 'knock', 'click.decay': 30, 'click.tone': 600 }, one, { seconds: 0.5 });
    expect(rms(r.left, 0, 0.02 * FS)).toBeGreaterThan(0.05);
    expect(rms(r.left, 0.25 * FS, 0.45 * FS)).toBeLessThan(0.002);
  });
});

describe('filter types', () => {
  const saw = { ...base, 'osc1.wave': 'saw' };
  const spec = (p: object) => powerSpectrum(mono(renderPatch(p, heldNote(33, 4), { seconds: 1.5 })), FS, 0.5 * FS, 1.4 * FS, 16384);
  it('notch carves a hole at the cutoff', () => {
    const open = spec({ ...saw, 'filter.type': 'lowpass' });
    const notch = spec({ ...saw, 'filter.type': 'notch', 'filter.cutoff': 1000, 'filter.resonance': 0.6 });
    const ratio = (s: ReturnType<typeof spec>) => bandPower(s, 900, 1100) / bandPower(s, 1500, 3000);
    expect(ratio(notch)).toBeLessThan(ratio(open) * 0.2);
  });
  it('comb rings at the cutoff pitch', () => {
    const s = spec({ ...saw, 'filter.type': 'comb', 'filter.cutoff': 600, 'filter.resonance': 0.9 });
    expect(bandPower(s, 570, 630)).toBeGreaterThan(bandPower(s, 420, 480) * 2);
  });
  it('diode resonance emphasises the cutoff', () => {
    const flat = spec({ ...saw, 'filter.type': 'diode', 'filter.cutoff': 800, 'filter.resonance': 0 });
    const res = spec({ ...saw, 'filter.type': 'diode', 'filter.cutoff': 800, 'filter.resonance': 0.85 });
    const peak = (s: ReturnType<typeof spec>) => bandPower(s, 650, 950) / bandPower(s, 100, 400);
    expect(peak(res)).toBeGreaterThan(peak(flat) * 2);
  });
  it('low-pass gate darkens as the note decays', () => {
    const p = { ...saw, 'filter.type': 'lpg', 'filter.cutoff': 6000, 'amp_env.decay': 600, 'amp_env.sustain': 0 };
    const x = mono(renderPatch(p, heldNote(45, 4), { seconds: 1.2 }));
    expect(brightness(x, 0.01, 0.08)).toBeGreaterThan(brightness(x, 0.35, 0.5) * 1.5);
  });
});

describe('new oscillators', () => {
  it('the physical-model string plays in tune and decays', () => {
    const r = renderPatch({ ...base, 'osc1.wave': 'string', 'string.tone': 0.4, 'string.decay': 0.3 }, heldNote(45, 4), { seconds: 2 });
    const hz = autocorrHz(r.left, 0.1, 0.4);
    expect(hz).toBeGreaterThan(104);
    expect(hz).toBeLessThan(116);
    expect(rms(r.left, 1.5 * FS, 1.9 * FS)).toBeLessThan(rms(r.left, 0.05 * FS, 0.3 * FS) * 0.3);
  });
  it('the Shepard tone keeps sounding while its partials glide', () => {
    const r = renderPatch({ ...base, 'osc1.wave': 'shepard', 'shepard.rate': -1 }, heldNote(45, 16), { seconds: 4 });
    expect(rms(r.left, 3 * FS, 3.9 * FS)).toBeGreaterThan(rms(r.left, 0.2 * FS, 1 * FS) * 0.5);
  });
  it('pwm_saw differs from a plain saw', () => {
    const a = renderPatch({ ...base, 'osc1.wave': 'saw' }, heldNote(45, 4), { seconds: 0.5 });
    const b = renderPatch({ ...base, 'osc1.wave': 'pwm_saw', 'osc1.pulse_width': 0.3 }, heldNote(45, 4), { seconds: 0.5 });
    let d = 0;
    for (let i = 0; i < a.left.length; i++) d = Math.max(d, Math.abs(a.left[i] - b.left[i]));
    expect(d).toBeGreaterThan(0.05);
  });
});

describe('envelope and modulation additions', () => {
  it('reverse attack swells slowly then rushes in', () => {
    const p = { ...base, 'osc1.wave': 'sine', 'amp_env.attack': 400, 'amp_env.attack_curve': 1 };
    const r = renderPatch(p, heldNote(45, 4), { seconds: 0.6 });
    const early = rms(r.left, 0.05 * FS, 0.15 * FS), late = rms(r.left, 0.3 * FS, 0.38 * FS);
    const normal = renderPatch({ ...p, 'amp_env.attack_curve': 0 }, heldNote(45, 4), { seconds: 0.6 });
    expect(early / late).toBeLessThan(rms(normal.left, 0.05 * FS, 0.15 * FS) / rms(normal.left, 0.3 * FS, 0.38 * FS) * 0.5);
  });
  it('drift modulation moves the sound slowly', () => {
    const p = { ...base, 'osc1.wave': 'saw', 'filter.cutoff': 600, 'mod1.source': 'drift', 'mod1.dest': 'filter_cutoff', 'mod1.amount': 0.6 };
    const x = mono(renderPatch(p, heldNote(45, 16), { seconds: 6 }));
    const b = [0.5, 2, 3.5, 5].map((t) => brightness(x, t, t + 0.4));
    expect(Math.max(...b) / Math.min(...b)).toBeGreaterThan(1.15);
  });
  it('accent opens the filter on hard notes only', () => {
    const p = { ...base, 'osc1.wave': 'saw', 'filter.type': 'diode', 'filter.cutoff': 300, 'filter.env_amount': 0.3, 'filter.accent': 1, 'mod_env.decay': 200, 'mod_env.sustain': 0 };
    const note = (vel: number) => ({ id: 'a', name: 'a', description: '', bpm: 120, length_beats: 8, notes: [{ start: 0, dur: 1, note: 45, vel }] });
    const soft = mono(renderPatch(p, note(0.5), { seconds: 0.4 }));
    const hard = mono(renderPatch(p, note(1), { seconds: 0.4 }));
    expect(brightness(hard, 0.01, 0.1)).toBeGreaterThan(brightness(soft, 0.01, 0.1) * 1.2);
  });
});
