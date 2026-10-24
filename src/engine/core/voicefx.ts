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

export const TEX_CRACKLE = 0, TEX_DUST = 1, TEX_RUMBLE = 2, TEX_AIR = 3, TEX_AIR_HIT = 4, TEX_TAPE = 5, TEX_STATIC = 6;
/**
 * The HIT types: each bed as one burst per note (fading over Tail), nothing between. Air's hit is
 * the breath. Grain hits start on their first grain; noise hits swell in over ~10 ms.
 */
export const TEX_CRACKLE_HIT = 7, TEX_DUST_HIT = 8, TEX_STATIC_HIT = 9, TEX_TAPE_HIT = 10, TEX_RUMBLE_HIT = 11;
/** The bed each type plays (a hit plays its bed), by texture.type index. */
const TEX_BED = [TEX_CRACKLE, TEX_DUST, TEX_RUMBLE, TEX_AIR, TEX_AIR, TEX_TAPE, TEX_STATIC, TEX_CRACKLE, TEX_DUST, TEX_STATIC, TEX_TAPE, TEX_RUMBLE];

/**
 * Texture bed. Grains: crackle (vinyl pops, nothing else), dust (fine grit),
 * static (grainy radio fizz with crackles). Noise: tape hiss, air (a broad
 * breathy band), breath (mouth-like, a puff at each note), wind (gusts),
 * rumble (low and dark, kept above the sub). No pitch and no rhythm in any of
 * them. Density: on the grains how many, on the noise how thick (how much of
 * the range the band fills); its middle (0.5) is each type's classic sound. Stereo except rumble, which is mono. Each type
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
  private wander = 0;
  private wanderTarget = 0;
  private wanderCount = 0;
  // Air breathes on its own, slower and shallower clock (breath, not gusts).
  private breath = 0;
  private breathTarget = 0;
  private breathCount = 0;
  /** Breath's puff at each new note: a quick swell in (puffIn) times a fade (puffOut) lasting puffLen seconds (Tail). */
  private puffIn = 0;
  private puffOut = 0;
  puffLen = 0.7;

  // Static's fast flicker (too fast to hear as rhythm: it is the grain).
  private flick = 0;
  private flickG = 1;

  /** The newest note's velocity (0..1): a harder note, a bigger puff or burst. */
  private hitVel = 1;
  /** A burst starts with a grain right on the note, so every hit has its attack. */
  private hitKick = false;

  /** A new note started: breath puffs, the HIT types burst. */
  trigger(velocity = 1): void {
    this.puffIn = 0;
    this.puffOut = 1;
    this.hitVel = 0.35 + 0.65 * Math.max(0, Math.min(1, velocity));
    this.hitKick = true;
  }

  reset(): void {
    this.svfL.reset();
    this.svfR.reset();
    this.svf2.reset();

  }

  /**
   * One stereo sample into out[0], out[1]. tone 0..1 (dark..bright); density 0..1 (grains: how
   * many; noise: how thick), its middle (0.5) each type's classic sound.
   */
  process(type: number, tone: number, density: number, fs: number, out: Float64Array): void {
    const k = density - 0.5;
    // the noise types: a thicker band at higher density (wider), its level held about even
    const wide = Math.pow(2, 1.6 * k);
    // Slow level wander (new target every 0.4-1.6 s).
    if (--this.wanderCount <= 0) {
      this.wanderTarget = this.rngW.next();
      this.wanderCount = Math.round((0.4 + 0.6 * (this.rngW.next() + 1)) * fs);
    }
    this.wander += (this.wanderTarget - this.wander) * (8 / fs);
    const w = 1 + 0.45 * this.wander;
    // HIT: the same generator as the bed it is named after, inside one burst per note
    const typeIn = type;
    const hit = type === TEX_AIR_HIT || type >= TEX_CRACKLE_HIT;
    type = TEX_BED[type] ?? TEX_AIR;
    const grain = type === TEX_CRACKLE || type === TEX_DUST || type === TEX_STATIC;
    if (hit) {
      this.puffIn += (1 - this.puffIn) * (1 / (0.01 * fs));
      this.puffOut *= Math.exp(-4.6 / (Math.max(0.02, this.puffLen) * fs));
    }
    // a grain burst is short: its grains come four times as often as in the bed, and the first lands on the note
    const boost = hit && grain ? 4 : 1;
    const kick = hit && grain && this.hitKick;
    if (kick) this.hitKick = false;
    let l: number, r: number;
    switch (type) {
      case TEX_CRACKLE: {
        // Vinyl pops only: random sizes (mostly small, a few big) ringing a resonant band (Tone).
        // density: a rare pop .. a broken record
        const p = ((16 * boost) / fs) * Math.pow(2, 5 * k);
        const g = Math.tan((Math.PI * Math.min(1500 * Math.pow(4, tone), fs * 0.4)) / fs);
        const el = kick ? 0.8 : 0.5 * (this.rngL.next() + 1) < p ? popSize(this.rngL) : 0;
        const er = kick ? -0.7 : 0.5 * (this.rngR.next() + 1) < p ? popSize(this.rngR) : 0;
        this.svfL.process(el, g, 1.1);
        this.svfR.process(er, g, 1.1);
        l = 40 * this.svfL.bp;
        r = 40 * this.svfR.bp;
        break;
      }
      case TEX_DUST: {
        // Dense tiny ticks, high-passed: fine grit.
        // density: sparse .. dense grit
        const p = ((250 + 900 * tone) / fs) * Math.pow(2, 3 * k);
        const g = Math.tan((Math.PI * Math.min(2500 * Math.pow(2.5, tone), fs * 0.4)) / fs);
        const el = kick ? 0.9 : 0.5 * (this.rngL.next() + 1) < p ? this.rngL.next() : 0;
        const er = kick ? -0.9 : 0.5 * (this.rngR.next() + 1) < p ? this.rngR.next() : 0;
        this.svfL.process(el, g, 0.9);
        this.svfR.process(er, g, 0.9);
        l = 4 * this.svfL.hp * w;
        r = 4 * this.svfR.hp * w;
        break;
      }
      case TEX_RUMBLE: {
        // Low, dark noise: low-passed at 140-400 Hz (Tone), high-passed at ~110 Hz so it stays off
        // the sub, churning slowly. Mono. density: a narrow low growl .. a broad, heavy one.
        const g = Math.tan((Math.PI * Math.min((140 + 260 * tone) * wide, fs * 0.4)) / fs);
        this.svfL.process(this.rngL.next(), g, 0.9);
        this.svf2.process(this.svfL.lp, Math.tan((Math.PI * 110) / fs), 1.2);
        l = r = (2.4 / Math.sqrt(wide)) * this.svf2.hp * (0.6 + 0.4 * w);
        break;
      }
      case TEX_TAPE: {
        // Tape hiss: a steady, fine hiss above Tone's corner. density: thin and fine .. thick and
        // full (the corner comes down, so more of the range hisses).
        const g = Math.tan((Math.PI * Math.min((2000 * Math.pow(4, tone)) / (wide * wide), fs * 0.4)) / fs);
        this.svfL.process(this.rngL.next(), g, 1.4);
        this.svfR.process(this.rngR.next(), g, 1.4);
        const a = 0.48 * Math.pow(wide, -0.3) * (0.9 + 0.1 * w);
        l = this.svfL.hp * a;
        r = this.svfR.hp * a;
        break;
      }
      case TEX_STATIC: {
        // Radio static: a band of noise with a fast random flicker (its grain, far too quick to
        // hear as a rhythm) and crackles. density: a soft fizz .. a harsh, crunchy one (more crackles).
        if (--this.flick <= 0) {
          this.flickG = 0.35 + 0.65 * Math.abs(this.rngW.next());
          this.flick = Math.round(fs / (300 + 300 * (this.rngW.next() + 1)));
        }
        const g = Math.tan((Math.PI * Math.min(1500 * Math.pow(3, tone), fs * 0.4)) / fs);
        const pop = kick ? 6 : 0.5 * (this.rngW.next() + 1) < (35 * boost * Math.pow(2, 4 * k)) / fs ? this.rngW.next() * 6 : 0;
        this.svfL.process(this.rngL.next() * this.flickG + pop, g, 1.2);
        this.svfR.process(this.rngR.next() * this.flickG + pop, g, 1.2);
        l = 1.6 * this.svfL.bp;
        r = 1.6 * this.svfR.bp;
        break;
      }
      default: {
        // Air: a broad band of breathy noise that swells and fades like slow
        // breathing: a new target every 2-5 s, glided to, about ±4 dB.
        // density: a thin wisp .. a thick wall of air
        if (--this.breathCount <= 0) {
          this.breathTarget = this.rngW.next();
          this.breathCount = Math.round((2 + 1.5 * (this.rngW.next() + 1)) * fs);
        }
        this.breath += (this.breathTarget - this.breath) * (1.5 / fs);
        const b = Math.exp(0.46 * this.breath);
        const g = Math.tan((Math.PI * Math.min(1000 * Math.pow(6, tone), fs * 0.4)) / fs);
        const q = 1.5 * wide;
        this.svfL.process(this.rngL.next(), g, q);
        this.svfR.process(this.rngR.next(), g, q);
        l = 2.4 * Math.sqrt(wide) * this.svfL.bp * b;
        r = 2.4 * Math.sqrt(wide) * this.svfR.bp * b;
      }
    }
    // a HIT fades over Tail: a grain hit starts at once (its first grain is the attack), a noise
    // hit swells in over ~10 ms so it never clicks
    if (hit) {
      const e = (grain ? 1 : this.puffIn) * this.puffOut * this.hitVel;
      l *= e;
      r *= e;
    }
    // every type at the same loudness (K-weighted) across its Tone, so switching types keeps the level
    const g = texTrim(typeIn, tone);
    l *= g;
    r *= g;
    out[0] = l;
    out[1] = r;
  }
}

