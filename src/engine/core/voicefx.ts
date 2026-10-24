// Voice building blocks added for full bass-directory coverage: 303-style
// diode filter, comb filter, physical-model string, Shepard-tone oscillator
// and the texture bed. All state is preallocated; nothing here
// allocates after construction.

import { fastTanh as fastTanh_, Rng as Rng_, Svf as Svf_, TWO_PI as TWO_PI_ } from './dsp';

// Module-local bindings: avoids live-binding getter overhead on hot paths in
// some module transforms (tsx / vite-node).
const fastTanh = fastTanh_;
const Rng = Rng_;
const Svf = Svf_;
const TWO_PI = TWO_PI_;

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

export const TEX_CRACKLE = 0, TEX_DUST = 1, TEX_RUMBLE = 2, TEX_AIR = 3, TEX_BREATH = 4, TEX_TAPE = 5, TEX_STATIC = 6, TEX_HUM = 7, TEX_WIND = 8, TEX_MACHINE = 9;

/**
 * Texture bed: crackle (vinyl pops over faint surface noise), dust (fine
 * grit), rumble (a low, dark, slowly breathing hum kept above the sub) or air
 * (breathy band of noise). Stereo except rumble, which is mono. Each type
 * wanders slowly in level so it never sits still. Output gains put each
 * type at a similar loudness at full level (crackle a little lower in
 * energy, since its pops read louder than their energy). It has its own random
 * generators, so switching it on doesn't change anything else in the patch.
 */
export class Texture {
  private readonly rngL = new Rng(0x7e47c0);
  private readonly rngR = new Rng(0x51de55);
  private readonly rngW = new Rng(0x3a11ee);
  private readonly svfL = new Svf();
  private readonly svfR = new Svf();
  private readonly svf2 = new Svf();
  private lpL = 0;
  private lpR = 0;
  private wander = 0;
  private wanderTarget = 0;
  private wanderCount = 0;
  // Air breathes on its own, slower and shallower clock (breath, not gusts).
  private breath = 0;
  private breathTarget = 0;
  private breathCount = 0;
  /** Breath's soft puff at each new note (set by trigger(), dies away in ~150 ms). */
  private puff = 0;

  // Tape hiss dropouts, static bursts, hum and machine phases, wind gusts.
  private dropT = 0;
  private dropG = 1;
  private flutPh = 0;
  private burstCount = 0;
  private burstLvl = 0;
  private burstG = 0;
  private humPh = 0;
  private gust = 0;
  private gustTarget = 0;
  private gustCount = 0;
  private machPh = 0;
  private cyclePh = 0;
  private readonly svf3 = new Svf();

  /** A new note started: breath takes a small breath in. */
  trigger(): void {
    this.puff = 1;
  }

  reset(): void {
    this.svf3.reset();
    this.svfL.reset();
    this.svfR.reset();
    this.svf2.reset();
    this.lpL = this.lpR = 0;
  }

