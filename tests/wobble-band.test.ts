// The Wobbler's band: only what lies between Low cut and High cut is wobbled; below and above it
// the sound stays steady.
import { describe, expect, it } from 'vitest';
import { Biquad } from '../src/engine/core/dsp';
import { renderPatch } from '../src/engine/core/render';
import { heldNote } from './helpers/audio';

const FS = 48000;
const base = { meta: { name: 't' }, 'osc1.wave': 'saw', 'amp_env.sustain': 1, 'wobble.depth': 1, 'wobble.life': 0, 'wobble.rate': '1/4', 'wobble.shape': 'square',
  'reverb.mix': 0, 'delay.mix': 0, 'texture.level': 0, 'voice.analog': 0, 'filter.cutoff': 18000, 'wobble.cutoff': false, 'wobble.volume': true };
/** How far the level in a band swings (dB) over 50 ms windows while the note holds. */
function swing(x: Float32Array, lo: number, hi: number): number {
  const hp = [0, 1, 2, 3].map(() => { const b = new Biquad(); b.setHighpass(lo, 0.7, FS); return b; });
  const lp = [0, 1, 2, 3].map(() => { const b = new Biquad(); b.setLowpass(hi, 0.7, FS); return b; });
  const y = Float32Array.from(x, (v) => { for (const b of hp) v = b.process(v); for (const b of lp) v = b.process(v); return v; });
  const w = FS / 20, lv: number[] = [];
  for (let i = FS / 2; i + w < FS * 1.4; i += w) {
    let e = 0;
    for (let k = 0; k < w; k++) e += y[i + k] ** 2;
    lv.push(10 * Math.log10(e / w + 1e-20));
  }
  return Math.max(...lv) - Math.min(...lv);
}

describe('wobbler band', () => {
  const x = renderPatch({ ...base, 'wobble.lowcut': 500, 'wobble.highcut': 2000 }, heldNote(45, 3), { seconds: 2, sampleRate: FS }).left;
  it('gates the band between the cuts', () => expect(swing(x, 600, 1500)).toBeGreaterThan(8));
  it('leaves below and above the band steady', () => {
    expect(swing(x, 20, 200)).toBeLessThan(2);
    expect(swing(x, 4000, 20000)).toBeLessThan(3);
  });
});
