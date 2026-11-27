// The reverb (owner's call, 27 Nov: rebuilt after his ear and the measurements both said the eight-line network rang and
// sounded nothing like Valhalla VintageVerb): the figure-eight tank of the classic digital reverbs VintageVerb models
// (Dattorro's, after the Lexicon / EMT line): four input diffusers, two cross-fed branches each with a modulated
// all-pass, a long delay, its absorption, a second all-pass and a second delay; the outputs read from seven taps per
// side across both branches, so the two sides are uncorrelated and the tail never rings on a few modes. Ported line by
// line to plugin/engine/Verb.h.

/** The original design's lengths, in samples at its 29761 Hz. */
const BASE_FS = 29761;
const IN_DIFF = [142, 107, 379, 277];
const IN_G = [0.75, 0.75, 0.625, 0.625];
/** Per branch: modulated all-pass, delay 1, all-pass 2, delay 2. */
const BR_AP1 = [672, 908];
const BR_D1 = [4453, 4217];
const BR_AP2 = [1800, 2656];
const BR_D2 = [3720, 3163];
/** Output taps: [branch, element (0 = delay 1, 1 = all-pass 2, 2 = delay 2), position, sign], left then right. */
const TAPS_L: [number, number, number, number][] = [[1, 0, 266, 1], [1, 0, 2974, 1], [1, 1, 1913, -1], [1, 2, 1996, 1], [0, 0, 1990, -1], [0, 1, 187, -1], [0, 2, 1066, -1]];
const TAPS_R: [number, number, number, number][] = [[0, 0, 353, 1], [0, 0, 3627, 1], [0, 1, 1228, -1], [0, 2, 2673, 1], [1, 0, 2111, -1], [1, 1, 335, -1], [1, 2, 121, -1]];
/** The modulated all-passes' swing (samples at the base rate) and rates (Hz), a little apart per branch. */
const MOD_EXC = 16;
const MOD_HZ = [0.87, 1.13];

/**
 * The four spaces (owner's call, fitted to VintageVerb's Room / Plate / Concert Hall / Cathedral, seventies colour):
 * size scales every length; diff the input diffusion; dd1 / dd2 the decay diffusion; lo / hi the decay at DC and at
 * Nyquist as multiples of Decay; mod the all-passes' swing (x MOD_EXC); bw the input band limit (Hz); level (as loud as
 * the eight-line reverb it replaced, at Decay 2.5 s).
 */
const TYPES = [
  { size: 0.42, diff: 0.45, dd1: 0.7, dd2: 0.5, lo: 1.36, hi: 0.71, mod: 0.6, bw: 9000, level: 1.019 }, // room
  { size: 0.7, diff: 0.7, dd1: 0.7, dd2: 0.5, lo: 1.18, hi: 0.4, mod: 0.8, bw: 14000, level: 0.965 }, // plate
  { size: 1.25, diff: 0.5, dd1: 0.7, dd2: 0.5, lo: 1.56, hi: 0.34, mod: 1.2, bw: 7000, level: 1.494 }, // hall
  { size: 2.0, diff: 0.5, dd1: 0.68, dd2: 0.45, lo: 1.5, hi: 0.29, mod: 1.6, bw: 6000, level: 1.545 }, // cathedral
];
const MAX_SIZE = 2.0;
const MAX_PRE = 0.26;

class Line {
  readonly buf: Float32Array;
  readonly mask: number;
  w = 0;
  constructor(len: number) {
    let n = 1;
    while (n < len + 4) n <<= 1;
    this.buf = new Float32Array(n);
    this.mask = n - 1;
  }
  /** The sample `d` (fractional) samples ago, before this sample's write. */
  read(d: number): number {
    const p = this.w - d;
    const i = Math.floor(p), f = p - i;
    const a = this.buf[i & this.mask];
    return a + (this.buf[(i + 1) & this.mask] - a) * f;
  }
  write(v: number): void {
    this.buf[this.w] = v;
    this.w = (this.w + 1) & this.mask;
  }
}

export class Reverb {
  private readonly fs: number;
  private readonly pre: Line;
  private readonly inAp: Line[];
  private readonly ap1: Line[];
  private readonly d1: Line[];
  private readonly ap2: Line[];
  private readonly d2: Line[];
  private readonly absS = new Float64Array(2);
  private readonly fb = new Float64Array(2);
  private readonly modPh = new Float64Array(2);
  private bwS = 0;
  private bwS2 = 0;
  // set up from the parameters (redone only when they move)
  private lastType = -1;
  private lastDecay = -1;
  private readonly inLen = new Float64Array(4);
  private readonly len = new Float64Array(8); // per branch: ap1, d1, ap2, d2
  private readonly absA = new Float64Array(2);
  private readonly absB = new Float64Array(2);
  private readonly tapPos = new Float64Array(14);
  private diff = 0.75;
  private dd1 = 0.7;
  private dd2 = 0.5;
  private exc = 0;
  private bwK = 0;
  private level = 0.5;

  constructor(fs: number) {
    this.fs = fs;
    const k = (fs / BASE_FS) * MAX_SIZE;
    this.pre = new Line(Math.ceil(MAX_PRE * fs) + 4);
    this.inAp = IN_DIFF.map((n) => new Line(Math.ceil(n * k) + 4));
    this.ap1 = BR_AP1.map((n) => new Line(Math.ceil((n + 2 * MOD_EXC) * k) + 4));
    this.d1 = BR_D1.map((n) => new Line(Math.ceil(n * k) + 4));
    this.ap2 = BR_AP2.map((n) => new Line(Math.ceil(n * k) + 4));
    this.d2 = BR_D2.map((n) => new Line(Math.ceil(n * k) + 4));
    this.modPh[1] = 0.25;
  }

