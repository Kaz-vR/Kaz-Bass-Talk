// GRIND: the neuro-bass chain. Four stages between the oscillators and the drive / main filter,
// each a moving filter into its own drive (filter → drive → filter → drive …, the way the sound is
// built by stacking), run at the oversampled rate like the rest of the nonlinear section.
// Each stage's filter moves on its own: a swing restarted by every note (HZ, SYNC) or wandering at random (RANDOM), at a rate
// in Hz (free, for life) or synced to the bar; the chain only ever sees what goes into the main filter (A / B), so the sub stays clean.

import { Biquad, Rng, Svf } from './dsp';
import * as K from './params';

const P = K.P;
const tanh = K.tanh, tanhIntegral = K.tanhIntegral;
const TUBE_BIAS = K.TUBE_BIAS, TUBE_OFFSET = K.TUBE_OFFSET;

export const GRIND_STAGES = 8;
/** The RUIN page's eight boxes: each holds one of the eight filters, drives or EQs, or nothing (grind.slot1..8). */
export const GRIND_SLOTS = 8;
/** grind<n>.filter option order. */
export const GF_NOTCH = 0, GF_PEAK = 1, GF_BAND = 2, GF_COMB = 3, GF_PHASER = 4, GF_BELLS = 5;
/**
 * BELLS (owner's call): the filter as an EQ, four bells (EQ Eight's bell: everything away from it stays at 0 dB),
 * each with its own Freq, Gain and Q and its own range to move in. The box's Rate and clock move all four, each on
 * its own path (HZ / SYNC: a quarter cycle apart; RANDOM: each wanders on its own), so they never move in lockstep.
 */
export const GRIND_BELLS = 4;
/**
 * The PHASER part (owner's call, a fourth kind in RUIN's boxes, slots 25-32): NOTCHES notches, each a second-order
 * all-pass (an SVF: x - 2k·bp) at its own frequency, CENTER ± SPREAD octaves apart, all swept together by AMOUNT
 * octaves on the part's own LFO (HZ free running, SYNC on the bar, RANDOM wandering), the right channel STEREO
 * degrees ahead; the all-passes summed with the dry make the notches, FEEDBACK sharpens them and rings between.
 */
export const PH_MAX = 12;
const PH_K = 1 / 1.1; // the all-passes' 1/Q: notches about a third of an octave wide
/** The page reads each phaser's left and right LFO (-1..1) packed into one live value. */
export const packPhaser = (l: number, r: number): number => Math.round((l + 1) * 127.5) + 256 * Math.round((r + 1) * 127.5);
export const unpackPhaser = (v: number): [number, number] => {
  const x = Math.max(0, Math.round(v));
  return [(x & 255) / 127.5 - 1, ((x >> 8) & 255) / 127.5 - 1];
};
/**
 * A bell's type (grind<n>.bell<b>_type, owner's call: EQ Eight's eight): low cut 48 / 12 dB, low shelf, bell, notch,
 * high shelf, high cut 12 / 48 dB. One SVF per bell, its output mixed (c0·x + c1·bp + c2·lp + c3·hp, the shelves after
 * Simper), four in a row for the 48 dB cuts (Butterworth, the last section's Q times the bell's Q / 0.71).
 */
export const BT_LC48 = 0, BT_LC12 = 1, BT_LS = 2, BT_BELL = 3, BT_NOTCH = 4, BT_HS = 5, BT_HC12 = 6, BT_HC48 = 7;
/** The old filters back as band types (owner's call): band, comb (Gain = feedback, minus = hollow), phaser (Q = feedback). */
export const BT_BAND = 8, BT_COMB = 9, BT_PHASER = 10;
/** A band's direction (`grind<n>.bell<k>_dir`): left right, up down, cross. */
export const BD_LR = 0, BD_UD = 1, BD_CROSS = 2;
/**
 * CROSS (owner's call, 27 Nov: one path for both made it move only on the diagonal): the band's one position t (0..1)
 * runs along a curve through all four corners, its frequency 1.5 cycles across (0.5 - 0.5 cos 3πt) and its gain one
 * (0.5 + 0.5 sin 2πt), so random wanders the whole square; t = 0.5 is the middle. The page draws the same curve.
 */
export const crossX = (t: number): number => 0.5 - 0.5 * Math.cos(3 * Math.PI * t);
export const crossY = (t: number): number => 0.5 + 0.5 * Math.sin(2 * Math.PI * t);
const BW8_Q = [0.5098, 0.6013, 0.9, 2.5629];
/** Where the page reads the bells' positions: the live value carries bell 1's Hz, the second packs bells 2-4. */
export const packBells = (m1: number, m2: number, m3: number): number =>
  Math.round(255 * m1) + 256 * Math.round(255 * m2) + 65536 * Math.round(255 * m3);
export const unpackBells = (v: number): [number, number, number] => {
  const x = Math.max(0, Math.round(v));
  return [(x & 255) / 255, ((x >> 8) & 255) / 255, ((x >> 16) & 255) / 255];
};
/** grind<n>.clock option order. */
export const GC_HZ = 0, GC_SYNC = 1, GC_RANDOM = 2;
/** A random speed for the RANDOM clock: ×0.35 … ×2.8 of Rate. */
/** One-pole smoothing per (oversampled) sample for each box's level: about 5 ms. */
const LV_SMOOTH = 0.002;
/** The filter's movement zone stays inside 20 Hz-20 kHz (log2). */
const GZ_LO = Math.log2(20), GZ_HI = Math.log2(20000);
const randomSpeed = (rng: Rng): number => Math.pow(2, 1.5 * rng.next());
/** Beats per cycle when a stage's rate is synced (grind<n>.sync), by rate (0..1 in six steps). */
export const GRIND_BEATS = [4, 2, 1, 0.5, 0.25, 0.125];
export const GRIND_BEAT_NAMES = ['1 BAR', '1/2', '1/4', '1/8', '1/16', '1/32'];
/** A stage's rate in Hz (when not synced): 0.1 Hz … 25.6 Hz. */
export const grindHz = (rate: number): number => 0.1 * Math.pow(2, rate * 8);
export const grindBeat = (rate: number): number => Math.round(Math.min(1, Math.max(0, rate)) * 5);
/**
 * grind<n>.drive_type / dist.type option order (owner's call, 27 Nov: the drive types rebuilt in five groups, each
 * loading on its own band): SUB & BASS transformer, soft clipper, hard clipper; LOW-MIDS triode, overdrive; UPPER-MIDS
 * transistor, pentode, distortion, amp, wavefolder, rectifier; HIGHS exciter, bitcrusher, downsampler; FULL tape,
 * console, fuzz.
 */
export const GD_TRANS = 0, GD_SOFT = 1, GD_HARD = 2, GD_TRIODE = 3, GD_OD = 4, GD_TRANSISTOR = 5, GD_PENTODE = 6, GD_DIST = 7, GD_AMP = 8,
  GD_FOLD = 9, GD_RECT = 10, GD_EXCITER = 11, GD_CRUSH = 12, GD_DOWN = 13, GD_TAPE = 14, GD_CONSOLE = 15, GD_FUZZ = 16;
/** Per type: how much hotter it is driven, the high-pass in front of the curve (Hz, 0 none) and the low-pass after it (Hz, 0 none). */
const TYPE_GAIN = [1, 1, 1, 1, 2, 1.5, 1.2, 4, 3, 1, 1, 1, 1, 1, 1, 0.5, 8];
const TYPE_TIGHT = [0, 0, 0, 0, 150, 200, 0, 100, 90, 0, 0, 0, 0, 0, 0, 0, 60];
const TYPE_LOSS = [0, 0, 0, 9000, 5000, 0, 12000, 7000, 0, 0, 0, 0, 0, 0, 11000, 0, 8000];
const DC_HZ = 15; // the DC blocker after every curve (the lopsided ones leave DC behind)
/** transformer: the lows pushed into the core harder (+8 dB under ~200 Hz) and taken back after, a lopsided soft curve. */
const TRANS_EMPH = 1.5, TRANS_EMPH_HZ = 200, TRANS_BIAS = 0.12;
const CONSOLE_BIAS = 0.03;
/** overdrive / fuzz: the negative side clips earlier (lopsided, the even harmonics' growl). */
const OD_NEG = 0.6, FUZZ_NEG = 0.45;
/** transistor: clean up to the knee, then a fast, hard bend. */
const TR_KNEE = 0.7, TR_SOFT = 0.3;
/** pentode: steeper than the triode and less lopsided (more odd harmonics, a sharper edge). */
const PEN_K = 1.8, PEN_B = 0.15;
const PEN_OFF = K.tanh(PEN_K * PEN_B), PEN_IOFF = K.tanhIntegral(PEN_K * PEN_B);
/** The antiderivatives below are taken from 0 (tanhIntegral(0) is not 0), so curves joined at 0 stay continuous. */
const TI0 = K.tanhIntegral(0);
/** The peak filter's height at full Depth (x 6 = about +17 dB at its centre). */
const PEAK_GAIN = 6;
/**
 * The drive's gain for grind<n>.drive (0..1): 0 … +30 dB, even across the knob. It works on the stage's
 * input brought to a reference level (DRIVE_REF, by a follower), so Drive means the same dirt whether a
 * loud saw or only a quiet band out of the filter arrives; the output is matched back to the input's level.
 */
