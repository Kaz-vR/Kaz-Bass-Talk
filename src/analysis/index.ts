// Analysis: offline render + feature extraction.
//
// A sound is rendered three ways and measured:
//   1. the audition loop (overall tone, balance, stereo image, level),
//   2. held probe notes at low / mid / high pitch (envelope, movement,
//      fundamental, consistency across the keyboard),
//   3. a "frozen" copy of the mid and high notes with unison, drift,
//      modulation and time-based effects switched off. Only the nonlinear
//      chain is left, so inharmonic content there is aliasing (digital fizz)
//      and narrow harmonic peaks are filter whistle, not intended detune.
//
// Raw measurements keep their units (Hz, dB, ms). Features are the same
// information mapped onto documented 0..1 scales (FEATURE_SCALES) so distances
// between sounds are meaningful; they are the map the Sound Tree and macro
// selector navigate. Pure TypeScript, no browser APIs.

import { renderPatch } from '../engine/core/render';
import type { Loop } from '../engine/core/sequencer';
import { validatePatch, type Patch } from '../schema';
import { wantsLife } from '../quality/critic';
import { bandPower, centroid, db, flatness, powerSpectrum, type PowerSpectrum } from './spectrum';

/** Default probe notes: the bass register, A1, A2, A3 (categories set their own). */
export const DEFAULT_PROBES = { low: 33, mid: 45, high: 57 } as const;
/** Seconds rendered after the loop stops, to measure the tail (release + space). */
const TAIL_SECONDS = 1.2;
const PROBE_BPM = 120;

export interface RawMeasures {
  /** Spectral centroid of the loop, Hz. */
  centroidHz: number;
  /** Energy above 2 kHz relative to total, dB. */
  highDb: number;
  /** Share of energy below 80 Hz (0..1). */
  subShare: number;
  /** Share of energy in 80–300 Hz (0..1). */
  lowMidShare: number;
  /** 2–5 kHz relative to 200 Hz–2 kHz, dB (harshness). */
  harshDb: number;
  /** 200–400 Hz relative to the average of its neighbour octaves, dB (mud bump). */
  mudDb: number;
  /** Spectral flatness 500 Hz–5 kHz (0 = pure tones, 1 = noise); rises with distortion and grit. */
  flatness: number;
  /** Side relative to mid above 150 Hz, dB (stereo width). */
  widthDb: number;
  /** Side relative to mid+side below 60 Hz, dB (very negative = mono low end). */
  sideLowDb: number;
  /** Mid-note attack time to 90% of peak, ms. */
  attackMs: number;
  /** Mid-note time from peak to −12 dB (or the hold length if it never gets there), ms. */
  decayMs: number;
  /** Mid-note level at the end of the hold relative to its peak, dB. */
  sustainDb: number;
  /** Mid-note time after release to −30 dB, ms. */
  releaseMs: number;
  /** Timbral movement during a held note: average spectral-shape change, dB. */
  movementDb: number;
  /** Per probe note: energy below 1.5 × f0 relative to total, dB. */
  fundamentalDb: { low: number; mid: number; high: number };
  /** Spread of held-note loudness across low / mid / high, dB. */
  noteSpreadDb: number;
  /** Inharmonic energy in the frozen render (worst of mid / high note), dB; null when not meaningful (inharmonic FM, bitcrusher). */
  aliasDb: number | null;
  /** Largest narrow harmonic peak above its neighbours in the frozen mid note, dB. */
  whistleDb: number;
  /** Highest sample peak across all renders. */
  peak: number;
  /** Most limiter gain reduction across all renders, dB (0 = never engaged). */
  limiterDb: number;
  /** Blackman-windowed mean of the loop (true DC estimate). */
  dc: number;
  /** Spectral centroid in octaves above the mid probe note's fundamental (register-independent darkness). */
  brightOct: number;
  /** Energy above 6 kHz relative to total, dB (air / top end). */
  airDb: number;
  /** Tail 0.3-1.2 s after the loop stops relative to the loop, dB (release + space). */
  tailDb: number;
  /** How alive a long held note is (only measured when requested; see measureLife). */
  life?: Life;
  /** Texture bed relative to the bass on the held mid note, dB; null when the patch has no texture. */
  textureDb: number | null;
}

