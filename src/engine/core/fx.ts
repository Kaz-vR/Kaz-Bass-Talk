// Stereo effects that run after the voice. Each only sees the part of the signal
// above its own low cut (chorus.lowcut … reverb.lowcut, see Synth), so the low end
// stays dry, centred and phase-stable whatever the effect settings are.

import { Biquad, clamp as clamp_, fastTanh as fastTanh_, Rng as Rng_, TWO_PI as TWO_PI_ } from './dsp';

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
    if (mode === 3) {
      this.processBbd(l, r, mix, depth, out);
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

  private bbdPhase = 0;
  private bbdRate = 0.5;
  private readonly bbdLp = new Float64Array(4);
  private readonly bbdNoise = new Rng(0xbbd);
  private bbdCoef = -1;

  /**
   * BBD (the Juno / Jupiter chorus): one bucket-brigade delay per side, swept by a triangle in
   * opposite directions (left and right swing apart), its echo darkened by the chips' filters
   * (~7 kHz), softly saturated and carrying a faint hiss. Depth = how far and how fast it sweeps
   * (from the Juno's slow I towards its faster II).
   */
  private processBbd(l: number, r: number, mix: number, depth: number, out: Float64Array): void {
    const mask = this.size - 1;
    this.bufL[this.w & mask] = l;
    this.bufR[this.w & mask] = r;
    if (this.bbdCoef < 0) this.bbdCoef = 1 - Math.exp((-TWO_PI * 7000) / this.fs);
    if (this.count-- <= 0) {
      this.count = 15;
      this.bbdRate = (0.4 + 0.5 * depth) * this.driftStep();
    }
    this.bbdPhase += this.bbdRate / this.fs;
    if (this.bbdPhase >= 1) this.bbdPhase -= 1;
    const tri = this.bbdPhase < 0.5 ? 4 * this.bbdPhase - 1 : 3 - 4 * this.bbdPhase; // -1..1
    const centre = 0.0035 * this.fs, swing = (0.0008 + 0.0016 * depth) * this.fs;
    let wl = this.read(this.bufL, centre + swing * tri);
    let wr = this.read(this.bufR, centre - swing * tri);
    // the chips' filters (two poles), a little saturation, a little hiss
    const c = this.bbdCoef, s = this.bbdLp;
    s[0] += (wl - s[0]) * c;
    s[1] += (s[0] - s[1]) * c;
    s[2] += (wr - s[2]) * c;
    s[3] += (s[2] - s[3]) * c;
    wl = fastTanh(1.2 * s[1]) / 1.2 + 0.0006 * this.bbdNoise.next();
    wr = fastTanh(1.2 * s[3]) / 1.2 + 0.0006 * this.bbdNoise.next();
    this.w = (this.w + 1) & mask;
    const dry = 1 - 0.5 * mix;
    out[0] = l * dry + mix * 0.55 * wl;
    out[1] = r * dry + mix * 0.55 * wr;
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

/**
 * HYPER / DIMENSION (owner's call: as Serum's): HYPER stacks up to 7 copies of the sound (Unison), each a short delay
 * swung by its own slow sine at about Rate (each a little off the others), Detune setting how far they swing (the
 * pitch spread), spread from left to right and blended in by Mix; Retrig restarts their swings on every note.
 * DIMENSION then widens it: each side gets the other side's short delay minus its own (Size = how long), blended by its
 * own Mix, so the middle stays where it was. Ported line by line to plugin/engine/Fx.h.
 */
export class HyperDim {
  private readonly buf: Float32Array;
  private readonly mask: number;
  private w = 0;
  private readonly ph = new Float64Array(7);
  private readonly dl: Float32Array;
  private readonly dr: Float32Array;
  private readonly dmask: number;
  private dw = 0;

  constructor(private readonly fs: number) {
    const size = pow2Size(Math.ceil(0.06 * fs));
    this.buf = new Float32Array(size);
    this.mask = size - 1;
    const ds = pow2Size(Math.ceil(0.04 * fs));
    this.dl = new Float32Array(ds);
    this.dr = new Float32Array(ds);
    this.dmask = ds - 1;
    this.retrig(7);
  }

  reset(): void {
    this.buf.fill(0);
    this.dl.fill(0);
    this.dr.fill(0);
    this.retrig(7);
  }

  /** Every copy's swing starts again, evenly spread over the cycle. */
  retrig(unison: number): void {
    const u = Math.max(1, Math.round(unison));
    for (let i = 0; i < 7; i++) this.ph[i] = (i % u) / u;
  }

  /** Writes the result (the whole sound, mixed) to out[0], out[1]. */
  process(l: number, r: number, rate: number, detune: number, unison: number, mix: number, size: number, dimMix: number, out: Float64Array): void {
    const fs = this.fs;
    if (mix > 1e-4) {
      const u = Math.max(1, Math.min(7, Math.round(unison)));
      let wl = 0, wr = 0;
      for (let i = 0; i < u; i++) {
        const ri = rate * (1 + 0.29 * (((i * 0.618034) % 1) - 0.5));
        let p = this.ph[i] + ri / fs;
        p -= Math.floor(p);
        this.ph[i] = p;
        const d = (0.008 + 0.0017 * i + detune * 0.005 * (0.5 + 0.5 * Math.sin(2 * Math.PI * p))) * fs;
        const y = readFrac(this.buf, this.mask, this.w, d);
        const pan = u > 1 ? (2 * i) / (u - 1) - 1 : 0;
        wl += y * Math.sqrt(0.5 * (1 - pan));
        wr += y * Math.sqrt(0.5 * (1 + pan));
      }
      this.buf[this.w] = 0.5 * (l + r);
      this.w = (this.w + 1) & this.mask;
      const n = 1 / Math.sqrt(u);
      l = l * (1 - mix) + wl * n * mix;
      r = r * (1 - mix) + wr * n * mix;
    }
    if (dimMix > 1e-4) {
      const s = 0.003 + 0.015 * size;
      const a = readFrac(this.dr, this.dmask, this.dw, s * fs), b = readFrac(this.dl, this.dmask, this.dw, s * 1.37 * fs);
      const c = readFrac(this.dl, this.dmask, this.dw, s * 1.17 * fs), d = readFrac(this.dr, this.dmask, this.dw, s * 1.61 * fs);
      this.dl[this.dw] = l;
      this.dr[this.dw] = r;
      this.dw = (this.dw + 1) & this.dmask;
      l += dimMix * 0.5 * (a - b);
      r += dimMix * 0.5 * (c - d);
    }
    out[0] = l;
    out[1] = r;
  }
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

/** The shifter's formant bank: log-spaced bands from SH_F_LO to SH_F_HI. */
const SH_BANDS = 24, SH_F_LO = 60, SH_F_HI = 15000;
const SH_SPACING = Math.log2(SH_F_HI / SH_F_LO) / (SH_BANDS - 1);
/**
 * PITCH SHIFTER (owner's call, 27 Nov, in the delay's place): the octave-down shifter generalised. Two read taps slide
 * through a short delay line at the ratio's speed, crossfaded (sin² / cos²) so each is silent while it jumps; the body
 * moves with the pitch (the monstrous octave down). Grain sets the window, 80 ms (smooth) down to 6 ms (granular),
 * and how far each grain's start jitters; Feedback sends the shifted sound back in, so it keeps climbing or falling
 * (shimmer, the abyss); an anti-alias low-pass in front when it shifts up. Formant moves the body further on its own
 * (± semitones on top of what the pitch moves it): a bank of 24 bands, the shifted sound's own envelope read
 * Formant semitones away and laid back onto it, faded in over the first semitone.
 */
export class PitchShifter {
  private readonly buf: Float32Array[];
  private readonly mask: number;
  private w = 0;
  private ph = 0;
  private readonly lastP = new Float64Array(2);
  private readonly jit = new Float64Array(2);
  private readonly rng = new Rng_(0x51f7a3);
  private readonly fbS = new Float64Array(2);
  private readonly aa = [new Biquad(), new Biquad(), new Biquad(), new Biquad()];
  private aaOn = false;
  private lastAa = -1;
  private ratio = 1;
  private win = 1;
  private grain = 0;
  private fb = 0;
  private fbK = 0;
  private formant = 0;
  // the formant bank: per band its SVF coefficients, both channels' states, the envelope and the gain
  private readonly fG = new Float64Array(SH_BANDS);
  private readonly fK = new Float64Array(SH_BANDS);
  private readonly ic1 = new Float64Array(2 * SH_BANDS);
  private readonly ic2 = new Float64Array(2 * SH_BANDS);
  private readonly env = new Float64Array(SH_BANDS);
  private readonly gain = new Float64Array(SH_BANDS).fill(1);
  private readonly gainT = new Float64Array(SH_BANDS).fill(1);
  private readonly bandOut = new Float64Array(2 * SH_BANDS);
  private envA = 0;
  private envR = 0;
  private tick = 0;
  /** The bank's output held at its input's level (followers over ~50 ms). */
  private lvIn = 0;
  private lvOut = 0;
  private lvK = 0;

  constructor(private readonly fs: number) {
    const size = pow2Size(Math.ceil(0.2 * fs));
    this.buf = [new Float32Array(size), new Float32Array(size)];
    this.mask = size - 1;
    for (let b = 0; b < SH_BANDS; b++) {
      const fc = Math.min(SH_F_LO * Math.pow(2, b * SH_SPACING), 0.45 * fs);
      this.fG[b] = Math.tan((Math.PI * fc) / fs);
      this.fK[b] = 1 / 4.2;
    }
    this.envA = 1 - Math.exp(-1 / (0.003 * fs));
    this.envR = 1 - Math.exp(-1 / (0.03 * fs));
    this.fbK = 1 - Math.exp((-TWO_PI_ * 7000) / fs);
    this.lvK = 1 - Math.exp(-1 / (0.05 * fs));
  }

  reset(): void {
    for (const b of this.buf) b.fill(0);
    this.ph = 0;
    this.lastP.fill(0);
    this.jit.fill(0);
    this.fbS.fill(0);
    for (const f of this.aa) f.reset();
    this.ic1.fill(0);
    this.ic2.fill(0);
    this.env.fill(0);
    this.gain.fill(1);
    this.gainT.fill(1);
    this.lvIn = this.lvOut = 0;
  }

  /** Control rate: the shift in semitones (oct, semi and fine together), Feedback 0..1, Grain 0..1, Formant in semitones. */
  set(semis: number, feedback: number, grain: number, formant: number): void {
    this.ratio = Math.pow(2, semis / 12);
    this.grain = clamp_(grain, 0, 1);
    this.win = Math.round(0.08 * Math.pow(6 / 80, this.grain) * this.fs);
    this.fb = 0.95 * clamp_(feedback, 0, 1);
    this.formant = clamp_(formant, -24, 24);
    // shifting up reads faster: what would fold over is taken out first
    const aa = this.ratio > 1.01 ? Math.min(0.45 * this.fs, (0.45 * this.fs) / this.ratio) : 0;
    if (aa !== this.lastAa) {
      this.lastAa = aa;
      this.aaOn = aa > 0;
      if (this.aaOn) for (const f of this.aa) f.setLowpass(aa, Math.SQRT1_2, this.fs);
    }
  }

  /** One stereo sample (what is above the low cut) into out: the shifted sound only (wet). */
  process(l: number, r: number, out: Float64Array): void {
    const mask = this.mask, win = this.win;
    // the taps: one phase for both channels, each tap's delay 2 .. win (+ its jitter) samples
    let ph = this.ph + (1 - this.ratio) / win;
    ph -= Math.floor(ph);
    this.ph = ph;
    const ph2 = ph + 0.5 >= 1 ? ph - 0.5 : ph + 0.5;
    for (let t = 0; t < 2; t++) {
      const p = t === 0 ? ph : ph2;
      // a new grain (its phase wrapped, either way): a new jitter
      if (Math.abs(p - this.lastP[t]) > 0.5) this.jit[t] = this.grain * this.grain * 0.5 * win * (0.5 + 0.5 * this.rng.next());
      this.lastP[t] = p;
    }
    for (let c = 0; c < 2; c++) {
      let x = (c === 0 ? l : r) + this.fb * this.fbS[c];
      if (this.aaOn) x = this.aa[2 * c + 1].process(this.aa[2 * c].process(x));
      const b = this.buf[c];
      b[this.w] = x;
      let y = 0;
      for (let t = 0; t < 2; t++) {
        const p = t === 0 ? ph : ph2;
        const d = 2 + p * win + this.jit[t];
        let rp = this.w - d;
        rp -= Math.floor(rp / (mask + 1)) * (mask + 1);
        const i = Math.floor(rp), f = rp - i;
        const v = b[i & mask] + (b[(i + 1) & mask] - b[i & mask]) * f;
        const s = Math.sin(Math.PI * p);
        y += v * s * s;
      }
      // the feedback path: darkened a little and held below clipping, so the repeats stay musical
      this.fbS[c] += (fastTanh_(y) - this.fbS[c]) * this.fbK;
      out[c] = y;
    }
    this.w = (this.w + 1) & mask;
    if (Math.abs(this.formant) > 1e-3) this.formantWarp(out);
  }

  private formantWarp(out: Float64Array): void {
    const NB = SH_BANDS;
    let sl = 0, sr = 0;
    for (let b = 0; b < NB; b++) {
      const g = this.fG[b], k = this.fK[b], a1 = 1 / (1 + g * (g + k)), a2 = g * a1;
      let e = 0;
      for (let c = 0; c < 2; c++) {
        const o = c * NB + b, v0 = out[c];
        const v1 = a1 * this.ic1[o] + a2 * (v0 - this.ic2[o]);
        const v2 = this.ic2[o] + g * v1;
        this.ic1[o] = 2 * v1 - this.ic1[o];
        this.ic2[o] = 2 * v2 - this.ic2[o];
        const bp = k * v1;
        this.bandOut[o] = bp;
        e += Math.abs(bp);
      }
      e *= 0.5;
      this.env[b] += (e - this.env[b]) * (e > this.env[b] ? this.envA : this.envR);
    }
    // every 16 samples: each band takes the envelope Formant semitones away (body down = read from higher up)
    if ((this.tick = (this.tick + 1) & 15) === 0) {
      const shift = -this.formant / 12 / SH_SPACING;
      for (let b = 0; b < NB; b++) {
        const s = Math.max(0, Math.min(NB - 1, b + shift)), i = Math.min(NB - 2, Math.floor(s)), f = s - i;
        const src = this.env[i] + (this.env[i + 1] - this.env[i]) * f;
        this.gainT[b] = Math.min(6, src / (this.env[b] + 1e-5));
      }
    }
    for (let b = 0; b < NB; b++) {
      this.gain[b] += (this.gainT[b] - this.gain[b]) * 0.02;
      sl += this.gain[b] * this.bandOut[b];
      sr += this.gain[b] * this.bandOut[NB + b];
    }
    // held at the level it came in at (a body moved is not a louder sound)
    this.lvIn += (Math.abs(out[0]) + Math.abs(out[1]) - this.lvIn) * this.lvK;
    this.lvOut += (Math.abs(sl) + Math.abs(sr) - this.lvOut) * this.lvK;
    const lg = Math.max(0.25, Math.min(2, this.lvIn / (this.lvOut + 1e-9)));
    sl *= lg;
    sr *= lg;
    // faded in over the first semitone, so turning it from 0 never jumps
    const m = Math.min(1, Math.abs(this.formant));
    out[0] += (sl - out[0]) * m;
    out[1] += (sr - out[1]) * m;
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

export { Reverb } from './verb';

/**
 * Tape: wow & flutter (a modulated delay). Processes the voice only;
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
  private hiss = new Rng(0x7a9e);
  private count = 0;
  private d: number;
  private dStep = 0;

  constructor(private fs: number) {
    this.d = 0.0025 * fs;
    const size = pow2Size(Math.ceil(0.12 * fs)); // room for the extreme wow (±2 semitones, its swing ~47 ms)
    this.bufL = new Float32Array(size);
    this.bufR = new Float32Array(size);
    this.mask = size - 1;
  }

  reset(): void {
    this.bufL.fill(0);
    this.bufR.fill(0);
  }

  /** Wow and flutter only (owner's call: tape's drive and age were removed; the DRIVE box's tape type, the EQ and the Noise box do them). */
  process(l: number, r: number, wow: number, out: Float64Array): void {
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
        // Depths in cents, curved (owner's call: as extreme as the wildest tape plugins at the top, the
        // first half as gentle as before): wow ±13 → ±200 cents, flutter ±9.5 → ±50; a delay swing of A
        // seconds at f Hz bends the pitch by ~1731·2πf·A cents. The resting delay sits just past the swing.
        const w4 = wow * wow * wow * wow;
        const aw = (13.2 * wow + 186.8 * w4) * 1.672e-4, af = (9.5 * wow + 40.5 * w4) * 1.2596e-5;
        const target = this.fs * (0.0025 + 1.4 * aw + af + aw * Math.sin(TWO_PI * this.wowPh) * (1 + 0.4 * this.drift) + af * Math.sin(TWO_PI * this.flutPh));
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

