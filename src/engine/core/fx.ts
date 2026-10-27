// Stereo effects that run after the voice. Each only sees the part of the signal
// above its own low cut (chorus.lowcut … reverb.lowcut, see Synth), so the low end
// stays dry, centred and phase-stable whatever the effect settings are.

import { clamp as clamp_, fastTanh as fastTanh_, Rng as Rng_, TWO_PI as TWO_PI_ } from './dsp';

// Module-local bindings: avoids live-binding getter overhead on hot paths in
// some module transforms (tsx / vite-node).
const clamp = clamp_;
const fastTanh = fastTanh_;
const Rng = Rng_;
const TWO_PI = TWO_PI_;

const MAX_FS = 192000;
/** Hyper's six copies: unrelated slow cycles (Hz, before Depth), spread left to right at equal power. */
const HYPER_RATE = [0.29, 0.41, 0.53, 0.67, 0.79, 0.97];
const HYPER_PAN_L = HYPER_RATE.map((_, i) => Math.SQRT2 * Math.cos(((((2 * i) / 5 - 1) * 0.9 + 1) * Math.PI) / 4));
const HYPER_PAN_R = HYPER_RATE.map((_, i) => Math.SQRT2 * Math.sin(((((2 * i) / 5 - 1) * 0.9 + 1) * Math.PI) / 4));

export class Chorus {
  private bufL: Float32Array;
  private bufR: Float32Array;
  private size: number;
  private w = 0;
  private phase = 0;
  private fs: number;
  private count = 0;
  private dl = 0;
  private dr = 0;
  private stepL = 0;
  private stepR = 0;
  // Analog-style rate drift (±40%, wandering every ~1-2 s): a perfectly steady chorus LFO ticks like a clock.
  private readonly rng = new Rng(0xc0c0a);
  private drift = 0;
  private driftTarget = 0;
  private driftCount = 0;

  constructor(fs: number) {
    this.fs = fs;
    this.dl = this.dr = 0.007 * fs;
    this.size = 1;
    while (this.size < Math.ceil(0.04 * Math.min(fs, MAX_FS))) this.size <<= 1;
    this.bufL = new Float32Array(this.size);
    this.bufR = new Float32Array(this.size);
  }

  reset(): void {
    this.bufL.fill(0);
    this.bufR.fill(0);
  }

  /** Advance the rate drift by 16 samples; returns the rate multiplier. */
  private driftStep(): number {
    this.driftCount -= 16;
    if (this.driftCount <= 0) {
      this.driftTarget = this.rng.next();
      this.driftCount = Math.round((1 + 0.5 * (this.rng.next() + 1)) * this.fs);
    }
    this.drift += (this.driftTarget - this.drift) * (16 / (0.6 * this.fs));
    return 1 + 0.4 * this.drift;
  }

  private read(buf: Float32Array, delaySamples: number): number {
    const mask = this.size - 1;
    const pos = this.w - delaySamples;
    const i = Math.floor(pos);
    const f = pos - i;
    const a = buf[i & mask];
    const b = buf[(i + 1) & mask];
    return a + (b - a) * f;
  }

  /**
   * Processes into the provided 2-element output holder. ensemble = true is
   * a three-voice string-machine/Juno-style ensemble (taps 120° apart plus a
   * fast shimmer); false is a classic two-voice chorus.
   */
  process(l: number, r: number, mix: number, depth: number, out: Float64Array, mode = 0): void {
    if (mode === 1) {
      this.processEnsemble(l, r, mix, depth, out);
      return;
    }
    if (mode === 2) {
      this.processHyper(l, r, mix, depth, out);
      return;
    }
    const mask = this.size - 1;
    this.bufL[this.w & mask] = l;
    this.bufR[this.w & mask] = r;
    if (this.count-- <= 0) {
      this.count = 15;
      const rate = (0.25 + depth * 0.9) * this.driftStep();
      this.phase += (16 * rate) / this.fs;
      if (this.phase >= 1) this.phase -= 1;
      const base = 0.007 * this.fs;
      const mod = (0.0005 + depth * 0.0045) * this.fs;
      this.stepL = (base + mod * (0.5 + 0.5 * Math.sin(TWO_PI * this.phase)) - this.dl) / 16;
      this.stepR = (base + mod * (0.5 + 0.5 * Math.sin(TWO_PI * (this.phase + 0.25))) - this.dr) / 16;
    }
    this.dl += this.stepL;
    this.dr += this.stepR;
    const wl = this.read(this.bufL, this.dl);
    const wr = this.read(this.bufR, this.dr);
    this.w = (this.w + 1) & mask;
    const dry = 1 - 0.5 * mix;
    // Cross-feed the wet signals a little for a wider image.
    out[0] = l * dry + 0.5 * mix * (0.8 * wl + 0.2 * wr);
    out[1] = r * dry + 0.5 * mix * (0.8 * wr + 0.2 * wl);
  }

