// GRIND: the neuro-bass chain. Four stages between the oscillators and the drive / main filter,
// each a moving filter into its own drive (filter → drive → filter → drive …, the way the sound is
// built by stacking), run at the oversampled rate like the rest of the nonlinear section.
// Each stage's filter moves on its own, restarted by every note or wandering at random, at a rate
// in Hz (free, for life) or synced to the bar; the chain only ever sees what goes into the main filter (A / B), so the sub stays clean.

import { Biquad, Rng, Svf } from './dsp';
import * as K from './params';

const P = K.P;
const tanh = K.tanh, tanhIntegral = K.tanhIntegral, fuzz = K.fuzz, fuzzIntegral = K.fuzzIntegral;
const TUBE_BIAS = K.TUBE_BIAS, TUBE_OFFSET = K.TUBE_OFFSET, HALF_PI = K.HALF_PI;
const DIST_SOFT = K.DIST_SOFT, DIST_HARD = K.DIST_HARD, DIST_FOLD = K.DIST_FOLD, DIST_FUZZ = K.DIST_FUZZ;

export const GRIND_STAGES = 4;
/** grind<n>.filter option order. */
export const GF_NOTCH = 0, GF_PEAK = 1, GF_BAND = 2, GF_COMB = 3, GF_PHASER = 4;
/** grind<n>.move option order. */
export const GM_NOTE = 0, GM_WANDER = 1;
/** Beats per cycle when a stage's rate is synced (grind<n>.sync), by rate (0..1 in six steps). */
export const GRIND_BEATS = [4, 2, 1, 0.5, 0.25, 0.125];
export const GRIND_BEAT_NAMES = ['1 BAR', '1/2', '1/4', '1/8', '1/16', '1/32'];
/** A stage's rate in Hz (when not synced): 0.1 Hz … 25.6 Hz. */
export const grindHz = (rate: number): number => 0.1 * Math.pow(2, rate * 8);
export const grindBeat = (rate: number): number => Math.round(Math.min(1, Math.max(0, rate)) * 5);
/** The drive's gain for grind<n>.drive (0..1). */
export const grindGain = (drive: number): number => 1 + 29 * drive * drive;
const COMB_LEN = 4096;
const TWO_PI = 2 * Math.PI;

class Stage {
  on = false;
  ftype = GF_NOTCH;
  dtype = DIST_SOFT;
  // movement (control rate)
  phase = 0;
  wFrom = 0;
  wTo = 0;
  wPos = 0;
  wCycle = -1;
  /** Where the filter is right now (Hz), for the page; -1 while the stage is off. */
  fcNow = -1;
  // filter coefficients, stepped per sample over a control block
  g = 0.05;
  gStep = 0;
  k = 1;
  peak = 0;
  delay = 100;
  delayStep = 0;
  fb = 0;
  // drive
  driveOn = false;
  gain = 1;
  comp = 1;
  mix = 1;
  bias = 0;
  offset = 0;
  readonly svf = [new Svf(), new Svf()];
  readonly ap = new Float64Array(10); // 4 allpass states + the feedback, per channel
  readonly comb = [new Float32Array(COMB_LEN), new Float32Array(COMB_LEN)];
  readonly adaaU = new Float64Array(2);
  readonly adaaF = new Float64Array(2);

  curve(u: number): number {
    switch (this.dtype) {
      case DIST_SOFT: return tanh(u);
      case DIST_HARD: return u > 1 ? 1 : u < -1 ? -1 : u;
      case DIST_FOLD: return Math.sin(HALF_PI * u);
      case DIST_FUZZ: return fuzz(u + this.bias) - this.offset;
      default: return tanh(u + TUBE_BIAS) - TUBE_OFFSET;
    }
  }

  curveIntegral(u: number): number {
    switch (this.dtype) {
      case DIST_SOFT: return tanhIntegral(u);
      case DIST_HARD: return u > 1 ? u - 0.5 : u < -1 ? -u - 0.5 : 0.5 * u * u;
      case DIST_FOLD: return -Math.cos(HALF_PI * u) / HALF_PI;
      case DIST_FUZZ: return fuzzIntegral(u + this.bias) - this.offset * u;
      default: return tanhIntegral(u + TUBE_BIAS) - TUBE_OFFSET * u;
    }
  }

  /** The drive with first-order antiderivative anti-aliasing (as the main distortion). */
  shape(x: number, ch: number): number {
    const u = this.gain * x;
    const up = this.adaaU[ch];
    const fu = this.curveIntegral(u);
    const du = u - up;
    const y = Math.abs(du) > 1e-5 ? (fu - this.adaaF[ch]) / du : this.curve(0.5 * (u + up));
    this.adaaU[ch] = u;
    this.adaaF[ch] = fu;
    return y;
  }