export const grindGain = (drive: number): number => Math.pow(10, 1.5 * drive);
// tape: highs pushed into the curve harder (pre-emphasis, +9.5 dB above ~3 kHz) and taken back after,
// a soft knee, a little high-frequency loss
const TAPE_EMPH = 2;
const TAPE_EMPH_HZ = 3000;
const TAPE_BIAS = 0.08;
const TAPE_OFFSET = TAPE_BIAS / Math.sqrt(1 + TAPE_BIAS * TAPE_BIAS);
const TRANS_OFFSET = TRANS_BIAS / Math.sqrt(1 + TRANS_BIAS * TRANS_BIAS);
const CONSOLE_OFFSET = CONSOLE_BIAS / Math.sqrt(1 + CONSOLE_BIAS * CONSOLE_BIAS);
/** An algebraic soft curve (x / sqrt(1 + x²)) shifted by `b`, offset so 0 stays 0; and its antiderivative. */
const algC = (u: number, b: number, off: number): number => { const v = u + b; return v / Math.sqrt(1 + v * v) - off; };
const algI = (u: number, b: number, off: number): number => { const v = u + b; return Math.sqrt(1 + v * v) - off * u; };
/** tanh with its negative side clipping at `n` (slope 1 through 0); and its antiderivative. */
const asymC = (u: number, n: number): number => (u >= 0 ? tanh(u) : n * tanh(u / n));
const asymI = (u: number, n: number): number => (u >= 0 ? tanhIntegral(u) - TI0 : n * n * (tanhIntegral(u / n) - TI0));
// tube: the lopsided tanh (even harmonics), an output transformer's soft top
// amp: tightened input, a hot asymmetric preamp, a 4x12 speaker cab heard through a close mic, then the room
const AMP_GAIN = 3;
const AMP_BIAS = 0.3;
const AMP_OFFSET = K.tanh(AMP_BIAS);
const AMP_TIGHT_HZ = 90;
const ROOM_LEN = 8192;
const ROOM_MS = [6.3, 11.9, 18.7, 27.1, 7.7, 13.4, 21.2, 29.5]; // left taps, right taps
const ROOM_GAIN = [0.3, 0.21, 0.15, 0.1];
const ROOM_TONE_HZ = 3500;
const COMB_LEN = 4096;
// OTT (low, mid, high band): Ableton's OTT preset's ratios, its thresholds, band gains and times fitted to Xfer's OTT
// (owner's call, 27 Nov, measured with tools/ref-host and tools/ott-ref.ts: tones stepped -60 .. 0 dBFS through each
// band, within ~1.5 dB; level steps, its attacks 4x and releases 4x faster than the Ableton preset's)
// (exported, and so writable, only so tools/ott-ref.ts can try values; nothing at runtime writes them)
export const OTT_ABOVE = [-38.0, -36.5, -41.0]; // dB, downward 1:66 over it
export const OTT_BELOW = [-46.0, -44.5, -45.2]; // dB, upward 4.17:1 under it
export const OTT_BAND_DB = [12.4, 11.2, 13.9];
export const OTT_ATTACK = [0.012, 0.0056, 0.0034];
export const OTT_RELEASE = [0.07, 0.07, 0.033];
const OTT_MAX_UP = 36; // dB: the most a band is pulled up (the silence between notes stays silent)
/**
 * The synth's bus runs far below the full-scale levels Ableton's thresholds assume: the detector sees
 * it OTT_IN_DB hotter (an input gain on the detector only), and OTT_MAKEUP_DB after the bands makes
 * full Depth come out louder and denser, as OTT does.
 */
const OTT_IN_DB = 18;
const OTT_MAKEUP_DB = 15;
const TWO_PI = 2 * Math.PI;

/**
 * The amp's speaker side on its own, for the FX page's distortion (`dist.type` amp): the tightened input
 * before the preamp, then the 4x12 cab through a close mic and a small room after it (as a RUIN stage's amp).
 */
export class AmpCab {
  private readonly tight = [new Biquad(), new Biquad()];
  private readonly cab = Array.from({ length: 10 }, () => new Biquad());
  private readonly room = [new Float32Array(ROOM_LEN), new Float32Array(ROOM_LEN)];
  private readonly roomLp = new Float64Array(2);
  private readonly roomTap = new Float64Array(8);
  private roomPos = 0;
  private roomK = 0;
  fs = 0;

  setFs(fs: number): void {
    this.fs = fs;
    this.roomK = 1 - Math.exp((-2 * Math.PI * ROOM_TONE_HZ) / fs);
    for (let ch = 0; ch < 2; ch++) {
      this.tight[ch].setHighpass(AMP_TIGHT_HZ, 0.7, fs);
      const c = this.cab, o = 5 * ch;
      c[o].setHighpass(55, 0.8, fs);
      c[o + 1].setPeak(110, 3, 1.2, fs);
      c[o + 2].setPeak(450, -4, 0.9, fs);
      c[o + 3].setPeak(2400, 5, 1.3, fs);
      c[o + 4].setLowpass(Math.min(5200, 0.45 * fs), 0.9, fs);
      for (let j = 0; j < 4; j++) this.roomTap[4 * ch + j] = Math.min(ROOM_LEN - 2, (ROOM_MS[4 * ch + j] / 1000) * fs);
    }
  }

  pre(x: number, ch: number): number {
    return this.tight[ch].process(x);
  }

  post(y: number, ch: number): number {
    const c = this.cab, o = 5 * ch;
    y = c[o + 4].process(c[o + 3].process(c[o + 2].process(c[o + 1].process(c[o].process(y)))));
    this.roomLp[ch] += (y - this.roomLp[ch]) * this.roomK;
    const buf = this.room[ch], pos = this.roomPos;
    buf[pos] = this.roomLp[ch];
    let r = 0;
    for (let j = 0; j < 4; j++) {
      let rp = pos - this.roomTap[4 * ch + j];
      if (rp < 0) rp += ROOM_LEN;
      const i = Math.floor(rp), fr = rp - i;
      r += ROOM_GAIN[j] * (buf[i] + (buf[(i + 1) & (ROOM_LEN - 1)] - buf[i]) * fr);
    }
    if (ch === 1) this.roomPos = (pos + 1) & (ROOM_LEN - 1);
    return y + r;
  }
}

/** The preamp curve of the amp (shared with the FX distortion): AMP_GAIN hotter, lopsided. */
export const ampCurve = (u: number): number => tanh(AMP_GAIN * u + AMP_BIAS) - AMP_OFFSET;
export const ampCurveIntegral = (u: number): number => tanhIntegral(AMP_GAIN * u + AMP_BIAS) / AMP_GAIN - AMP_OFFSET * u;