  private ensPhase = 0;
  private ensRate = 0.75;
  private shimmer = 0;
  private readonly hypPhase = Float64Array.from(HYPER_RATE, (_, i) => i / HYPER_RATE.length);
  private hypDrift = 1;

  /**
   * Hyper (as Serum's): six copies, each held a little sharp or flat and drifting on its own
   * unrelated slow cycle, spread across the stereo field: a supersaw thickness on the whole sound.
   * Depth = how far apart they are (a few cents up to ~25).
   */
  private processHyper(l: number, r: number, mix: number, depth: number, out: Float64Array): void {
    const mask = this.size - 1;
    this.bufL[this.w & mask] = l;
    this.bufR[this.w & mask] = r;
    if (this.count-- <= 0) {
      this.count = 15;
      this.hypDrift = this.driftStep();
    }
    const fs = this.fs, sp = (0.6 + 0.9 * depth) * this.hypDrift;
    // the delay swing that gives each copy its detune: d·2π·f ≈ the pitch offset
    const amp = (0.0004 + 0.0028 * depth) * fs;
    let wl = 0, wr = 0;
    for (let t = 0; t < HYPER_RATE.length; t++) {
      let ph = this.hypPhase[t] + (HYPER_RATE[t] * sp) / fs;
      if (ph >= 1) ph -= 1;
      this.hypPhase[t] = ph;
      const d = (0.006 + 0.0011 * t) * fs + amp * (0.5 + 0.5 * Math.sin(TWO_PI * ph));
      const gl = HYPER_PAN_L[t], gr = HYPER_PAN_R[t];
      wl += this.read(this.bufL, d) * gl;
      wr += this.read(this.bufR, d) * gr;
    }
    this.w = (this.w + 1) & mask;
    const dry = 1 - 0.6 * mix;
    out[0] = l * dry + mix * 0.42 * wl;
    out[1] = r * dry + mix * 0.42 * wr;
  }

  private processEnsemble(l: number, r: number, mix: number, depth: number, out: Float64Array): void {
    const mask = this.size - 1;
    this.bufL[this.w & mask] = l;
    this.bufR[this.w & mask] = r;
    if (this.count-- <= 0) {
      this.count = 15;
      this.ensRate = (0.55 + 0.4 * depth) * this.driftStep();
    }
    this.ensPhase += this.ensRate / this.fs;
    if (this.ensPhase >= 1) this.ensPhase -= 1;
    this.shimmer += 6.1 / this.fs;
    if (this.shimmer >= 1) this.shimmer -= 1;
    const base = 0.0065 * this.fs;
    const mod = (0.001 + depth * 0.003) * this.fs;
    const shim = 0.00012 * this.fs * Math.sin(TWO_PI * this.shimmer);
    let wl = 0, wr = 0;
    for (let t = 0; t < 3; t++) {
      const ph = this.ensPhase + t / 3;
      const s = Math.sin(TWO_PI * ph);
      wl += this.read(this.bufL, base + mod * (0.5 + 0.5 * s) + shim);
      wr += this.read(this.bufR, base + mod * (0.5 - 0.5 * s) + shim);
    }
    this.w = (this.w + 1) & mask;
    const dry = 1 - 0.55 * mix;
    out[0] = l * dry + mix * 0.3 * (0.7 * wl + 0.3 * wr);
    out[1] = r * dry + mix * 0.3 * (0.7 * wr + 0.3 * wl);
  }
}

export class Phaser {
  private zl = new Float64Array(4);
  private zr = new Float64Array(4);
  private fbL = 0;
  private fbR = 0;
  private phase = 0;
  private fs: number;

  constructor(fs: number) {
    this.fs = fs;
  }

  reset(): void {
    this.zl.fill(0);
    this.zr.fill(0);
    this.fbL = this.fbR = 0;
  }

  private coef(lfo: number): number {
    const fc = 250 * Math.pow(14, lfo); // 250 Hz .. 3.5 kHz
    const t = Math.tan((Math.PI * Math.min(fc, this.fs * 0.45)) / this.fs);
    return (t - 1) / (t + 1);
  }

  private chain(x: number, z: Float64Array, a: number): number {
    for (let i = 0; i < 4; i++) {
      // First-order allpass: y = a·x + z; z = x − a·y
      const y = a * x + z[i];
      z[i] = x - a * y;
      x = y;
    }
    return x;
  }

  private count = 0;
  private aL = 0;
  private aR = 0;
  private stepL = 0;
  private stepR = 0;