  /** One sample of one channel through the filter. */
  filter(x: number, ch: number, g: number, pos: number): number {
    switch (this.ftype) {
      case GF_NOTCH: {
        const f = this.svf[ch];
        f.process(x, g, this.k);
        return f.lp + f.hp;
      }
      case GF_PEAK: {
        const f = this.svf[ch];
        f.process(x, g, this.k);
        return (x + this.peak * f.bp * this.k) / (1 + 0.35 * this.peak);
      }
      case GF_BAND: {
        const f = this.svf[ch];
        f.process(x, g, this.k);
        return f.bp * this.k * 1.6;
      }
      case GF_COMB: {
        const buf = this.comb[ch];
        let rp = pos - this.delay;
        if (rp < 0) rp += COMB_LEN;
        const i = Math.floor(rp), fr = rp - i;
        const d = buf[i] + (buf[(i + 1) & (COMB_LEN - 1)] - buf[i]) * fr;
        const y = x + this.fb * d;
        buf[pos] = y;
        return y * (1 - 0.55 * this.fb);
      }
      default: {
        // four first-order allpasses (TPT) with feedback, mixed with the dry: two moving notches
        const s = this.ap, o = ch * 5, G = g / (1 + g);
        let v = x + this.fb * s[o + 4];
        for (let j = 0; j < 4; j++) {
          const w = (v - s[o + j]) * G;
          const lp = w + s[o + j];
          s[o + j] = lp + w;
          v = 2 * lp - v;
        }
        s[o + 4] = v;
        return 0.5 * (x + v);
      }
    }
  }
}

/** One voice's GRIND chain (stereo). */
export class Grind {
  readonly stages = Array.from({ length: GRIND_STAGES }, () => new Stage());
  l = 0;
  r = 0;
  private combPos = 0;
  /** Below grind.lowcut the sound passes clean (a 24 dB/oct Linkwitz-Riley split); grind.mix blends the chain in. */
  private lcOn = false;
  private lastLc = -1;
  private mix = 1;
  private readonly split = Array.from({ length: 8 }, () => new Biquad()); // per channel: LP, LP, HP, HP
  private dcX = new Float64Array(2);
  private dcY = new Float64Array(2);
  private dcR = 0.999;

  constructor(rng: Rng) {
    for (const s of this.stages) {
      s.wFrom = rng.next();
      s.wTo = rng.next();
      s.wPos = 0.5 * (rng.next() + 1);
    }
  }

  /** A new note: movement that follows the note starts again. */
  noteOn(): void {
    for (const s of this.stages) s.phase = 0;
  }

  /** Clear the filters, delays and drives (a fresh note from silence). */
  reset(): void {
    for (const s of this.stages) {
      for (const f of s.svf) f.reset();
      s.ap.fill(0);
      s.comb[0].fill(0);
      s.comb[1].fill(0);
      s.adaaU.fill(0);
      s.adaaF.fill(0);
    }
    this.dcX.fill(0);
    this.dcY.fill(0);
    for (const f of this.split) f.reset();
  }