/**
 * Movement of a long held note, split by time scale. Measured on the spectral
 * shape above 150 Hz (loudness removed, the sub ignored).
 */
export interface Life {
  /** Slow motion: spread of the shape smoothed over ~1 s, dB (phrase-level wander, blooms, slow LFOs). */
  slowDb: number;
  /** Fast motion: shape changes between ~60 ms and ~0.5 s, dB (wobble, flutter, beating, grain). */
  fastDb: number;
  /** Strongest self-similarity at lags of 0.25–2 s after removing the slow trend (1 = exactly repeating). */
  repeat: number;
}

export interface Features {
  brightness: number;
  highEnergy: number;
  sub: number;
  lowMid: number;
  dirt: number;
  width: number;
  attack: number;
  decay: number;
  sustain: number;
  release: number;
  movement: number;
}

export type FeatureName = keyof Features;

/** How each raw measurement maps onto 0..1 (values outside are clamped). */
export const FEATURE_SCALES: Record<FeatureName, { from: string; scale: string; map: (r: RawMeasures) => number }> = {
  brightness: { from: 'centroidHz', scale: 'log, 50 Hz → 0, 5 kHz → 1', map: (r) => Math.log(Math.max(r.centroidHz, 1) / 50) / Math.log(100) },
  highEnergy: { from: 'highDb', scale: 'linear dB, −60 dB → 0, 0 dB → 1', map: (r) => (r.highDb + 60) / 60 },
  sub: { from: 'subShare', scale: 'square root of energy share (spreads the low values)', map: (r) => Math.sqrt(r.subShare) },
  lowMid: { from: 'lowMidShare', scale: 'square root of energy share', map: (r) => Math.sqrt(r.lowMidShare) },
  dirt: { from: 'flatness', scale: 'square root of 500 Hz–5 kHz spectral flatness, ×2', map: (r) => 2 * Math.sqrt(r.flatness) },
  width: { from: 'widthDb', scale: 'linear dB, −40 dB (mono) → 0, 0 dB → 1', map: (r) => (r.widthDb + 40) / 40 },
  attack: { from: 'attackMs', scale: 'log, 1 ms → 0, 1 s → 1', map: (r) => Math.log10(Math.max(r.attackMs, 1)) / 3 },
  decay: { from: 'decayMs', scale: 'log, 10 ms → 0, 2 s → 1', map: (r) => Math.log(Math.max(r.decayMs, 10) / 10) / Math.log(200) },
  sustain: { from: 'sustainDb', scale: 'linear dB, −40 dB → 0, 0 dB → 1', map: (r) => (r.sustainDb + 40) / 40 },
  release: { from: 'releaseMs', scale: 'log, 10 ms → 0, 2 s → 1', map: (r) => Math.log(Math.max(r.releaseMs, 10) / 10) / Math.log(200) },
  movement: { from: 'movementDb', scale: 'linear, 0 dB → 0, 6 dB → 1', map: (r) => r.movementDb / 6 },
};

export const FEATURE_NAMES = Object.keys(FEATURE_SCALES) as FeatureName[];

export function toFeatures(r: RawMeasures): Features {
  const f = {} as Features;
  for (const k of FEATURE_NAMES) {
    const v = FEATURE_SCALES[k].map(r);
    f[k] = Math.round(Math.min(1, Math.max(0, v)) * 1000) / 1000;
  }
  return f;
}

/** Euclidean distance between two feature vectors (0 = identical). */
export function featureDistance(a: Features, b: Features): number {
  let s = 0;
  for (const k of FEATURE_NAMES) s += (a[k] - b[k]) ** 2;
  return Math.sqrt(s);
}

export interface Analysis {
  raw: RawMeasures;
  features: Features;
}

export interface AnalyzeOptions {
  /** Also measure life on a long held note (slower; on by default for families whose limits check it). */
  life?: boolean;
  sampleRate?: number;
  /** Seconds of the loop to render. */
  loopSeconds?: number;
  /** Held-note length, seconds. */
  holdSeconds?: number;
  /** Probe notes (MIDI) for the low / mid / high tests; defaults to the bass register (A1, A2, A3). */
  probes?: { low: number; mid: number; high: number };
  /** Mod wheel position held for every render (0 = at rest). */
  modWheel?: number;
}

