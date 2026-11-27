// Band-limited wavetables, built once at engine start-up (never on the audio
// thread's process() path).
//
// The morph table sweeps sine → triangle → saw → square → vocal. Keyframes are
// defined as harmonic spectra and interpolated in the harmonic domain, so the
// in-between frames are real hybrid timbres rather than crossfades. Each frame
// has one mip level per octave so that no harmonic ever exceeds Nyquist.

import { WAVE_TABLES } from './wave-tables';

export const TABLE_SIZE = 2048;
export const TABLE_MASK = TABLE_SIZE - 1;
export const MIP_LEVELS = 11; // level m holds harmonics 1..min(1023, 1024 >> m)
export const FRAMES_PER_SEGMENT = 4;
export const KEYFRAMES = 5;
export const FRAME_COUNT = (KEYFRAMES - 1) * FRAMES_PER_SEGMENT + 1; // 17

/** Normalised morph positions of the keyframes. */
export const WT_POS_SINE = 0;
export const WT_POS_TRIANGLE = 1 / (KEYFRAMES - 1);

const MAX_HARMONIC = TABLE_SIZE / 2 - 1;

function keyframeSpectrum(kf: number): Float64Array {
  const a = new Float64Array(MAX_HARMONIC + 1);
  for (let k = 1; k <= MAX_HARMONIC; k++) {
    switch (kf) {
      case 0: // sine
        a[k] = k === 1 ? 1 : 0;
        break;
      case 1: // triangle
        a[k] = k % 2 === 1 ? ((8 / (Math.PI * Math.PI)) * ((k - 1) / 2 % 2 === 0 ? 1 : -1)) / (k * k) : 0;
        break;
      case 2: // saw
        a[k] = ((2 / Math.PI) * (k % 2 === 1 ? 1 : -1)) / k;
        break;
      case 3: // square
        a[k] = k % 2 === 1 ? 4 / (Math.PI * k) : 0;
        break;
      case 4: {
        // "vocal": strong fundamental plus formant-like humps at fixed harmonics
        const hump = (c: number, w: number) => Math.exp(-(((k - c) / w) ** 2));
        a[k] = (k === 1 ? 0.8 : 0) + (0.9 * hump(4, 1.6) + 0.55 * hump(11, 3) + 0.3 * hump(26, 7)) / Math.sqrt(k) + 0.15 / k;
        break;
      }
    }
  }
  return a;
}

// Minimal iterative radix-2 complex FFT (in place), used only at init.
function fft(re: Float64Array, im: Float64Array, inverse: boolean): void {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = ((inverse ? 2 : -2) * Math.PI) / len;
    const wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let j = 0; j < len / 2; j++) {
        const ar = re[i + j + len / 2] * cr - im[i + j + len / 2] * ci;
        const ai = re[i + j + len / 2] * ci + im[i + j + len / 2] * cr;
        re[i + j + len / 2] = re[i + j] - ar;
        im[i + j + len / 2] = im[i + j] - ai;
        re[i + j] += ar;
        im[i + j] += ai;
        const t = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = t;
      }
    }
  }
}

/** Synthesise one period of Σ a[k]·sin(2πk·n/N) for k ≤ maxH. */
function synth(a: Float64Array, maxH: number, out: Float32Array, scale: number): void {
  const re = new Float64Array(TABLE_SIZE);
  const im = new Float64Array(TABLE_SIZE);
  for (let k = 1; k <= maxH; k++) {
    // sin = (e^{iθ} - e^{-iθ}) / 2i  →  X[k] = -i a/2, X[N-k] = i a/2
    im[k] = -a[k] / 2;
    im[TABLE_SIZE - k] = a[k] / 2;
  }
  fft(re, im, true);
  for (let n = 0; n < TABLE_SIZE; n++) out[n] = re[n] * scale;
}


// ---- The wave bank (owner's call, 27 Nov): the menu's new waves, each a small morph table Shape moves through,
// keyframes defined as one cycle in time (x in 0..1), built after the morph table in the same data array.
// Ported line by line to plugin/engine/Wavetable.h (bankKey).

