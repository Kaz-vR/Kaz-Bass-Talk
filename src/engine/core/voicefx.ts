// Voice building blocks added for full bass-directory coverage: 303-style
// diode filter, comb filter, physical-model string, Shepard-tone oscillator
// and the attack transient layer. All state is preallocated; nothing here
// allocates after construction.

import { fastTanh, Rng, Svf, TWO_PI } from './dsp';

/**
 * 3-pole (18 dB/oct) diode-style ladder, the 303 filter's character: each
 * stage saturates and the feedback loop is looser than a Moog ladder, so it
 * squelches and growls rather than whistling.
 */
export class DiodeLadder {
  private s1 = 0;
  private s2 = 0;
  private s3 = 0;
  private y = 0;

  reset(): void {
    this.s1 = this.s2 = this.s3 = this.y = 0;
  }

  /** g = tan(π·fc/fs); k = feedback 0..~7 */
  process(x: number, g: number, k: number): number {
    const G = g / (1 + g);
    const u = fastTanh(x * (1 + 0.15 * k) - k * this.y);
    let v = (u - this.s1) * G;
    const y1 = v + this.s1;
    this.s1 = y1 + v;
    v = (fastTanh(y1) - this.s2) * G;
    const y2 = v + this.s2;
    this.s2 = y2 + v;
    v = (y2 - this.s3) * G;
    const y3 = v + this.s3;
    this.s3 = y3 + v;
    this.y = y3;
    return y3;
  }
}

/**
 * Feedback comb filter: rings at the cutoff frequency and its harmonics.
 * Sweeping it gives metallic, robotic growls.
 */
export class Comb {
  private buf: Float64Array;
  private mask: number;
  private w = 0;

  constructor(maxDelaySamples: number) {
    let size = 1;
    while (size < maxDelaySamples + 4) size <<= 1;
    this.buf = new Float64Array(size);
    this.mask = size - 1;
  }

  reset(): void {
    this.buf.fill(0);
  }

  process(x: number, delaySamples: number, feedback: number): number {
    const pos = this.w - delaySamples;
    const i = Math.floor(pos);
    const f = pos - i;
    const a = this.buf[i & this.mask];
    const d = a + (this.buf[(i + 1) & this.mask] - a) * f;
    const y = x + feedback * d;
    this.buf[this.w] = y > 4 ? 4 : y < -4 ? -4 : y;
    this.w = (this.w + 1) & this.mask;
    return y * (1 - 0.7 * Math.abs(feedback));
  }
}

/**
 * Karplus-Strong plucked string with a tunable loop filter. Excited with a
 * filtered noise burst on each note; the loop low-pass sets brightness and
 * the loop gain sets how long it rings.
 */
export class KarplusString {
  private buf: Float64Array;
  private mask: number;
  private w = 0;
  private lp = 0;
  private dc = 0;
  private dcIn = 0;
  private readonly rng = new Rng(0x5eed);
  private excite = 0; // samples of excitation left
  private exciteLp = 0;

  constructor(maxPeriodSamples: number) {
    let size = 1;
    while (size < maxPeriodSamples + 8) size <<= 1;
    this.buf = new Float64Array(size);
    this.mask = size - 1;
  }

  reset(): void {
    this.buf.fill(0);
    this.lp = this.dc = this.dcIn = 0;
  }

  /** Pluck: inject a noise burst one period long. */
  pluck(periodSamples: number): void {
    this.excite = Math.max(1, Math.round(periodSamples));
    this.exciteLp = 0;
  }

  /**
   * One sample. period = fs / f0; tone 0..1 = loop brightness;
   * gain = loop gain per period (from the sustain setting).
   */
  process(period: number, tone: number, loopGain: number): number {
    // Loop low-pass: a one-pole whose delay is compensated below.
    const a = 0.08 + 0.9 * tone; // one-pole coefficient (1 = no filtering)
    const filterDelay = (1 - a) / a;
    const d = Math.max(2, period - filterDelay - 1);
    const pos = this.w - d;
    const i = Math.floor(pos);
    const f = pos - i;
    const s0 = this.buf[i & this.mask];
    const delayed = s0 + (this.buf[(i + 1) & this.mask] - s0) * f;
    this.lp += (delayed - this.lp) * a;
    let input = 0;
    if (this.excite > 0) {
      // Excitation: noise, darkened for low tone settings.
      this.exciteLp += (this.rng.next() - this.exciteLp) * (0.15 + 0.85 * tone);
      input = this.exciteLp;
      this.excite--;
    }
    const y = this.lp * loopGain + input;
    this.buf[this.w] = y;
    this.w = (this.w + 1) & this.mask;
    // DC blocker on the output.
    const out = y - this.dcIn + 0.995 * this.dc;
    this.dcIn = y;
    this.dc = out;
    return out;
  }
}