  process(l: number, r: number, mix: number, rate: number, out: Float64Array): void {
    if (this.count-- <= 0) {
      // Sweep coefficients are computed every 16 samples and interpolated.
      this.count = 15;
      this.phase += (16 * rate) / this.fs;
      if (this.phase >= 1) this.phase -= 1;
      const tl = this.coef(0.5 + 0.5 * Math.sin(TWO_PI * this.phase));
      const tr = this.coef(0.5 + 0.5 * Math.sin(TWO_PI * (this.phase + 0.2)));
      this.stepL = (tl - this.aL) / 16;
      this.stepR = (tr - this.aR) / 16;
    }
    this.aL += this.stepL;
    this.aR += this.stepR;
    const yl = this.chain(l + 0.4 * this.fbL, this.zl, this.aL);
    const yr = this.chain(r + 0.4 * this.fbR, this.zr, this.aR);
    this.fbL = clamp(yl, -2, 2);
    this.fbR = clamp(yr, -2, 2);
    out[0] = l * (1 - 0.5 * mix) + yl * 0.5 * mix;
    out[1] = r * (1 - 0.5 * mix) + yr * 0.5 * mix;
  }
}

/**
 * Transparent look-ahead peak limiter (stereo-linked, always on).
 *
 * The gain applied to a sample is the box-car average of a sliding-window
 * minimum of the required gain, delayed so that the average can never exceed
 * the gain the sample itself needs. Recovery waits for a hold time longer than
 * the longest sub period (~18 Hz) and then follows a slow release, so the gain doesn't
 * ripple within each waveform cycle (which would distort and create DC). Hold
 * and release only ever lower the gain, so the guarantee holds. A final clamp
 * catches floating-point residue.
 */
/** Delay of the limiter's true-peak detector (samples): it looks 4 samples ahead of the point it interpolates. */
export const TP_DELAY = 4;
/** 4x interpolation between samples for the true-peak detector: 8-tap Hann-windowed sinc per phase (1/4, 1/2, 3/4). */
const TP_TAPS: Float64Array[] = [0.25, 0.5, 0.75].map((f) => {
  const h = new Float64Array(8);
  let sum = 0;
  for (let i = 0; i < 8; i++) {
    const x = f - (i - 3);
    const sinc = Math.sin(Math.PI * x) / (Math.PI * x);
    const w = 0.5 + 0.5 * Math.cos((Math.PI * x) / 4.5);
    h[i] = sinc * w;
    sum += h[i];
  }
  for (let i = 0; i < 8; i++) h[i] /= sum;
  return h;
});

export class Limiter {
  readonly ceiling: number;
  /** Total delay through the limiter is lookahead - 1 samples (the detector's delay comes out of the window). */
  readonly lookahead: number;
  private readonly win: number;
  // Last 8 inputs per channel for the true-peak detector.
  private histL = new Float64Array(8);
  private histR = new Float64Array(8);
  private hPos = 0;
  private delayL: Float64Array;
  private delayR: Float64Array;
  private dPos = 0;
  // Monotonic deque for the sliding minimum.
  private qVal: Float64Array;
  private qIdx: Float64Array;
  private qHead = 0;
  private qTail = 0;
  private qCap: number;
  private n = 0;
  // Box-car average.
  private box: Float64Array;
  private boxPos = 0;
  private boxSum: number;
  private gain = 1;
  private release: number;
  private holdSamples: number;
  private holdCount = 0;
  /** Lowest gain applied since last read (for metering). */
  minGain = 1;

  constructor(fs: number, ceilingDb = -1, lookaheadMs = 1.5, releaseMs = 150, holdMs = 55) {
    this.ceiling = Math.pow(10, ceilingDb / 20);
    this.lookahead = Math.max(2 + TP_DELAY, Math.round((lookaheadMs * fs) / 1000));
    this.win = this.lookahead - TP_DELAY;
    const L = this.win;
    this.delayL = new Float64Array(L + TP_DELAY);
    this.delayR = new Float64Array(L + TP_DELAY);
    this.qCap = L + 2;
    this.qVal = new Float64Array(this.qCap);
    this.qIdx = new Float64Array(this.qCap);
    this.box = new Float64Array(L).fill(1);
    this.boxSum = L;
    this.release = 1 - Math.exp(-1 / ((releaseMs * fs) / 1000));
    this.holdSamples = Math.round((holdMs * fs) / 1000);
  }

  reset(): void {
    this.delayL.fill(0);
    this.delayR.fill(0);
    this.histL.fill(0);
    this.histR.fill(0);
    this.box.fill(1);
    this.boxSum = this.win;
    this.qHead = this.qTail = 0;
    this.gain = 1;
    this.holdCount = 0;
  }