// --------------------------------------------------------------- helpers

function heldLoop(note: number, holdSeconds: number): Loop {
  const beats = (holdSeconds * PROBE_BPM) / 60;
  return { id: 'probe', name: 'probe', description: '', bpm: PROBE_BPM, length_beats: beats * 4, notes: [{ start: 0, dur: beats, note, vel: 0.85 }] };
}

function mono(l: Float32Array, r: Float32Array): Float64Array {
  const m = new Float64Array(l.length);
  for (let i = 0; i < l.length; i++) m[i] = 0.5 * (l[i] + r[i]);
  return m;
}

function side(l: Float32Array, r: Float32Array): Float64Array {
  const s = new Float64Array(l.length);
  for (let i = 0; i < l.length; i++) s[i] = 0.5 * (l[i] - r[i]);
  return s;
}

function rmsDb(x: Float64Array, from: number, to: number): number {
  let s = 0;
  for (let i = from; i < to; i++) s += x[i] * x[i];
  return db(s / Math.max(1, to - from) + 1e-20);
}

/**
 * Amplitude envelope on a 2 ms grid: the peak |x| over the preceding 40 ms
 * (longer than one cycle of a 27.5 Hz sub, so the envelope doesn't ripple
 * with the waveform).
 */
function envelope(x: Float64Array, fs: number): { env: Float64Array; hop: number } {
  const hop = Math.round(fs * 0.002);
  const win = Math.round(fs * 0.04);
  const n = Math.floor(x.length / hop);
  const env = new Float64Array(n);
  for (let f = 0; f < n; f++) {
    const end = (f + 1) * hop;
    let m = 0;
    for (let i = Math.max(0, end - win); i < end; i++) {
      const a = Math.abs(x[i]);
      if (a > m) m = a;
    }
    env[f] = m;
  }
  return { env, hop };
}

/** Octaves and fifths sit on (or half-way along) the harmonic lattice. */
function harmonicInterval(semi: number): boolean {
  const m = ((semi % 12) + 12) % 12;
  return m === 0 || m === 7;
}

/** Fundamental of the harmonic lattice the frozen patch produces, or null if inharmonic. */
function latticeBase(p: Patch, f0: number): number | null {
  let base = f0;
  const octaveShift = (semi: number) => Math.floor(semi / 12);
  for (const n of [1, 2]) {
    if ((p[`osc${n}.level`] as number) <= 0) continue;
    if (n === 2 && !harmonicInterval(p['osc2.semi'] as number)) continue; // muted in the frozen probe
    // Shepard partials glide and a physical-model string is not exactly harmonic: no lattice.
    const wave = p[`osc${n}.wave`];
    if (wave === 'shepard' || wave === 'string') return null;
    const semi = p[`osc${n}.semi`] as number;
    base = Math.min(base, f0 * Math.pow(2, octaveShift(semi)));
    if (semi % 12 !== 0) base = Math.min(base, (f0 * Math.pow(2, octaveShift(semi))) / 2); // fifths etc. fall on half-steps of the lattice
  }
  if ((p['sub.level'] as number) > 0) base = Math.min(base, f0 * Math.pow(2, p['sub.octave'] as number));
  const fm = p['fm.amount'] as number;
  if (fm > 0.01) {
    const r = p['fm.ratio'] as number;
    let q = 0;
    for (let d = 1; d <= 4 && !q; d++) if (Math.abs(r * d - Math.round(r * d)) < 0.01) q = d;
    if (!q) return null;
    base = Math.min(base, f0 / q);
  }
  return base;
}

/**
 * Inharmonic energy above 200 Hz relative to the whole sound, dB. In a frozen
 * render every intended partial sits exactly on the harmonic lattice, so what
 * falls between is aliasing / digital fizz.
 */
function inharmonicDb(s: PowerSpectrum, base: number): number {
  let other = 0, total = 0;
  const tol = 7;
  for (let k = 1; k < s.power.length; k++) {
    total += s.power[k];
    const f = k * s.binHz;
    if (f < 200) continue;
    const d = Math.abs(f / base - Math.round(f / base)) * base;
    if (d > tol) other += s.power[k];
  }
  return db(other / (total + 1e-30));
}

