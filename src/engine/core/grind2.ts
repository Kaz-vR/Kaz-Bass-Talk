// GRIND2: the neuro chain built the way neuro producers build it. Four filter → drive stages, but
// ONE movement moves them all (one macro / one automation curve in a DAW): each stage follows it by
// its own depth (negative = the other way) and offset (later in the cycle), and its drive can follow
// it too. Moving together is what makes a bass talk; stages wandering on their own only smear into
// phasing. The movement is on the tempo and restarts with the note (or plays once, or locks to the bar);
// Life adds small independent drift on top so it never sounds like a loop.
// Signal: lo-cut split → SAT (drive first, so the filters cut into a rich sound) → stage 1 → stage 2 →
// mid OTT (the glue a resample adds) → stage 3 → stage 4 → DC blocker → level back to the input → mix.

import { Biquad, Rng, Svf } from './dsp';
import { WOB_TEMPLATES, wobPointsAt } from './wobshape';
import { COMB_LEN, GF_BAND, GF_COMB, GF_NOTCH, GF_PEAK, GF_PHASER, Ott, Stage, grindGain } from './grind';
import * as K from './params';

const P = K.P;
const TWO_PI = 2 * Math.PI;

/** g2s<n>.filter option order (vowel first, then the stage filters GRIND has). */
export const G2_VOWEL = 0;
const G2_FILTER_MAP = [-1, GF_NOTCH, GF_PEAK, GF_BAND, GF_COMB, GF_PHASER];
/** g2.shape options, in schema order; 'random' draws new steps every cycle. */
export const G2_SHAPES = ['sine', 'saw down', 'saw up', 'yoyo', 'square', 'staircase', 'ratchet', 'brake', 'pulse decay', 'sync gate', 'duck', 'random'];
const G2_RANDOM = G2_SHAPES.indexOf('random');
/** g2.rate options: beats per cycle. */
export const G2_BEATS = [8, 4, 2, 1, 0.5, 0.25, 0.125, 4 / 3, 2 / 3, 1 / 3, 1 / 6];
export const G2_RATE_NAMES = ['2 BARS', '1 BAR', '1/2', '1/4', '1/8', '1/16', '1/32', '1/2T', '1/4T', '1/8T', '1/16T'];
/** g2.timing option order. */
export const G2_NOTE = 0, G2_ONCE = 1, G2_BAR = 2;
const TABLE = 512;
const RANDOM_STEPS = 8;
/** The movement shapes as tables (0..1), made once. */
export const G2_TABLES: Float64Array[] = G2_SHAPES.map((name) => {
  const t = new Float64Array(TABLE + 1);
  // sine as a bell from the bottom (a "yoi"); the rest are the Wobbler's shapes
  const pts = WOB_TEMPLATES[name];
  for (let i = 0; i <= TABLE; i++) {
    const p = i / TABLE;
    t[i] = name === 'sine' ? 0.5 - 0.5 * Math.cos(TWO_PI * p) : pts ? wobPointsAt(pts, Math.min(p, 0.9999)) : 0;
  }
  return t;
});
/** Vowel formants (F1, F2) from dark to bright: u, o, a, e, i. */
const VOWELS = [[300, 870], [450, 800], [730, 1090], [530, 1840], [300, 2300]];
/** Where a vowel stage's frequency puts it on u … i: 150 Hz = u, 2400 Hz = i. */
export const g2VowelPos = (fc: number): number => Math.min(4, Math.max(0, Math.log2(fc / 150)));

class Stage2 extends Stage {
  kind = 0; // schema filter index
  m = 0; // this stage's movement value right now (0..1)
  drift = 0;
  dFrom = 0;
  dTo = 0;
  dPos = 0;
  dSpd = 0.4;
  gainT = 1;
  gainStep = 0;
  // vowel: two band-passes per channel, their coefficients stepped like the main ones
  readonly f1 = [new Svf(), new Svf()];
  readonly f2 = [new Svf(), new Svf()];
  g1 = 0.05;
  g1Step = 0;
  g2 = 0.05;
  g2Step = 0;
}