/** Rounds half up, the same in both engines (Math.round differs from C++ on negative halves). */
const jr = (x: number) => Math.floor(x + 0.5);
const fr = (x: number) => x - Math.floor(x);
const S = (x: number) => Math.sin(2 * Math.PI * x);
/** A sum of harmonics sin(2πkx), amplitude amp(k) for k = 1..h. */
function additive(x: number, h: number, amp: (k: number) => number): number {
  let y = 0;
  for (let k = 1; k <= h; k++) y += amp(k) * Math.sin(2 * Math.PI * k * x);
  return y;
}
/** Vowel formants (Hz) and their gains, A E I O U. */
const VF = [[730, 1090, 2440], [530, 1840, 2480], [270, 2290, 3010], [570, 840, 2410], [300, 870, 2240]];
const VG = [1, 0.5, 0.25];
/** A voice on a 110 Hz fundamental through three formants (vowel index, bandwidth scale, tilt). */
function voice(x: number, v: number, bw: number, tilt: number): number {
  return additive(x, 80, (k) => {
    const f = 110 * k;
    let a = 0;
    for (let i = 0; i < 3; i++) {
      const d = (f - VF[v][i]) / ((90 + 40 * i) * bw);
      a += VG[i] * Math.exp(-d * d);
    }
    return (a + 0.08 / k) / Math.pow(k, tilt);
  });
}

/**
 * The sampled waves (owner's call: exactly Serum's): acid, ring, scream and gritty are Serum's own tables, taken frame
 * by frame from the owner's renders (tools/extract-waves.py, wave-tables.ts), Shape scanning their frames.
 */
const sampledData: (Float32Array | null)[] = WAVE_TABLES.map(() => null);
function sampledSample(t: number, kf: number, x: number): number {
  let d = sampledData[t];
  if (!d) {
    // base64 -> int16 by hand (the audio worklet has no atob)
    const A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/', s = WAVE_TABLES[t].b64, lut = new Int8Array(128);
    for (let i = 0; i < 64; i++) lut[A.charCodeAt(i)] = i;
    const bytes = new Uint8Array(WAVE_TABLES[t].frames * TABLE_SIZE * 2);
    let o = 0;
    for (let i = 0; i + 3 < s.length && o < bytes.length; i += 4) {
      const n = (lut[s.charCodeAt(i)] << 18) | (lut[s.charCodeAt(i + 1)] << 12) | (lut[s.charCodeAt(i + 2)] << 6) | lut[s.charCodeAt(i + 3)];
      bytes[o++] = (n >> 16) & 255;
      if (o < bytes.length) bytes[o++] = (n >> 8) & 255;
      if (o < bytes.length) bytes[o++] = n & 255;
    }
    d = new Float32Array(WAVE_TABLES[t].frames * TABLE_SIZE);
    for (let i = 0; i < d.length; i++) {
      const v = bytes[2 * i] | (bytes[2 * i + 1] << 8);
      d[i] = (v >= 32768 ? v - 65536 : v) / 32767;
    }
    sampledData[t] = d;
  }
  return d[kf * TABLE_SIZE + (Math.floor(x * TABLE_SIZE) & TABLE_MASK)];
}
const sampledFrames = (name: string): number => WAVE_TABLES.find((q) => q.name === name)?.frames ?? 2;

/** The bank's waves by name: how many keyframes, and keyframe kf's sample at x. Tables of 8 keyframes and more are
 * real wavetables, made to be scanned (owner's call): two frames per step instead of four. */
