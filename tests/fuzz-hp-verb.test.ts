// Fuzz distortion, the high-pass main filter and the reverb's -1 octave.
import { describe, expect, it } from 'vitest';
import { renderPatch } from '../src/engine/core/render';
import { bandPower, powerSpectrum } from '../src/analysis/spectrum';
import { OctaveDown } from '../src/engine/core/fx';
import { heldNote, rms } from './helpers/audio';

const FS = 48000;
const dry = {
  meta: { name: 't' }, 'voice.analog': 0, 'amp_env.attack': 1, 'amp_env.sustain': 1, 'amp_env.release': 30, 'filter.cutoff': 20000, 'filter.resonance': 0,
  'filter.keytrack': 0, 'osc1.wave': 'sine', 'osc1.level': 0.8, 'osc1.unison_voices': 1, 'osc2.level': 0, 'sub.level': 0, 'texture.level': 0,
  'chorus.on': false, 'delay.on': false, 'reverb.on': false, 'tape.on': false, 'eq.on': false,
};
const mono = (r: { left: Float32Array; right: Float32Array }) => Float64Array.from(r.left, (v, i) => 0.5 * (v + r.right[i]));
const spec = (x: Float64Array) => powerSpectrum(x, FS, Math.round(0.2 * FS), Math.round(0.7 * FS), 8192);

describe('fuzz', () => {
  const fz = { ...dry, 'dist.on': true, 'dist.type': 'fuzz', 'dist.drive': 0.7, 'dist.mix': 1 };
  it('adds lopsided harmonics (even ones too) to a sine', () => {
    const s = spec(mono(renderPatch(fz, heldNote(48, 4), { seconds: 0.8 })));
    const f0 = 130.81;
    const h1 = bandPower(s, f0 * 0.95, f0 * 1.05), h2 = bandPower(s, 2 * f0 * 0.95, 2 * f0 * 1.05), h3 = bandPower(s, 3 * f0 * 0.95, 3 * f0 * 1.05);
    expect(h2 / h1).toBeGreaterThan(0.01);
    expect(h3 / h1).toBeGreaterThan(0.01);
  });
  it('sounds different from the other types and keeps silence silent', () => {
    const a = mono(renderPatch(fz, heldNote(48, 4), { seconds: 0.8 }));
    const b = mono(renderPatch({ ...fz, 'dist.type': 'soft' }, heldNote(48, 4), { seconds: 0.8 }));
    let d = 0, e = 0;
    for (let i = 0.2 * FS; i < 0.7 * FS; i++) { d += (a[i] - b[i]) ** 2; e += a[i] ** 2 + b[i] ** 2; }
    expect(d / e).toBeGreaterThan(0.02);
    const silent = mono(renderPatch({ ...fz, 'osc1.level': 0 }, heldNote(48, 4), { seconds: 0.5 }));
    expect(rms(Float32Array.from(silent), 0.1 * FS, 0.45 * FS)).toBeLessThan(1e-6);
  });
});

describe('high-pass main filter', () => {
  it('takes the bottom away and keeps the top', () => {
    const saw = { ...dry, 'osc1.wave': 'saw', 'filter.type': 'highpass', 'filter.cutoff': 1500 };
    const s = spec(mono(renderPatch(saw, heldNote(36, 4), { seconds: 0.8 })));
    const open = spec(mono(renderPatch({ ...saw, 'filter.type': 'lowpass', 'filter.cutoff': 20000 }, heldNote(36, 4), { seconds: 0.8 })));
    expect(bandPower(s, 50, 300) / bandPower(open, 50, 300)).toBeLessThan(0.01);
    expect(bandPower(s, 4000, 8000) / bandPower(open, 4000, 8000)).toBeGreaterThan(0.5);
  });
});

describe('reverb -1 octave', () => {
  it('the shifter plays a tone an octave down', () => {
    const sh = new OctaveDown(FS), n = FS;
    const y = new Float64Array(n);
    for (let i = 0; i < n; i++) y[i] = sh.process(Math.sin((2 * Math.PI * 880 * i) / FS));
    const s = powerSpectrum(y, FS, Math.round(0.2 * FS), n, 8192);
    expect(bandPower(s, 420, 460)).toBeGreaterThan(bandPower(s, 860, 900) * 3);
  });
});