  process(l: number, r: number, out: Float64Array): void {
    const L = this.win;
    // True peak: the sample TP_DELAY back and the three points interpolated after it,
    // so peaks between samples (which a DAC or a converter would reconstruct) are caught too.
    const hp = this.hPos;
    this.histL[hp] = l;
    this.histR[hp] = r;
    this.hPos = (hp + 1) & 7;
    const pl = this.histL[(hp + 4) & 7], pr = this.histR[(hp + 4) & 7];
    let peak = Math.max(Math.abs(pl), Math.abs(pr));
    for (let ph = 0; ph < 3; ph++) {
      const h = TP_TAPS[ph];
      let al = 0, ar = 0;
      for (let i = 0; i < 8; i++) {
        const j = (hp + 1 + i) & 7;
        al += h[i] * this.histL[j];
        ar += h[i] * this.histR[j];
      }
      if (al < 0) al = -al;
      if (ar < 0) ar = -ar;
      if (al > peak) peak = al;
      if (ar > peak) peak = ar;
    }
    const req = peak > this.ceiling ? this.ceiling / peak : 1;

    // Sliding minimum over the last L required gains.
    const cap = this.qCap;
    while (this.qTail !== this.qHead && this.qVal[(this.qTail - 1 + cap) % cap] >= req) {
      this.qTail = (this.qTail - 1 + cap) % cap;
    }
    this.qVal[this.qTail] = req;
    this.qIdx[this.qTail] = this.n;
    this.qTail = (this.qTail + 1) % cap;
    while (this.qIdx[this.qHead] <= this.n - L) this.qHead = (this.qHead + 1) % cap;
    const held = this.qVal[this.qHead];
    this.n++;

    // Box-car average over the last L held values.
    this.boxSum += held - this.box[this.boxPos];
    this.box[this.boxPos] = held;
    this.boxPos = this.boxPos + 1 === L ? 0 : this.boxPos + 1;
    if (this.boxPos === 0) {
      // Re-sum once per window to stop floating-point drift.
      let s = 0;
      for (let i = 0; i < L; i++) s += this.box[i];
      this.boxSum = s;
    }
    const smooth = this.boxSum / L;

    // Instant reduction; hold, then slow recovery.
    if (smooth < this.gain) {
      this.gain = smooth;
      this.holdCount = this.holdSamples;
    } else if (this.holdCount > 0) {
      this.holdCount--;
    } else {
      const rel = this.gain + (1 - this.gain) * this.release;
      this.gain = smooth < rel ? smooth : rel;
    }
    if (this.gain < this.minGain) this.minGain = this.gain;

    // Delay the signal by L-1 samples (plus the detector's delay) so the gain is applied ahead of peaks.
    const dl = this.delayL[this.dPos];
    const dr = this.delayR[this.dPos];
    this.delayL[this.dPos] = l;
    this.delayR[this.dPos] = r;
    this.dPos = this.dPos + 1 === L - 1 + TP_DELAY ? 0 : this.dPos + 1;

    const c = this.ceiling;
    const yl = dl * this.gain;
    const yr = dr * this.gain;
    out[0] = yl > c ? c : yl < -c ? -c : yl;
    out[1] = yr > c ? c : yr < -c ? -c : yr;
  }
}

// ---------------------------------------------------------------------------
// Effects added for the "expensive" sound: flanger, delay, reverb, tape,
// bitcrusher, compressor, multiband (OTT-style) compressor.
// ---------------------------------------------------------------------------

/** Linear-interpolated read `delay` samples behind write index `w`. */
function readFrac(buf: Float32Array, mask: number, w: number, delay: number): number {
  const pos = w - delay;
  const i = Math.floor(pos);
  const f = pos - i;
  const a = buf[i & mask];
  return a + (buf[(i + 1) & mask] - a) * f;
}

function pow2Size(n: number): number {
  let s = 1;
  while (s < n) s <<= 1;
  return s;
}

export class Flanger {
  private bufL: Float32Array;
  private bufR: Float32Array;
  private mask: number;
  private w = 0;
  private phase = 0;
  private fbL = 0;
  private fbR = 0;
  private count = 0;
  private dl = 0;
  private dr = 0;
  private stepL = 0;
  private stepR = 0;

  constructor(private fs: number) {
    this.dl = this.dr = 0.0003 * fs;
    const size = pow2Size(Math.ceil(0.012 * fs));
    this.bufL = new Float32Array(size);
    this.bufR = new Float32Array(size);
    this.mask = size - 1;
  }

  reset(): void {
    this.bufL.fill(0);
    this.bufR.fill(0);
    this.fbL = this.fbR = 0;
  }