const SHEPARD_PARTIALS = 8;

/**
 * Shepard tone: octave-spaced sines under a fixed bell-shaped loudness curve
 * on a log-frequency axis. Gliding all partials together while the curve
 * stays put gives an endlessly rising or falling pitch.
 */
export class Shepard {
  private phase = new Float64Array(SHEPARD_PARTIALS);
  private pos = 0; // 0..1 octave offset

  reset(): void {
    this.phase.fill(0);
    this.pos = 0;
  }

  /** inc = phase increment of the note (cycles/sample); rate = octaves per second (signed). */
  process(inc: number, rateOctPerSample: number): number {
    this.pos += rateOctPerSample;
    if (this.pos >= 1) {
      this.pos -= 1;
      for (let j = 0; j < SHEPARD_PARTIALS - 1; j++) this.phase[j] = this.phase[j + 1];
      this.phase[SHEPARD_PARTIALS - 1] = 0;
    } else if (this.pos < 0) {
      this.pos += 1;
      for (let j = SHEPARD_PARTIALS - 1; j > 0; j--) this.phase[j] = this.phase[j - 1];
      this.phase[0] = 0;
    }
    let out = 0, wsum = 0;
    const center = SHEPARD_PARTIALS / 2 - 1; // partial 3 sits on the note
    for (let j = 0; j < SHEPARD_PARTIALS; j++) {
      const oct = j - center + this.pos; // octaves from the note
      const w = Math.exp(-((oct - 0.5) * (oct - 0.5)) / 1.6);
      wsum += w;
      const pinc = inc * Math.pow(2, oct);
      if (pinc >= 0.45) continue;
      let ph = this.phase[j] + pinc;
      if (ph >= 1) ph -= 1;
      this.phase[j] = ph;
      out += w * Math.sin(TWO_PI * ph);
    }
    return wsum > 0 ? (out / wsum) * 1.6 : 0;
  }
}

export const CLICK_NOISE = 0, CLICK_CLICK = 1, CLICK_KNOCK = 2, CLICK_KICK = 3;

/**
 * Attack transient layer: a short, separately enveloped noise burst, tick,
 * woody knock or pitched kick drum, added on top of each note (it bypasses
 * the filter so it stays crisp).
 */
export class Transient {
  private env = 0;
  private envCoef = 0.99;
  private phase = 0;
  private freq = 0; // cycles/sample
  private freqTarget = 0;
  private sweep = 0.999;
  private readonly svf = new Svf();
  private readonly rng = new Rng(0xc11c);
  private type = CLICK_CLICK;
  private g = 0.1;

  reset(): void {
    this.env = 0;
    this.svf.reset();
  }

  /**
   * Fire on a new note. tone = Hz (filter for noise/click, start pitch for
   * knock/kick), noteHz = the note's pitch (kick drops to it).
   */
  trigger(type: number, decayMs: number, tone: number, noteHz: number, fs: number): void {
    this.type = type;
    this.env = 1;
    this.envCoef = Math.exp(-4.6 / Math.max(1, (decayMs / 1000) * fs));
    this.phase = 0;
    this.g = Math.tan((Math.PI * Math.min(tone, fs * 0.45)) / fs);
    if (type === CLICK_KNOCK) {
      this.freq = tone / fs;
      this.freqTarget = (tone * 0.6) / fs;
      this.sweep = Math.exp(-1 / (0.01 * fs));
    } else if (type === CLICK_KICK) {
      this.freq = tone / fs;
      this.freqTarget = Math.max(30, noteHz) / fs;
      this.sweep = Math.exp(-1 / (Math.max(5, decayMs * 0.25) * 0.001 * fs));
    }
  }

  process(): number {
    if (this.env < 1e-5) return 0;
    let y: number;
    switch (this.type) {
      case CLICK_NOISE:
        this.svf.process(this.rng.next(), this.g, 0.7);
        y = this.svf.bp * 1.4;
        break;
      case CLICK_CLICK:
        this.svf.process(this.rng.next(), this.g, 1.2);
        y = this.svf.hp;
        break;
      case CLICK_KNOCK:
      default: {
        this.freq = this.freqTarget + (this.freq - this.freqTarget) * this.sweep;
        this.phase += this.freq;
        if (this.phase >= 1) this.phase -= 1;
        y = Math.sin(TWO_PI * this.phase);
        if (this.type === CLICK_KICK) y = fastTanh(2.2 * y);
      }
    }
    y *= this.env;
    this.env *= this.envCoef;
    return y;
  }
}
