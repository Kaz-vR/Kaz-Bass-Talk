// Analysis on known signals: the measurements must mean what they claim.
import { describe, expect, it } from 'vitest';
import { analyzePatch, FEATURE_NAMES } from '../src/analysis';
import { fft, flatness, powerSpectrum } from '../src/analysis/spectrum';
import { loop } from './helpers/audio';

const groove = loop('groove');
const sine = {
  meta: { name: 'sine' }, 'osc1.wave': 'sine', 'osc1.level': 1, 'sub.level': 0, 'voice.analog': 0,
  'filter.cutoff': 20000, 'filter.keytrack': 0, 'filter.resonance': 0, 'amp_env.attack': 1, 'amp_env.sustain': 1,
};

describe('spectrum helpers', () => {
  it('fft puts a sine in the right bin', () => {
    const N = 1024, re = new Float64Array(N), im = new Float64Array(N);
    for (let i = 0; i < N; i++) re[i] = Math.sin((2 * Math.PI * 37 * i) / N);
    fft(re, im);
    let best = 0;
    for (let k = 1; k < N / 2; k++) if (re[k] ** 2 + im[k] ** 2 > re[best] ** 2 + im[best] ** 2) best = k;
    expect(best).toBe(37);
  });

  it('flatness is near 0 for a tone and high for noise', () => {
    const fs = 48000, n = 48000;
    const tone = new Float64Array(n), noise = new Float64Array(n);
    let s = 1;
    for (let i = 0; i < n; i++) {
      tone[i] = Math.sin((2 * Math.PI * 1000 * i) / fs);
      s = (s * 16807) % 2147483647;
      noise[i] = s / 2147483647 - 0.5;
    }
    expect(flatness(powerSpectrum(tone, fs), 500, 5000)).toBeLessThan(0.01);
    expect(flatness(powerSpectrum(noise, fs), 500, 5000)).toBeGreaterThan(0.5);
  });
});

describe('analysis of known sounds', () => {
  const pure = analyzePatch(sine, groove);

  it('a sine has almost no high-frequency energy, no harshness, no fizz, no whistle', () => {
    expect(pure.raw.highDb).toBeLessThan(-60);
    expect(pure.raw.harshDb).toBeLessThan(-40);
    expect(pure.raw.aliasDb!).toBeLessThan(-80);
    expect(pure.raw.whistleDb).toBeLessThan(3);
    expect(pure.raw.flatness).toBeLessThan(0.03); // noise floor only; real dirt reads 0.25+, noise 0.4+
  });

  it('a sine is all fundamental, mono, static and even across the keyboard', () => {
    for (const v of Object.values(pure.raw.fundamentalDb)) expect(v).toBeGreaterThan(-1);
    expect(pure.raw.widthDb).toBeLessThan(-60);
    expect(pure.raw.movementDb).toBeLessThan(0.2);
    expect(pure.raw.noteSpreadDb).toBeLessThan(1.5);
  });

  it('noise is bright and flat', () => {
    const noise = analyzePatch({ ...sine, 'osc1.level': 0, 'noise.level': 1 }, groove);
    expect(noise.features.brightness).toBeGreaterThan(0.8);
    expect(noise.raw.flatness).toBeGreaterThan(0.4);
  });

  it('measures attack, decay and sustain', () => {
    const slow = analyzePatch({ ...sine, 'amp_env.attack': 200 }, groove);
    expect(slow.raw.attackMs).toBeGreaterThan(150);
    expect(slow.raw.attackMs).toBeLessThan(260);
    expect(pure.raw.attackMs).toBeLessThan(25);
    const pluck = analyzePatch({ ...sine, 'amp_env.decay': 150, 'amp_env.sustain': 0 }, groove);
    expect(pluck.raw.decayMs).toBeGreaterThan(30);
    expect(pluck.raw.decayMs).toBeLessThan(200);
    expect(pluck.raw.sustainDb).toBeLessThan(-30);
    expect(pure.raw.decayMs).toBeGreaterThan(1000); // never falls: the whole hold
    expect(pure.raw.sustainDb).toBeGreaterThan(-2);
  });

  it('detects movement from an LFO and width from unison spread', () => {
    const saw = { ...sine, 'osc1.wave': 'saw', 'filter.cutoff': 800 };
    const moving = analyzePatch({ ...saw, 'mod1.source': 'lfo1', 'mod1.dest': 'filter_cutoff', 'mod1.amount': 0.4, 'lfo1.rate': 4 }, groove);
    const still = analyzePatch(saw, groove);
    expect(moving.raw.movementDb).toBeGreaterThan(1);
    expect(still.raw.movementDb).toBeLessThan(0.3);
    const wide = analyzePatch({ ...saw, 'osc1.unison_voices': 7, 'osc1.unison_detune': 25, 'osc1.unison_spread': 1 }, groove);
    expect(wide.raw.widthDb).toBeGreaterThan(-15);
    expect(wide.raw.sideLowDb).toBeLessThan(-30); // mono below the crossover
  });

  it('features stay in 0..1 and are deterministic', () => {
    const again = analyzePatch(sine, groove);
    for (const k of FEATURE_NAMES) {
      expect(pure.features[k], k).toBeGreaterThanOrEqual(0);
      expect(pure.features[k], k).toBeLessThanOrEqual(1);
      expect(again.features[k], k).toBe(pure.features[k]);
    }
  });
});
