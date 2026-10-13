// Stereo effects that run after the voice. They only ever see the part of the
// signal above `fx.lowcut` (see Synth.processFx), so the low end stays dry,
// centred and phase-stable whatever the effect settings are.

import { clamp, TWO_PI } from './dsp';

const MAX_FS = 192000;

export class Chorus {
  private bufL: Float32Array;
  private bufR: Float32Array;
  private size: number;
  private w = 0;
  private phase = 0;
  private fs: number;

  constructor(fs: number) {
    this.fs = fs;
    this.size = 1;
    while (this.size < Math.ceil(0.04 * Math.min(fs, MAX_FS))) this.size <<= 1;
    this.bufL = new Float32Array(this.size);
    this.bufR = new Float32Array(this.size);
  }

  reset(): void {
    this.bufL.fill(0);
    this.bufR.fill(0);
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

  /** Processes in place on the provided 2-element output holder. */
  process(l: number, r: number, mix: number, depth: number, out: Float64Array): void {
    const mask = this.size - 1;
    this.bufL[this.w & mask] = l;
    this.bufR[this.w & mask] = r;
    const rate = 0.25 + depth * 0.9;
    this.phase += rate / this.fs;
    if (this.phase >= 1) this.phase -= 1;
    const base = 0.007 * this.fs;
    const mod = (0.0005 + depth * 0.0045) * this.fs;
    const dl = base + mod * (0.5 + 0.5 * Math.sin(TWO_PI * this.phase));
    const dr = base + mod * (0.5 + 0.5 * Math.sin(TWO_PI * (this.phase + 0.25)));
    const wl = this.read(this.bufL, dl);
    const wr = this.read(this.bufR, dr);
    this.w = (this.w + 1) & mask;
    const dry = 1 - 0.5 * mix;
    // Cross-feed the wet signals a little for a wider image.
    out[0] = l * dry + 0.5 * mix * (0.8 * wl + 0.2 * wr);
    out[1] = r * dry + 0.5 * mix * (0.8 * wr + 0.2 * wl);
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

  process(l: number, r: number, mix: number, rate: number, out: Float64Array): void {
    this.phase += rate / this.fs;
    if (this.phase >= 1) this.phase -= 1;
    const lfoL = 0.5 + 0.5 * Math.sin(TWO_PI * this.phase);
    const lfoR = 0.5 + 0.5 * Math.sin(TWO_PI * (this.phase + 0.2));
    const yl = this.chain(l + 0.4 * this.fbL, this.zl, this.coef(lfoL));
    const yr = this.chain(r + 0.4 * this.fbR, this.zr, this.coef(lfoR));
    this.fbL = clamp(yl, -2, 2);
    this.fbR = clamp(yr, -2, 2);
    out[0] = l * (1 - 0.5 * mix) + yl * 0.5 * mix;
    out[1] = r * (1 - 0.5 * mix) + yr * 0.5 * mix;
  }
}

/** Small Schroeder/Freeverb-style room: 4 damped combs + 2 allpasses per side. */
export class Reverb {
  private combs: Float32Array[] = [];
  private combLen: number[] = [];
  private combIdx: number[] = [];
  private combLp: Float64Array = new Float64Array(8);
  private aps: Float32Array[] = [];
  private apLen: number[] = [];
  private apIdx: number[] = [];

  constructor(fs: number) {
    const s = fs / 44100;
    const combMs = [1116, 1188, 1277, 1356];
    const apMs = [556, 441];
    for (let ch = 0; ch < 2; ch++) {
      for (const c of combMs) {
        const n = Math.round((c + ch * 23) * s);
        this.combs.push(new Float32Array(n));
        this.combLen.push(n);
        this.combIdx.push(0);
      }
      for (const a of apMs) {
        const n = Math.round((a + ch * 23) * s);
        this.aps.push(new Float32Array(n));
        this.apLen.push(n);
        this.apIdx.push(0);
      }
    }
  }

  reset(): void {
    for (const c of this.combs) c.fill(0);
    for (const a of this.aps) a.fill(0);
    this.combLp.fill(0);
  }

  /** Returns wet stereo into out[0], out[1] (dry not included). */
  process(input: number, size: number, out: Float64Array): void {
    const fb = 0.7 + 0.25 * size;
    const damp = 0.35;
    const x = input * 0.12;
    for (let ch = 0; ch < 2; ch++) {
      let acc = 0;
      for (let c = 0; c < 4; c++) {
        const k = ch * 4 + c;
        const buf = this.combs[k];
        const i = this.combIdx[k];
        const y = buf[i];
        this.combLp[k] = y * (1 - damp) + this.combLp[k] * damp;
        buf[i] = x + this.combLp[k] * fb;
        this.combIdx[k] = i + 1 === this.combLen[k] ? 0 : i + 1;
        acc += y;
      }
      for (let a = 0; a < 2; a++) {
        const k = ch * 2 + a;
        const buf = this.aps[k];
        const i = this.apIdx[k];
        const b = buf[i];
        const y = -acc + b;
        buf[i] = acc + b * 0.5;
        this.apIdx[k] = i + 1 === this.apLen[k] ? 0 : i + 1;
        acc = y;
      }
      out[ch] = acc;
    }
  }
}

/**
 * Transparent look-ahead peak limiter (stereo-linked, always on).
 *
 * The gain applied to a sample is the box-car average of a sliding-window
 * minimum of the required gain, delayed so that the average can never exceed
 * the gain the sample itself needs. Recovery waits for a hold time longer than
 * a low bass period and then follows a slow release, so the gain doesn't
 * ripple within each waveform cycle (which would distort and create DC). Hold
 * and release only ever lower the gain, so the guarantee holds. A final clamp
 * catches floating-point residue.
 */
export class Limiter {
  readonly ceiling: number;
  readonly lookahead: number;
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

  constructor(fs: number, ceilingDb = -1, lookaheadMs = 1.5, releaseMs = 150, holdMs = 30) {
    this.ceiling = Math.pow(10, ceilingDb / 20);
    this.lookahead = Math.max(2, Math.round((lookaheadMs * fs) / 1000));
    const L = this.lookahead;
    this.delayL = new Float64Array(L);
    this.delayR = new Float64Array(L);
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
    this.box.fill(1);
    this.boxSum = this.lookahead;
    this.qHead = this.qTail = 0;
    this.gain = 1;
    this.holdCount = 0;
  }

  process(l: number, r: number, out: Float64Array): void {
    const L = this.lookahead;
    const peak = Math.max(Math.abs(l), Math.abs(r));
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

    // Delay the signal by L-1 samples so the gain is applied ahead of peaks.
    const dl = this.delayL[this.dPos];
    const dr = this.delayR[this.dPos];
    this.delayL[this.dPos] = l;
    this.delayR[this.dPos] = r;
    this.dPos = this.dPos + 1 === L - 1 ? 0 : this.dPos + 1;

    const c = this.ceiling;
    const yl = dl * this.gain;
    const yr = dr * this.gain;
    out[0] = yl > c ? c : yl < -c ? -c : yl;
    out[1] = yr > c ? c : yr < -c ? -c : yr;
  }
}