/** Largest harmonic peak above its loudest neighbours (±3 harmonics), dB. */
function whistle(s: PowerSpectrum, f0: number): number {
  const amp: number[] = [];
  const kMax = Math.min(60, Math.floor(8000 / f0));
  for (let h = 1; h <= kMax; h++) {
    const c = Math.round((h * f0) / s.binHz);
    let p = 0;
    for (let k = c - 3; k <= c + 3; k++) if (k > 0 && k < s.power.length) p += s.power[k];
    amp.push(db(p + 1e-30));
  }
  const top = Math.max(...amp);
  let worst = 0;
  for (let h = 3; h <= kMax; h++) {
    const a = amp[h - 1];
    if (a < top - 40) continue; // ignore peaks far below the main body
    let nb = -Infinity;
    for (let d = 1; d <= 3; d++) {
      if (h - 1 - d >= 0) nb = Math.max(nb, amp[h - 1 - d]);
      if (h - 1 + d < amp.length) nb = Math.max(nb, amp[h - 1 + d]);
    }
    worst = Math.max(worst, a - nb);
  }
  return worst;
}

/** Average change of spectral shape over a held note (loudness envelope removed), dB. */
function movement(x: Float64Array, fs: number, from: number, to: number): number {
  const N = 2048, hop = 480;
  const edges = [60, 150, 400, 1000, 2500, 6000, 16000];
  const frames: number[][] = [];
  for (let s = from; s + N <= to; s += hop) {
    const sp = powerSpectrum(x, fs, s, s + N, N);
    const bands = edges.slice(0, -1).map((lo, i) => bandPower(sp, lo, edges[i + 1]) + 1e-20);
    const tot = bands.reduce((a, b) => a + b, 0);
    frames.push(bands.map((b) => db(b / tot)));
  }
  if (frames.length < 4) return 0;
  let acc = 0, wsum = 0;
  for (let b = 0; b < edges.length - 1; b++) {
    const vals = frames.map((f) => f[b]);
    const mean = vals.reduce((a, c) => a + c, 0) / vals.length;
    if (mean < -45) continue; // band too quiet to matter
    const sd = Math.sqrt(vals.reduce((a, c) => a + (c - mean) ** 2, 0) / vals.length);
    const w = Math.pow(10, mean / 10);
    acc += sd * w;
    wsum += w;
  }
  return wsum > 0 ? acc / wsum : 0;
}

/** Centered moving average with window w frames (edges use the available frames). */
function movAvg(v: number[], w: number): number[] {
  const h = Math.floor(w / 2);
  return v.map((_, i) => {
    let s = 0, n = 0;
    for (let j = Math.max(0, i - h); j <= Math.min(v.length - 1, i + h); j++) { s += v[j]; n++; }
    return s / n;
  });
}

function std(v: number[]): number {
  const m = v.reduce((a, b) => a + b, 0) / v.length;
  return Math.sqrt(v.reduce((a, b) => a + (b - m) ** 2, 0) / v.length);
}

export const LIFE_HOLD_SECONDS = 7;
const LIFE_HOP_S = 0.02;

/**
 * Measure life on a held note (x from `from` to `to` samples). The series
 * ends where the ~1 s average level falls 20 dB below its loudest, so a decaying note is judged on
 * its audible part rather than its tail.
 */
