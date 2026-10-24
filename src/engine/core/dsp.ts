// Small DSP building blocks. All state lives in preallocated fields; nothing
// here allocates after construction.

export const TWO_PI = Math.PI * 2;

/**
 * Transparent peak soft clipper: identity up to the knee t, then a tanh curve
 * that eases toward t + w. Everything under the knee keeps its level, so the
 * clipped sound is denser at the same loudness (no make-up gain needed).
 */
export function softClip(x: number, t: number, w: number): number {
  const a = x < 0 ? -x : x;
  if (a <= t) return x;
  const y = t + w * Math.tanh((a - t) / w);
  return x < 0 ? -y : y;
}

/**
 * A transparent soft clipper with automatic level matching: it compares the loudness going in
 * and coming out (300 ms power followers) and makes up the difference, so switching it on
 * sounds denser and fuller, not quieter or louder. Knee = drive below the nominal peak.
 */
export class Clipper {
  private pin = 1e-12;
  private pout = 1e-12;
  private readonly a: number;
  knee = 0;

  constructor(fs: number) {
    this.a = 1 - Math.exp(-1 / (0.3 * fs));
  }

  setDrive(driveDb: number): void {
    this.knee = driveDb > 0 ? Math.pow(10, -driveDb / 20) : 0;
  }

  reset(): void {
    this.pin = this.pout = 1e-12;
  }

  /** Clip l/r against nominal peak c (mono power for the level match); writes into out. */
  process(l: number, r: number, c: number, out: Float64Array): void {
    const t = this.knee * c, w = 0.5 * (c - t);
    const yl = softClip(l, t, w), yr = softClip(r, t, w);
    this.pin += (l * l + r * r - this.pin) * this.a;
    this.pout += (yl * yl + yr * yr - this.pout) * this.a;
    let g = Math.sqrt(this.pin / this.pout);
    g = g < 1 ? 1 : g > 2 ? 2 : g;
    out[0] = yl * g;
    out[1] = yr * g;
  }
}

export function clamp(x: number, lo: number, hi: number): number {
  return x < lo ? lo : x > hi ? hi : x;
}

/** Rational tanh approximation, exact at ±3 and saturating beyond. */
export function fastTanh(x: number): number {
  if (x > 3) return 1;
  if (x < -3) return -1;
  const x2 = x * x;
  return (x * (27 + x2)) / (27 + 9 * x2);
}

export function dbToGain(db: number): number {
  return Math.pow(10, db / 20);
}

/** Two-sided PolyBLEP residual for a discontinuity at phase 0. */
export function polyBlep(t: number, dt: number): number {
  if (dt <= 0) return 0;
  if (t < dt) {
    t /= dt;
    return t + t - t * t - 1;
  }
  if (t > 1 - dt) {
    t = (t - 1) / dt;
    return t * t + t + t + 1;
  }
  return 0;
}

/** Deterministic xorshift32 PRNG, returns floats in [-1, 1). */
export class Rng {
  private s: number;
  constructor(seed = 0x9e3779b9) {
    this.s = seed >>> 0 || 1;
  }
  next(): number {
    let x = this.s;
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    this.s = x >>> 0;
    return (this.s / 0x80000000) - 1;
  }
}

/** Zero-delay-feedback 4-pole ladder low-pass (Zavalishin TPT form). */
export class Ladder {
  private s1 = 0;
  private s2 = 0;
  private s3 = 0;
  private s4 = 0;

  reset(): void {
    this.s1 = this.s2 = this.s3 = this.s4 = 0;
  }

  /** g = tan(π·fc/fs); k = feedback 0..~3.9 */
  process(x: number, g: number, k: number): number {
    return this.processG(x, g / (1 + g), k);
  }

  /** Same as process() with G = g / (1 + g) precomputed (share it across channels). */
  processG(x: number, G: number, k: number): number {
    const b = 1 - G;
    const G2 = G * G;
    const G3 = G2 * G;
    const G4 = G3 * G;
    const S = G3 * b * this.s1 + G2 * b * this.s2 + G * b * this.s3 + b * this.s4;
    // Partial passband compensation so resonance doesn't hollow out the bass.
    const xin = x * (1 + 0.3 * k);
    const y4est = (G4 * xin + S) / (1 + k * G4);
    const u = fastTanh(xin - k * y4est);

    let v = (u - this.s1) * G;
    const y1 = v + this.s1;
    this.s1 = y1 + v;
    v = (y1 - this.s2) * G;
    const y2 = v + this.s2;
    this.s2 = y2 + v;
    v = (y2 - this.s3) * G;
    const y3 = v + this.s3;
    this.s3 = y3 + v;
    v = (y3 - this.s4) * G;
    const y4 = v + this.s4;
    this.s4 = y4 + v;
    return y4;
  }
}

