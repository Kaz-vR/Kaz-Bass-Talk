// The new routing and filter slots: per-source filters, square sub, sub direct out,
// A/B/N/S into the main filter, filter fat and mix, texture pan / direct out / filter.
import { describe, expect, it } from 'vitest';
import { renderPatch } from '../src/engine/core/render';
import { fft, heldNote, rms } from './helpers/audio';

const FS = 48000;
const base = {
  meta: { name: 't' }, 'voice.analog': 0, 'amp_env.attack': 1, 'amp_env.sustain': 1, 'filter.keytrack': 0, 'filter.resonance': 0,
  'dynamics.on': false, 'chorus.on': false, 'delay.on': false, 'reverb.on': false, 'tape.on': false, 'eq.on': false, 'output.gain': -12,
};
const render = (p: object, note = 48) => renderPatch({ ...base, ...p }, heldNote(note), { sampleRate: FS, seconds: 1 });
const tail = (x: Float32Array) => x.subarray(FS / 4, FS);
const db = (x: Float32Array) => 20 * Math.log10(rms(tail(x)) + 1e-12);
const diffDb = (a: Float32Array, b: Float32Array) => {
  let d = 0, e = 0;
  for (let i = 0; i < a.length; i++) {
    d += (a[i] - b[i]) ** 2;
    e += a[i] ** 2;
  }
  return 10 * Math.log10(d / e + 1e-30);
};
/** Share of energy above `hz` (dB). */
function above(x: Float32Array, hz: number): number {
  const N = 16384, re = new Float64Array(N), im = new Float64Array(N);
  for (let i = 0; i < N; i++) re[i] = x[FS / 4 + i] * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / N));
  fft(re, im);
  let hi = 0, all = 0;
  for (let k = 1; k < N / 2; k++) {
    const e = re[k] ** 2 + im[k] ** 2;
    all += e;
    if ((k * FS) / N > hz) hi += e;
  }
  return 10 * Math.log10(hi / all + 1e-30);
}

const subOnly = { 'osc1.level': 0, 'osc2.level': 0, 'sub.level': 0.8 };
const saw = { 'osc1.wave': 'saw', 'osc1.level': 0.8, 'osc2.level': 0, 'sub.level': 0, 'filter.cutoff': 300 };

describe('sub', () => {
  it('square has far more upper harmonics than sine, and its own low-pass tames them', () => {
    const sine = render({ ...subOnly }).left;
    const sq = render({ ...subOnly, 'sub.wave': 'square' }).left;
    const tamed = render({ ...subOnly, 'sub.wave': 'square', 'sub.filter_type': 'low 24', 'sub.filter_cutoff': 80 }).left;
    expect(above(sq, 100)).toBeGreaterThan(above(sine, 100) + 30);
    expect(above(tamed, 100)).toBeLessThan(above(sq, 100) - 10);
  });

  it('direct out off sends the sub through the effects', () => {
    const fx = { ...subOnly, 'reverb.on': true, 'reverb.mix': 0.6, 'fx.lowcut': 20, 'output.crossover': 20 };
    const direct = render(fx).left;
    const through = render({ ...fx, 'sub.direct': false }).left;
    expect(diffDb(direct, through)).toBeGreaterThan(-30);
  });

  it('S sends the sub through the main filter (a 30 Hz low-pass nearly silences it)', () => {
    const clean = render({ ...subOnly, 'filter.cutoff': 30 }).left;
    const routed = render({ ...subOnly, 'filter.cutoff': 30, 'filter.route_s': true }).left;
    expect(db(routed)).toBeLessThan(db(clean) - 10);
  });
});

describe('oscillator filter slots and routing', () => {
  it('a low-pass slot darkens its oscillator', () => {
    const open = render({ ...saw, 'filter.cutoff': 20000 }).left;
    const dark = render({ ...saw, 'filter.cutoff': 20000, 'osc1.filter_type': 'low 24', 'osc1.highpass': 400 }).left;
    expect(above(dark, 1000)).toBeLessThan(above(open, 1000) - 15);
  });

  it('A off: oscillator 1 skips the main filter', () => {
    const filtered = render(saw).left;
    const skips = render({ ...saw, 'filter.route_a': false }).left;
    expect(above(skips, 1000)).toBeGreaterThan(above(filtered, 1000) + 15);
  });

  it('B off with A on keeps oscillator 1 filtered and oscillator 2 open', () => {
    const p = { ...saw, 'osc2.level': 0.8, 'osc2.wave': 'saw', 'osc2.semi': 7 };
    const both = render(p).left;
    const bOff = render({ ...p, 'filter.route_b': false }).left;
    expect(above(bOff, 1000)).toBeGreaterThan(above(both, 1000) + 10);
  });
});

describe('main filter fat and mix', () => {
  const res = { ...saw, 'filter.cutoff': 600, 'filter.resonance': 0.8 };
  it('fat brings back low end under a resonant filter', () => {
    const thin = render(res).left;
    const fat = render({ ...res, 'filter.fat': 1 }).left;
    expect(above(fat, 400)).toBeLessThan(above(thin, 400) - 2);
  });
  it('mix 0 is the unfiltered (driven) sound', () => {
    const dry = render({ ...saw, 'filter.mix': 0 }).left;
    const wet = render(saw).left;
    expect(above(dry, 1000)).toBeGreaterThan(above(wet, 1000) + 15);
  });
});

describe('texture bed', () => {
  const bed = { 'osc1.level': 0, 'osc2.level': 0, 'sub.level': 0, 'texture.level': 0.8, 'texture.type': 'air' };
  it('pans', () => {
    const r = render({ ...bed, 'texture.pan': -1, 'output.crossover': 20 });
    // (the lows stay centred: the low end is always mono)
    expect(db(r.right)).toBeLessThan(db(r.left) - 12);
  });
  it('its own filter and the main filter copy (N) shape it', () => {
    const open = render(bed).left;
    const hp = render({ ...bed, 'texture.filter_type': 'high 24', 'texture.filter_cutoff': 6000 }).left;
    const n = render({ ...bed, 'filter.route_n': true, 'filter.cutoff': 200, 'filter.env_amount': 0 }).left;
    expect(above(hp, 6000)).toBeGreaterThan(above(open, 6000) + 3);
    expect(db(n)).toBeLessThan(db(open) - 15);
  });
  it('direct out skips the effects', () => {
    const fx = { ...bed, 'reverb.on': true, 'reverb.mix': 0.6 };
    const through = render(fx).left;
    const direct = render({ ...fx, 'texture.direct': true }).left;
    const dry = render(bed).left;
    expect(diffDb(dry, direct)).toBeLessThan(-60);
    expect(diffDb(dry, through)).toBeGreaterThan(-30);
  });
});