  process(l: number, r: number, mix: number, rate: number, feedback: number, out: Float64Array): void {
    if (this.count-- <= 0) {
      this.count = 15;
      this.phase += (16 * rate) / this.fs;
      if (this.phase >= 1) this.phase -= 1;
      const min = 0.0003 * this.fs, depth = 0.0042 * this.fs;
      this.stepL = (min + depth * (0.5 - 0.5 * Math.cos(TWO_PI * this.phase)) - this.dl) / 16;
      this.stepR = (min + depth * (0.5 - 0.5 * Math.cos(TWO_PI * (this.phase + 0.25))) - this.dr) / 16;
    }
    const dl = (this.dl += this.stepL);
    const dr = (this.dr += this.stepR);
    this.bufL[this.w] = l + feedback * this.fbL;
    this.bufR[this.w] = r + feedback * this.fbR;
    const wl = readFrac(this.bufL, this.mask, this.w, dl);
    const wr = readFrac(this.bufR, this.mask, this.w, dr);
    this.w = (this.w + 1) & this.mask;
    this.fbL = clamp(wl, -1.5, 1.5);
    this.fbR = clamp(wr, -1.5, 1.5);
    out[0] = l * (1 - 0.5 * mix) + wl * 0.5 * mix;
    out[1] = r * (1 - 0.5 * mix) + wr * 0.5 * mix;
  }
}

/** Tempo-synced stereo ping-pong delay with a darkening, mud-free feedback path. */
export class Delay {
  private bufL: Float32Array;
  private bufR: Float32Array;
  private mask: number;
  private w = 0;
  private time = -1; // smoothed delay in samples
  private lpL = 0;
  private lpR = 0;
  private hpL = 0;
  private hpR = 0;
  private readonly hpCoef: number;

  constructor(private fs: number) {
    const size = pow2Size(Math.ceil(3.1 * fs));
    this.bufL = new Float32Array(size);
    this.bufR = new Float32Array(size);
    this.mask = size - 1;
    this.hpCoef = 1 - Math.exp((-TWO_PI * 150) / fs);
  }

  reset(): void {
    this.bufL.fill(0);
    this.bufR.fill(0);
    this.lpL = this.lpR = this.hpL = this.hpR = 0;
  }

  /** `toneCoef` is a one-pole LP coefficient for the feedback path. Returns wet only. */
  process(l: number, r: number, seconds: number, feedback: number, toneCoef: number, out: Float64Array): void {
    const target = Math.min(seconds * this.fs, this.mask - 2);
    // Glide towards a new time (tape-style) instead of jumping (no clicks).
    this.time = this.time < 0 ? target : this.time + (target - this.time) * 0.0005;
    const yl = readFrac(this.bufL, this.mask, this.w, this.time);
    const yr = readFrac(this.bufR, this.mask, this.w, this.time);
    // Feedback filtering: low-pass for darkness, high-pass so repeats never build mud.
    this.lpL += (yl - this.lpL) * toneCoef;
    this.lpR += (yr - this.lpR) * toneCoef;
    this.hpL += (this.lpL - this.hpL) * this.hpCoef;
    this.hpR += (this.lpR - this.hpR) * this.hpCoef;
    const fl = this.lpL - this.hpL;
    const fr = this.lpR - this.hpR;
    // Ping-pong: the mono input enters on the left, repeats cross over.
    this.bufL[this.w] = 0.5 * (l + r) + feedback * fr;
    this.bufR[this.w] = feedback * fl;
    this.w = (this.w + 1) & this.mask;
    out[0] = yl;
    out[1] = yr;
  }
}

/**
 * Octave-down pitch shifter for the reverb's input: two read taps sliding through a short delay
 * line at half speed, crossfaded (sin²/cos²) so each tap is silent while it jumps back. A slight
 * grain and movement in the shifted signal, which the reverb smears into its tail.
 */
export class OctaveDown {
  private readonly buf: Float32Array;
  private w = 0;
  private ph = 0;
  private readonly win: number;

  constructor(fs: number) {
    this.win = Math.round(0.06 * fs);
    this.buf = new Float32Array(this.win * 2 + 8);
  }

  reset(): void {
    this.buf.fill(0);
    this.ph = 0;
  }

  process(x: number): number {
    const n = this.buf.length;
    this.buf[this.w] = x;
    // each tap's delay grows by half a sample per sample: it reads at half speed (an octave down)
    this.ph += 0.5 / this.win;
    if (this.ph >= 1) this.ph -= 1;
    let y = 0;
    for (let t = 0; t < 2; t++) {
      let p = this.ph + 0.5 * t;
      if (p >= 1) p -= 1;
      const d = 2 + p * this.win;
      let r = this.w - d;
      if (r < 0) r += n;
      const i = Math.floor(r), f = r - i;
      const v = this.buf[i] * (1 - f) + this.buf[i + 1 === n ? 0 : i + 1] * f;
      const s = Math.sin(Math.PI * p);
      y += v * s * s;
    }
    this.w = this.w + 1 === n ? 0 : this.w + 1;
    return y;
  }
}