  /**
   * Control-rate update: movement and coefficients. `beatPos` is the bar position in beats (0..4),
   * `n` the oversampled samples until the next update.
   */
  control(cur: Float64Array, beatPos: number, fs: number, fsOs: number, n: number, rng: Rng): void {
    const dt = n / fsOs;
    this.dcR = 1 - (TWO_PI * 10) / fsOs;
    this.mix = cur[P.grindMix];
    const lc = cur[P.grindLowcut];
    if (lc !== this.lastLc) {
      this.lastLc = lc;
      this.lcOn = lc > 21;
      if (this.lcOn) for (let c = 0; c < 2; c++) for (let j = 0; j < 2; j++) {
        this.split[4 * c + j].setLowpass(Math.min(lc, fs * 0.45), Math.SQRT1_2, fsOs);
        this.split[4 * c + 2 + j].setHighpass(Math.min(lc, fs * 0.45), Math.SQRT1_2, fsOs);
      }
    }
    for (let i = 0; i < GRIND_STAGES; i++) {
      const s = this.stages[i], gp = P.grind[i];
      s.on = cur[gp.on] > 0.5;
      if (!s.on) {
        s.fcNow = -1;
        continue;
      }
      const rate = cur[gp.rate], wander = cur[gp.move] === GM_WANDER;
      let m: number;
      if (cur[gp.sync] > 0.5) {
        // synced: the cycle follows the synth's bar clock
        const p = beatPos / GRIND_BEATS[grindBeat(rate)], cycle = Math.floor(p), f = p - cycle;
        if (wander) {
          if (cycle !== s.wCycle) {
            s.wCycle = cycle;
            s.wFrom = s.wTo;
            s.wTo = rng.next();
          }
          m = s.wFrom + (s.wTo - s.wFrom) * (0.5 - 0.5 * Math.cos(Math.PI * f));
        } else m = Math.cos(TWO_PI * f);
      } else if (wander) {
        s.wPos += grindHz(rate) * dt;
        if (s.wPos >= 1) {
          s.wPos -= Math.floor(s.wPos);
          s.wFrom = s.wTo;
          s.wTo = rng.next();
        }
        m = s.wFrom + (s.wTo - s.wFrom) * (0.5 - 0.5 * Math.cos(Math.PI * s.wPos));
      } else {
        s.phase += grindHz(rate) * dt;
        if (s.phase >= 1) s.phase -= Math.floor(s.phase);
        m = Math.cos(TWO_PI * s.phase); // from the top at every note
      }
      const fc = Math.min(Math.max(cur[gp.freq] * Math.pow(2, 0.5 * cur[gp.range] * m), 20), fs * 0.45);
      s.fcNow = fc;
      const ftype = cur[gp.filter];
      if (ftype !== s.ftype) {
        s.ftype = ftype;
        for (const f of s.svf) f.reset();
          s.ap.fill(0);
      }
      const res = cur[gp.res];
      const gT = Math.tan((Math.PI * fc) / fsOs);
      s.gStep = (gT - s.g) / n;
      switch (ftype) {
        case GF_NOTCH: s.k = 1.6 * (1 - res) + 0.08; break;
        case GF_PEAK: s.k = 1.2 * (1 - res) + 0.15; s.peak = 1 + 5 * res; break;
        case GF_BAND: s.k = 1.4 * (1 - res) + 0.1; break;
        case GF_COMB: {
          const d = Math.min(fsOs / fc, COMB_LEN - 2);
          s.delayStep = (d - s.delay) / n;
          s.fb = 0.92 * res;
          break;
        }
        default: s.fb = 0.75 * res; // phaser
      }
      // Drive.
      const drive = cur[gp.drive];
      s.driveOn = drive > 0.001;
      s.mix = cur[gp.mix];
      s.gain = grindGain(drive);
      s.comp = 1 / (1 + 0.1 * (s.gain - 1));
      const dtype = cur[gp.dtype];
      const bias = dtype === DIST_FUZZ ? K.FUZZ_BIAS_REL * s.gain : 0;
      if (dtype !== s.dtype || bias !== s.bias) {
        s.dtype = dtype;
        s.bias = bias;
        s.offset = dtype === DIST_FUZZ ? fuzz(bias) : 0;
        s.adaaF[0] = s.curveIntegral(s.adaaU[0]);
        s.adaaF[1] = s.curveIntegral(s.adaaU[1]);
      }
    }
  }

  /** One stereo sample through the chain (at the rate control() was given), into l / r. */
  process(inL: number, inR: number): void {
    let lowL = 0, lowR = 0, l = inL, r = inR;
    if (this.lcOn) {
      const sp = this.split;
      lowL = sp[1].process(sp[0].process(inL));
      l = sp[3].process(sp[2].process(inL));
      lowR = sp[5].process(sp[4].process(inR));
      r = sp[7].process(sp[6].process(inR));
    }
    const hiL = l, hiR = r;
    const pos = this.combPos;
    for (let i = 0; i < GRIND_STAGES; i++) {
      const s = this.stages[i];
      if (!s.on) continue;
      s.g += s.gStep;
      if (s.ftype === GF_COMB) s.delay += s.delayStep;
      l = s.filter(l, 0, s.g, pos);
      r = s.filter(r, 1, s.g, pos);
      if (s.driveOn) {
        l += (s.shape(l, 0) * s.comp - l) * s.mix;
        r += (s.shape(r, 1) * s.comp - r) * s.mix;
      }
    }
    this.combPos = (pos + 1) & (COMB_LEN - 1);
    // the drives' lopsided curves leave DC behind: a gentle blocker on what the chain adds
    const dx = this.dcX, dy = this.dcY, R = this.dcR;
    dy[0] = l - dx[0] + R * dy[0];
    dx[0] = l;
    dy[1] = r - dx[1] + R * dy[1];
    dx[1] = r;
    const m = this.mix;
    this.l = lowL + hiL + (dy[0] - hiL) * m;
    this.r = lowR + hiR + (dy[1] - hiR) * m;
  }
}
