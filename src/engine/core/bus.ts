// The dirt chain on the summed sound (owner's call): RUIN → DRIVE → bitcrusher → tape, once on all the
// voices together (and the noise bed unless it is on Direct out or NOISE THRU), not on each note, so a
// chord grinds against itself as it does through distortion in a DAW. The clean sub never comes here.
// RUIN and DRIVE run 2x oversampled (always, so the latency never changes); the bitcrusher and tape at
// the base rate. RUIN's KEY and ONE SHOT follow the newest note, as the noise bed does; the matrix's
// targets here (Dis Drive / Mix / Tone, crush, tape wow) follow the newest voice, as the FX targets do.

import { clamp, Rng, Svf, TWO_PI } from './dsp';
import { Crusher, Tape } from './fx';
import { DriveUnit, Grind } from './grind';
import { Downsampler2x, Upsampler2x } from './oversample';
import * as K from './params';

const P = K.P;
const OS = K.OS;

export class DirtBus {
  readonly grind: Grind;
  grindOn = false;
  private readonly drv = new DriveUnit();
  private distOn = false;
  private distMix = 0;
  private splitG = 0; // 0 = full-band
  private lastSplit = NaN;
  // Linkwitz-Riley 4th-order crossover for DRIVE's clean low band: per channel LP, LP∘, HP∘
  private readonly split = [new Svf(), new Svf(), new Svf(), new Svf(), new Svf(), new Svf()];
  private readonly crusher = new Crusher();
  private crushQ = 128;
  private crushRate = 1;
  private crushMix = 0;
  private crushLc = 0;
  private tapeLc = 0;
  private readonly crushLp = new Float64Array(4);
  private readonly tapeLp = new Float64Array(4);
  private readonly tape: Tape;
  private tapeWow = 0;
  private tapeOn = false;
  private readonly upL = new Upsampler2x();
  private readonly upR = new Upsampler2x();
  private readonly dnL = new Downsampler2x();
  private readonly dnR = new Downsampler2x();
  private readonly os = new Float64Array(4);
  private readonly tmp = new Float64Array(2);
  l = 0;
  r = 0;
  /** The RUIN page's taps at the base rate (after SAT, PRE OTT and each stage's filter and drive), see Grind.tap. */
  readonly tap = new Float64Array(10);

  constructor(fs: number, rng: Rng) {
    this.grind = new Grind(rng);
    this.tape = new Tape(fs);
  }

  reset(): void {
    this.grind.reset();
    this.crusher.reset();
    this.tape.reset();
    this.crushLp.fill(0);
    this.tapeLp.fill(0);
    for (const f of this.split) f.reset();
    this.upL.reset();
    this.upR.reset();
    this.dnL.reset();
    this.dnR.reset();
  }

  /** A new note: RUIN's note movement starts again. */
  noteOn(rng: Rng): void {
    this.grind.noteOn(rng);
  }

  /** Control rate: `dst` is the newest voice's matrix (and mod wheel) offsets, `keyOct` its note in octaves from C3. */
  control(cur: Float64Array, dst: Float64Array, beatPos: number, bps: number, keyOct: number, fs: number, n: number, rng: Rng): void {
    const fsOs = fs * OS;
    const on = cur[P.grindOn] > 0.5;
    if (on && !this.grindOn) this.grind.reset();
    this.grindOn = on;
    if (on) this.grind.control(cur, beatPos, bps, keyOct, fs, fsOs, n * OS, rng);

    // DRIVE (the FX page's box): RUIN's drive, pushed hot, with its Output.
    const dDrive = clamp(cur[P.dDrive] + dst[K.D_DIST_DRIVE], 0, 1);
    this.distMix = clamp(cur[P.dMix] + dst[K.D_DIST_MIX], 0, 1);
    this.distOn = dDrive > 0.001 && this.distMix > 1e-4;
    const dTone = clamp(cur[P.dTone] + dst[K.D_DIST_TONE], 0, 1);
    if (this.distOn) this.drv.control(cur[P.dType], dDrive, dTone, cur[P.dOut], cur[P.dBandHz], cur[P.dBandOct], fs, fsOs);
    if (cur[P.dSplit] !== this.lastSplit) {
      const split = cur[P.dSplit];
      this.splitG = split > 22 ? Math.tan((Math.PI * split) / fsOs) : 0;
      if (this.splitG > 0) for (const f of this.split) f.setCoefs(this.splitG, Math.SQRT2);
      this.lastSplit = split;
    }

    // Bitcrusher.
    this.crushMix = clamp(cur[P.crushMix] + dst[K.D_CRUSH], 0, 1);
    this.crushQ = Math.pow(2, cur[P.crushBits] - 1);
    this.crushRate = cur[P.crushRate];
    this.crushLc = cur[P.crushLowcut] > 21 ? Math.exp((-TWO_PI * cur[P.crushLowcut]) / fs) : 0;
    this.tapeLc = cur[P.tapeLowcut] > 21 ? Math.exp((-TWO_PI * cur[P.tapeLowcut]) / fs) : 0;

    // Tape.
    this.tapeWow = clamp(cur[P.tapeWow] + dst[K.D_TAPE_WOW], 0, 1);
    this.tapeOn = this.tapeWow > 0;
  }