export const VERB_ROOM = 0, VERB_PLATE = 1, VERB_HALL = 2, VERB_CATHEDRAL = 3;

/** Per type: tank size (× the base lengths), input diffusion, tank damping (Hz), modulation depth (ms), early build-up, output level (the types level-matched). */
const VERB_TYPES = [
  { size: 0.36, diff: 0.62, damp: 5200, mod: 0.35, build: 0.55, level: 0.27 }, // room: small, quick, a little boxy
  { size: 0.52, diff: 0.78, damp: 6800, mod: 0.5, build: 0.25, level: 0.255 }, // plate: dense from the first moment, the brightest
  { size: 1.0, diff: 0.7, damp: 4400, mod: 0.8, build: 0.7, level: 0.4 }, // hall: big, smooth, chorused tail
  { size: 1.75, diff: 0.72, damp: 3300, mod: 1.1, build: 1, level: 0.58 }, // cathedral: huge, slow to bloom, dark
];
/** The tank's eight delay lines at hall size (ms): unrelated lengths, so no ringing modes line up. */
const VERB_LINES_MS = [29.7, 37.1, 41.1, 43.7, 53.3, 59.9, 67.7, 73.1];
const VERB_DIFF_MS = [4.77, 3.59, 12.73, 9.3];
const VERB_MOD_HZ = [0.31, 0.47, 0.61, 0.83, 0.37, 0.53, 0.71, 1.07];
/** Output signs per line: left and right hear the tank differently, so the tail is wide. */
const VERB_SIGN_L = [1, -1, 1, 1, -1, 1, -1, -1];
const VERB_SIGN_R = [1, 1, -1, 1, 1, -1, -1, 1];
const VERB_MAX_PRE = 0.26;

/**
 * Vintage digital reverb in the manner of the late-1970s machines (as Valhalla
 * VintageVerb's 1970s colour mode emulates them): a low bandwidth (dark input
 * and output, nothing above ~8 kHz), a diffused input, and an eight-line
 * feedback delay network whose lines are slowly chorused, so the tail is
 * smooth and never rings metallic. Four types (room, plate, hall, cathedral)
 * set the tank's size, density, damping and modulation; Decay is the RT60 in
 * seconds; Pre-delay holds the tail back from the note.
 */
export class Reverb {
  private readonly fs: number;
  private readonly pre: Float32Array;
  private preW = 0;
  private readonly diff: Float32Array[] = [];
  private readonly diffW = new Int32Array(4);
  private readonly lines: Float32Array[] = [];
  private readonly lineW = new Int32Array(8);
  private readonly damp = new Float64Array(8);
  private readonly modPh = new Float64Array(8);
  private readonly lineOut = new Float64Array(8);
  private inLp = 0;
  private inLp2 = 0;
  private outL = 0;
  private outR = 0;
  // set up per call from the parameters (cached so the coefficients are only redone when they move)
  private lastType = -1;
  private lastDecay = -1;
  private readonly len = new Float64Array(8);
  private readonly gain = new Float64Array(8);
  private readonly diffLen = new Int32Array(4);
  private dampCoef = 0;
  private modDepth = 0;
  private diffG = 0.7;
  private build = 0.7;
  private level = 0.4;
  private readonly bwCoef: number;

  constructor(fs: number) {
    this.fs = fs;
    this.pre = new Float32Array(Math.ceil(VERB_MAX_PRE * fs) + 4);
    const maxScale = VERB_TYPES[VERB_CATHEDRAL].size;
    for (const ms of VERB_DIFF_MS) this.diff.push(new Float32Array(Math.ceil((ms * maxScale * fs) / 1000) + 4));
    for (const ms of VERB_LINES_MS) this.lines.push(new Float32Array(Math.ceil(((ms * maxScale + 3) * fs) / 1000) + 4));
    // 1970s colour: the input and output are band-limited (~7.5 kHz), as the early machines' converters were.
    this.bwCoef = 1 - Math.exp((-2 * Math.PI * 7500) / fs);
    for (let i = 0; i < 8; i++) this.modPh[i] = i / 8;
  }

  reset(): void {
    this.pre.fill(0);
    for (const d of this.diff) d.fill(0);
    for (const l of this.lines) l.fill(0);
    this.damp.fill(0);
    this.inLp = this.inLp2 = this.outL = this.outR = 0;
  }