export const BANK: { name: string; keys: number }[] = [
  { name: 'square', keys: 3 }, { name: 'double saw', keys: 3 }, { name: 'sync saw', keys: 9 }, { name: 'vowel', keys: 5 },
  { name: 'choir', keys: 3 }, { name: 'talk', keys: 3 }, { name: 'bell', keys: 5 }, { name: 'ring', keys: sampledFrames('ring') },
  { name: 'digital', keys: 5 }, { name: 'glass', keys: 5 }, { name: 'bowed', keys: 3 }, { name: 'reed', keys: 3 },
  { name: 'breath', keys: 3 }, { name: 'tape saw', keys: 3 }, { name: 'cassette pulse', keys: 3 }, { name: 'lofi sample', keys: 3 },
  { name: 'broken sine', keys: 5 }, { name: 'electric guitar', keys: 3 }, { name: 'acid', keys: sampledFrames('acid') }, { name: 'scream', keys: sampledFrames('scream') },
  { name: 'growl', keys: 9 }, { name: 'fold', keys: 9 }, { name: 'harmonic', keys: 9 }, { name: 'crush', keys: 9 },
  { name: 'spectral', keys: 9 }, { name: 'formant scan', keys: 9 },
  { name: 'gritty', keys: sampledFrames('gritty') },
];
/** Each bank wave's sampled table (an index into WAVE_TABLES), -1 when it is built from its formula. */
export const BANK_SAMPLED = BANK.map((b) => WAVE_TABLES.findIndex((q) => q.name === b.name));
/** Frames per keyframe step of bank wave w: 1 on a sampled table (its own frames), 2 on the wavetables, 4 on the rest. */
export const bankFps = (w: number): number => (BANK_SAMPLED[w] >= 0 ? 1 : BANK[w].keys >= 8 ? 2 : FRAMES_PER_SEGMENT);

export function bankKey(w: number, kf: number, x: number): number {
  if (BANK_SAMPLED[w] >= 0) return sampledSample(BANK_SAMPLED[w], kf, x);
  const saw = (t: number) => 2 * fr(t) - 1;
  const tri = (t: number) => 1 - 4 * Math.abs(fr(t + 0.25) - 0.5);
  switch (w) {
    case 0: { const g = [40, 4, 1.4][kf]; return Math.tanh(g * S(x)) / Math.tanh(g); } // square, Shape rounds it
    case 1: return saw(x) + [0, 0.5, 1][kf] * saw(2 * x); // double saw, Shape brings in the octave
    case 2: return saw(x * [1, 1.5, 2, 2.7, 3.5, 4.5, 6, 8, 11][kf]); // sync sweep, Shape = how hard it is synced
    case 3: return voice(x, [0, 1, 2, 3, 4][kf], 1, 0); // vowel A E I O U
    case 4: return voice(x, [4, 3, 0][kf], 2.4, 0.5); // choir oo oh ah, soft and wide
    case 5: return voice(x, [3, 2, 0][kf], 0.8, 0.2); // talk o → i → a
    case 6: { const ks = [1, 5, 9, 14, 21, 28, 35, 44], b = [0.2, 0.4, 0.6, 0.8, 1][kf]; let y = 0; for (let i = 0; i < ks.length; i++) y += Math.pow(b, i) * Math.sin(2 * Math.PI * ks[i] * x); return y; } // bell, brighter and denser
    case 8: { const n = [48, 16, 8, 4, 2][kf]; return jr((0.6 * saw(x + 0.5) + 0.6 * S(x)) * n) / n; } // digital steps, down to two
    case 9: { const ks = [1, 4, 8, 12, 16, 24, 32, 40, 48], b = [0.15, 0.35, 0.55, 0.75, 1][kf]; let y = 0; for (let i = 0; i < ks.length; i++) y += Math.pow(b, i) * Math.sin(2 * Math.PI * ks[i] * x); return y; } // glass
    case 10: { const p = [1.6, 1.3, 1][kf]; return additive(x, 60, (k) => (1 + 0.8 * Math.exp(-(((k - 3) / 1.5) ** 2)) + 0.5 * Math.exp(-(((k - 8) / 3) ** 2))) / Math.pow(k, p)); } // bowed
    case 11: { const n = [0.3, 1, 2][kf]; return additive(x, 60, (k) => (k % 2 === 1 ? 1 / k : 0.15 / k) * (1 + n * Math.exp(-(((k - 7) / 3) ** 2)))); } // reed
    case 12: { const h = [0.05, 0.2, 0.35][kf]; return S(x) + h * S(2 * x) + 0.4 * h * S(3 * x); } // breath: a soft, flute-like tone, Shape brighter
    case 13: { const d = [1.5, 3, 6][kf]; return Math.tanh(d * (saw(x) + 0.1)) - Math.tanh(d * 0.1); } // tape saw
    case 14: { const dr = [0.5, 1.5, 3][kf]; return x < 0.5 ? Math.exp(-dr * x) : -Math.exp(-dr * (x - 0.5)); } // cassette pulse, sagging
    case 15: { const st = [64, 24, 10][kf], q = [24, 8, 4][kf], xs = Math.floor(x * st) / st; return jr((0.6 * saw(xs + 0.5) + 0.4 * S(xs)) * q) / q; } // lofi sample
    case 16: { const g = [0.6, 1.4, 2.4, 3.8, 6][kf]; return Math.sin(Math.PI * g * S(x)); } // broken sine, folded further
    case 17: { // electric guitar: a string plucked near the bridge through an amp, Shape = more gain
      const d = [1.5, 4, 10][kf];
      return Math.tanh(d * additive(x, 40, (k) => Math.abs(Math.sin(Math.PI * k * 0.2)) / k)) / Math.tanh(d);
    }
    case 20: return Math.tanh(3 * voice(x, [3, 4, 3, 0, 1, 2, 1, 0, 3][kf], 0.7, 0)) / Math.tanh(3); // growl: a neuro yoi, o-u-o-a-e-i-e-a-o
    case 21: return Math.sin(0.5 * Math.PI * [0.25, 0.6, 1, 1.6, 2.4, 3.4, 4.6, 6, 8][kf] * tri(x)); // fold: clean to folded hard
    case 22: { const n = [1, 2, 3, 4, 6, 8, 12, 16, 24][kf]; return additive(x, n, (k) => 1 / Math.sqrt(k)); } // harmonic: partials one by one
    case 23: { // crush: clean to destroyed, sample rate and bits together
      const st = [256, 128, 64, 40, 24, 16, 10, 6, 4][kf], q = [256, 64, 32, 16, 8, 6, 4, 3, 2][kf], xs = Math.floor(x * st) / st;
      return jr((0.5 * saw(xs + 0.5) + 0.7 * S(xs)) * q) / q;
    }
    case 24: { const ph = (kf * Math.PI) / 4; return additive(x, 80, (k) => (0.5 + 0.5 * Math.cos((2 * Math.PI * k) / 6 + ph)) / Math.pow(k, 0.6)); } // spectral: a moving comb
    default: return voice(x, [0, 1, 2, 3, 4, 3, 1, 0, 2][kf], 0.6, 0); // formant scan: a long sweep through the vowels
  }
}

