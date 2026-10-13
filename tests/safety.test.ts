// Safety tests: whatever the patch, the output never exceeds the limiter
// ceiling, carries no DC offset, and is mono below the crossover.
import { describe, expect, it } from 'vitest';
import { renderPatch } from '../src/engine/core/render';
import { Rng } from '../src/engine/core/dsp';
import { Synth } from '../src/engine/core/synth';
import { params, type Patch } from '../src/schema';
import { bandEnergy, dcOffset, hasNonFinite, libraryPatches, loop, loops, midSide, peak } from './helpers/audio';

const FS = 48000;
const CEILING = new Synth(FS).limiterCeiling;

function checkSafety(name: string, patch: unknown, l: ReturnType<typeof loop>, seconds: number) {
  const r = renderPatch(patch, l, { seconds, tail: 0.25 });
  expect(hasNonFinite(r.left) || hasNonFinite(r.right), `${name}: non-finite samples`).toBe(false);
  expect(peak(r.left, r.right), `${name}: peak`).toBeLessThanOrEqual(CEILING + 1e-6);
  expect(Math.abs(dcOffset(r.left)), `${name}: DC left`).toBeLessThan(2e-3);
  expect(Math.abs(dcOffset(r.right)), `${name}: DC right`).toBeLessThan(2e-3);
  const xo = ((patch as Record<string, unknown>)['output.crossover'] as number | undefined) ?? 120;
  const { mid, side } = midSide(r.left, r.right);
  // Stereo (side) content below half the crossover must be either ≥ 30 dB under
  // the whole low band, or ≥ 60 dB under the entire signal (i.e. negligible).
  const sideLow = bandEnergy(side, FS, xo / 2, 5);
  const midLow = bandEnergy(mid, FS, xo / 2, 5);
  const all = bandEnergy(mid, FS, FS / 2) + bandEnergy(side, FS, FS / 2);
  const vsLow = 10 * Math.log10(sideLow / (midLow + sideLow + 1e-30));
  const vsAll = 10 * Math.log10(sideLow / (all + 1e-30));
  expect(vsLow <= -30 || vsAll <= -60 || sideLow === 0, `${name}: side below crossover ${vsLow.toFixed(1)} dB of low band, ${vsAll.toFixed(1)} dB of total`).toBe(true);
}

describe('library patches are safe on every loop', () => {
  const ls = loops();
  for (const { file, json } of libraryPatches()) {
    it(file, () => {
      for (const l of ls) checkSafety(`${file} / ${l.id}`, json, l, 2);
    });
  }
});

function randomPatch(rng: Rng, n: number): Patch {
  const u = () => 0.5 * (rng.next() + 1);
  const patch: Record<string, unknown> = { meta: { name: `fuzz ${n}` } };
  for (const p of params) {
    switch (p.type) {
      case 'bool': patch[p.id] = u() < 0.5; break;
      case 'enum': patch[p.id] = p.options![Math.floor(u() * p.options!.length) % p.options!.length]; break;
      case 'int': patch[p.id] = Math.round(p.min! + u() * (p.max! - p.min!)); break;
      case 'float': {
        // Bias towards extremes, which is where things break.
        const r = u();
        const t = r < 0.15 ? 0 : r > 0.85 ? 1 : u();
        patch[p.id] = p.min! + t * (p.max! - p.min!);
      }
    }
  }
  // Push levels hot so the limiter has to work.
  patch['output.gain'] = 6 + 6 * u();
  return patch as Patch;
}

describe('fuzzed patches never break the safety rules', () => {
  const rng = new Rng(0xbada55);
  const ls = loops();
  const N = 60;
  it(`${N} random patches`, () => {
    for (let n = 0; n < N; n++) {
      const patch = randomPatch(rng, n);
      checkSafety(`fuzz ${n}`, patch, ls[n % ls.length], 0.75);
    }
  });

  it('survives extreme values hammered mid-note', () => {
    const s = new Synth(FS);
    const L = new Float32Array(128), R = new Float32Array(128);
    const vals = new Float64Array(params.length);
    s.noteOn(40, 1);
    for (let block = 0; block < 2000; block++) {
      if (block % 7 === 0) {
        params.forEach((p, i) => {
          const r = 0.5 * (rng.next() + 1);
          vals[i] = p.type === 'enum' ? Math.floor(r * p.options!.length) % p.options!.length
            : p.type === 'bool' ? (r < 0.5 ? 0 : 1)
            : p.type === 'int' ? Math.round(p.min! + r * (p.max! - p.min!))
            : r < 0.5 ? p.min! : p.max!;
        });
        s.setParams(vals);
      }
      if (block % 50 === 0) s.noteOn(30 + (block % 40), 1);
      s.render(L, R, 0, 128);
      expect(hasNonFinite(L) || hasNonFinite(R)).toBe(false);
      expect(peak(L, R)).toBeLessThanOrEqual(CEILING + 1e-6);
    }
  });
});