  private setup(type: number, decay: number): void {
    const t = VERB_TYPES[Math.max(0, Math.min(3, type))];
    const fs = this.fs;
    for (let i = 0; i < 8; i++) {
      this.len[i] = (VERB_LINES_MS[i] * t.size * fs) / 1000;
      // RT60: each pass through a line loses its share of 60 dB.
      // (the damping and the chorused reads lose a little on every pass too: long tails are stretched to match)
      this.gain[i] = Math.pow(10, (-3 * this.len[i]) / (Math.max(0.1, decay) * (1 + 0.055 * decay) * fs));
    }
    for (let i = 0; i < 4; i++) this.diffLen[i] = Math.max(1, Math.round((VERB_DIFF_MS[i] * Math.sqrt(t.size) * fs) / 1000));
    this.dampCoef = Math.exp((-2 * Math.PI * t.damp) / fs);
    this.modDepth = (t.mod * fs) / 1000;
    this.diffG = t.diff;
    this.build = t.build;
    // a long tail piles up more energy: level it so Decay changes the length, not mostly the loudness
    this.level = t.level * Math.min(2, Math.pow(Math.max(0.1, decay) / 2, -0.37));
    this.lastType = type;
    this.lastDecay = decay;
  }

  /** Returns wet stereo into out (dry not included). type 0..3, decay = RT60 seconds, predelay in ms. */
  process(input: number, type: number, decay: number, predelayMs: number, out: Float64Array): void {
    if (type !== this.lastType || Math.abs(decay - this.lastDecay) > 1e-4 * decay) this.setup(type, decay);
    const fs = this.fs;
    // pre-delay (fractional, so moving it glides)
    const pn = this.pre.length;
    this.pre[this.preW] = input;
    const pd = Math.min(VERB_MAX_PRE * fs, Math.max(0, (predelayMs * fs) / 1000));
    let rp = this.preW - pd;
    if (rp < 0) rp += pn;
    const ri = Math.floor(rp), rf = rp - ri;
    let x = this.pre[ri] * (1 - rf) + this.pre[ri + 1 === pn ? 0 : ri + 1] * rf;
    this.preW = this.preW + 1 === pn ? 0 : this.preW + 1;
    // band-limit (two poles: the dark 1970s top)
    this.inLp += this.bwCoef * (x - this.inLp);
    this.inLp2 += this.bwCoef * (this.inLp - this.inLp2);
    x = this.inLp2;
    // input diffusion: four allpasses smear the attack into a cloud
    const g = this.diffG;
    for (let i = 0; i < 4; i++) {
      const buf = this.diff[i];
      const n = buf.length;
      let r = this.diffW[i] - this.diffLen[i];
      if (r < 0) r += n;
      const d = buf[r];
      const v = x + g * d;
      buf[this.diffW[i]] = v;
      x = d - g * v;
      this.diffW[i] = this.diffW[i] + 1 === n ? 0 : this.diffW[i] + 1;
    }
    // the tank: read each (chorused) line, damp it, mix through a Householder matrix, feed back
    let sum = 0;
    const dc = this.dampCoef;
    for (let i = 0; i < 8; i++) {
      const buf = this.lines[i];
      const n = buf.length;
      let ph = this.modPh[i] + VERB_MOD_HZ[i] / fs;
      if (ph >= 1) ph -= 1;
      this.modPh[i] = ph;
      const m = 1 + this.modDepth * (0.5 + 0.5 * Math.sin(2 * Math.PI * ph));
      let r = this.lineW[i] - this.len[i] - m;
      while (r < 0) r += n;
      const j = Math.floor(r), f = r - j;
      const y = buf[j] * (1 - f) + buf[j + 1 === n ? 0 : j + 1] * f;
      this.damp[i] = y * (1 - dc) + this.damp[i] * dc;
      const v = this.damp[i] * this.gain[i];
      this.lineOut[i] = v;
      sum += v;
    }
    const hh = (2 / 8) * sum;
    // the build-up: in a big space the first lines fill before the later ones
    const b = this.build;
    let l = 0, rr = 0;
    for (let i = 0; i < 8; i++) {
      const v = this.lineOut[i];
      const inject = i < 4 ? x : x * (1 - 0.5 * b);
      const buf = this.lines[i];
      buf[this.lineW[i]] = v - hh + inject;
      this.lineW[i] = this.lineW[i] + 1 === buf.length ? 0 : this.lineW[i] + 1;
      l += VERB_SIGN_L[i] * v;
      rr += VERB_SIGN_R[i] * v;
    }
    // output band-limit, same colour as the input
    this.outL += this.bwCoef * (l - this.outL);
    this.outR += this.bwCoef * (rr - this.outR);
    out[0] = this.outL * this.level;
    out[1] = this.outR * this.level;
  }
}

