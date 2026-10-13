// Small DSP building blocks. All state lives in preallocated fields; nothing
// here allocates after construction.

export const TWO_PI = Math.PI * 2;

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
    const G = g / (1 + g);
    const b = 1 / (1 + g);
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

/** ADSR with analog-style exponential segments. Times are in ms. */
export class Envelope {
  level = 0;
  stage = 0; // 0 idle, 1 attack, 2 decay/sustain, 3 release
  private ca = 0;
  private cd = 0;
  private cr = 0;
  private sustain = 1;

  private lastA = -1;
  private lastD = -1;
  private lastR = -1;

  /** Recompute coefficients (call at control rate; cheap when unchanged). */
  set(attackMs: number, decayMs: number, sustain: number, releaseMs: number, fs: number): void {
    this.sustain = sustain;
    if (attackMs === this.lastA && decayMs === this.lastD && releaseMs === this.lastR) return;
    this.lastA = attackMs;
    this.lastD = decayMs;
    this.lastR = releaseMs;
    // Attack aims at 1.2 and stops at 1 → reaches 1 in `attack` ms.
    this.ca = 1 - Math.exp(-Math.log(6) / Math.max(1, (attackMs * fs) / 1000));
    // Decay/release reach 1% of the distance in the given time.
    this.cd = 1 - Math.exp(-4.6 / Math.max(1, (decayMs * fs) / 1000));
    this.cr = 1 - Math.exp(-4.6 / Math.max(1, (releaseMs * fs) / 1000));
  }

  /** Start (or restart from the current level, no click) the attack. */
  trigger(): void {
    this.stage = 1;
  }

  release(): void {
    if (this.stage !== 0) this.stage = 3;
  }

  reset(): void {
    this.stage = 0;
    this.level = 0;
  }

  tick(): number {
    switch (this.stage) {
      case 1:
        this.level += (1.2 - this.level) * this.ca;
        if (this.level >= 1) {
          this.level = 1;
          this.stage = 2;
        }
        break;
      case 2:
        this.level += (this.sustain - this.level) * this.cd;
        break;
      case 3:
        this.level -= this.level * this.cr;
        if (this.level < 1e-5) {
          this.level = 0;
          this.stage = 0;
        }
        break;
    }
    return this.level;
  }
}
