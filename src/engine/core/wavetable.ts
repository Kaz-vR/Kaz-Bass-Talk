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
export const MIP_LEVELS = 21; // level m holds harmonics 1..mipHarmonics(m): half an octave a level
/** How many harmonics mip level m holds: 1023, 724, 512, 362, 256 … 1 (half an octave a step). */
export function mipHarmonics(m: number): number {
  const o = 1024 >> (m >> 1);
  return Math.min(TABLE_SIZE / 2 - 1, m & 1 ? Math.floor(o * 0.7071067811865476) : o);
}
/** How long mip level m's table is (owner's call, 27 Nov, measured against Serum): long enough that the images linear
 * interpolation leaves sit under -90 dB, as Serum's (at 4 samples a harmonic the small high-note tables threw images
 * at -50 dB); the long tables where there are many harmonics, the shorter ones only up high. */
const MIP_SIZES = [2048, 2048, 2048, 2048, 2048, 2048, 2048, 2048, 2048, 2048, 2048, 1024, 1024, 1024, 1024, 512, 512, 512, 512, 256, 256];
export const MIP_SIZE: number[] = [];
/** Where mip level m starts inside a frame, and how long a frame is. */
export const MIP_OFFSET: number[] = [];
export let FRAME_STRIDE = 0;
for (let m = 0; m < MIP_LEVELS; m++) {
  const n = MIP_SIZES[m];
  MIP_SIZE.push(n);
  MIP_OFFSET.push(FRAME_STRIDE);
  FRAME_STRIDE += n;
}
/** Where frame f's mip level m starts in the data. */
export const mipBase = (f: number, m: number): number => f * FRAME_STRIDE + MIP_OFFSET[m];
export const FRAMES_PER_SEGMENT = 4;
export const KEYFRAMES = 5;
export const FRAME_COUNT = (KEYFRAMES - 1) * FRAMES_PER_SEGMENT + 1; // 17

/** Normalised morph positions of the keyframes. */
export const WT_POS_SINE = 0;
export const WT_POS_TRIANGLE = 1 / (KEYFRAMES - 1);

const MAX_HARMONIC = TABLE_SIZE / 2 - 1;

/** The MORPH table's last keyframe: the harmonic amplitudes of the processed "ah" (its frame 0, measured once). */
let vocalAmps: Float64Array | null = null;
function morphVocal(): Float64Array {
  if (!vocalAmps) {
    const t = WAVE_TABLES.findIndex((q) => q.name === 'morph vocal');
    const re = new Float64Array(TABLE_SIZE), im = new Float64Array(TABLE_SIZE);
    for (let n = 0; n < TABLE_SIZE; n++) re[n] = sampledSample(t, 0, n / TABLE_SIZE);
    fft(re, im, false);
    vocalAmps = new Float64Array(MAX_HARMONIC + 1);
    for (let k = 1; k <= MAX_HARMONIC; k++) vocalAmps[k] = (2 * Math.hypot(re[k], im[k])) / TABLE_SIZE;
  }
  return vocalAmps;
}

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
      case 4: // "vocal": the harmonics of a sung "ah" (tools/build-waves.py, 'morph vocal')
        a[k] = morphVocal()[k];
        break;
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
  const N = out.length; // TABLE_SIZE, or a shorter mip level
  const re = new Float64Array(N);
  const im = new Float64Array(N);
  for (let k = 1; k <= maxH; k++) {
    // sin = (e^{iθ} - e^{-iθ}) / 2i  →  X[k] = -i a/2, X[N-k] = i a/2
    im[k] = -a[k] / 2;
    im[N - k] = a[k] / 2;
  }
  fft(re, im, true);
  for (let n = 0; n < TABLE_SIZE; n++) out[n] = re[n] * scale;
}


// ---- The wave bank (owner's call, 27 Nov): the menu's new waves, each a table Shape moves through, built after the
// morph table in the same data array. Ported line by line to plugin/engine/Wavetable.h (bankKey).

const S = (x: number) => Math.sin(2 * Math.PI * x);
/** Rounds half up, the same in both engines (Math.round differs from C++ on negative halves). */
const jr = (x: number) => Math.floor(x + 0.5);
const fr = (x: number) => x - Math.floor(x);

/**
 * The sampled waves (owner's call, 27 Nov): acid, ring, scream and gritty are Serum's own tables, from the owner's
 * renders; every other bank wave but square, harmonic and the owner's four kept formulas (double saw, bell, digital, glass) is made the same way, a real source through real processing
 * (tools/build-waves.py), many full-band frames; both taken by tools/extract-waves.py into wave-tables.ts.
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
/** The true square (made once from its spectrum): every odd harmonic up to 1023 at exactly 1/k, as the textbook. */
let squareData: Float32Array | null = null;
function squareCycle(): Float32Array {
  if (!squareData) {
    const a = new Float64Array(MAX_HARMONIC + 1);
    for (let k = 1; k <= MAX_HARMONIC; k += 2) a[k] = 4 / (Math.PI * k);
    squareData = new Float32Array(TABLE_SIZE);
    synth(a, MAX_HARMONIC, squareData, 1);
  }
  return squareData;
}