  reset(): void {
    for (const l of [this.pre, ...this.inAp, ...this.ap1, ...this.d1, ...this.ap2, ...this.d2]) l.buf.fill(0);
    this.absS.fill(0);
    this.fb.fill(0);
    this.bwS = this.bwS2 = 0;
  }

  private setup(type: number, decay: number): void {
    const t = TYPES[Math.max(0, Math.min(3, type))], fs = this.fs;
    const k = (fs / BASE_FS) * t.size;
    for (let i = 0; i < 4; i++) this.inLen[i] = Math.max(1, Math.round(IN_DIFF[i] * Math.sqrt(t.size) * (fs / BASE_FS)));
    const d = Math.max(0.1, decay);
    for (let b = 0; b < 2; b++) {
      this.len[4 * b] = BR_AP1[b] * k;
      this.len[4 * b + 1] = BR_D1[b] * k;
      this.len[4 * b + 2] = BR_AP2[b] * k;
      this.len[4 * b + 3] = BR_D2[b] * k;
      // the branch's absorption: a one-pole whose DC and Nyquist gains lose 60 dB in Decay x lo / x hi over the branch
      const L = this.len[4 * b] + this.len[4 * b + 1] + this.len[4 * b + 2] + this.len[4 * b + 3];
      const gdc = Math.pow(10, (-3 * L) / (t.lo * d * fs)), gny = Math.pow(10, (-3 * L) / (t.hi * d * fs));
      this.absA[b] = (gdc - gny) / (gdc + gny);
      this.absB[b] = gdc * (1 - this.absA[b]);
    }
    const all = [...TAPS_L, ...TAPS_R];
    for (let i = 0; i < 14; i++) this.tapPos[i] = all[i][2] * k;
    this.diff = t.diff;
    this.dd1 = t.dd1;
    this.dd2 = t.dd2;
    this.exc = MOD_EXC * t.mod * (fs / BASE_FS);
    this.bwK = 1 - Math.exp((-2 * Math.PI * t.bw) / fs);
    this.level = t.level * Math.min(2, Math.pow(d / 2, -0.37));
    this.lastType = type;
    this.lastDecay = decay;
  }

  /** Returns wet stereo into out (dry not included). type 0..3, decay = RT60 seconds, predelay in ms. */
  process(input: number, type: number, decay: number, predelayMs: number, out: Float64Array): void {
    if (type !== this.lastType || Math.abs(decay - this.lastDecay) > 1e-4 * decay) this.setup(type, decay);
    const fs = this.fs;
    // pre-delay (fractional, so moving it glides), then the input band limit
    const pd = Math.min(MAX_PRE * fs, Math.max(0, (predelayMs * fs) / 1000));
    this.pre.write(input);
    let x = this.pre.read(pd + 1); // (written first: 1 is the sample just written, so 0 ms of pre-delay is none)
    // (two poles: the converters' steep top, as VintageVerb's seventies colour)
    this.bwS += this.bwK * (x - this.bwS);
    this.bwS2 += this.bwK * (this.bwS - this.bwS2);
    x = this.bwS2;
    // input diffusion: four all-passes
    for (let i = 0; i < 4; i++) {
      const l = this.inAp[i], g = IN_G[i] * this.diff / 0.75;
      const dl = l.read(this.inLen[i]);
      const v = x + g * dl;
      l.write(v);
      x = dl - g * v;
    }
    const early = x;
    // the tank: each branch fed by the other's end
    const in0 = x + this.fb[1], in1 = x + this.fb[0];
    for (let b = 0; b < 2; b++) {
      let s = b === 0 ? in0 : in1;
      // modulated all-pass (decay diffusion 1, negative)
      let ph = this.modPh[b] + MOD_HZ[b] / fs;
      if (ph >= 1) ph -= 1;
      this.modPh[b] = ph;
      const a1 = this.ap1[b], g1 = -this.dd1;
      const dl1 = a1.read(this.len[4 * b] + this.exc * (1 + Math.sin(2 * Math.PI * ph)));
      const v1 = s + g1 * dl1;
      a1.write(v1);
      s = dl1 - g1 * v1;
      // delay 1, then the absorption
      const l1 = this.d1[b];
      const y1 = l1.read(this.len[4 * b + 1]);
      l1.write(s);
      this.absS[b] = this.absB[b] * y1 + this.absA[b] * this.absS[b];
      s = this.absS[b];
      // all-pass 2 (decay diffusion 2)
      const a2 = this.ap2[b], g2 = this.dd2;
      const dl2 = a2.read(this.len[4 * b + 2]);
      const v2 = s + g2 * dl2;
      a2.write(v2);
      s = dl2 - g2 * v2;
      // delay 2, its end feeds the other branch
      const l2 = this.d2[b];
      this.fb[b] = l2.read(this.len[4 * b + 3]);
      l2.write(s);
    }
    // outputs: seven taps a side across both branches
    let l = 0, r = 0;
    for (let i = 0; i < 14; i++) {
      const t = i < 7 ? TAPS_L[i] : TAPS_R[i - 7];
      const line = t[1] === 0 ? this.d1[t[0]] : t[1] === 1 ? this.ap2[t[0]] : this.d2[t[0]];
      const v = t[3] * line.read(this.tapPos[i]);
      if (i < 7) l += v;
      else r += v;
    }
    out[0] = (0.6 * l + 0.12 * early) * this.level;
    out[1] = (0.6 * r + 0.12 * early) * this.level;
  }
}