/** One voice's GRIND2 chain (stereo). */
export class Grind2 {
  readonly stages = Array.from({ length: 4 }, () => new Stage2());
  l = 0;
  r = 0;
  /** The shared movement's position in its cycle (0..1) and level (0..1), for the page. */
  phase = 0;
  level = 0;
  private cycle = 0;
  private depthVar = 1;
  private readonly steps = new Float64Array(RANDOM_STEPS);
  private combPos = 0;
  private lcOn = false;
  private lastLc = -1;
  private mix = 1;
  private readonly split = Array.from({ length: 8 }, () => new Biquad());
  private readonly dcX = new Float64Array(2);
  private readonly dcY = new Float64Array(2);
  private dcR = 0.999;
  private satAmt = 0;
  private satGain = 1;
  private readonly satU = new Float64Array(2);
  private readonly satF = new Float64Array(2);
  private readonly midOtt = new Ott(0, 12, false);
  private inLvl = 0;
  private outLvl = 0;
  private lvlK = 0.001;
  private envK = 0.001;

  constructor(private readonly rng: Rng) {
    for (const s of this.stages) {
      s.dFrom = rng.next() * 2 - 1;
      s.dTo = rng.next() * 2 - 1;
      s.dPos = rng.next();
      s.dSpd = 0.25 + 0.5 * rng.next();
    }
    this.newSteps();
  }

  private newSteps(): void {
    for (let i = 0; i < RANDOM_STEPS; i++) this.steps[i] = this.rng.next();
  }

  /** A new note: the movement starts again (unless it is locked to the bar). */
  noteOn(): void {
    this.phase = 0;
    this.cycle = 0;
    this.depthVar = 1;
    this.newSteps();
  }

  reset(): void {
    for (const s of this.stages) {
      for (const f of s.svf) f.reset();
      for (const f of s.f1) f.reset();
      for (const f of s.f2) f.reset();
      s.ap.fill(0);
      s.comb[0].fill(0);
      s.comb[1].fill(0);
      s.adaaU.fill(0);
      s.adaaF.fill(0);
      s.inEnv = s.outEnv = 0;
    }
    this.dcX.fill(0);
    this.dcY.fill(0);
    for (const f of this.split) f.reset();
    this.satU.fill(0);
    this.satF.fill(0);
    this.inLvl = this.outLvl = 0;
    this.midOtt.reset();
  }

  /** The shape's level at phase p (0..1). */
  private shapeAt(shape: number, p: number): number {
    p -= Math.floor(p);
    if (shape === G2_RANDOM) {
      // eight steps a cycle, each gliding into the next over its last fifth
      const x = p * RANDOM_STEPS, i = Math.floor(x), fr = x - i;
      const a = this.steps[i], b = this.steps[(i + 1) % RANDOM_STEPS];
      return fr < 0.8 ? a : a + (b - a) * (0.5 - 0.5 * Math.cos((Math.PI * (fr - 0.8)) / 0.2));
    }
    const t = G2_TABLES[shape] ?? G2_TABLES[0], x = p * TABLE, i = Math.floor(x);
    return t[i] + (t[i + 1] - t[i]) * (x - i);
  }