/**
 * Loudness trim per type (dB) at Tone 0, 0.25, 0.5, 0.75, 1 (measured K-weighted at Density 0.5,
 * hits over their burst), so every type plays at the same loudness wherever its Tone is. Made by
 * tools/level-texture.ts (run it with this table at 0 after changing a type's sound).
 */
const TEX_TRIM_DB: number[][] = [
  [7.8, 6, 4.4, 3.1, 2.1],
  [4.4, 1.5, -0.2, -1.3, -2.1],
  [11.4, 8, 6.2, 5, 4],
  [1.5, -0.8, -2.9, -4.6, -5.8],
  [8.6, 6.3, 4.2, 2.5, 1.3],
  [-2.5, -2.3, -2.1, -1.7, -1.1],
  [1.7, 0.2, -1, -2.1, -3.1],
  [3.7, 1.9, 0.4, -0.9, -1.9],
  [8.8, 6.4, 5.1, 4, 3.4],
  [6.2, 4.8, 3.5, 2.4, 1.5],
  [4.4, 4.6, 4.8, 5.2, 5.8],
  [18, 14.7, 12.9, 11.7, 10.8],
];
const TEX_TRIM = TEX_TRIM_DB.map((row) => row.map((db) => Math.pow(10, db / 20)));
function texTrim(type: number, tone: number): number {
  const row = TEX_TRIM[type] ?? TEX_TRIM[0];
  const f = Math.max(0, Math.min(1, tone)) * 4, i = Math.min(3, Math.floor(f));
  return row[i] + (row[i + 1] - row[i]) * (f - i);
}

/** Pop amplitude: mostly small, occasionally big, random polarity. */
function popSize(rng: InstanceType<typeof Rng_>): number {
  const u = 0.5 * (rng.next() + 1);
  return (0.15 + 0.85 * u * u * u) * (rng.next() < 0 ? -1 : 1);
}