/** The bank's waves by name: how many keyframes, and keyframe kf's sample at x. Tables of 8 keyframes and more are
 * real wavetables, made to be scanned (owner's call): two frames per step instead of four. */
const bank = (name: string, keys = 0) => ({ name, keys: WAVE_TABLES.find((q) => q.name === name)?.frames ?? keys });
export const BANK: { name: string; keys: number }[] = [
  bank('square', 3), bank('double saw', 3), bank('sync saw'), bank('vowel'), bank('choir'), bank('talk'), bank('bell', 5), bank('ring'),
  bank('digital', 5), bank('glass', 5), bank('bowed'), bank('reed'), bank('breath'),
  bank('electric guitar'), bank('acid'), bank('scream'), bank('growl'), bank('gritty'),
  // (fold, harmonic, crush, spectral and formant scan were cut, owner's call, 27 Nov: each repeated something the synth has)
];
/** Each bank wave's sampled table (an index into WAVE_TABLES), -1 when it is built from its formula. */
export const BANK_SAMPLED = BANK.map((b) => WAVE_TABLES.findIndex((q) => q.name === b.name));
/** Frames per keyframe step of bank wave w: 1 on a sampled table (its own frames), 2 on the wavetables, 4 on the rest. */
export const bankFps = (w: number): number => (BANK_SAMPLED[w] >= 0 ? 1 : BANK[w].keys >= 8 ? 2 : FRAMES_PER_SEGMENT);

export function bankKey(w: number, kf: number, x: number): number {
  if (BANK_SAMPLED[w] >= 0) return sampledSample(BANK_SAMPLED[w], kf, x);
  if (w === 0) { // square: a true square at Shape 0 (as Serum's, every odd harmonic at 1/k), Shape rounding it
    if (kf === 0) return squareCycle()[Math.floor(x * TABLE_SIZE) & TABLE_MASK];
    const g = [0, 4, 1.4][kf];
    return Math.tanh(g * S(x)) / Math.tanh(g);
  }
  // (the owner's picks, 27 Nov: these four kept their formulas over the processed versions)
  const saw = (t: number) => 2 * fr(t) - 1;
  switch (w) {
    case 1: return saw(x) + [0, 0.5, 1][kf] * saw(2 * x); // double saw, Shape brings in the octave
    case 6: { const ks = [1, 5, 9, 14, 21, 28, 35, 44], b = [0.2, 0.4, 0.6, 0.8, 1][kf]; let y = 0; for (let i = 0; i < ks.length; i++) y += Math.pow(b, i) * Math.sin(2 * Math.PI * ks[i] * x); return y; } // bell
    case 8: { const n = [48, 16, 8, 4, 2][kf]; return jr((0.6 * saw(x + 0.5) + 0.6 * S(x)) * n) / n; } // digital steps, down to two
    case 9: { const ks = [1, 4, 8, 12, 16, 24, 32, 40, 48], b = [0.15, 0.35, 0.55, 0.75, 1][kf]; let y = 0; for (let i = 0; i < ks.length; i++) y += Math.pow(b, i) * Math.sin(2 * Math.PI * ks[i] * x); return y; } // glass
  }
  return 0;
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
  const N = out.length; // TABLE_SIZE, or a shorter mip level (it holds maxH < N / 2 harmonics)
  const re = new Float64Array(N), im = new Float64Array(N);
  for (let k = 1; k <= maxH; k++) {
    re[k] = xr[k];
    im[k] = xi[k];
    re[N - k] = xr[TABLE_SIZE - k];
    im[N - k] = xi[TABLE_SIZE - k];
  }
  fft(re, im, true);
  for (let n = 0; n < N; n++) out[n] = (re[n] / TABLE_SIZE) * scale;
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
        const maxH = mipHarmonics(m);
        bandLimit(xr, xi, maxH, data.subarray(mipBase(fi, m), mipBase(fi, m) + MIP_SIZE[m]), scale);
      }
    }
  }
}

export interface Wavetable {
  /** data[mipBase(frame, mip) + i], i < MIP_SIZE[mip] */
  data: Float32Array;
}

let cached: Wavetable | null = null;

export function getWavetable(): Wavetable {
  if (cached) return cached;
  const data = new Float32Array(TOTAL_FRAMES * FRAME_STRIDE);
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
      const maxH = mipHarmonics(m);
      synth(spec, maxH, data.subarray(mipBase(f, m), mipBase(f, m) + MIP_SIZE[m]), scale);
    }
  }
  buildBank(data);
  cached = { data };
  return cached;
}

/**
 * Mip level for a phase increment (cycles/sample) at sample rate fs: the fullest level whose harmonics, where they
 * pass Nyquist, only fold back above 20 kHz (as the big wavetable synths do), so every note keeps its top end up to
 * about 20 kHz (half-octave levels: the top partial is never under 0.71 x that limit; at 48 kHz about 19.8 kHz).
 */
export function mipForIncrement(inc: number, fs: number): number {
  const a = Math.abs(inc);
  if (a <= 0) return 0;
  const allowed = Math.max(0.5, 1 - 20000 / fs) / a;
  let m = 0;
  while (m < MIP_LEVELS - 1 && mipHarmonics(m) > allowed) m++;
  return m;
}