/** Where each bank wave's frames start in the data (after the morph table) and how many it has. */
export const BANK_FRAME0: number[] = [];
export const BANK_FRAMES: number[] = [];
{
  let f = FRAME_COUNT;
  for (let w = 0; w < BANK.length; w++) {
    BANK_FRAME0.push(f);
    BANK_FRAMES.push((BANK[w].keys - 1) * bankFps(w) + 1);
    f += (BANK[w].keys - 1) * bankFps(w) + 1;
  }
}
export const TOTAL_FRAMES = BANK_FRAME0[BANK_FRAME0.length - 1] + BANK_FRAMES[BANK_FRAMES.length - 1];

/** Band-limit one frame's spectrum (re / im, full length) to maxH harmonics into out, times scale. */
function bandLimit(xr: Float64Array, xi: Float64Array, maxH: number, out: Float32Array, scale: number): void {
  const re = new Float64Array(TABLE_SIZE), im = new Float64Array(TABLE_SIZE);
  for (let k = 1; k <= maxH; k++) {
    re[k] = xr[k];
    im[k] = xi[k];
    re[TABLE_SIZE - k] = xr[TABLE_SIZE - k];
    im[TABLE_SIZE - k] = xi[TABLE_SIZE - k];
  }
  fft(re, im, true);
  for (let n = 0; n < TABLE_SIZE; n++) out[n] = (re[n] / TABLE_SIZE) * scale;
}