  /** Control-rate update. `keyOct` = the note in octaves from C3; `n` = samples to the next update. */
  control(cur: Float64Array, beatPos: number, bps: number, keyOct: number, fs: number, fsOs: number, n: number): void {
    const dt = n / fsOs;
    this.dcR = 1 - (TWO_PI * 10) / fsOs;
    this.envK = 1 - Math.exp(-1 / (0.05 * fsOs));
    this.lvlK = 1 - Math.exp(-1 / (0.6 * fsOs));
    this.mix = cur[P.g2Mix];
    this.satAmt = cur[P.g2Sat];
    this.satGain = 1 + 24 * this.satAmt * this.satAmt;
    this.midOtt.set(cur[P.g2Ott], 20, fsOs);
    const lc = cur[P.g2Lowcut];
    if (lc !== this.lastLc) {
      this.lastLc = lc;
      this.lcOn = lc > 21;
      if (this.lcOn) for (let c = 0; c < 2; c++) for (let j = 0; j < 2; j++) {
        this.split[4 * c + j].setLowpass(Math.min(lc, fs * 0.45), Math.SQRT1_2, fsOs);
        this.split[4 * c + 2 + j].setHighpass(Math.min(lc, fs * 0.45), Math.SQRT1_2, fsOs);
      }
    }
    // the one movement
    const beats = G2_BEATS[cur[P.g2Rate]] ?? 1, timing = cur[P.g2Timing], shape = cur[P.g2Shape], life = cur[P.g2Life];
    let p: number;
    if (timing === G2_BAR && beats <= 4) {
      p = beatPos / beats;
      const c = Math.floor(p);
      if (c !== this.cycle) this.newCycle(c, life);
      p -= c;
    } else {
      this.phase += (bps / beats) * dt;
      if (timing === G2_ONCE) this.phase = Math.min(this.phase, 0.9999);
      else if (this.phase >= 1) {
        this.phase -= Math.floor(this.phase);
        this.newCycle(this.cycle + 1, life);
      }
      p = this.phase;
    }
    this.phase = timing === G2_BAR && beats <= 4 ? p : this.phase;
    this.level = this.shapeAt(shape, p);
    const key = Math.pow(2, keyOct), keyOn = cur[P.g2Key] > 0.5;
    for (let i = 0; i < 4; i++) {
      const s = this.stages[i], gp = P.g2[i];
      s.on = cur[gp.on] > 0.5;
      if (!s.on) {
        s.fcNow = -1;
        continue;
      }
      // Life: each stage drifts on its own, slowly (a smooth random walk, ±0.5 oct and a little resonance at full Life)
      s.dPos += s.dSpd * dt;
      if (s.dPos >= 1) {
        s.dPos -= Math.floor(s.dPos);
        s.dFrom = s.dTo;
        s.dTo = this.rng.next() * 2 - 1;
        s.dSpd = 0.25 + 0.5 * this.rng.next();
      }
      s.drift = s.dFrom + (s.dTo - s.dFrom) * (0.5 - 0.5 * Math.cos(Math.PI * s.dPos));
      const m = this.shapeAt(shape, timing === G2_ONCE ? Math.max(0, p - cur[gp.offset]) : p - cur[gp.offset]);
      s.m = m;
      const kind = cur[gp.filter];
      if (kind !== s.kind) {
        s.kind = kind;
        for (const f of s.svf) f.reset();
        for (const f of s.f1) f.reset();
        for (const f of s.f2) f.reset();
        s.ap.fill(0);
      }
      s.ftype = G2_FILTER_MAP[kind] ?? GF_NOTCH;
      const oct = cur[gp.depth] * this.depthVar * m + 0.5 * life * s.drift;
      // the comb always follows the note (Freq = its pitch at C3), so it stays in tune
      const track = kind === 4 || keyOn ? key : 1;
      const fc = Math.min(Math.max(cur[gp.freq] * track * Math.pow(2, oct), 20), fs * 0.45);
      s.fcNow = fc;
      const res = Math.min(1, Math.max(0, cur[gp.res] + 0.1 * life * s.drift));
      s.resNow = res;
      if (kind === G2_VOWEL) {
        // the frequency picks the vowel, u … i; the formants glide between them
        const vp = g2VowelPos(fc), vi = Math.min(3, Math.floor(vp)), vf = vp - vi;
        const a = VOWELS[vi], b = VOWELS[vi + 1];
        const F1 = a[0] + (b[0] - a[0]) * vf, F2 = a[1] + (b[1] - a[1]) * vf;
        s.g1Step = (Math.tan((Math.PI * F1) / fsOs) - s.g1) / n;
        s.g2Step = (Math.tan((Math.PI * F2) / fsOs) - s.g2) / n;
        s.k = 0.9 * (1 - res) + 0.12;
      } else {
        s.gStep = (Math.tan((Math.PI * fc) / fsOs) - s.g) / n;
        switch (s.ftype) {
          case GF_NOTCH: s.k = 1.6 * (1 - res) + 0.08; break;
          case GF_PEAK: s.k = 1.2 * (1 - res) + 0.15; s.peak = 1 + 5 * res; break;
          case GF_BAND: s.k = 1.4 * (1 - res) + 0.1; break;
          case GF_COMB: {
            const d = Math.min(fsOs / fc, COMB_LEN - 2);
            s.delayStep = (d - s.delay) / n;
            s.fb = 0.92 * res;
            break;
          }
          default: s.fb = 0.75 * res;
        }
      }
      // the drive, following the movement when Drive follow is set
      const drive = Math.min(1, Math.max(0, cur[gp.drive] + 0.6 * cur[gp.dmod] * (m - (cur[gp.dmod] < 0 ? 1 : 0))));
      s.driveOn = cur[gp.drive] > 0.001 || cur[gp.dmod] > 0.001;
      s.mix = cur[gp.mix];
      s.gainT = grindGain(drive);
      s.gainStep = (s.gainT - s.gain) / n;
      const dtype = cur[gp.dtype];
      const bias = dtype === K.DIST_FUZZ ? K.FUZZ_BIAS_REL * s.gainT : 0;
      if (dtype !== s.dtype || Math.abs(bias - s.bias) > 0.05) {
        s.dtype = dtype;
        s.bias = bias;
        s.offset = dtype === K.DIST_FUZZ ? K.fuzz(bias) : 0;
        s.adaaF[0] = s.curveIntegral(s.adaaU[0]);
        s.adaaF[1] = s.curveIntegral(s.adaaU[1]);
      }
    }
  }