/** Trapezoidal state-variable filter (Simper). Exposes LP/BP/HP outputs. */
export class Svf {
  private ic1 = 0;
  private ic2 = 0;
  lp = 0;
  bp = 0;
  hp = 0;

  reset(): void {
    this.ic1 = this.ic2 = this.lp = this.bp = this.hp = 0;
  }

  private ca1 = 0;
  private ca2 = 0;
  private ca3 = 0;
  private ck = 0;

  /** Precompute coefficients for processFixed() (for filters whose frequency rarely changes). */
  setCoefs(g: number, k: number): void {
    this.ca1 = 1 / (1 + g * (g + k));
    this.ca2 = g * this.ca1;
    this.ca3 = g * this.ca2;
    this.ck = k;
  }

  /** process() with the coefficients from setCoefs(). */
  processFixed(x: number): void {
    const v3 = x - this.ic2;
    const v1 = this.ca1 * this.ic1 + this.ca2 * v3;
    const v2 = this.ic2 + this.ca2 * this.ic1 + this.ca3 * v3;
    this.ic1 = 2 * v1 - this.ic1;
    this.ic2 = 2 * v2 - this.ic2;
    this.lp = v2;
    this.bp = v1;
    this.hp = x - this.ck * v1 - v2;
  }

  /** g = tan(π·fc/fs); k = 1/Q */
  process(x: number, g: number, k: number): void {
    const a1 = 1 / (1 + g * (g + k));
    const a2 = g * a1;
    const a3 = g * a2;
    const v3 = x - this.ic2;
    const v1 = a1 * this.ic1 + a2 * v3;
    const v2 = this.ic2 + a2 * this.ic1 + a3 * v3;
    this.ic1 = 2 * v1 - this.ic1;
    this.ic2 = 2 * v2 - this.ic2;
    this.lp = v2;
    this.bp = v1;
    this.hp = x - k * v1 - v2;
  }
}

/** Direct-form-I biquad with RBJ cookbook designs. */
export class Biquad {
  b0 = 1;
  b1 = 0;
  b2 = 0;
  a1 = 0;
  a2 = 0;
  private x1 = 0;
  private x2 = 0;
  private y1 = 0;
  private y2 = 0;

  reset(): void {
    this.x1 = this.x2 = this.y1 = this.y2 = 0;
  }

  process(x: number): number {
    const y = this.b0 * x + this.b1 * this.x1 + this.b2 * this.x2 - this.a1 * this.y1 - this.a2 * this.y2;
    this.x2 = this.x1;
    this.x1 = x;
    this.y2 = this.y1;
    this.y1 = y;
    return y;
  }

  private set(b0: number, b1: number, b2: number, a0: number, a1: number, a2: number): void {
    this.b0 = b0 / a0;
    this.b1 = b1 / a0;
    this.b2 = b2 / a0;
    this.a1 = a1 / a0;
    this.a2 = a2 / a0;
  }

  setHighpass(fc: number, q: number, fs: number): void {
    const w = (TWO_PI * fc) / fs;
    const c = Math.cos(w), al = Math.sin(w) / (2 * q);
    this.set((1 + c) / 2, -(1 + c), (1 + c) / 2, 1 + al, -2 * c, 1 - al);
  }

  setLowpass(fc: number, q: number, fs: number): void {
    const w = (TWO_PI * fc) / fs;
    const c = Math.cos(w), al = Math.sin(w) / (2 * q);
    this.set((1 - c) / 2, 1 - c, (1 - c) / 2, 1 + al, -2 * c, 1 - al);
  }

  setBandpass(fc: number, q: number, fs: number): void {
    const w = (TWO_PI * fc) / fs;
    const c = Math.cos(w), al = Math.sin(w) / (2 * q);
    this.set(al, 0, -al, 1 + al, -2 * c, 1 - al);
  }

  setLowShelf(fc: number, db: number, fs: number): void {
    const A = Math.pow(10, db / 40);
    const w = (TWO_PI * fc) / fs;
    const c = Math.cos(w), s = Math.sin(w);
    const al = (s / 2) * Math.SQRT2; // slope 1
    const sa = 2 * Math.sqrt(A) * al;
    this.set(
      A * (A + 1 - (A - 1) * c + sa),
      2 * A * (A - 1 - (A + 1) * c),
      A * (A + 1 - (A - 1) * c - sa),
      A + 1 + (A - 1) * c + sa,
      -2 * (A - 1 + (A + 1) * c),
      A + 1 + (A - 1) * c - sa,
    );
  }

