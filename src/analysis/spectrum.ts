// Spectral helpers for offline analysis. Pure TypeScript, no browser APIs.

/** In-place radix-2 complex FFT (forward). n must be a power of two. */
export function fft(re: Float64Array, im: Float64Array): void {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      let t = re[i]; re[i] = re[j]; re[j] = t;
      t = im[i]; im[i] = im[j]; im[j] = t;
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wr = Math.cos(ang), wi = Math.sin(ang);
    const half = len >> 1;
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let j = 0; j < half; j++) {
        const a = i + j, b = a + half;
        const tr = re[b] * cr - im[b] * ci, ti = re[b] * ci + im[b] * cr;
        re[b] = re[a] - tr;
        im[b] = im[a] - ti;
        re[a] += tr;
        im[a] += ti;
        const t = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = t;
      }
    }
  }
}

const windows = new Map<number, Float64Array>();

/** Blackman-Harris window (-92 dB sidelobes), cached per size. */
export function blackmanHarris(n: number): Float64Array {
  let w = windows.get(n);
  if (!w) {
    w = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      const t = (2 * Math.PI * i) / (n - 1);
      w[i] = 0.35875 - 0.48829 * Math.cos(t) + 0.14128 * Math.cos(2 * t) - 0.01168 * Math.cos(3 * t);
    }
    windows.set(n, w);
  }
  return w;
}

export interface PowerSpectrum {
  /** Average power per bin (bins 0..N/2-1). */
  power: Float64Array;
  /** Hz per bin. */
  binHz: number;
  frames: number;
}

/**
 * Average power spectrum of x[from, to) using Blackman-Harris frames of size
 * N with 50% overlap. A segment shorter than N is zero-padded into one frame.
 */
export function powerSpectrum(x: ArrayLike<number>, sampleRate: number, from = 0, to = x.length, N = 8192): PowerSpectrum {
  const re = new Float64Array(N), im = new Float64Array(N);
  const power = new Float64Array(N / 2);
  const w = blackmanHarris(N);
  let frames = 0;
  const len = to - from;
  const hop = N / 2;
  const starts: number[] = [];
  if (len <= N) starts.push(from);
  else for (let s = from; s + N <= to; s += hop) starts.push(s);
  for (const s of starts) {
    re.fill(0);
    im.fill(0);
    const n = Math.min(N, to - s);
    for (let i = 0; i < n; i++) re[i] = x[s + i] * w[i];
    fft(re, im);
    for (let k = 0; k < N / 2; k++) power[k] += re[k] * re[k] + im[k] * im[k];
    frames++;
  }
  if (frames) for (let k = 0; k < N / 2; k++) power[k] /= frames;
  return { power, binHz: sampleRate / N, frames };
}

/** Sum of power between lo and hi Hz (inclusive bins). */
export function bandPower(s: PowerSpectrum, lo: number, hi: number): number {
  const k0 = Math.max(1, Math.ceil(lo / s.binHz));
  const k1 = Math.min(s.power.length - 1, Math.floor(hi / s.binHz));
  let e = 0;
  for (let k = k0; k <= k1; k++) e += s.power[k];
  return e;
}

/** Power-weighted mean frequency between lo and hi Hz. */
export function centroid(s: PowerSpectrum, lo = 20, hi = 20000): number {
  const k0 = Math.max(1, Math.ceil(lo / s.binHz));
  const k1 = Math.min(s.power.length - 1, Math.floor(hi / s.binHz));
  let num = 0, den = 0;
  for (let k = k0; k <= k1; k++) {
    num += k * s.binHz * s.power[k];
    den += s.power[k];
  }
  return den > 0 ? num / den : 0;
}

/** Spectral flatness (geometric / arithmetic mean of power) between lo and hi Hz, 0..1. */
export function flatness(s: PowerSpectrum, lo: number, hi: number): number {
  const k0 = Math.max(1, Math.ceil(lo / s.binHz));
  const k1 = Math.min(s.power.length - 1, Math.floor(hi / s.binHz));
  let logSum = 0, sum = 0, n = 0;
  for (let k = k0; k <= k1; k++) {
    const p = s.power[k] + 1e-20;
    logSum += Math.log(p);
    sum += p;
    n++;
  }
  if (!n || sum <= 0) return 0;
  return Math.exp(logSum / n) / (sum / n);
}

export function db(ratio: number): number {
  return 10 * Math.log10(Math.max(ratio, 1e-12));
}