  /** One oversampled stereo sample through RUIN and DRIVE, into os[slot], os[slot + 1]. */
  private nonlinear(l: number, r: number, slot: number): void {
    const t = this.tap;
    if (this.grindOn) {
      this.grind.process(l, r);
      l = this.grind.l;
      r = this.grind.r;
      const g = this.grind.tap;
      for (let k = 0; k < 10; k++) t[k] += 0.5 * g[k];
    } else {
      const m = 0.25 * (l + r);
      for (let k = 0; k < 10; k++) t[k] += m;
    }
    // DRIVE, optionally on the mids only (below dist.clean_below stays clean).
    if (this.distOn) {
      let lowL = 0, lowR = 0, hl = l, hr = r;
      if (this.splitG > 0) {
        // Linkwitz-Riley 4th-order crossover: low = LP∘LP, high = HP∘HP (sum is allpass).
        const sp = this.split;
        sp[0].processFixed(l);
        sp[1].processFixed(sp[0].lp);
        sp[2].processFixed(sp[0].hp);
        lowL = sp[1].lp;
        hl = sp[2].hp;
        sp[3].processFixed(r);
        sp[4].processFixed(sp[3].lp);
        sp[5].processFixed(sp[3].hp);
        lowR = sp[4].lp;
        hr = sp[5].hp;
      }
      this.drv.process(hl, hr, this.distMix);
      l = lowL + this.drv.l;
      r = lowR + this.drv.r;
    }
    this.os[slot] = l;
    this.os[slot + 1] = r;
  }

  /** One stereo sample of the summed voices through the chain, into l / r (OVERSAMPLE_LATENCY late). */
  process(l: number, r: number): void {
    this.tap.fill(0);
    this.upL.process(l);
    this.upR.process(r);
    this.nonlinear(this.upL.out0, this.upR.out0, 0);
    this.nonlinear(this.upL.out1, this.upR.out1, 2);
    const os = this.os;
    l = this.dnL.process(os[0], os[2]);
    r = this.dnR.process(os[1], os[3]);

    // Bitcrusher / downsampler (below its low cut the sound passes clean: split off with a one-pole pair).
    if (this.crushMix > 0) {
      let lowL = 0, lowR = 0;
      if (this.crushLc > 0) {
        const c = this.crushLc, s = this.crushLp;
        s[0] = l + c * (s[0] - l);
        s[1] = s[0] + c * (s[1] - s[0]);
        s[2] = r + c * (s[2] - r);
        s[3] = s[2] + c * (s[3] - s[2]);
        lowL = s[1];
        lowR = s[3];
      }
      this.crusher.process(l - lowL, r - lowR, this.crushMix, this.crushQ, this.crushRate, this.tmp);
      l = lowL + this.tmp[0];
      r = lowR + this.tmp[1];
    }

    // Tape (wow and flutter).
    if (this.tapeOn) {
      let lowL = 0, lowR = 0;
      if (this.tapeLc > 0) {
        const c = this.tapeLc, s = this.tapeLp;
        s[0] = l + c * (s[0] - l);
        s[1] = s[0] + c * (s[1] - s[0]);
        s[2] = r + c * (s[2] - r);
        s[3] = s[2] + c * (s[3] - s[2]);
        lowL = s[1];
        lowR = s[3];
      }
      this.tape.process(l - lowL, r - lowR, this.tapeWow, this.tmp);
      l = lowL + this.tmp[0];
      r = lowR + this.tmp[1];
    }
    this.l = l;
    this.r = r;
  }
}