export function measureLife(x: Float64Array, fs: number, from: number, to: number): Life {
  const N = 2048, hop = Math.round(LIFE_HOP_S * fs);
  const edges = [150, 300, 600, 1200, 2500, 5000, 12000];
  const nb = edges.length - 1;
  const shapes: number[][] = [];
  const levels: number[] = [];
  for (let s = from; s + N <= to; s += hop) {
    const sp = powerSpectrum(x, fs, s, s + N, N);
    const bands = edges.slice(0, -1).map((lo, i) => bandPower(sp, lo, edges[i + 1]) + 1e-20);
    const tot = bands.reduce((a, b) => a + b, 0);
    shapes.push(bands.map((b) => b / tot));
    levels.push(db(tot));
  }
  // Gate on the level averaged over ~1 s, so a decay ends the series but a deep wobble doesn't.
  const avg = movAvg(levels, Math.round(1 / LIFE_HOP_S));
  const top = Math.max(...avg);
  let frames = avg.findIndex((l) => l < top - 20);
  if (frames < 0) frames = levels.length;
  const none = { slowDb: 0, fastDb: 0, repeat: 0 };
  if (frames < 60) return none;
  const fr = (sec: number) => Math.max(1, Math.round(sec / LIFE_HOP_S));
  const lags: number[] = [];
  for (let l = 1; l <= Math.min(fr(2), frames - fr(1)); l++) lags.push(l);
  const num = new Float64Array(lags.length), den = new Float64Array(lags.length);
  let slow = 0, fast = 0, wsum = 0;
  for (let b = 0; b < nb; b++) {
    let pw = 0;
    for (let i = 0; i < frames; i++) pw += shapes[i][b];
    const mean = db(pw / frames);
    if (mean < -35) continue; // band too quiet to matter
    const w = Math.pow(10, mean / 10);
    const v: number[] = [];
    for (let i = 0; i < frames; i++) v.push(db(shapes[i][b]));
    const smooth = movAvg(v, fr(0.06)), mid = movAvg(v, fr(0.5)), trend = movAvg(v, fr(2.5));
    slow += std(movAvg(v, fr(1))) * w;
    fast += std(smooth.map((y, i) => y - mid[i])) * w;
    wsum += w;
    // Autocorrelation of the shape with motion slower than ~2.5 s removed.
    const d = smooth.map((y, i) => y - trend[i]);
    lags.forEach((lag, k) => {
      let c = 0, e1 = 0, e2 = 0;
      for (let i = 0; i + lag < d.length; i++) { c += d[i] * d[i + lag]; e1 += d[i] * d[i]; e2 += d[i + lag] * d[i + lag]; }
      num[k] += w * c;
      den[k] += w * Math.sqrt(e1 * e2);
    });
  }
  if (wsum === 0) return none;
  // Repetition = a correlation peak that comes back after a dip (a periodic
  // pattern). Smooth slow motion only decays with lag and scores near 0.
  let repeat = 0, lowest = 1;
  for (let k = 0; k < lags.length; k++) {
    const c = den[k] > 1e-12 ? num[k] / den[k] : 0;
    lowest = Math.min(lowest, c);
    if (lags[k] >= fr(0.25)) repeat = Math.max(repeat, Math.min(c, c - lowest));
  }
  return { slowDb: slow / wsum, fastDb: fast / wsum, repeat };
}