/**
 * Tape: saturation (soft, slightly asymmetric), wow & flutter (modulated
 * delay), and age (high-frequency loss plus hiss). Processes the voice only;
 * the sub is added afterwards so it stays clean and phase-stable.
 */
export class Tape {
  private bufL: Float32Array;
  private bufR: Float32Array;
  private mask: number;
  private w = 0;
  private wowPh = 0;
  private flutPh = 0;
  private drift = 0;
  private driftTarget = 0;
  private driftCount = 0;
  private lpL = 0;
  private lpR = 0;
  private hiss = new Rng(0x7a9e);
  private hissLp = 0;
  private count = 0;
  private d: number;
  private dStep = 0;

  constructor(private fs: number) {
    this.d = 0.0025 * fs;
    const size = pow2Size(Math.ceil(0.02 * fs));
    this.bufL = new Float32Array(size);
    this.bufR = new Float32Array(size);
    this.mask = size - 1;
  }

  reset(): void {
    this.bufL.fill(0);
    this.bufR.fill(0);
    this.lpL = this.lpR = this.hissLp = 0;
  }

  /** env: the voice's amp envelope, used to gate the hiss. lpCoef: age low-pass. */
  process(l: number, r: number, drive: number, wow: number, age: number, lpCoef: number, env: number, out: Float64Array): void {
    // Saturation.
    if (drive > 0) {
      const g = 1 + 5 * drive;
      const bias = 0.15 * drive;
      const tb = fastTanh(bias);
      const comp = 1 / (1 + 1.2 * drive);
      l += ((fastTanh(g * l + bias) - tb) * comp - l) * Math.min(1, drive * 4);
      r += ((fastTanh(g * r + bias) - tb) * comp - r) * Math.min(1, drive * 4);
    }
    // Wow (slow, wandering) and flutter (fast, small).
    if (wow > 0) {
      if (this.count-- <= 0) {
        // Modulation computed every 16 samples, interpolated in between.
        this.count = 15;
        // The wow rate wanders widely (worn capstans and stretched tape never turn evenly).
        this.wowPh += (16 * (0.55 * (1 + 0.5 * this.drift))) / this.fs;
        if (this.wowPh >= 1) this.wowPh -= 1;
        this.flutPh += (16 * 7.3) / this.fs;
        if (this.flutPh >= 1) this.flutPh -= 1;
        this.driftCount -= 16;
        if (this.driftCount <= 0) {
          this.driftTarget = this.hiss.next();
          this.driftCount = Math.round(this.fs * 0.4);
        }
        this.drift += (this.driftTarget - this.drift) * 0.0016;
        const target = this.fs * (0.0025 + wow * (0.0022 * Math.sin(TWO_PI * this.wowPh) * (1 + 0.4 * this.drift) + 0.00012 * Math.sin(TWO_PI * this.flutPh)));
        this.dStep = (target - this.d) / 16;
      }
      this.d += this.dStep;
      const d = this.d;
      this.bufL[this.w] = l;
      this.bufR[this.w] = r;
      l = readFrac(this.bufL, this.mask, this.w, d);
      r = readFrac(this.bufR, this.mask, this.w, d);
      this.w = (this.w + 1) & this.mask;
    }
    // Age: high-frequency loss and hiss.
    if (age > 0) {
      this.lpL += (l - this.lpL) * lpCoef;
      this.lpR += (r - this.lpR) * lpCoef;
      l = this.lpL;
      r = this.lpR;
      const n = this.hiss.next();
      const hp = n - this.hissLp; // crude high-passed hiss
      this.hissLp += (n - this.hissLp) * 0.3;
      const h = hp * age * 0.004 * Math.min(1, env * 4);
      l += h;
      r += h;
    }
    out[0] = l;
    out[1] = r;
  }
}

/** Bitcrusher + downsampler (sample-and-hold), with dry/wet mix. */
export class Crusher {
  private holdL = 0;
  private holdR = 0;
  private acc = 1;

  reset(): void {
    this.holdL = this.holdR = 0;
    this.acc = 1;
  }

  /** q = quantisation steps per unit; rate = downsample factor (≥ 1). */
  process(l: number, r: number, mix: number, q: number, rate: number, out: Float64Array): void {
    this.acc += 1;
    if (this.acc >= rate) {
      this.acc -= rate;
      this.holdL = Math.round(clamp(l, -1, 1) * q) / q;
      this.holdR = Math.round(clamp(r, -1, 1) * q) / q;
    }
    out[0] = l + (this.holdL - l) * mix;
    out[1] = r + (this.holdR - r) * mix;
  }
}

