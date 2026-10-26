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
const SAT_OFFSET = Math.tanh(0.15);
// OTT: Ableton's OTT preset (low, mid, high band)
const OTT_ABOVE = [-33.8, -30.2, -35.5]; // dB, downward 1:66 over it
const OTT_BELOW = [-40.8, -41.8, -40.8]; // dB, upward 4.17:1 under it
const OTT_BAND_DB = [10.3, 5.7, 10.3];
const OTT_ATTACK = [0.0478, 0.0224, 0.0135];
const OTT_RELEASE = [0.282, 0.282, 0.132];
const OTT_MAX_UP = 36; // dB: the most a band is pulled up (the silence between notes stays silent)
/**
 * The synth's bus runs far below the full-scale levels Ableton's thresholds assume: the detector sees
 * it OTT_IN_DB hotter (an input gain on the detector only), and OTT_MAKEUP_DB after the bands makes
 * full Depth come out louder and denser, as OTT does.
 */
const OTT_IN_DB = 18;
const OTT_MAKEUP_DB = 15;
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
  /** Wander's second path: the resonance drifts too, at its own slower speed, so the two never line up. */
  rFrom = 0;
  rTo = 0;
  rPos = 0;
  resWander = 0;
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
  /** Level matching: followers of what goes into the drive and what comes out, so more drive is dirtier, not louder, at any input level. */
  inEnv = 0;
  outEnv = 0;
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
  /** In front of the stages: SAT (grind.sat, a level-matched tube-ish saturation) then PRE OTT (grind.preott). */
  private satAmt = 0;
  private satGain = 1;
  private readonly satU = new Float64Array(2);
  private readonly satF = new Float64Array(2);
  private satIn = 0;
  private satOut = 0;
  private readonly preOtt = new Ott(0, 0, true);
  private envK = 0.001;

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
    this.satU.fill(0);
    this.satF.fill(0);
    this.satIn = this.satOut = 0;
    this.preOtt.reset();
  }

  /**
   * Control-rate update: movement and coefficients. `beatPos` is the bar position in beats (0..4),
   * `bps` the tempo in beats per second, `keyOct` the note in octaves from C3 (for KEY), `n` the samples
   * until the next update.
   */
  control(cur: Float64Array, beatPos: number, bps: number, keyOct: number, fs: number, fsOs: number, n: number, rng: Rng): void {
    const dt = n / fsOs;
    this.dcR = 1 - (TWO_PI * 10) / fsOs;
    this.envK = 1 - Math.exp(-1 / (0.05 * fsOs));
    this.mix = cur[P.grindMix];
    this.satAmt = cur[P.grindSat];
    this.satGain = 1 + 24 * this.satAmt * this.satAmt;
    this.preOtt.set(cur[P.grindPreOtt], 20, fsOs);
    const lc = cur[P.grindLowcut];
    if (lc !== this.lastLc) {
      this.lastLc = lc;
      this.lcOn = lc > 21;
      if (this.lcOn) for (let c = 0; c < 2; c++) for (let j = 0; j < 2; j++) {
        this.split[4 * c + j].setLowpass(Math.min(lc, fs * 0.45), Math.SQRT1_2, fsOs);
        this.split[4 * c + 2 + j].setHighpass(Math.min(lc, fs * 0.45), Math.SQRT1_2, fsOs);
      }
    }
    // KEY: every stage follows the note (Freq is where it sits at C3); ONE SHOT: note movement sweeps once and holds
    const key = cur[P.grindKey] > 0.5 ? Math.pow(2, keyOct) : 1, oneShot = cur[P.grindOneShot] > 0.5;
    for (let i = 0; i < GRIND_STAGES; i++) {
      const s = this.stages[i], gp = P.grind[i];
      s.on = cur[gp.on] > 0.5;
      if (!s.on) {
        s.fcNow = -1;
        continue;
      }
      const rate = cur[gp.rate], wander = cur[gp.move] === GM_WANDER;
      let m: number;
      if (oneShot && !wander) {
        // an envelope, not an LFO: from the top of the range it falls fast, then settles at the bottom
        // and stays there until the next note; Rate sets how long the fall takes (its time = half a cycle)
        const hz = cur[gp.sync] > 0.5 ? bps / GRIND_BEATS[grindBeat(rate)] : grindHz(rate);
        s.phase += dt;
        m = -1 + 2 * Math.exp((-s.phase * 2 * hz) * 3);
      } else if (cur[gp.sync] > 0.5) {
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
      s.resWander = 0;
      if (wander) {
        s.rPos += grindHz(rate) * 0.61 * dt;
        if (s.rPos >= 1) {
          s.rPos -= Math.floor(s.rPos);
          s.rFrom = s.rTo;
          s.rTo = rng.next();
        }
        s.resWander = 0.25 * (s.rFrom + (s.rTo - s.rFrom) * (0.5 - 0.5 * Math.cos(Math.PI * s.rPos)));
      }
      const fc = Math.min(Math.max(cur[gp.freq] * key * Math.pow(2, 0.5 * cur[gp.range] * m), 20), fs * 0.45);
      s.fcNow = fc;
      const ftype = cur[gp.filter];
      if (ftype !== s.ftype) {
        s.ftype = ftype;
        for (const f of s.svf) f.reset();
          s.ap.fill(0);
      }
      const res = Math.min(1, Math.max(0, cur[gp.res] + s.resWander));
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
    if (this.satAmt > 0) {
      // ADAA tanh, slightly lopsided (warm even harmonics), level-matched by followers
      const g = this.satGain, u = this.satU, f = this.satF, k = this.envK;
      let sl = 0, sr = 0;
      for (let ch = 0; ch < 2; ch++) {
        const x = (ch ? r : l) * g + 0.15, up = u[ch], fx = tanhIntegral(x), du = x - up;
        const y = (Math.abs(du) > 1e-5 ? (fx - f[ch]) / du : tanh(0.5 * (x + up))) - SAT_OFFSET;
        u[ch] = x;
        f[ch] = fx;
        if (ch) sr = y;
        else sl = y;
      }
      this.satIn += (Math.abs(l) + Math.abs(r) - this.satIn) * k;
      this.satOut += (Math.abs(sl) + Math.abs(sr) - this.satOut) * k;
      const m = this.satOut > 1e-9 ? Math.min(2, this.satIn / this.satOut) : 1;
      l = sl * m;
      r = sr * m;
    }
    if (this.preOtt.on) {
      this.preOtt.process(l, r);
      l = this.preOtt.l;
      r = this.preOtt.r;
    }
    const pos = this.combPos;
    for (let i = 0; i < GRIND_STAGES; i++) {
      const s = this.stages[i];
      if (!s.on) continue;
      s.g += s.gStep;
      if (s.ftype === GF_COMB) s.delay += s.delayStep;
      l = s.filter(l, 0, s.g, pos);
      r = s.filter(r, 1, s.g, pos);
      if (s.driveOn) {
        const dl = s.shape(l, 0), dr = s.shape(r, 1), k = this.envK;
        s.inEnv += (Math.abs(l) + Math.abs(r) - s.inEnv) * k;
        s.outEnv += (Math.abs(dl) + Math.abs(dr) - s.outEnv) * k;
        const match = s.outEnv > 1e-9 ? Math.min(2, s.inEnv / s.outEnv) : 1;
        l += (dl * match - l) * s.mix;
        r += (dr * match - r) * s.mix;
      }
    }
    this.combPos = (pos + 1) & (COMB_LEN - 1);
    // the drives' lopsided curves leave DC behind: a gentle blocker on what the chain adds
    const dx = this.dcX, dy = this.dcY, R = this.dcR;
    dy[0] = l - dx[0] + R * dy[0];
    dx[0] = l;
    dy[1] = r - dx[1] + R * dy[1];
    dx[1] = r;
    const wl = dy[0], wr = dy[1];
    const m = this.mix;
    this.l = lowL + hiL + (wl - hiL) * m;
    this.r = lowR + hiR + (wr - hiR) * m;
  }
}

/**
 * GRIND's OTT (grind.ott), as Ableton's OTT preset / Xfer's OTT, on the whole synth after the amp
 * envelopes (the voices' sum and the noise bed, before the effects; the clean sub stays out): three
 * bands split at 88 Hz and 2.5 kHz, each squashed hard from above (1:66 over its upper threshold) and
 * pulled up hard from below (4.17:1 under its lower one), with the preset's band gains and attack /
 * release times. The knob is Depth (dry / wet; the dry is the same bands summed, so no phasing).
 * Below GRIND's Lo cut the sound passes clean.
 */
export class Ott {
  l = 0;
  r = 0;
  private amt = 0;
  private fs = 0;
  private lcOn = false;
  private lastLc = -1;
  private readonly split = Array.from({ length: 8 }, () => new Biquad());
  private readonly x = Array.from({ length: 16 }, () => new Biquad()); // per channel: LP1 ×2, HP1 ×2, LP2 ×2, HP2 ×2
  private readonly env = new Float64Array(3);
  private readonly gain = new Float64Array(3).fill(1);
  private readonly bd = new Float64Array(6);
  private readonly atk = new Float64Array(3);
  private readonly rel = new Float64Array(3);
  private tick = 0;
  private inLvl = 0;
  private outLvl = 0;
  private lvlK = 0;

  /**
   * `inDb`: how much hotter the detector sees the signal than it is (the thresholds assume full-scale
   * material); `makeupDb` after the bands; `match`: hold the output at the input's level (a tone and
   * density tool, as GRIND's PRE OTT in front of the stages).
   */
  constructor(private readonly inDb = OTT_IN_DB, private readonly makeupDb = OTT_MAKEUP_DB, private readonly match = false) {}

  get on(): boolean {
    return this.amt > 0;
  }

  /** Control rate: Depth (0 = off) and the Lo cut. */
  set(depth: number, lowcut: number, fs: number): void {
    if (depth > 0 && this.amt === 0) this.reset();
    this.amt = depth;
    if (depth <= 0) return;
    if (fs !== this.fs) {
      this.fs = fs;
      this.lastLc = -1;
      for (let c = 0; c < 2; c++) for (let j = 0; j < 2; j++) {
        const o = 8 * c;
        this.x[o + j].setLowpass(88, Math.SQRT1_2, fs);
        this.x[o + 2 + j].setHighpass(88, Math.SQRT1_2, fs);
        this.x[o + 4 + j].setLowpass(2500, Math.SQRT1_2, fs);
        this.x[o + 6 + j].setHighpass(2500, Math.SQRT1_2, fs);
      }
      this.lvlK = 1 - Math.exp(-1 / (0.3 * fs));
      for (let b = 0; b < 3; b++) {
        this.atk[b] = 1 - Math.exp(-1 / (OTT_ATTACK[b] * fs));
        this.rel[b] = 1 - Math.exp(-1 / (OTT_RELEASE[b] * fs));
      }
    }
    if (lowcut !== this.lastLc) {
      this.lastLc = lowcut;
      this.lcOn = lowcut > 21;
      if (this.lcOn) for (let c = 0; c < 2; c++) for (let j = 0; j < 2; j++) {
        this.split[4 * c + j].setLowpass(Math.min(lowcut, fs * 0.45), Math.SQRT1_2, fs);
        this.split[4 * c + 2 + j].setHighpass(Math.min(lowcut, fs * 0.45), Math.SQRT1_2, fs);
      }
    }
  }

  reset(): void {
    for (const f of this.x) f.reset();
    for (const f of this.split) f.reset();
    this.env.fill(0);
    this.gain.fill(1);
    this.inLvl = this.outLvl = 0;
  }

  /** One stereo sample, into l / r. */
  process(inL: number, inR: number): void {
    let lowL = 0, lowR = 0, l = inL, r = inR;
    if (this.lcOn) {
      const sp = this.split;
      lowL = sp[1].process(sp[0].process(inL));
      l = sp[3].process(sp[2].process(inL));
      lowR = sp[5].process(sp[4].process(inR));
      r = sp[7].process(sp[6].process(inR));
    }
    const x = this.x, bd = this.bd;
    const rest0 = x[3].process(x[2].process(l)), rest1 = x[11].process(x[10].process(r));
    bd[0] = x[1].process(x[0].process(l));
    bd[1] = x[5].process(x[4].process(rest0));
    bd[2] = x[7].process(x[6].process(rest0));
    bd[3] = x[9].process(x[8].process(r));
    bd[4] = x[13].process(x[12].process(rest1));
    bd[5] = x[15].process(x[14].process(rest1));
    const env = this.env, gain = this.gain, recompute = (this.tick = (this.tick + 1) & 3) === 0;
    let ol = 0, or = 0;
    for (let b = 0; b < 3; b++) {
      const a = Math.max(Math.abs(bd[b]), Math.abs(bd[b + 3]));
      env[b] += (a - env[b]) * (a > env[b] ? this.atk[b] : this.rel[b]);
      if (recompute) {
        const lvl = 20 * Math.log10(env[b] + 1e-9) + this.inDb;
        let g = 0;
        if (lvl > OTT_ABOVE[b]) g = (OTT_ABOVE[b] - lvl) * (1 - 1 / 66);
        else if (lvl < OTT_BELOW[b] && lvl > -90) g = Math.min(OTT_MAX_UP, (OTT_BELOW[b] - lvl) * (1 - 1 / 4.17));
        gain[b] = Math.pow(10, (g + OTT_BAND_DB[b] + this.makeupDb) / 20);
      }
      ol += bd[b] * gain[b];
      or += bd[b + 3] * gain[b];
    }
    const dl = bd[0] + bd[1] + bd[2], dr = bd[3] + bd[4] + bd[5], d = this.amt;
    if (this.match) {
      const k = this.lvlK;
      this.inLvl += (Math.abs(dl) + Math.abs(dr) - this.inLvl) * k;
      this.outLvl += (Math.abs(ol) + Math.abs(or) - this.outLvl) * k;
      const m = this.outLvl > 1e-9 ? Math.min(4, this.inLvl / this.outLvl) : 1;
      ol *= m;
      or *= m;
    }
    this.l = lowL + dl + (ol - dl) * d;
    this.r = lowR + dr + (or - dr) * d;
  }
}
