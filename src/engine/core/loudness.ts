// K-weighted loudness (ITU-R BS.1770, as LUFS without gating) of the noise bed, used by the dev
// tool that levels the noise types and by its test. Not used on the audio thread.
import type { Texture } from './voicefx';
import { TEX_AIR_HIT, TEX_CRACKLE_HIT } from './voicefx';

/** BS.1770 K-weighting at 48 kHz: a high shelf (+4 dB above ~1.7 kHz), then a 38 Hz high-pass. */
function kWeight(x: Float64Array): Float64Array {
  const st = (b: number[], a: number[], inp: Float64Array) => {
    const y = new Float64Array(inp.length);
    let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
    for (let i = 0; i < inp.length; i++) {
      const v = b[0] * inp[i] + b[1] * x1 + b[2] * x2 - a[1] * y1 - a[2] * y2;
      x2 = x1; x1 = inp[i]; y2 = y1; y1 = v;
      y[i] = v;
    }
    return y;
  };
  const s1 = st([1.53512485958697, -2.69169618940638, 1.19839281085285], [1, -1.69065929318241, 0.73248077421585], x);
  return st([1, -2, 1], [1, -1.99004745483398, 0.99007225036621], s1);
}

/**
 * Loudness of one type at a tone and density (dB, K-weighted). A bed is measured over 4 s; a hit
 * is fired every 0.5 s (Tail 0.4 s, full velocity) and measured over the first 150 ms of each
 * burst, so a hit sounds as loud as its bed while it plays.
 */
export function textureLoudness(t: Texture, type: number, tone: number, density: number, fs: number): number {
  const hit = type === TEX_AIR_HIT || type >= TEX_CRACKLE_HIT;
  const n = 4 * fs, o = new Float64Array(2);
  const l = new Float64Array(n), r = new Float64Array(n);
  t.puffLen = 0.4;
  const period = Math.round(0.5 * fs);
  for (let i = 0; i < n; i++) {
    if (hit && i % period === 0) t.trigger(1);
    t.process(type, tone, density, fs, o);
    l[i] = o[0];
    r[i] = o[1];
  }
  const kl = kWeight(l), kr = kWeight(r);
  let e = 0, c = 0;
  for (let i = Math.round(0.5 * fs); i < n; i++) {
    if (hit && i % period >= 0.15 * fs) continue;
    e += 0.5 * (kl[i] * kl[i] + kr[i] * kr[i]);
    c++;
  }
  return 10 * Math.log10(e / c + 1e-20) - 0.691;
}