class Stage {
  /** OTT TYPE 1 (owner's call, 27 Nov): each box's own OTT, after its level, all set by grind.ott_box: filter, drive, EQ, phaser. */
  readonly otts = [new Ott(), new Ott(), new Ott(), new Ott()];
  /**
   * Each box's second OTT, after OTT BOXES': OTT DRIVES on the drive box, OTT FILTERS on the filter, EQ and phaser boxes
   * (owner's calls, 27 Nov; grind.ott_drives / grind.ott_filters), by box kind.
   */
  readonly ottX = [new Ott(), new Ott(), new Ott(), new Ott()];
  on = false;
  ftype = GF_NOTCH;
  dtype = GD_TAPE;
  // movement (control rate)
  phase = 0;
  wFrom = 0;
  wTo = 0;
  wPos = 0;
  /** Wander's second path: the resonance drifts too, at its own slower speed, so the two never line up. */
  /** RANDOM clock: this cycle's speed for the sweep and for the depth (× Rate). */
  spd = 1;
  /** DEPTH (owner's call): how much of the filter is heard, 0 = a straight line (no effect), 1 = all of it. */
  depth = 1;
  /** PHASER: on, its notches' all-passes per channel (stepped coefficient), feedback, level, LFO and its live L / R. */
  phOn = false;
  phN = 4;
  phFb = 0;
  phLvT = 1;
  phLv = 1;
  phPh = 0;
  readonly phSvf = Array.from({ length: 2 * PH_MAX }, () => new Svf());
  readonly phG = new Float64Array(2 * PH_MAX).fill(0.05);
  readonly phGStep = new Float64Array(2 * PH_MAX);
  readonly phFbS = new Float64Array(2);
  /** RANDOM: a wander per channel (from, to, position, speed). */
  readonly phW = Float64Array.from([0.3, 0.7, 0, 1, 0.6, 0.2, 0.5, 1]);
  readonly phM = new Float64Array(2);
  phLive = -1;

  /** One sample of one channel through the phaser: the notches' all-passes with feedback, summed with the dry. */
  phaser(x: number, ch: number): number {
    const o = ch * PH_MAX, fb = this.phFb;
    let v = x + fb * this.phFbS[ch];
    for (let k = 0; k < this.phN; k++) {
      const f = this.phSvf[o + k];
      f.process(v, this.phG[o + k], PH_K);
      v -= 2 * PH_K * f.bp;
    }
    this.phFbS[ch] = v;
    // dry + all-passes: 0 dB away from the notches, the feedback's peaks scaled back to 0 dB
    return ((1 - fb) / (2 - fb)) * (x + v);
  }
  /** BELLS: per bell its filter (per channel), coefficient (stepped per sample), 1/Q and gain - 1. */
  readonly bSvf = Array.from({ length: 2 * GRIND_BELLS * 4 }, () => new Svf());
  /** Per bell: its type, its four sections' 1/Q (the 48 dB cuts) and its output mix c0..c3. */
  readonly bT = new Int8Array(GRIND_BELLS).fill(BT_BELL);
  readonly bK4 = new Float64Array(4 * GRIND_BELLS).fill(1);
  readonly bC = new Float64Array(4 * GRIND_BELLS);
  /** How many bands are used (grind<n>.bell_count); per band its comb delay and feedback, its phaser's all-passes. */
  bN = GRIND_BELLS;
  readonly bComb = Array.from({ length: 2 * GRIND_BELLS }, () => new Float32Array(COMB_LEN));
  readonly bDelay = new Float64Array(GRIND_BELLS).fill(100);
  readonly bDelayStep = new Float64Array(GRIND_BELLS);
  readonly bFb = new Float64Array(GRIND_BELLS);
  readonly bAp = new Float64Array(2 * GRIND_BELLS * 5);
  readonly bG = new Float64Array(GRIND_BELLS).fill(0.05);
  readonly bGStep = new Float64Array(GRIND_BELLS);
  readonly bK = new Float64Array(GRIND_BELLS).fill(1);
  /** Bells 2-4's own wander (bell 1 uses the stage's), and where each bell sits in its range (0..1, for the page). */
  readonly bFrom = Float64Array.from([0, 0.2, 0.8, 0.45]);
  readonly bTo = Float64Array.from([0, 0.7, 0.3, 0.95]);
  readonly bPos = Float64Array.from([0, 0.33, 0.66, 0.15]);
  readonly bSpd = Float64Array.from([1, 0.8, 1.25, 0.95]);
  readonly bM = new Float64Array(GRIND_BELLS);
  /** Each box's level (owner's call): the handle on its meter; target and smoothed gain, filter and drive. */
  fLvT = 1;
  fLv = 1;
  dLvT = 1;
  dLv = 1;
  /** Where the filter is right now (Hz), for the page; -1 while the stage is off. */
  fcNow = -1;
  resNow = 0;
  // filter coefficients, stepped per sample over a control block
  g = 0.05;
  gStep = 0;
  k = 1;
  peak = 0;
  delay = 100;
  delayStep = 0;
  fb = 0;
  /** The filter and the drive each switch off on their own (grind<n>.filter_on / drive_on). */
  filterOn = true;
  // drive
  driveOn = false;
  gain = 1;
  /** The drive's gain to glide to (it moves with an LFO, so it never steps). */
  gainT = 1;
  /** Level matching: followers of what goes into the drive and what comes out, so more drive is dirtier, not louder, at any input level. */
  inEnv = 0;
  outEnv = 0;
  mix = 1;
  /** Drive colour stages (per channel): tape emphasis / de-emphasis and loss, tube loss, amp tightening, cab and room. */
  readonly pre = new Float64Array(2);
  readonly post = new Float64Array(2);
  readonly loss = new Float64Array(2);
  readonly roomLp = new Float64Array(2);
  readonly tight = [new Biquad(), new Biquad()];
  /** The drive's band (as Ableton's Overdrive): a high-pass and a low-pass per channel in front of it. */
  /**
   * The drive's band (owner's call: like a multiband plugin, not Overdrive): a 24 dB/oct Linkwitz-Riley split into
   * below / the band / above; only the band is driven, below and above pass untouched and are added back, so
   * driving the top never loses the bottom. Per channel: low LP x2, low HP x2, high LP x2, high HP x2.
   */
  readonly bandX = Array.from({ length: 16 }, () => new Biquad());
  /** The EQ part (owner's call): the FX page's four-band EQ, static; bands at 0 dB are skipped. */
  eqOn = false;
  readonly eqL = Array.from({ length: 4 }, () => new Biquad());
  readonly eqR = Array.from({ length: 4 }, () => new Biquad());
  readonly eqBand = new Uint8Array(4);
  readonly eqLast = new Float64Array(16).fill(NaN);
  eqLvT = 1;
  eqLv = 1;
  bandOn = false;
  bandLoOn = false;
  bandHiOn = false;
  bandKey = NaN;
  /** What passed around the band this sample, per channel (added back after the drive). */
  readonly rest = new Float64Array(2);

  /** Set the band: centre Hz and width in octaves (9 = the whole sound, no split). */
  setBand(bandHz: number, bandOct: number, fs: number, fsOs: number): void {
    const bk = bandHz * 31 + bandOct + fsOs * 1e-9;
    if (bk === this.bandKey) return;
    this.bandKey = bk;
    this.bandOn = bandOct < 8.95;
    if (!this.bandOn) return;
    const lo = bandHz * Math.pow(2, -bandOct / 2), hi = bandHz * Math.pow(2, bandOct / 2);
    this.bandLoOn = lo > 20;
    this.bandHiOn = hi < 0.45 * fs;
    const q = Math.SQRT1_2;
    for (let c = 0; c < 2; c++) {
      const f = this.bandX, o = 8 * c;
      if (this.bandLoOn) {
        f[o].setLowpass(lo, q, fsOs);
        f[o + 1].setLowpass(lo, q, fsOs);
        f[o + 2].setHighpass(lo, q, fsOs);
        f[o + 3].setHighpass(lo, q, fsOs);
      }
      if (this.bandHiOn) {
        f[o + 4].setLowpass(hi, q, fsOs);
        f[o + 5].setLowpass(hi, q, fsOs);
        f[o + 6].setHighpass(hi, q, fsOs);
        f[o + 7].setHighpass(hi, q, fsOs);
      }
    }
  }