  private newCycle(c: number, life: number): void {
    this.cycle = c;
    this.newSteps();
    // every cycle moves a little more or less (±30 % at full Life)
    this.depthVar = 1 + 0.3 * life * (this.rng.next() * 2 - 1);
  }

  /** One stereo sample through the chain, into l / r. */
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
      const g = this.satGain, u = this.satU, f = this.satF;
      for (let ch = 0; ch < 2; ch++) {
        const x = (ch ? r : l) * g + 0.35, up = u[ch], fx = K.tanhIntegral(x), du = x - up;
        const y = (Math.abs(du) > 1e-5 ? (fx - f[ch]) / du : K.tanh(0.5 * (x + up))) - Math.tanh(0.35);
        u[ch] = x;
        f[ch] = fx;
        const a = Math.min(1, this.satAmt * 3);
        if (ch) r += (y - r) * a;
        else l += (y - l) * a;
      }
    }
    const pos = this.combPos;
    for (let i = 0; i < 4; i++) {
      const s = this.stages[i];
      if (s.on) {
        if (s.kind === G2_VOWEL) {
          s.g1 += s.g1Step;
          s.g2 += s.g2Step;
          for (let ch = 0; ch < 2; ch++) {
            const x = ch ? r : l, a = s.f1[ch], b = s.f2[ch];
            a.process(x, s.g1, s.k);
            b.process(x, s.g2, s.k);
            const y = (a.bp + 0.7 * b.bp) * s.k * 1.5 + 0.12 * x;
            if (ch) r = y;
            else l = y;
          }
        } else {
          s.g += s.gStep;
          if (s.ftype === GF_COMB) s.delay += s.delayStep;
          l = s.filter(l, 0, s.g, pos);
          r = s.filter(r, 1, s.g, pos);
        }
        if (s.driveOn) {
          s.gain += s.gainStep;
          const dl = s.shape(l, 0), dr = s.shape(r, 1), k = this.envK;
          s.inEnv += (Math.abs(l) + Math.abs(r) - s.inEnv) * k;
          s.outEnv += (Math.abs(dl) + Math.abs(dr) - s.outEnv) * k;
          const match = s.outEnv > 1e-9 ? Math.min(2, s.inEnv / s.outEnv) : 1;
          l += (dl * match - l) * s.mix;
          r += (dr * match - r) * s.mix;
        }
      }
      if (i === 1 && this.midOtt.on) {
        this.midOtt.process(l, r);
        l = this.midOtt.l;
        r = this.midOtt.r;
      }
    }
    this.combPos = (pos + 1) & (COMB_LEN - 1);
    const dx = this.dcX, dy = this.dcY, R = this.dcR;
    dy[0] = l - dx[0] + R * dy[0];
    dx[0] = l;
    dy[1] = r - dx[1] + R * dy[1];
    dx[1] = r;
    // the chain's level back to what came in (slow, so the talk's own swells stay)
    const k = this.lvlK;
    this.inLvl += (hiL * hiL + hiR * hiR - this.inLvl) * k;
    this.outLvl += (dy[0] * dy[0] + dy[1] * dy[1] - this.outLvl) * k;
    const back = this.outLvl > 1e-12 ? Math.min(4, Math.max(0.25, Math.sqrt(this.inLvl / this.outLvl))) : 1;
    const m = this.mix;
    this.l = lowL + hiL + (dy[0] * back - hiL) * m;
    this.r = lowR + hiR + (dy[1] * back - hiR) * m;
  }
}