  setHighShelf(fc: number, db: number, fs: number): void {
    const A = Math.pow(10, db / 40);
    const w = (TWO_PI * fc) / fs;
    const c = Math.cos(w), s = Math.sin(w);
    const al = (s / 2) * Math.SQRT2;
    const sa = 2 * Math.sqrt(A) * al;
    this.set(
      A * (A + 1 + (A - 1) * c + sa),
      -2 * A * (A - 1 + (A + 1) * c),
      A * (A + 1 + (A - 1) * c - sa),
      A + 1 - (A - 1) * c + sa,
      2 * (A - 1 - (A + 1) * c),
      A + 1 - (A - 1) * c - sa,
    );
  }

  setPeak(fc: number, db: number, q: number, fs: number): void {
    const A = Math.pow(10, db / 40);
    const w = (TWO_PI * fc) / fs;
    const c = Math.cos(w), al = Math.sin(w) / (2 * q);
    this.set(1 + al * A, -2 * c, 1 - al * A, 1 + al / A, -2 * c, 1 - al / A);
  }
}

/** Filter kinds of a source's own filter slot. */
export const SLOT_OFF = 0, SLOT_HP = 1, SLOT_LP = 2, SLOT_BP = 3;
/** 4th-order Butterworth stage Qs (as the oscillator high-pass always used). */
const BW4_Q = [0.5412, 1.3066];

/**
 * A source's own filter (oscillators, sub, texture bed): high-, low- or band-pass at 12 or
 * 24 dB/oct, on 1 or 2 channels. It switches itself off where it would do nothing (a
 * high-pass at 20 Hz, a low-pass at 20 kHz), so an unused slot costs nothing.
 */
export class SlotFilter {
  active = false;
  private readonly f: Biquad[];
  private stages = 2;
  private kind = SLOT_OFF;
  private fc = -1;

  constructor(private readonly channels: number) {
    this.f = Array.from({ length: 2 * channels }, () => new Biquad());
  }

  reset(): void {
    for (const b of this.f) b.reset();
  }

  set(kind: number, poles24: boolean, fc: number, fs: number): void {
    const on = kind === SLOT_HP ? fc > 21 : kind === SLOT_LP ? fc < 19000 : kind === SLOT_BP;
    if (!on) {
      if (this.active) this.reset();
      this.active = false;
      this.fc = -1;
      return;
    }
    const stages = kind === SLOT_BP ? 1 : poles24 ? 2 : 1;
    if (this.active && kind === this.kind && stages === this.stages && fc === this.fc) return;
    if (!this.active || kind !== this.kind) this.reset();
    this.active = true;
    this.kind = kind;
    this.stages = stages;
    this.fc = fc;
    const f = Math.min(fc, fs * 0.45);
    for (let ch = 0; ch < this.channels; ch++) {
      for (let i = 0; i < stages; i++) {
        const q = stages === 2 ? BW4_Q[i] : Math.SQRT1_2;
        const b = this.f[2 * ch + i];
        if (kind === SLOT_HP) b.setHighpass(f, q, fs);
        else if (kind === SLOT_LP) b.setLowpass(f, q, fs);
        else b.setBandpass(f, 1, fs);
      }
    }
  }

  process(x: number, ch = 0): number {
    const b = 2 * ch;
    x = this.f[b].process(x);
    return this.stages === 2 ? this.f[b + 1].process(x) : x;
  }
}

/** Slot kind and slope for the oscillators' filter types: high 24, high 12, low 24, low 12, band. */
export const OSC_SLOT: [number, boolean][] = [[SLOT_HP, true], [SLOT_HP, false], [SLOT_LP, true], [SLOT_LP, false], [SLOT_BP, false]];
/** ... and for the sub's and the texture bed's: off, low 12, low 24, high 12, high 24, band. */
export const AUX_SLOT: [number, boolean][] = [[SLOT_OFF, false], [SLOT_LP, false], [SLOT_LP, true], [SLOT_HP, false], [SLOT_HP, true], [SLOT_BP, false]];

/**
 * How each segment bends (as on Serum's envelopes): the bend b (-1..1) is a curvature k = 12·b;
 * 0 is a straight line, positive moves fast first and settles (analog), negative starts slow and
 * rushes at the end (a swell). The defaults are the analog shapes the envelopes always had.
 */
export const ENV_BEND_K = 12;
export const ENV_ATTACK_BEND = 0.15;
export const ENV_FALL_BEND = 0.38;