  /** Split one sample: returns the band (what gets driven); what lies below and above goes to rest[ch]. */
  split(x: number, ch: number): number {
    if (!this.bandOn) {
      this.rest[ch] = 0;
      return x;
    }
    const f = this.bandX, o = 8 * ch;
    let low = 0, mid = x, high = 0;
    if (this.bandLoOn) {
      low = f[o + 1].process(f[o].process(x));
      mid = f[o + 3].process(f[o + 2].process(x));
    }
    if (this.bandHiOn) {
      high = f[o + 7].process(f[o + 6].process(mid));
      mid = f[o + 5].process(f[o + 4].process(mid));
    }
    this.rest[ch] = low + high;
    return mid;
  }
  /** Tone after the distortion (one-pole low-pass; fully up = open) and the fast level followers for Dynamics. */
  readonly toneLp = new Float64Array(2);
  toneK = 1;
  dyn = 0.5;
  inSlow = 0;
  outSlow = 0;
  inFast = 0;
  outFast = 0;
  readonly cab = Array.from({ length: 10 }, () => new Biquad()); // 5 per channel
  readonly room = [new Float32Array(ROOM_LEN), new Float32Array(ROOM_LEN)];
  readonly roomTap = new Float64Array(8);
  roomPos = 0;
  emphK = 0;
  lossK = 0;
  roomK = 0;
  colourFs = 0;
  readonly svf = [new Svf(), new Svf()];
  readonly ap = new Float64Array(10); // 4 allpass states + the feedback, per channel
  readonly comb = [new Float32Array(COMB_LEN), new Float32Array(COMB_LEN)];
  readonly adaaU = new Float64Array(2);
  readonly adaaF = new Float64Array(2);
  /** downsample: the held sample and how long it still holds, per channel */
  readonly dsHold = new Float64Array(2);
  readonly dsLeft = new Float64Array(2);
  dcK = 0;
  /** An offset into the curve and the curve's value there (taken off so silence stays silent); 0 on every type now. */
  bias = 0;
  biasOff = 0;
  private readonly dcS = new Float64Array(2);

  curve(u: number): number {
    switch (this.dtype) {
      case GD_TRANS: return algC(u, TRANS_BIAS, TRANS_OFFSET);
      case GD_SOFT: return u > 1 ? 1 : u < -1 ? -1 : 1.5 * u - 0.5 * u * u * u;
      case GD_HARD: return u > 1 ? 1 : u < -1 ? -1 : u;
      case GD_OD: return asymC(u, OD_NEG);
      case GD_TRANSISTOR: { const a = Math.abs(u); return a <= TR_KNEE ? u : Math.sign(u) * (TR_KNEE + TR_SOFT * tanh((a - TR_KNEE) / TR_SOFT)); }
      case GD_PENTODE: return tanh(PEN_K * (u + PEN_B)) - PEN_OFF;
      case GD_DIST: return tanh(u);
      case GD_AMP: return tanh(u + AMP_BIAS) - AMP_OFFSET;
      case GD_FOLD: return Math.sin(u);
      case GD_RECT: return Math.abs(tanh(u));
      case GD_EXCITER: { const t = tanh(u); return 0.6 * t + 0.4 * Math.abs(t); }
      case GD_TAPE: return algC(u, TAPE_BIAS, TAPE_OFFSET);
      case GD_CONSOLE: return algC(u, CONSOLE_BIAS, CONSOLE_OFFSET);
      case GD_FUZZ: return asymC(u, FUZZ_NEG);
      default: return tanh(u + TUBE_BIAS) - TUBE_OFFSET; // triode
    }
  }

  curveIntegral(u: number): number {
    switch (this.dtype) {
      case GD_TRANS: return algI(u, TRANS_BIAS, TRANS_OFFSET);
      case GD_SOFT: { if (u > 1) return u - 0.375; if (u < -1) return -u - 0.375; const u2 = u * u; return 0.75 * u2 - 0.125 * u2 * u2; }
      case GD_HARD: return u > 1 ? u - 0.5 : u < -1 ? -u - 0.5 : 0.5 * u * u;
      case GD_OD: return asymI(u, OD_NEG);
      case GD_TRANSISTOR: {
        const a = Math.abs(u);
        if (a <= TR_KNEE) return 0.5 * u * u;
        return 0.5 * TR_KNEE * TR_KNEE + TR_KNEE * (a - TR_KNEE) + TR_SOFT * TR_SOFT * (tanhIntegral((a - TR_KNEE) / TR_SOFT) - TI0);
      }
      case GD_PENTODE: return (tanhIntegral(PEN_K * (u + PEN_B)) - PEN_IOFF) / PEN_K - PEN_OFF * u;
      case GD_DIST: return tanhIntegral(u) - TI0;
      case GD_AMP: return tanhIntegral(u + AMP_BIAS) - AMP_OFFSET * u;
      case GD_FOLD: return 1 - Math.cos(u);
      case GD_RECT: return u >= 0 ? tanhIntegral(u) - TI0 : TI0 - tanhIntegral(u);
      case GD_EXCITER: { const f = tanhIntegral(u) - TI0; return 0.6 * f + 0.4 * (u >= 0 ? f : -f); }
      case GD_TAPE: return algI(u, TAPE_BIAS, TAPE_OFFSET);
      case GD_CONSOLE: return algI(u, CONSOLE_BIAS, CONSOLE_OFFSET);
      case GD_FUZZ: return asymI(u, FUZZ_NEG);
      default: return tanhIntegral(u + TUBE_BIAS) - TUBE_OFFSET * u;
    }
  }

  /** The colour stages' coefficients at the chain's rate. */
  setColour(fs: number): void {
    const t = this.dtype;
    this.colourFs = fs;
    this.emphK = 1 - Math.exp((-2 * Math.PI * (t === GD_TRANS ? TRANS_EMPH_HZ : TAPE_EMPH_HZ)) / fs);
    this.lossK = TYPE_LOSS[t] > 0 ? 1 - Math.exp((-2 * Math.PI * Math.min(TYPE_LOSS[t], 0.45 * fs)) / fs) : 1;
    this.roomK = 1 - Math.exp((-2 * Math.PI * ROOM_TONE_HZ) / fs);
    this.dcK = 1 - Math.exp((-2 * Math.PI * DC_HZ) / fs);
    for (let ch = 0; ch < 2; ch++) {
      if (TYPE_TIGHT[t] > 0) this.tight[ch].setHighpass(TYPE_TIGHT[t], 0.7, fs);
      const c = this.cab, o = 5 * ch;
      c[o].setHighpass(55, 0.8, fs); // the cab's low end, a resonant bump just above
      c[o + 1].setPeak(110, 3, 1.2, fs);
      c[o + 2].setPeak(450, -4, 0.9, fs); // boxy mids scooped
      c[o + 3].setPeak(2400, 5, 1.3, fs); // the speaker's bite as a close mic hears it
      c[o + 4].setLowpass(Math.min(5200, 0.45 * fs), 0.9, fs); // the speaker's steep top
      for (let j = 0; j < 4; j++) this.roomTap[4 * ch + j] = Math.min(ROOM_LEN - 2, (ROOM_MS[4 * ch + j] / 1000) * fs);
    }
  }

  /**
   * One sample of one channel through the drive and its colour, its input brought to the reference level
   * by `norm`. ADAA on the curve (first-order antiderivative), as the main distortion.
   */
  shape(x: number, ch: number, norm: number): number {
    const t = this.dtype;
    if (t === GD_DOWN) {
      // sample-and-hold: Drive drops the rate from as is to 1/128 (stepped, aliasing on purpose)
      if (--this.dsLeft[ch] <= 0) {
        this.dsHold[ch] = x;
        this.dsLeft[ch] = Math.round(Math.pow(this.gain, 1.4));
      }
      return this.dsHold[ch];
    }
    if (t === GD_CRUSH) {
      // fewer bits as Drive goes up: 16 down to 2 (the steps are the grain and fizz)
      const steps = Math.pow(2, Math.max(1, 15 - 2.811 * Math.log2(this.gain)));
      return Math.round(x * steps) / steps;
    }
    let v = x;
    if (t === GD_TAPE) {
      this.pre[ch] += (v - this.pre[ch]) * this.emphK;
      v += TAPE_EMPH * (v - this.pre[ch]);
    } else if (t === GD_TRANS) {
      this.pre[ch] += (v - this.pre[ch]) * this.emphK;
      v += TRANS_EMPH * this.pre[ch];
    } else if (TYPE_TIGHT[t] > 0) {
      v = this.tight[ch].process(v);
    }
    const u = this.gain * norm * TYPE_GAIN[t] * v + this.bias;
    const up = this.adaaU[ch];
    const fu = this.curveIntegral(u);
    const du = u - up;
    let y = (Math.abs(du) > 1e-5 ? (fu - this.adaaF[ch]) / du : this.curve(0.5 * (u + up))) - this.biasOff;
    this.adaaU[ch] = u;
    this.adaaF[ch] = fu;
    y = this.colour(y, ch);
    // a lopsided curve leaves DC behind: a blocker takes it back out, so the next box isn't pushed off centre
    {
      this.dcS[ch] += (y - this.dcS[ch]) * this.dcK;
      y -= this.dcS[ch];
    }
    return y;
  }