/** Build the bank's frames into data (after the morph table). */
function buildBank(data: Float32Array): void {
  const tmp = new Float32Array(TABLE_SIZE);
  for (let w = 0; w < BANK.length; w++) {
    const keys = BANK[w].keys;
    // each keyframe's spectrum (one cycle sampled, forward FFT)
    const kr: Float64Array[] = [], ki: Float64Array[] = [];
    for (let kf = 0; kf < keys; kf++) {
      const re = new Float64Array(TABLE_SIZE), im = new Float64Array(TABLE_SIZE);
      for (let n = 0; n < TABLE_SIZE; n++) re[n] = bankKey(w, kf, n / TABLE_SIZE);
      fft(re, im, false);
      kr.push(re);
      ki.push(im);
    }
    const xr = new Float64Array(TABLE_SIZE), xi = new Float64Array(TABLE_SIZE);
    for (let f = 0; f < BANK_FRAMES[w]; f++) {
      const fps = bankFps(w);
      const seg = Math.min(keys - 2, Math.floor(f / fps));
      const t = f / fps - seg;
      for (let k = 0; k < TABLE_SIZE; k++) {
        xr[k] = kr[seg][k] * (1 - t) + kr[seg + 1][k] * t;
        xi[k] = ki[seg][k] * (1 - t) + ki[seg + 1][k] * t;
      }
      // normalised by the peak of its full-bandwidth version, as the morph table
      bandLimit(xr, xi, MAX_HARMONIC, tmp, 1);
      let peak = 0;
      for (let n = 0; n < TABLE_SIZE; n++) peak = Math.max(peak, Math.abs(tmp[n]));
      // (a sampled table keeps Serum's levels between its frames)
      const scale = BANK_SAMPLED[w] >= 0 || peak <= 0 ? 1 : 1 / peak;
      const fi = BANK_FRAME0[w] + f;
      for (let m = 0; m < MIP_LEVELS; m++) {
        const maxH = Math.min(MAX_HARMONIC, 1024 >> m);
        bandLimit(xr, xi, maxH, data.subarray((fi * MIP_LEVELS + m) * TABLE_SIZE, (fi * MIP_LEVELS + m + 1) * TABLE_SIZE), scale);
      }
    }
  }
}

export interface Wavetable {
  /** data[(frame * MIP_LEVELS + mip) * TABLE_SIZE + i] */
  data: Float32Array;
}

let cached: Wavetable | null = null;

export function getWavetable(): Wavetable {
  if (cached) return cached;
  const data = new Float32Array(TOTAL_FRAMES * MIP_LEVELS * TABLE_SIZE);
  const keys = Array.from({ length: KEYFRAMES }, (_, i) => keyframeSpectrum(i));
  const spec = new Float64Array(MAX_HARMONIC + 1);
  const tmp = new Float32Array(TABLE_SIZE);
  for (let f = 0; f < FRAME_COUNT; f++) {
    const seg = Math.min(KEYFRAMES - 2, Math.floor(f / FRAMES_PER_SEGMENT));
    const t = f / FRAMES_PER_SEGMENT - seg;
    for (let k = 0; k <= MAX_HARMONIC; k++) spec[k] = keys[seg][k] * (1 - t) + keys[seg + 1][k] * t;
    // Normalise each frame by the peak of its full-bandwidth version.
    synth(spec, MAX_HARMONIC, tmp, 1);
    let peak = 0;
    for (let n = 0; n < TABLE_SIZE; n++) peak = Math.max(peak, Math.abs(tmp[n]));
    const scale = peak > 0 ? 1 / peak : 1;
    for (let m = 0; m < MIP_LEVELS; m++) {
      const maxH = Math.min(MAX_HARMONIC, 1024 >> m);
      synth(spec, maxH, data.subarray((f * MIP_LEVELS + m) * TABLE_SIZE, (f * MIP_LEVELS + m + 1) * TABLE_SIZE), scale);
    }
  }
  buildBank(data);
  cached = { data };
  return cached;
}

/** Mip level for a phase increment (cycles/sample) so harmonics stay below Nyquist. */
export function mipForIncrement(inc: number): number {
  const a = Math.abs(inc);
  if (a <= 0) return 0;
  const allowed = 0.5 / a; // highest harmonic below Nyquist
  let m = 0;
  while (m < MIP_LEVELS - 1 && Math.min(MAX_HARMONIC, 1024 >> m) > allowed) m++;
  return m;
}
