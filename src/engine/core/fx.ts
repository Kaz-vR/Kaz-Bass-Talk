// Stereo effects that run after the voice. They only ever see the part of the
// signal above `fx.lowcut` (see Synth.processFx), so the low end stays dry,
// centred and phase-stable whatever the effect settings are.

import { clamp as clamp_, fastTanh as fastTanh_, Rng as Rng_, Svf as Svf_, TWO_PI as TWO_PI_ } from './dsp';

// Module-local bindings: avoids live-binding getter overhead on hot paths in
// some module transforms (tsx / vite-node).
const clamp = clamp_;
const fastTanh = fastTanh_;
const Rng = Rng_;
const Svf = Svf_;
const TWO_PI = TWO_PI_;

const MAX_FS = 192000;

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
  process(l: number, r: number, mix: number, depth: number, out: Float64Array, ensemble = false): void {
    if (ensemble) {
      this.processEnsemble(l, r, mix, depth, out);
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

/** Freeverb-style stereo reverb: 8 damped combs + 4 allpasses per side, with pre-delay. */
export class Reverb {
  private combs: Float32Array[] = [];
  private combIdx = new Int32Array(16);
  private combLp = new Float64Array(16);
  private aps: Float32Array[] = [];
  private apIdx = new Int32Array(8);
  private pre: Float32Array;
  private preIdx = 0;

  constructor(fs: number) {
    const s = fs / 44100;
    const combLens = [1116, 1188, 1277, 1356, 1422, 1491, 1557, 1617];
    const apLens = [556, 441, 341, 225];
    for (let ch = 0; ch < 2; ch++) {
      for (const c of combLens) this.combs.push(new Float32Array(Math.round((c + ch * 23) * s)));
      for (const a of apLens) this.aps.push(new Float32Array(Math.round((a + ch * 23) * s)));
    }
    this.pre = new Float32Array(Math.round(0.018 * fs));
  }

  reset(): void {
    for (const c of this.combs) c.fill(0);
    for (const a of this.aps) a.fill(0);
    this.combLp.fill(0);
    this.pre.fill(0);
  }

  /** Returns wet stereo into out (dry not included). size 0..1, tone 0 (bright)..1 (dark). */
  process(input: number, size: number, tone: number, out: Float64Array): void {
    const fb = 0.72 + 0.26 * size; // ~0.5 s .. ~8 s tails
    const damp = 0.05 + 0.65 * tone;
    const x = this.pre[this.preIdx] * 0.03;
    this.pre[this.preIdx] = input;
    this.preIdx = this.preIdx + 1 === this.pre.length ? 0 : this.preIdx + 1;
    for (let ch = 0; ch < 2; ch++) {
      let acc = 0;
      for (let c = 0; c < 8; c++) {
        const k = ch * 8 + c;
        const buf = this.combs[k];
        const i = this.combIdx[k];
        const y = buf[i];
        this.combLp[k] = y * (1 - damp) + this.combLp[k] * damp;
        buf[i] = x + this.combLp[k] * fb;
        this.combIdx[k] = i + 1 === buf.length ? 0 : i + 1;
        acc += y;
      }
      for (let a = 0; a < 4; a++) {
        const k = ch * 4 + a;
        const buf = this.aps[k];
        const i = this.apIdx[k];
        const b = buf[i];
        buf[i] = acc + b * 0.5;
        this.apIdx[k] = i + 1 === buf.length ? 0 : i + 1;
        acc = b - acc;
      }
      out[ch] = acc;
    }
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

/**
 * Stereo-linked feed-forward compressor with automatic make-up gain and a
 * tempo-synced "pump" (sidechain-style ducking on every beat). The gain is
 * computed at control rate from a per-sample peak detector and interpolated.
 */
export class Compressor {
  private env = 0;
  private gain = 1;
  private gainStep = 0;
  private atk = 0;
  private rel = 0;
  private thresh = 1;
  private slope = 0; // 1 - 1/ratio
  private makeup = 1;
  private active = false;

  reset(): void {
    this.env = 0;
    this.gain = 1;
    this.gainStep = 0;
  }

  /** Call at control rate with block length (samples) and settings. */
  update(amount: number, speed: number, pumpGain: number, fs: number, block: number): void {
    this.active = amount > 0.001;
    const atkMs = 30 * Math.pow(1 / 30, speed); // 30 ms .. 1 ms
    const relMs = 300 * Math.pow(40 / 300, speed); // 300 ms .. 40 ms
    this.atk = 1 - Math.exp(-1 / ((atkMs * fs) / 1000));
    this.rel = 1 - Math.exp(-1 / ((relMs * fs) / 1000));
    const threshDb = -30 * amount;
    const ratio = 1.5 + 6 * amount;
    this.thresh = Math.pow(10, threshDb / 20);
    this.slope = 1 - 1 / ratio;
    this.makeup = Math.pow(10, (-threshDb * this.slope * 0.5) / 20);
    let g = 1;
    if (this.active && this.env > this.thresh) {
      // gain = (env/thresh)^(-slope)
      g = Math.pow(this.env / this.thresh, -this.slope);
    }
    const target = (this.active ? g * this.makeup : 1) * pumpGain;
    this.gainStep = (target - this.gain) / block;
  }

  process(l: number, r: number, out: Float64Array): void {
    const a = Math.max(Math.abs(l), Math.abs(r));
    this.env += (a - this.env) * (a > this.env ? this.atk : this.rel);
    this.gain += this.gainStep;
    out[0] = l * this.gain;
    out[1] = r * this.gain;
  }
}

/**
 * Three-band upward + downward compressor in the style of "OTT": brings up
 * quiet detail and squashes loud peaks per band, for a dense, polished,
 * "finished" tone. Bands are split complementarily (low = LP, mid = LP of the
 * rest, high = remainder) so with all gains at 1 the output equals the input.
 * The low band gets very little upward gain so the sub never swells or muddies.
 */
export class Ott {
  private lowL = new Svf();
  private lowR = new Svf();
  private midL = new Svf();
  private midR = new Svf();
  private gLow: number;
  private gMid: number;
  private env = new Float64Array(3);
  private gain = new Float64Array([1, 1, 1]);
  private step = new Float64Array(3);
  private atk: number;
  private rel: number;
  private static readonly UP_MAX_DB = [3, 12, 14];
  private static readonly THRESH_DB = [-14, -20, -24];

  constructor(fs: number) {
    this.gLow = Math.tan((Math.PI * 120) / fs);
    this.gMid = Math.tan((Math.PI * 2500) / fs);
    this.lowL.setCoefs(this.gLow, Math.SQRT2);
    this.lowR.setCoefs(this.gLow, Math.SQRT2);
    this.midL.setCoefs(this.gMid, Math.SQRT2);
    this.midR.setCoefs(this.gMid, Math.SQRT2);
    this.atk = 1 - Math.exp(-1 / (0.004 * fs));
    this.rel = 1 - Math.exp(-1 / (0.12 * fs));
  }

  reset(): void {
    this.lowL.reset();
    this.lowR.reset();
    this.midL.reset();
    this.midR.reset();
    this.env.fill(0);
    this.gain.fill(1);
    this.step.fill(0);
  }

  update(amount: number, block: number): void {
    for (let b = 0; b < 3; b++) {
      let target = 1;
      if (amount > 0.001) {
        const e = Math.max(this.env[b], 1e-6);
        const db = 20 * Math.log10(e);
        const t = Ott.THRESH_DB[b];
        let gDb: number;
        if (db > t) gDb = -(db - t) * 0.75; // downward 4:1
        else gDb = Math.min(Ott.UP_MAX_DB[b], (t - db) * 0.6); // upward
        if (db < -70) gDb = Math.min(gDb, 0); // never lift silence / noise
        target = 1 + amount * (Math.pow(10, gDb / 20) - 1);
      }
      this.step[b] = (target - this.gain[b]) / block;
    }
  }

  process(l: number, r: number, out: Float64Array): void {
    this.lowL.processFixed(l);
    this.lowR.processFixed(r);
    const loL = this.lowL.lp, loR = this.lowR.lp;
    const restL = l - loL, restR = r - loR;
    this.midL.processFixed(restL);
    this.midR.processFixed(restR);
    const miL = this.midL.lp, miR = this.midR.lp;
    const hiL = restL - miL, hiR = restR - miR;
    const bands0 = Math.max(Math.abs(loL), Math.abs(loR));
    const bands1 = Math.max(Math.abs(miL), Math.abs(miR));
    const bands2 = Math.max(Math.abs(hiL), Math.abs(hiR));
    const env = this.env, a = this.atk, rl = this.rel;
    env[0] += (bands0 - env[0]) * (bands0 > env[0] ? a : rl);
    env[1] += (bands1 - env[1]) * (bands1 > env[1] ? a : rl);
    env[2] += (bands2 - env[2]) * (bands2 > env[2] ? a : rl);
    const g = this.gain, s = this.step;
    g[0] += s[0];
    g[1] += s[1];
    g[2] += s[2];
    out[0] = loL * g[0] + miL * g[1] + hiL * g[2];
    out[1] = loR * g[0] + miR * g[1] + hiR * g[2];
  }
}
