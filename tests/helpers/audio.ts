// Test helpers: data loading and simple signal measurements.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Loop } from '../../src/engine/core/sequencer';

const ROOT = join(__dirname, '../..');

export function libraryPatches(): { file: string; json: any }[] {
  const dir = join(ROOT, 'data/library');
  return readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .map((file) => ({ file, json: JSON.parse(readFileSync(join(dir, file), 'utf8')) }));
}

export function loops(): Loop[] {
  const dir = join(ROOT, 'data/loops');
  return readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .map((f) => JSON.parse(readFileSync(join(dir, f), 'utf8')));
}

export function loop(id: string): Loop {
  const l = loops().find((l) => l.id === id);
  if (!l) throw new Error(`no loop ${id}`);
  return l;
}

/** A single held note, as a loop. */
export function heldNote(note: number, beats = 4, bpm = 120): Loop {
  return { id: 'held', name: 'held', description: '', bpm, length_beats: beats * 2, notes: [{ start: 0, dur: beats, note, vel: 1 }] };
}

export function peak(...chans: Float32Array[]): number {
  let p = 0;
  for (const c of chans) for (let i = 0; i < c.length; i++) p = Math.max(p, Math.abs(c[i]));
  return p;
}

export function mean(x: Float32Array): number {
  let s = 0;
  for (let i = 0; i < x.length; i++) s += x[i];
  return s / x.length;
}

/**
 * DC offset estimate: Blackman-windowed mean. Unlike a plain mean it doesn't
 * mistake real low-frequency content in a short window for DC.
 */
export function dcOffset(x: Float32Array): number {
  let s = 0, w = 0;
  const n = x.length;
  for (let i = 0; i < n; i++) {
    const t = (2 * Math.PI * i) / (n - 1);
    const win = 0.42 - 0.5 * Math.cos(t) + 0.08 * Math.cos(2 * t);
    s += x[i] * win;
    w += win;
  }
  return s / w;
}

/**
 * True DC level, measured in the spectrum: the energy below 0.5 Hz relative
 * to the whole signal, in dB (one FFT over the whole render, zero-padded).
 * Unlike a windowed mean, real low-frequency content (sub, slow modulation)
 * doesn't leak into it.
 */
export function dcDb(x: Float32Array, sampleRate = 48000): number {
  let N = 1;
  while (N < x.length) N <<= 1;
  N = Math.max(N, 131072);
  const re = new Float64Array(N), im = new Float64Array(N);
  for (let i = 0; i < x.length; i++) {
    const t = (2 * Math.PI * i) / (x.length - 1);
    re[i] = x[i] * (0.35875 - 0.48829 * Math.cos(t) + 0.14128 * Math.cos(2 * t) - 0.01168 * Math.cos(3 * t));
  }
  fft(re, im);
  let low = 0, total = 0;
  const kLow = Math.floor((0.5 * N) / sampleRate);
  for (let k = 0; k < N / 2; k++) {
    const e = re[k] * re[k] + im[k] * im[k];
    total += e;
    if (k <= kLow) low += e;
  }
  return 10 * Math.log10(low / (total + 1e-30) + 1e-30);
}

export function rms(x: Float32Array, from = 0, to = x.length): number {
  from = Math.round(from);
  to = Math.round(to);
  let s = 0;
  for (let i = from; i < to; i++) s += x[i] * x[i];
  return Math.sqrt(s / Math.max(1, to - from));
}

export function hasNonFinite(x: Float32Array): boolean {
  for (let i = 0; i < x.length; i++) if (!Number.isFinite(x[i])) return true;
  return false;
}

/**
 * Energy (sum of squared magnitudes) between minHz and maxHz over
 * Blackman-Harris-windowed frames (-92 dB sidelobes, so strong content higher
 * up doesn't leak into the band being measured).
 */
export function bandEnergy(x: Float64Array | Float32Array, sampleRate: number, maxHz: number, minHz = 0, N = 8192): number {
  const re = new Float64Array(N), im = new Float64Array(N);
  let total = 0;
  const kMin = Math.max(1, Math.ceil((minHz * N) / sampleRate));
  const kMax = Math.min(N / 2 - 1, Math.floor((maxHz * N) / sampleRate));
  for (let start = 0; start + N <= x.length; start += N / 2) {
    for (let i = 0; i < N; i++) {
      const t = (2 * Math.PI * i) / (N - 1);
      const w = 0.35875 - 0.48829 * Math.cos(t) + 0.14128 * Math.cos(2 * t) - 0.01168 * Math.cos(3 * t);
      re[i] = x[start + i] * w;
      im[i] = 0;
    }
    fft(re, im);
    for (let k = kMin; k <= kMax; k++) total += re[k] * re[k] + im[k] * im[k];
  }
  return total;
}

export function fft(re: Float64Array, im: Float64Array): void {
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
    const ang = (-2 * Math.PI) / len;
    const wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let j = 0; j < len / 2; j++) {
        const a = i + j, b = a + len / 2;
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

/** Mid and side signals. */
export function midSide(l: Float32Array, r: Float32Array): { mid: Float64Array; side: Float64Array } {
  const mid = new Float64Array(l.length), side = new Float64Array(l.length);
  for (let i = 0; i < l.length; i++) {
    mid[i] = 0.5 * (l[i] + r[i]);
    side[i] = 0.5 * (l[i] - r[i]);
  }
  return { mid, side };
}