  /** The type's colour after its curve (tape's de-emphasis, the transformer's, the low-pass of the hot ones, the amp's cab and room). */
  private colour(y: number, ch: number): number {
    const t = this.dtype;
    if (t === GD_TAPE) {
      this.post[ch] += (y - this.post[ch]) * this.emphK;
      y -= (TAPE_EMPH / (1 + TAPE_EMPH)) * (y - this.post[ch]);
    } else if (t === GD_TRANS) {
      this.post[ch] += (y - this.post[ch]) * this.emphK;
      y -= (TRANS_EMPH / (1 + TRANS_EMPH)) * this.post[ch];
    } else if (t === GD_AMP) {
      const c = this.cab, o = 5 * ch;
      y = c[o + 4].process(c[o + 3].process(c[o + 2].process(c[o + 1].process(c[o].process(y)))));
      // the room: a few early reflections of the cab, darker than it
      this.roomLp[ch] += (y - this.roomLp[ch]) * this.roomK;
      const buf = this.room[ch], pos = this.roomPos;
      buf[pos] = this.roomLp[ch];
      let r = 0;
      for (let j = 0; j < 4; j++) {
        let rp = pos - this.roomTap[4 * ch + j];
        if (rp < 0) rp += ROOM_LEN;
        const i = Math.floor(rp), fr = rp - i;
        r += ROOM_GAIN[j] * (buf[i] + (buf[(i + 1) & (ROOM_LEN - 1)] - buf[i]) * fr);
      }
      if (ch === 1) this.roomPos = (pos + 1) & (ROOM_LEN - 1);
      return y + r;
    }
    if (TYPE_LOSS[t] > 0) {
      this.loss[ch] += (y - this.loss[ch]) * this.lossK;
      return this.loss[ch];
    }
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
        // a bell as in EQ Eight: everything away from it stays at 0 dB, only the peak rises (up to +17 dB at full Depth)
        return x + this.peak * f.bp * this.k;
      }
      case GF_BAND: {
        const f = this.svf[ch];
        f.process(x, g, this.k);
        return f.bp * this.k; // its centre at 0 dB
      }
      case GF_BELLS: {
        // four bands in a row; a bell is x + (gain - 1) · k · band-pass: exactly its gain at its centre, 0 dB away
        let v = x;
        for (let b = 0; b < this.bN; b++) {
          const o = (ch * GRIND_BELLS + b) * 4, t = this.bT[b], g = this.bG[b];
          if (t === BT_COMB) {
            // rings on Freq and its harmonics; its peaks at 0 dB
            const buf = this.bComb[ch * GRIND_BELLS + b], fb = this.bFb[b];
            let rp = pos - this.bDelay[b];
            if (rp < 0) rp += COMB_LEN;
            const i = Math.floor(rp), fr = rp - i;
            const dd = buf[i] + (buf[(i + 1) & (COMB_LEN - 1)] - buf[i]) * fr;
            const y = v + fb * dd;
            buf[pos] = y;
            v = y * (1 - Math.abs(fb));
          } else if (t === BT_PHASER) {
            // four first-order all-passes with feedback, mixed with the dry: two moving notches
            const s = this.bAp, so = (ch * GRIND_BELLS + b) * 5, fb = this.bFb[b], G = g / (1 + g);
            let w = v + fb * s[so + 4];
            for (let j = 0; j < 4; j++) {
              const u = (w - s[so + j]) * G;
              const lp = u + s[so + j];
              s[so + j] = lp + u;
              w = 2 * lp - w;
            }
            s[so + 4] = w;
            v = ((1 - fb) / (2 - fb)) * (v + w);
          } else if (t === BT_LC48 || t === BT_HC48) {
            for (let j = 0; j < 4; j++) {
              const f = this.bSvf[o + j];
              f.process(v, g, this.bK4[4 * b + j]);
              v = t === BT_LC48 ? f.hp : f.lp;
            }
          } else {
            const f = this.bSvf[o], c = this.bC, q = 4 * b;
            f.process(v, g, this.bK[b]);
            v = c[q] * v + c[q + 1] * f.bp + c[q + 2] * f.lp + c[q + 3] * f.hp;
          }
        }
        return v;
      }
      case GF_COMB: {
        const buf = this.comb[ch];
        let rp = pos - this.delay;
        if (rp < 0) rp += COMB_LEN;
        const i = Math.floor(rp), fr = rp - i;
        const d = buf[i] + (buf[(i + 1) & (COMB_LEN - 1)] - buf[i]) * fr;
        const y = x + this.fb * d;
        buf[pos] = y;
        return y * (1 - this.fb); // its peaks at 0 dB, the dips between them below
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
        // dry + allpasses: 0 dB away from the notches, the feedback's peaks scaled back to 0 dB
        return ((1 - this.fb) / (2 - this.fb)) * (x + v);
      }
    }
  }
}

/** One voice's GRIND chain (stereo). */
/**
 * One drive on its own, as RUIN's stages have it (Ableton's Overdrive layout): band → drive → tone → Output.
 * Pushed hot: nothing is level-matched (owner's call). The FX page's DRIVE box is one of these.
 */
export class DriveUnit {
  private readonly s = new Stage();
  l = 0;
  r = 0;
  /** The output level (dist.output, in dB as a gain): the drive itself is never level-matched. */
  private out = 1;

  /** dtype by grind<n>.drive_type order (GD_*); drive / tone / dyn 0..1; band in Hz and octaves. */
  control(dtype: number, drive: number, tone: number, outDb: number, bandHz: number, bandOct: number, fs: number, fsOs: number): void {
    const s = this.s;
    this.out = Math.pow(10, outDb / 20);
    s.gain = grindGain(drive);
    s.setBand(bandHz, bandOct, fs, fsOs);
    s.toneK = tone >= 0.999 ? 1 : 1 - Math.exp((-2 * Math.PI * 200 * Math.pow(100, tone)) / fsOs);
    if (dtype !== s.dtype) {
      s.dtype = dtype;
      s.adaaF[0] = s.curveIntegral(s.adaaU[0]);
      s.adaaF[1] = s.curveIntegral(s.adaaU[1]);
      s.setColour(fsOs);
    } else if (s.colourFs !== fsOs) {
      s.setColour(fsOs);
    }
    s.bias = 0;
    s.biasOff = 0;
  }