/** A rising segment 0..1 at position p (0..1) with curvature k (the shape the page draws too). */
export function envSegment(p: number, b: number): number {
  const k = ENV_BEND_K * b;
  if (Math.abs(k) < 1e-3) return p;
  return (1 - Math.exp(-k * p)) / (1 - Math.exp(-k));
}

/** ADSR whose attack, decay and release each have their own bend. Times are in ms. */
export class Envelope {
  level = 0;
  stage = 0; // 0 idle, 1 attack, 2 decay/sustain, 3 release
  private sustain = 1;
  private pos = 0;
  /** e^(-k·pos) for the segment running, advanced by one multiply per sample. */
  private ex = 1;
  private from = 0;
  private incA = 0;
  private incD = 0;
  private incR = 0;
  private kA = 0;
  private kD = 0;
  private kR = 0;
  private rA = 1;
  private rD = 1;
  private rR = 1;
  // 1 / (1 - e^-k) per segment; 0 = a straight line (also before the first set())
  private nA = 0;
  private nD = 0;
  private nR = 0;
  private lastA = -1;
  private lastD = -1;
  private lastR = -1;
  private lastAB = NaN;
  private lastDB = NaN;
  private lastRB = NaN;

  /** Recompute the segments (call at control rate; cheap when unchanged). */
  set(attackMs: number, decayMs: number, sustain: number, releaseMs: number, fs: number,
    attackBend = ENV_ATTACK_BEND, decayBend = ENV_FALL_BEND, releaseBend = ENV_FALL_BEND): void {
    this.sustain = sustain;
    if (attackMs === this.lastA && decayMs === this.lastD && releaseMs === this.lastR && attackBend === this.lastAB && decayBend === this.lastDB && releaseBend === this.lastRB) return;
    this.lastA = attackMs;
    this.lastD = decayMs;
    this.lastR = releaseMs;
    this.lastAB = attackBend;
    this.lastDB = decayBend;
    this.lastRB = releaseBend;
    const sa = Math.max(1, (attackMs * fs) / 1000), sd = Math.max(1, (decayMs * fs) / 1000), sr = Math.max(1, (releaseMs * fs) / 1000);
    this.incA = 1 / sa;
    this.incD = 1 / sd;
    this.incR = 1 / sr;
    this.kA = ENV_BEND_K * attackBend;
    this.kD = ENV_BEND_K * decayBend;
    this.kR = ENV_BEND_K * releaseBend;
    this.rA = Math.exp(-this.kA * this.incA);
    this.rD = Math.exp(-this.kD * this.incD);
    this.rR = Math.exp(-this.kR * this.incR);
    this.nA = Math.abs(this.kA) < 1e-3 ? 0 : 1 / (1 - Math.exp(-this.kA));
    this.nD = Math.abs(this.kD) < 1e-3 ? 0 : 1 / (1 - Math.exp(-this.kD));
    this.nR = Math.abs(this.kR) < 1e-3 ? 0 : 1 / (1 - Math.exp(-this.kR));
  }

  /** Start (or restart from the current level, no click) the attack. */
  trigger(): void {
    this.stage = 1;
    // continue the attack from where the level is now (the inverse of its curve)
    const L = Math.max(0, Math.min(1, this.level));
    if (this.nA === 0) this.pos = L;
    else {
      const inner = 1 - L / this.nA;
      this.pos = inner > 0 ? Math.min(1, -Math.log(inner) / this.kA) : 1;
    }
    this.ex = Math.exp(-this.kA * this.pos);
  }

  release(): void {
    if (this.stage === 0) return;
    this.stage = 3;
    this.from = this.level;
    this.pos = 0;
    this.ex = 1;
  }

  reset(): void {
    this.stage = 0;
    this.level = 0;
  }

  tick(): number {
    switch (this.stage) {
      case 1:
        this.pos += this.incA;
        this.ex *= this.rA;
        if (this.pos >= 1) {
          this.level = 1;
          this.stage = 2;
          this.pos = 0;
          this.ex = 1;
        } else this.level = this.nA === 0 ? this.pos : (1 - this.ex) * this.nA;
        break;
      case 2:
        if (this.pos < 1) {
          this.pos += this.incD;
          this.ex *= this.rD;
          const g = this.pos >= 1 ? 1 : this.nD === 0 ? this.pos : (1 - this.ex) * this.nD;
          this.level = 1 - (1 - this.sustain) * g;
        } else this.level = this.sustain;
        break;
      case 3:
        this.pos += this.incR;
        this.ex *= this.rR;
        if (this.pos >= 1) {
          this.level = 0;
          this.stage = 0;
        } else this.level = this.from * (1 - (this.nR === 0 ? this.pos : (1 - this.ex) * this.nR));
        break;
    }
    return this.level;
  }
}