function blackmanMean(x: Float64Array): number {
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

/** A copy of the patch with unison, drift, modulation and time-based FX off. */
export function frozen(p: Patch): Patch {
  const q: Patch = { ...p, meta: p.meta };
  q['voice.analog'] = 0;
  q['osc1.unison_voices'] = 1;
  q['osc2.unison_voices'] = 1;
  q['osc1.fine'] = 0;
  q['osc2.fine'] = 0;
  for (let n = 1; n <= 12; n++) q[`mod${n}.amount`] = 0;
  for (const id of ['chorus.mix', 'flanger.mix', 'phaser.mix', 'delay.mix', 'reverb.mix', 'tape.wow', 'tape.age', 'filter.env_amount', 'noise.level', 'fm.punch']) q[id] = 0;
  // Hold the note at full level so short plucks are measured, not their silence.
  q['amp_env.attack'] = 1;
  q['amp_env.sustain'] = 1;
  q['amp_env.attack_curve'] = 0;
  q['texture.level'] = 0;
  q['vibrato.depth'] = 0;
  // The wobble sweeps the filter (motion, not fizz).
  q['wobble.depth'] = 0;
  // A deliberately dissonant layer (not an octave or fifth) has no harmonic
  // lattice, so it would read as aliasing: leave it out of the frozen probe.
  if (!harmonicInterval(q['osc2.semi'] as number)) q['osc2.level'] = 0;
  return q;
}

// --------------------------------------------------------------- analyze

/** Render and measure a patch (any patch-like object; it is validated). */
export function analyzePatch(input: unknown, loop: Loop, opts: AnalyzeOptions = {}): Analysis {
  const p = validatePatch(input).patch;
  const fs = opts.sampleRate ?? 48000;
  const loopSeconds = opts.loopSeconds ?? 2;
  const hold = opts.holdSeconds ?? 1.2;
  const PROBE_NOTES = opts.probes ?? DEFAULT_PROBES;
  const after = 0.6;
  const modWheel = opts.modWheel ?? 0;
  let peak = 0, minGain = 1;
  const track = (r: { left: Float32Array; right: Float32Array; limiterMinGain: number }) => {
    for (let i = 0; i < r.left.length; i++) peak = Math.max(peak, Math.abs(r.left[i]), Math.abs(r.right[i]));
    minGain = Math.min(minGain, r.limiterMinGain);
  };

  // 1. Loop.
  const lr = renderPatch(p, loop, { sampleRate: fs, modWheel, seconds: loopSeconds, tail: TAIL_SECONDS });
  track(lr);
  const loopEnd = Math.round(loopSeconds * fs);
  const mAll = mono(lr.left, lr.right);
  const m = mAll.subarray(0, loopEnd);
  const sd = side(lr.left, lr.right).subarray(0, loopEnd);
  // Tail: what hangs in the air 0.3-1.2 s after the last notes stop (release + reverb + echo).
  const tailDb = rmsDb(mAll, loopEnd + Math.round(0.3 * fs), mAll.length) - rmsDb(mAll, 0, loopEnd);
  const sp = powerSpectrum(m, fs);
  const ssp = powerSpectrum(sd, fs);
  const total = bandPower(sp, 20, 20000) + 1e-30;
  const sideAll = bandPower(ssp, 150, 20000), midAll = bandPower(sp, 150, 20000);
  const sideLow = bandPower(ssp, 20, 60), midLow = bandPower(sp, 20, 60);
  const neighbours = 0.5 * (bandPower(sp, 100, 200) + bandPower(sp, 400, 800)) + 1e-30;

  // 2. Probe notes.
  const probe = (note: number) => {
    const r = renderPatch(p, heldLoop(note, hold), { sampleRate: fs, modWheel, seconds: hold + after });
    track(r);
    return mono(r.left, r.right);
  };
  const lowX = probe(PROBE_NOTES.low), midX = probe(PROBE_NOTES.mid), highX = probe(PROBE_NOTES.high);
  // Texture: the same note without the bed; the difference is the bed (it has its own random generators).
  const hasTexture = (p['texture.level'] as number) > 0 && !String(p['texture.type']).endsWith(' hit');
  const noTex: Patch = { ...p, meta: p.meta, 'texture.level': 0 };
  const holdEnd = Math.round(hold * fs);
  const settle = Math.round(0.25 * fs);
  // The note the sound plays: the main oscillator's octave (osc 1, or osc 2 when osc 1 is silent) plus
  // any global octave. No hidden octave: a preset an octave up shows it on its oscillators.
  const mainOsc = (p['osc1.level'] as number) > 0 ? 1 : 2;
  const register = (p['voice.octave'] as number) + Math.floor((p[`osc${mainOsc}.semi`] as number) / 12);
  const f0 = (note: number) => 440 * Math.pow(2, (note + 12 * register - 69) / 12);
  const fund = (x: Float64Array, note: number) => {
    const s = powerSpectrum(x, fs, 0, holdEnd, 16384);
    return db(bandPower(s, 15, 1.5 * f0(note)) / (bandPower(s, 15, 20000) + 1e-30));
  };
  const levels = [lowX, midX, highX].map((x) => rmsDb(x, Math.round(0.05 * fs), holdEnd));

  // Envelope of the mid note.
  const { env, hop } = envelope(midX, fs);
  const hopMs = (hop / fs) * 1000;
  let peakEnv = 0, peakIdx = 0;
  for (let i = 0; i < env.length; i++) if (env[i] > peakEnv) { peakEnv = env[i]; peakIdx = i; }
  let onset = 0;
  while (onset < env.length && env[onset] < peakEnv * 1e-3) onset++;
  let a90 = onset;
  while (a90 < env.length && env[a90] < 0.9 * peakEnv) a90++;
  const holdFrame = Math.floor(holdEnd / hop);
  let d12 = peakIdx;
  while (d12 < holdFrame && env[d12] > peakEnv * 0.251) d12++;
  const endLevel = env[Math.max(0, holdFrame - 2)];
  let rel = holdFrame;
  const relTarget = Math.max(endLevel, 1e-9) * 0.0316;
  while (rel < env.length && env[rel] > relTarget) rel++;

  // 3. Frozen renders for aliasing and whistle.
  const fz = frozen(p);
  const frozenSpec = (note: number) => {
    const r = renderPatch(fz, heldLoop(note, hold), { sampleRate: fs, modWheel, wheelFrozen: true, seconds: hold });
    return powerSpectrum(mono(r.left, r.right), fs, settle, holdEnd, 32768);
  };
  const fzMid = frozenSpec(PROBE_NOTES.mid);
  const fzHigh = frozenSpec(PROBE_NOTES.high);
  const crushed = (p['crush.mix'] as number) > 0.05;
  const bMid = latticeBase(p, f0(PROBE_NOTES.mid));
  const bHigh = latticeBase(p, f0(PROBE_NOTES.high));
  const aliasDb = crushed || bMid === null || bHigh === null ? null : Math.max(inharmonicDb(fzMid, bMid), inharmonicDb(fzHigh, bHigh));

  const raw: RawMeasures = {
    centroidHz: centroid(sp),
    highDb: db(bandPower(sp, 2000, 20000) / total),
    subShare: bandPower(sp, 20, 80) / total,
    lowMidShare: bandPower(sp, 80, 300) / total,
    harshDb: db(bandPower(sp, 2000, 5000) / (bandPower(sp, 200, 2000) + 1e-30)),
    mudDb: db(bandPower(sp, 200, 400) / neighbours),
    flatness: flatness(sp, 500, 5000),
    widthDb: db(sideAll / (midAll + 1e-30)),
    sideLowDb: db(sideLow / (midLow + sideLow + 1e-30)),
    attackMs: Math.max(0, a90 - onset) * hopMs,
    decayMs: (d12 - peakIdx) * hopMs,
    sustainDb: db((endLevel * endLevel) / (peakEnv * peakEnv + 1e-30)),
    releaseMs: (rel - holdFrame) * hopMs,
    movementDb: movement(midX, fs, settle, holdEnd),
    fundamentalDb: { low: fund(lowX, PROBE_NOTES.low), mid: fund(midX, PROBE_NOTES.mid), high: fund(highX, PROBE_NOTES.high) },
    noteSpreadDb: Math.max(...levels) - Math.min(...levels),
    aliasDb,
    whistleDb: whistle(fzMid, f0(PROBE_NOTES.mid)),
    peak,
    limiterDb: -db(minGain * minGain),
    dc: blackmanMean(m),
    textureDb: null,
    brightOct: Math.log2(Math.max(centroid(sp), 1) / f0(PROBE_NOTES.mid)),
    airDb: db(bandPower(sp, 6000, 20000) / total),
    tailDb,
  };
  if (hasTexture) {
    const r = renderPatch(noTex, heldLoop(PROBE_NOTES.mid, hold), { sampleRate: fs, modWheel, seconds: hold + after });
    const bare = mono(r.left, r.right);
    let e = 0, d = 0;
    for (let i = Math.round(0.05 * fs); i < holdEnd; i++) {
      e += bare[i] * bare[i];
      d += (midX[i] - bare[i]) ** 2;
    }
    raw.textureDb = db(d / (e + 1e-30));
  }
  if (opts.life ?? wantsLife(p.meta?.family as string | undefined, p.meta?.category as string | undefined)) {
    // Life is judged on the sound itself: a crackle bed must not make a static sound pass as alive.
    // Two held notes, averaged, so one lucky or unlucky random realization doesn't decide.
    const lives = [PROBE_NOTES.mid, PROBE_NOTES.mid - 5].map((note) => {
      const r = renderPatch(noTex, heldLoop(note, LIFE_HOLD_SECONDS), { sampleRate: fs, modWheel, seconds: LIFE_HOLD_SECONDS });
      track(r);
      return measureLife(mono(r.left, r.right), fs, Math.round(0.5 * fs), Math.round(LIFE_HOLD_SECONDS * fs));
    });
    raw.life = {
      slowDb: (lives[0].slowDb + lives[1].slowDb) / 2,
      fastDb: (lives[0].fastDb + lives[1].fastDb) / 2,
      repeat: (lives[0].repeat + lives[1].repeat) / 2,
    };
    raw.peak = peak;
    raw.limiterDb = -db(minGain * minGain);
  }
  return { raw, features: toFeatures(raw) };
}