  /** One stereo sample into l / r: the band driven (blended in by `mix`), what lies around it untouched. */
  process(l: number, r: number, mix: number): void {
    const s = this.s;
    const bl = s.split(l, 0), br = s.split(r, 1);
    // pushed hot (owner's call): no input levelling and no output matching, so more Drive is louder and
    // denser and hits whatever comes next harder; Output sets the level
    let dl = s.shape(bl, 0, 1), dr = s.shape(br, 1, 1);
    if (s.toneK < 1) {
      s.toneLp[0] += (dl - s.toneLp[0]) * s.toneK;
      s.toneLp[1] += (dr - s.toneLp[1]) * s.toneK;
      dl = s.toneLp[0];
      dr = s.toneLp[1];
    }
    this.l = s.rest[0] + bl + (dl * this.out - bl) * mix;
    this.r = s.rest[1] + br + (dr * this.out - br) * mix;
  }
}

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
  /** RUIN's Output (grind.output, dB as a gain) on the chain's wet side. */
  private outGain = 1;
  /**
   * The RUIN page's taps (a listening and display aid, not part of the patch): the signal (L + R) / 2 after
   * the chain's input (0 and 1: both the input since SAT and PRE OTT were removed) and after each box (2 + k), written every sample. Nothing reads them on the audio thread.
   */
  readonly tap = new Float64Array(2 + GRIND_SLOTS);
  /** Which part each box holds: 0 nothing, 1-8 filter 1-8, 9-16 drive 1-8, 17-24 EQ 1-8 (grind.slot1..8). */
  readonly slots = new Int8Array(GRIND_SLOTS);
  /** Listening (the RUIN page's S / B / Δ): which point (as the taps, -1 none) and how (1 solo, 2 bypass, 3 delta). */
  listenAt = -1;
  listenMode = 0;

  constructor(rng: Rng) {
    for (const s of this.stages) {
      s.wFrom = rng.next();
      s.wTo = rng.next();
      s.wPos = 0.5 * (rng.next() + 1);
    }
  }

  /** A new note: movement that follows the note starts again. */
  noteOn(rng?: Rng): void {
    for (const s of this.stages) {
      s.phase = 0;
      if (rng) s.spd = randomSpeed(rng);
    }
  }

  /** Clear the filters, delays and drives (a fresh note from silence). */
  reset(): void {
    for (const s of this.stages) {
      for (const f of s.svf) f.reset();
      for (const f of s.bSvf) f.reset();
      for (const c of s.bComb) c.fill(0);
      s.bAp.fill(0);
      for (const f of s.phSvf) f.reset();
      s.phFbS.fill(0);
      s.ap.fill(0);
      s.comb[0].fill(0);
      s.comb[1].fill(0);
      s.adaaU.fill(0);
      s.adaaF.fill(0);
      s.pre.fill(0);
      s.post.fill(0);
      s.loss.fill(0);
      s.roomLp.fill(0);
      for (const f of s.tight) f.reset();
      for (const f of s.bandX) f.reset();
      for (const f of s.eqL) f.reset();
      for (const f of s.eqR) f.reset();
      s.toneLp.fill(0);
      for (const f of s.cab) f.reset();
      s.room[0].fill(0);
      s.room[1].fill(0);
    }
    this.dcX.fill(0);
    this.dcY.fill(0);
    for (const f of this.split) f.reset();
  }

  /**
   * Control-rate update: movement and coefficients. `beatPos` is the bar position in beats (0..4),
   * `bps` the tempo in beats per second, `keyOct` the note in octaves from C3 (for KEY), `n` the samples
   * until the next update.
   */
  control(cur: Float64Array, dst: Float64Array, beatPos: number, bps: number, keyOct: number, fs: number, fsOs: number, n: number, rng: Rng): void {
    const dt = n / fsOs;
    this.dcR = 1 - (TWO_PI * 10) / fsOs;
    this.mix = cur[P.grindMix];
    this.outGain = Math.pow(10, cur[P.grindOut] / 20);
    const lc = cur[P.grindLowcut];
    if (lc !== this.lastLc) {
      this.lastLc = lc;
      this.lcOn = lc > 21;
      if (this.lcOn) for (let c = 0; c < 2; c++) for (let j = 0; j < 2; j++) {
        this.split[4 * c + j].setLowpass(Math.min(lc, fs * 0.45), Math.SQRT1_2, fsOs);
        this.split[4 * c + 2 + j].setHighpass(Math.min(lc, fs * 0.45), Math.SQRT1_2, fsOs);
      }
    }
    // KEY: every stage follows the note (Freq is where it sits at C3); ONE SHOT: every stage sweeps once and holds
    // ONE SHOT is gone (owner's call): the stages always move on their clock; grind.oneshot is ignored
    const key = cur[P.grindKey] > 0.5 ? Math.pow(2, keyOct) : 1, oneShot = false;
    // ONE SHOT's way: down = from the top to the bottom (right to left), up = from the bottom to the top
    const shotDir = 1;
    for (let k = 0; k < GRIND_SLOTS; k++) this.slots[k] = cur[P.grindSlot[k]];
    for (let i = 0; i < GRIND_STAGES; i++) {
      const s = this.stages[i], gp = P.grind[i];
      s.on = cur[gp.on] > 0.5;
      for (let q = 0; q < 4; q++) s.otts[q].set(s.on ? cur[P.grindOttBox] : 0, 0, fsOs);
      for (let q = 0; q < 4; q++) s.ottX[q].set(s.on ? cur[q === 1 ? P.grindOttDrives : P.grindOttFilters] : 0, 0, fsOs);
      if (!s.on) {
        s.fcNow = -1;
        continue;
      }
      const rate = cur[gp.rate], clock = cur[gp.clock];
      // HZ: a swing from the top of the range at every note, free running at Rate; SYNC: the same swing on the
      // bar clock; RANDOM: it wanders (smooth random), Rate is the average and every step gets its own speed,
      // so nothing ever repeats (owner's call: the clock is the movement, no separate move switch)
      const hz = clock === GC_SYNC ? bps / GRIND_BEATS[grindBeat(rate)] : grindHz(rate);
      let m: number;
      if (oneShot) {
        // an envelope, not an LFO: from one end of the range it moves fast, then settles at the other end
        // and stays there until the next note; Rate sets how long the move takes (its time = half a cycle);
        // on RANDOM every note's sweep gets its own speed around Rate (owner's call: ONE SHOT on all three clocks)
        s.phase += dt;
        m = shotDir * (-1 + 2 * Math.exp((-s.phase * 2 * hz * (clock === GC_RANDOM ? s.spd : 1)) * 3));
      } else if (clock === GC_RANDOM) {
        s.wPos += hz * s.spd * dt;
        if (s.wPos >= 1) {
          s.wPos -= Math.floor(s.wPos);
          s.wFrom = s.wTo;
          s.wTo = rng.next();
          s.spd = randomSpeed(rng);
        }
        m = s.wFrom + (s.wTo - s.wFrom) * (0.5 - 0.5 * Math.cos(Math.PI * s.wPos));
      } else if (clock === GC_SYNC) {
        const p = beatPos / GRIND_BEATS[grindBeat(rate)];
        m = Math.cos(TWO_PI * (p - Math.floor(p)));
      } else {
        // an even swing at exactly Rate (only RANDOM varies its speed)
        s.phase += hz * dt;
        if (s.phase >= 1) s.phase -= Math.floor(s.phase);
        m = Math.cos(TWO_PI * s.phase); // from the top at every note
      }
      // where it moves: Freq (times KEY) ± half the H Range, in octaves, slid inside 20 Hz-20 kHz so the zone keeps
      // its width at the edges; at the top of the range (10 octaves) the zone is the whole spectrum (owner's call)
      const c = Math.log2(Math.max(cur[gp.freq] * key, 1)), h = 0.5 * cur[gp.range];
      let lo = c - h, hi = c + h;
      if (hi - lo >= GZ_HI - GZ_LO) { lo = GZ_LO; hi = GZ_HI; }
      else if (lo < GZ_LO) { hi += GZ_LO - lo; lo = GZ_LO; }
      else if (hi > GZ_HI) { lo -= hi - GZ_HI; hi = GZ_HI; }
      const fc = Math.min(Math.pow(2, lo + (hi - lo) * 0.5 * (m + 1)), fs * 0.45);
      s.fcNow = fc;
      const ftype = cur[gp.filter];
      if (ftype !== s.ftype) {
        s.ftype = ftype;
        for (const f of s.svf) f.reset();
        for (const f of s.bSvf) f.reset();
        s.ap.fill(0);
      }
      if (ftype === GF_BELLS) {
        const link = cur[gp.bellLink] > 0.5;
        // each bell moves in its own range (its Freq × KEY ± half its range), on the box's Rate and clock, its own path
        for (let b = 0; b < GRIND_BELLS; b++) {
          const bp = gp.bells[b];
          let mb = m;
          // LINK (owner's call): all four on one path (bell 1's), so a vowel's formants move together
          if (b > 0 && !oneShot && !link) {
            if (clock === GC_RANDOM) {
              s.bPos[b] += hz * s.bSpd[b] * dt;
              if (s.bPos[b] >= 1) {
                s.bPos[b] -= Math.floor(s.bPos[b]);
                s.bFrom[b] = s.bTo[b];
                s.bTo[b] = rng.next();
                s.bSpd[b] = randomSpeed(rng);
              }
              mb = s.bFrom[b] + (s.bTo[b] - s.bFrom[b]) * (0.5 - 0.5 * Math.cos(Math.PI * s.bPos[b]));
            } else if (clock === GC_SYNC) {
              const p = beatPos / GRIND_BEATS[grindBeat(rate)] + 0.25 * b;
              mb = Math.cos(TWO_PI * (p - Math.floor(p)));
            } else {
              mb = Math.cos(TWO_PI * (s.phase + 0.25 * b));
            }
          }
          const bc = Math.log2(Math.max(cur[bp.freq] * key, 1)), bh = 0.5 * cur[bp.range];
          let blo = bc - bh, bhi = bc + bh;
          if (bhi - blo >= GZ_HI - GZ_LO) { blo = GZ_LO; bhi = GZ_HI; }
          else if (blo < GZ_LO) { bhi += GZ_LO - blo; blo = GZ_LO; }
          else if (bhi > GZ_HI) { blo -= bhi - GZ_HI; bhi = GZ_HI; }
          const pos = 0.5 * (mb + 1);
          // its direction (owner's call): left right = its frequency moves, up down = its gain (± half its up down
          // range around its Gain), cross = both, on the same path
          const dir = cur[bp.dir];
          const px = dir === BD_CROSS ? crossX(pos) : pos, py = dir === BD_CROSS ? crossY(pos) : pos;
          const bfc = Math.min(dir === BD_UD ? Math.pow(2, Math.max(GZ_LO, Math.min(GZ_HI, bc))) : Math.pow(2, blo + (bhi - blo) * px), fs * 0.45);
          const gain = dir === BD_LR ? cur[bp.gain] : Math.max(-18, Math.min(18, cur[bp.gain] + cur[bp.vrange] * (py - 0.5)));
          s.bM[b] = pos;
          const t = cur[bp.type], q = cur[bp.q], k = 1 / q, A = Math.pow(10, gain / 40), c = s.bC, o = 4 * b;
          if (t !== s.bT[b]) {
            s.bT[b] = t;
            for (let j = 0; j < 8; j++) s.bSvf[(Math.floor(j / 4) * GRIND_BELLS + b) * 4 + (j % 4)].reset();
            s.bComb[b].fill(0);
            s.bComb[GRIND_BELLS + b].fill(0);
            for (let j = 0; j < 5; j++) s.bAp[b * 5 + j] = s.bAp[(GRIND_BELLS + b) * 5 + j] = 0;
          }
          if (t === BT_COMB) {
            s.bDelayStep[b] = (Math.min(fsOs / bfc, COMB_LEN - 2) - s.bDelay[b]) / n;
            s.bFb[b] = 0.92 * Math.max(-1, Math.min(1, gain / 18));
          } else if (t === BT_PHASER) s.bFb[b] = 0.85 * Math.min(1, Math.log2(1 + q) / Math.log2(19));
          // the shelves' corner moves with the gain (Simper's shelves), so the gain's middle sits at Freq
          const gw = Math.tan((Math.PI * bfc) / fsOs) * (t === BT_LS ? 1 / Math.sqrt(A) : t === BT_HS ? Math.sqrt(A) : 1);
          s.bGStep[b] = (gw - s.bG[b]) / n;
          s.bK[b] = k;
          c[o] = c[o + 1] = c[o + 2] = c[o + 3] = 0;
          switch (t) {
            case BT_LC12: c[o + 3] = 1; break;
            case BT_HC12: c[o + 2] = 1; break;
            case BT_NOTCH: c[o + 2] = 1; c[o + 3] = 1; break;
            case BT_LS: c[o] = 1; c[o + 1] = k * (A - 1); c[o + 2] = A * A - 1; break;
            case BT_HS: c[o] = A * A; c[o + 1] = k * (1 - A) * A; c[o + 2] = 1 - A * A; break;
            case BT_BELL: c[o] = 1; c[o + 1] = (A * A - 1) * k; break;
            case BT_BAND: c[o + 1] = k; break; // only the band round Freq, its centre at 0 dB
            case BT_COMB: case BT_PHASER: break;
            default: for (let j = 0; j < 4; j++) s.bK4[o + j] = 1 / (BW8_Q[j] * (j === 3 ? q / 0.7071 : 1));
          }
          // (moving up down only, band 1's live value carries its position: an octave around its Freq, for the page)
          // (up down and cross: band 1's live value carries its position t, an octave around its Freq, for the page)
          if (b === 0) s.fcNow = dir !== BD_LR ? Math.pow(2, bc + pos - 0.5) : bfc;
        }
        s.resNow = packBells(s.bM[1], s.bM[2], s.bM[3]);
        s.bN = Math.max(1, Math.min(GRIND_BELLS, Math.round(cur[gp.bellCount])));
      }
      // WIDTH (owner's call, was Res, turned round: up = wider); it no longer moves (no vertical movement)
      const res = 1 - cur[gp.width];
      // BELLS has no Depth (its four gains are it)
      s.depth = ftype === GF_BELLS ? 1 : cur[gp.depth];
      s.fLvT = Math.pow(10, cur[gp.fLevel] / 20);
      s.dLvT = Math.pow(10, cur[gp.dLevel] / 20);
      s.eqLvT = Math.pow(10, cur[gp.eqLevel] / 20);
      s.eqOn = cur[gp.eqOn] > 0.5;
      // PHASER: its own LFO (HZ free running, SYNC on the bar, RANDOM wandering), the right channel STEREO ahead
      s.phOn = cur[gp.phOn] > 0.5;
      if (s.phOn) {
        const pRate = cur[gp.phRate], pClock = cur[gp.phClock], st = cur[gp.phStereo] / 360;
        const phz = pClock === GC_SYNC ? bps / GRIND_BEATS[grindBeat(pRate)] : grindHz(pRate);
        if (pClock === GC_RANDOM) {
          const w = s.phW;
          for (let c = 0; c < 2; c++) {
            const o = 4 * c;
            w[o + 2] += phz * w[o + 3] * dt;
            if (w[o + 2] >= 1) {
              w[o + 2] -= Math.floor(w[o + 2]);
              w[o] = w[o + 1];
              w[o + 1] = rng.next();
              w[o + 3] = randomSpeed(rng);
            }
            s.phM[c] = w[o] + (w[o + 1] - w[o]) * (0.5 - 0.5 * Math.cos(Math.PI * w[o + 2]));
          }
          // STEREO blends the right channel from the left's path (0) to its own (180)
          s.phM[1] = s.phM[0] + (s.phM[1] - s.phM[0]) * Math.min(1, 2 * st);
        } else {
          let p: number;
          if (pClock === GC_SYNC) p = beatPos / GRIND_BEATS[grindBeat(pRate)];
          else {
            s.phPh += phz * dt;
            if (s.phPh >= 1) s.phPh -= Math.floor(s.phPh);
            p = s.phPh;
          }
          s.phM[0] = Math.sin(TWO_PI * p);
          s.phM[1] = Math.sin(TWO_PI * (p + st));
        }
        s.phLive = packPhaser(s.phM[0], s.phM[1]);
        const N = Math.max(1, Math.min(PH_MAX, Math.round(cur[gp.phNotches])));
        if (N !== s.phN) s.phN = N;
        s.phFb = cur[gp.phFeedback];
        s.phLvT = Math.pow(10, cur[gp.phLevel] / 20);
        const cen = Math.log2(Math.max(cur[gp.phCenter], 1)), spread = cur[gp.phSpread], amt = cur[gp.phAmount];
        for (let c = 0; c < 2; c++) for (let k = 0; k < N; k++) {
          const hz = Math.min(Math.max(Math.pow(2, cen + (k - (N - 1) / 2) * spread + 0.5 * amt * s.phM[c]), 20), fs * 0.45);
          const j = c * PH_MAX + k;
          s.phGStep[j] = (Math.tan((Math.PI * hz) / fsOs) - s.phG[j]) / n;
        }
      } else s.phLive = -1;
      if (s.eqOn) {
        // the FX page's EQ: band 1 low shelf / high-pass, 2-3 bell / notch, 4 high shelf / low-pass, gains × Scale
        for (let b = 0; b < 4; b++) {
          const e = gp.eq[b], o = 4 * b, el = s.eqLast;
          const type = cur[e.type], hz = Math.min(cur[e.freq], fs * 0.45), db = cur[e.gain] * cur[gp.eqScale], q = cur[e.q];
          // (only the first eq_count bands are used)
          s.eqBand[b] = b < Math.round(cur[gp.eqCount]) && (type > 0.5 || Math.abs(db) > 0.01) ? 1 : 0;
          if (!s.eqBand[b] || (el[o] === type && el[o + 1] === hz && el[o + 2] === db && el[o + 3] === q)) continue;
          el[o] = type;
          el[o + 1] = hz;
          el[o + 2] = db;
          el[o + 3] = q;
          for (const f of [s.eqL[b], s.eqR[b]]) {
            if (b === 0) type > 0.5 ? f.setHighpass(hz, q, fsOs) : f.setLowShelf(hz, db, fsOs, q);
            else if (b === 3) type > 0.5 ? f.setLowpass(hz, q, fsOs) : f.setHighShelf(hz, db, fsOs, q);
            else type > 0.5 ? f.setNotch(hz, q, fsOs) : f.setPeak(hz, db, q, fsOs);
          }
        }
      }
      if (ftype !== GF_BELLS) s.resNow = res;
      const gT = Math.tan((Math.PI * fc) / fsOs);
      s.gStep = (gT - s.g) / n;
      switch (ftype) {
        case GF_NOTCH: s.k = 1.6 * (1 - res) + 0.08; break;
        case GF_PEAK: s.k = 1.2 * (1 - res) + 0.15; s.peak = PEAK_GAIN; break;
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
      s.driveOn = drive > 0.001 && cur[gp.driveOn] > 0.5;
      s.filterOn = cur[gp.filterOn] > 0.5;
      s.mix = cur[gp.mix];
      // the LFO page's RUIN drive targets: all drives, or the drive in this stage's box, relative to its Drive
      let dm = dst[K.D_RUIN_DRIVES];
      for (let k = 0; k < GRIND_SLOTS; k++) if (this.slots[k] === 1 + GRIND_STAGES + i) dm += dst[K.D_RUIN_DRIVE1 + k];
      s.gainT = grindGain(Math.max(0, Math.min(1, drive * (1 + dm))));
      // the band in front of the drive (Overdrive's X-Y): centre and width in octaves; 9 octaves = the whole sound
      s.setBand(cur[gp.dFreq], cur[gp.dWidth], fs, fsOs);
      const tone = cur[gp.dTone];
      s.toneK = tone >= 0.999 ? 1 : 1 - Math.exp((-2 * Math.PI * 200 * Math.pow(100, tone)) / fsOs);
      const dtype = cur[gp.dtype];
      if (dtype !== s.dtype) {
        s.dtype = dtype;
        s.adaaF[0] = s.curveIntegral(s.adaaU[0]);
        s.adaaF[1] = s.curveIntegral(s.adaaU[1]);
        s.setColour(fsOs);
      } else if (s.colourFs !== fsOs) {
        s.setColour(fsOs);
      }
      s.bias = 0;
      s.biasOff = 0;
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
    const at = this.listenAt, mode = this.listenMode;
    let done = false; // solo / delta: the rest of the chain is skipped
    let bl0 = l, br0 = r;
    this.tap[0] = 0.5 * (l + r);
    if (at === 0 && mode >= 1 && mode !== 2) {
      if (mode === 3) {
        l -= bl0;
        r -= br0;
      }
      done = true;
    }
    bl0 = l;
    br0 = r;
    this.tap[1] = 0.5 * (l + r);
    if (at === 1 && !done && mode >= 1 && mode !== 2) {
      if (mode === 3) {
        l -= bl0;
        r -= br0;
      }
      done = true;
    }
    const pos = this.combPos;
    // every stage that is on moves its filter on, whether or not its parts are heard this sample
    for (let i = 0; i < GRIND_STAGES; i++) {
      const s = this.stages[i];
      if (s.on) {
        s.g += s.gStep;
        if (s.ftype === GF_COMB) s.delay += s.delayStep;
        else if (s.ftype === GF_BELLS) for (let b = 0; b < GRIND_BELLS; b++) {
          s.bG[b] += s.bGStep[b];
          if (s.bT[b] === BT_COMB) s.bDelay[b] += s.bDelayStep[b];
        }
        if (s.phOn) for (let j = 0; j < s.phN; j++) {
          s.phG[j] += s.phGStep[j];
          s.phG[PH_MAX + j] += s.phGStep[PH_MAX + j];
        }
      }
    }
    // the eight boxes in their order (owner's call: free order): each holds filter n, drive n or nothing
    const slots = this.slots;
    for (let k = 0; k < GRIND_SLOTS; k++) {
      const v = slots[k], kAt = 2 + k;
      if (v > 0 && !done && !(at === kAt && mode === 2)) {
        // 1-8 filter 1-8, 9-16 drive 1-8, 17-24 EQ 1-8, 25-32 phaser 1-8
        const kind = Math.floor((v - 1) / GRIND_STAGES), s = this.stages[(v - 1) % GRIND_STAGES], drive = kind === 1;
        if (s.on && (kind === 0 ? s.filterOn : kind === 1 ? s.driveOn : kind === 2 ? s.eqOn : s.phOn)) {
          const il = l, ir = r;
          if (kind === 3) {
            l = s.phaser(l, 0);
            r = s.phaser(r, 1);
            s.phLv += (s.phLvT - s.phLv) * LV_SMOOTH;
            l *= s.phLv;
            r *= s.phLv;
          } else if (kind === 2) {
            for (let b = 0; b < 4; b++) {
              if (s.eqBand[b]) {
                l = s.eqL[b].process(l);
                r = s.eqR[b].process(r);
              }
            }
            s.eqLv += (s.eqLvT - s.eqLv) * LV_SMOOTH;
            l *= s.eqLv;
            r *= s.eqLv;
          } else if (!drive) {
            // DEPTH blends the filter in: 0 = the untouched sound (a straight line), 1 = the whole notch / peak / band
            l = il + s.depth * (s.filter(il, 0, s.g, pos) - il);
            r = ir + s.depth * (s.filter(ir, 1, s.g, pos) - ir);
          } else {
            // Overdrive's chain: band → drive → tone, pushed hot (owner's call): nothing is level-matched, so a
            // hotter stage hits the next one harder; RUIN's Output sets the chain's level at the end
            // only the band is driven; below and above it pass untouched and are added back
            s.gain += (s.gainT - s.gain) * LV_SMOOTH;
            const bl = s.split(l, 0), br = s.split(r, 1);
            let dl = s.shape(bl, 0, 1), dr = s.shape(br, 1, 1);
            if (s.toneK < 1) {
              s.toneLp[0] += (dl - s.toneLp[0]) * s.toneK;
              s.toneLp[1] += (dr - s.toneLp[1]) * s.toneK;
              dl = s.toneLp[0];
              dr = s.toneLp[1];
            }
            l = s.rest[0] + bl + (dl - bl) * s.mix;
            r = s.rest[1] + br + (dr - br) * s.mix;
          }
          // the box's level, smoothed so the handle never clicks
          if (kind >= 2) {
            // (done above)
          } else if (drive) {
            s.dLv += (s.dLvT - s.dLv) * LV_SMOOTH;
            l *= s.dLv;
            r *= s.dLv;
          } else {
            s.fLv += (s.fLvT - s.fLv) * LV_SMOOTH;
            l *= s.fLv;
            r *= s.fLv;
          }
          // the box's own OTT, after its level
          const ot = s.otts[kind];
          if (ot.on) {
            ot.process(l, r);
            l = ot.l;
            r = ot.r;
          }
          const ox = s.ottX[kind];
          if (ox.on) {
            ox.process(l, r);
            l = ox.l;
            r = ox.r;
          }
          if (at === kAt && mode >= 1) {
            if (mode === 3) {
              l -= il;
              r -= ir;
            }
            done = true;
          }
        }
      }
      this.tap[kAt] = 0.5 * (l + r);
    }
    this.combPos = (pos + 1) & (COMB_LEN - 1);
    // the drives' lopsided curves leave DC behind: a gentle blocker on what the chain adds
    const dx = this.dcX, dy = this.dcY, R = this.dcR;
    dy[0] = l - dx[0] + R * dy[0];
    dx[0] = l;
    dy[1] = r - dx[1] + R * dy[1];
    dx[1] = r;
    const wl = dy[0] * this.outGain, wr = dy[1] * this.outGain;
    const m = this.mix;
    // Mix blends the untouched input with the chain (its clean low band + the processed rest), so Mix 0
    // is exactly the chain switched off (the Lo cut's split is never heard dry)
    this.l = inL + (lowL + wl - inL) * m;
    this.r = inR + (lowR + wr - inR) * m;
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
        // pulled up from below, but never what is near silence (tails, filter residue): no lift under -80 dBFS, full lift from -70
        else if (lvl < OTT_BELOW[b]) g = Math.min(OTT_MAX_UP, (OTT_BELOW[b] - lvl) * (1 - 1 / 4.17)) * Math.min(1, Math.max(0, (lvl - this.inDb + 80) / 10));
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