  /**
   * One stereo sample into out[0], out[1]. tone 0..1 (dark..bright); character 0..1 is the
   * variation within the type, its middle (0.5) each type as it always was.
   */
  process(type: number, tone: number, character: number, fs: number, out: Float64Array): void {
    const k = character - 0.5;
    // Slow level wander (new target every 0.4-1.6 s).
    if (--this.wanderCount <= 0) {
      this.wanderTarget = this.rngW.next();
      this.wanderCount = Math.round((0.4 + 0.6 * (this.rngW.next() + 1)) * fs);
    }
    this.wander += (this.wanderTarget - this.wander) * (8 / fs);
    const w = 1 + 0.45 * this.wander;
    let l: number, r: number;
    switch (type) {
      case TEX_CRACKLE: {
        // Sparse pops of random size (mostly small, a few big) ringing a resonant band, over faint surface hiss.
        // character: clean vinyl (few pops, little surface) .. a broken record (many, big)
        const p = ((6 + 30 * tone) / fs) * Math.pow(2, 4 * k);
        const g = Math.tan((Math.PI * Math.min(1500 * Math.pow(4, tone), fs * 0.4)) / fs);
        const pop = 1 + 1.2 * k;
        const el = 0.5 * (this.rngL.next() + 1) < p ? popSize(this.rngL) * pop : 0;
        const er = 0.5 * (this.rngR.next() + 1) < p ? popSize(this.rngR) * pop : 0;
        this.svfL.process(el, g, 1.1);
        this.svfR.process(er, g, 1.1);
        this.lpL += (this.rngL.next() - this.lpL) * 0.25;
        this.lpR += (this.rngR.next() - this.lpR) * 0.25;
        l = 24 * this.svfL.bp + 0.27 * (1 + k) * this.lpL;
        r = 24 * this.svfR.bp + 0.27 * (1 + k) * this.lpR;
        break;
      }
      case TEX_DUST: {
        // Dense tiny ticks, high-passed: fine grit.
        // character: sparse .. dense grit
        const p = ((250 + 900 * tone) / fs) * Math.pow(2, 3 * k);
        const g = Math.tan((Math.PI * Math.min(2500 * Math.pow(2.5, tone), fs * 0.4)) / fs);
        const el = 0.5 * (this.rngL.next() + 1) < p ? this.rngL.next() : 0;
        const er = 0.5 * (this.rngR.next() + 1) < p ? this.rngR.next() : 0;
        this.svfL.process(el, g, 0.9);
        this.svfR.process(er, g, 0.9);
        l = 4 * this.svfL.hp * w;
        r = 4 * this.svfR.hp * w;
        break;
      }
      case TEX_RUMBLE: {
        // Low, dark hum: noise low-passed at 140-400 Hz, high-passed at ~110 Hz so it stays off the sub. Mono.
        const g = Math.tan((Math.PI * (140 + 260 * tone)) / fs);
        this.svfL.process(this.rngL.next(), g, 0.9);
        this.svf2.process(this.svfL.lp, Math.tan((Math.PI * 110) / fs), 1.2);
        // character: steady .. churning
        const m = 0.4 * (1 + 2 * k);
        l = r = 2.4 * this.svf2.hp * (1 - m + m * w);
        break;
      }
      case TEX_BREATH: {
        // Breath: a narrower, mouth-like band of noise (500 Hz .. 8 kHz with tone), a soft puff at
        // each new note, and the same slow wander as the other beds.
        this.puff *= Math.exp(-1 / (0.15 * fs));
        // character: a soft exhale .. a harsh, narrow inhale with a bigger puff
        const g = Math.tan((Math.PI * Math.min(500 * Math.pow(16, tone) * Math.pow(2, k), fs * 0.4)) / fs);
        const q = 1.1 * Math.pow(2, -1.5 * k);
        this.svfL.process(this.rngL.next(), g, q);
        this.svfR.process(this.rngR.next(), g, q);
        const a = 1.85 * (0.75 + 0.25 * w) * (1 + 1.2 * (1 + 2 * k) * this.puff) * Math.sqrt(q / 1.1);
        l = this.svfL.bp * a;
        r = this.svfR.bp * a;
        break;
      }
      case TEX_TAPE: {
        // Tape hiss: high, fine hiss; character: clean .. worn (flutter and short dropouts).
        const g = Math.tan((Math.PI * Math.min(2000 * Math.pow(4, tone), fs * 0.4)) / fs);
        this.svfL.process(this.rngL.next(), g, 1.4);
        this.svfR.process(this.rngR.next(), g, 1.4);
        const worn = Math.max(0, 2 * k);
        if (this.dropT > 0) this.dropT--;
        else if (worn > 0 && 0.5 * (this.rngW.next() + 1) < (1.5 * worn) / fs) this.dropT = Math.round((0.04 + 0.08 * 0.5 * (this.rngW.next() + 1)) * fs);
        this.dropG += ((this.dropT > 0 ? 0.15 : 1) - this.dropG) * (200 / fs);
        this.flutPh += 6 / fs;
        if (this.flutPh >= 1) this.flutPh -= 1;
        const a = 0.48 * this.dropG * (1 - 0.3 * worn * (0.5 + 0.5 * Math.sin(2 * Math.PI * this.flutPh))) * (0.9 + 0.1 * w);
        l = this.svfL.hp * a;
        r = this.svfR.hp * a;
        break;
      }
      case TEX_STATIC: {
        // Radio static: a band of noise that jumps between levels in bursts, with pops;
        // character: soft static .. a broken transmission (gaps, more pops).
        if (--this.burstCount <= 0) {
          const u = 0.5 * (this.rngW.next() + 1);
          this.burstLvl = u < 0.25 + 0.5 * character ? (u < 0.15 * character ? 0 : 0.3 + 0.7 * u) : 0.6 + 0.4 * u;
          this.burstCount = Math.round((0.02 + 0.18 * 0.5 * (this.rngW.next() + 1)) * fs);
        }
        this.burstG += (this.burstLvl - this.burstG) * (400 / fs);
        const g = Math.tan((Math.PI * Math.min(1500 * Math.pow(3, tone), fs * 0.4)) / fs);
        const pop = 0.5 * (this.rngW.next() + 1) < (5 + 60 * character) / fs ? this.rngW.next() * 6 : 0;
        this.svfL.process(this.rngL.next() + pop, g, 1.2);
        this.svfR.process(this.rngR.next() + pop, g, 1.2);
        l = 1.8 * this.svfL.bp * this.burstG;
        r = 1.8 * this.svfR.bp * this.burstG;
        break;
      }
      case TEX_HUM: {
        // Mains hum: the 2nd to 8th harmonics of 50 Hz (100 Hz up, so it stays off the sub), tone
        // leans to the upper ones; character: clean .. dirty, buzzing (driven harder). Mono.
        this.humPh += 50 / fs;
        if (this.humPh >= 1) this.humPh -= 1;
        let x = 0;
        for (let n = 2; n <= 8; n++) x += Math.sin(2 * Math.PI * n * this.humPh) * Math.pow(1 / n, 1.6 - 1.4 * tone);
        const drive = 1 + 8 * character * character;
        x = Math.tanh(x * drive) / Math.tanh(drive);
        l = r = 0.32 * x * (0.85 + 0.15 * w) + 0.02 * this.rngL.next();
        break;
      }
      case TEX_WIND: {
        // Wind: noise through a band that wanders with slow gusts; character: a breeze .. howling
        // (a narrower, whistling band and stronger gusts).
        if (--this.gustCount <= 0) {
          this.gustTarget = this.rngW.next();
          this.gustCount = Math.round((1.5 + 1.25 * (this.rngW.next() + 1)) * fs);
        }
        this.gust += (this.gustTarget - this.gust) * (1.2 / fs);
        const f = Math.min(300 * Math.pow(10, tone) * Math.pow(2, 1.2 * this.gust), fs * 0.4);
        const g = Math.tan((Math.PI * f) / fs), q = 1.6 - 1.4 * character;
        this.svfL.process(this.rngL.next(), g, q);
        this.svfR.process(this.rngR.next(), g, q);
        const a = 6.2 * Math.sqrt(q / 1.6) * (0.45 + 0.55 * (0.5 + 0.5 * this.gust) * (1 + character));
        l = this.svfL.bp * a;
        r = this.svfR.bp * a;
        break;
      }
      case TEX_MACHINE: {
        // A distant machine: a low drone (harmonics of ~90-250 Hz with tone), muffled noise and a
        // slow working cycle; character: smooth ventilation .. clanking (ticks every cycle).
        const f0 = 90 * Math.pow(2.8, tone);
        this.machPh += f0 / fs;
        if (this.machPh >= 1) this.machPh -= 1;
        // the working cycle; clanking adds a tick four times per cycle
        const before = this.cyclePh;
        this.cyclePh += 0.7 / fs;
        if (this.cyclePh >= 1) this.cyclePh -= 1;
        const tick = character > 0.5 && Math.floor(this.cyclePh * 4) !== Math.floor(before * 4) ? 8 * (character - 0.5) : 0;
        const drone = Math.sin(2 * Math.PI * this.machPh) * 0.5 + Math.sin(4 * Math.PI * this.machPh) * 0.3 + Math.sin(6 * Math.PI * this.machPh) * 0.15;
        this.svfL.process(this.rngL.next(), Math.tan((Math.PI * 600 * Math.pow(2, tone)) / fs), 1.0);
        this.svf3.process(tick, Math.tan((Math.PI * 2500) / fs), 0.15);
        // character: smooth (more drone, a gentle cycle) .. rough (more noise, a deeper cycle)
        const cyc = 1 - 0.6 * character * (0.5 + 0.5 * Math.sin(2 * Math.PI * this.cyclePh));
        const x = (0.35 * (1.5 - character) * drone + 0.9 * (0.5 + character) * this.svfL.lp) * cyc * (0.85 + 0.15 * w) + 1.5 * this.svf3.bp;
        this.svf2.process(x, Math.tan((Math.PI * 80) / fs), 0.9);
        l = r = 1.2 * this.svf2.hp;
        break;
      }
      default: {
        // Air: a broad band of breathy noise that swells and fades like slow
        // breathing: a new target every 2-5 s, glided to, about ±4 dB.
        if (--this.breathCount <= 0) {
          this.breathTarget = this.rngW.next();
          this.breathCount = Math.round((2 + 1.5 * (this.rngW.next() + 1)) * fs);
        }
        this.breath += (this.breathTarget - this.breath) * (1.5 / fs);
        // character: still .. drafty (deeper breathing)
        const b = Math.exp(0.46 * (1 + 2 * k) * this.breath);
        const g = Math.tan((Math.PI * Math.min(1000 * Math.pow(6, tone), fs * 0.4)) / fs);
        this.svfL.process(this.rngL.next(), g, 1.5);
        this.svfR.process(this.rngR.next(), g, 1.5);
        l = 2.4 * this.svfL.bp * b;
        r = 2.4 * this.svfR.bp * b;
      }
    }
    out[0] = l;
    out[1] = r;
  }
}

/** Pop amplitude: mostly small, occasionally big, random polarity. */
function popSize(rng: InstanceType<typeof Rng_>): number {
  const u = 0.5 * (rng.next() + 1);
  return (0.15 + 0.85 * u * u * u) * (rng.next() < 0 ? -1 : 1);
}
