// 2× oversampling with linear-phase half-band FIR filters (Kaiser-windowed
// sinc). Used around every nonlinear stage of the voice (drive, filter,
// distortion) so harmonics they create above Nyquist are filtered out instead
// of folding back as inharmonic digital fizz.
//
// A half-band filter has every even tap zero except the centre (= 0.5), so
// each direction costs K multiply-adds per channel per base-rate sample.

/** Odd-tap pairs per side. 10 → 39-tap filter: flat to 18 kHz, ~-74 dB image rejection. */
const K = 10;
const KAISER_BETA = 8;

function besselI0(x: number): number {
  let sum = 1, term = 1;
  for (let k = 1; k < 50; k++) {
    term *= (x / (2 * k)) ** 2;
    sum += term;
    if (term < 1e-12 * sum) break;
  }
  return sum;
}

/** Coefficients h[1], h[3], ..., h[2K-1] of the half-band low-pass. */
function halfbandTaps(): Float64Array {
  const half = 2 * K - 1;
  const taps = new Float64Array(K);
  let sum = 0;
  for (let j = 0; j < K; j++) {
    const t = 2 * j + 1;
    const sinc = Math.sin((Math.PI * t) / 2) / ((Math.PI * t) / 2);
    const w = besselI0(KAISER_BETA * Math.sqrt(1 - (t / (half + 1)) ** 2)) / besselI0(KAISER_BETA);
    taps[j] = 0.5 * sinc * w;
    sum += 2 * taps[j];
  }
  // Odd taps must sum to 0.5 so DC gain is exactly 1.
  for (let j = 0; j < K; j++) taps[j] *= 0.5 / sum;
  return taps;
}

const TAPS = halfbandTaps();

/** Base rate → 2×. Each input sample yields two outputs (delayed by K base samples). */
export class Upsampler2x {
  private buf = new Float64Array(4 * K); // doubled ring for contiguous reads
  private pos = 0;
  out0 = 0;
  out1 = 0;

  reset(): void {
    this.buf.fill(0);
    this.out0 = this.out1 = 0;
  }

  process(x: number): void {
    const N = 2 * K;
    this.pos = this.pos === 0 ? N - 1 : this.pos - 1;
    this.buf[this.pos] = x;
    this.buf[this.pos + N] = x;
    // buf[pos + i] = x[n - i]
    const b = this.buf, p = this.pos;
    // Even phase: the original sample x[n-K] (centre tap 0.5 × zero-stuffing gain 2).
    this.out0 = b[p + K];
    // Odd phase: the interpolated midpoint between x[n-K] and x[n-K+1].
    let acc = 0;
    for (let j = 0; j < K; j++) acc += TAPS[j] * (b[p + K - 1 - j] + b[p + K + j]);
    this.out1 = 2 * acc;
  }
}

/** 2× → base rate. Push two oversampled samples, get one base-rate sample. */
export class Downsampler2x {
  private buf = new Float64Array(2 * (4 * K));
  private pos = 0;

  reset(): void {
    this.buf.fill(0);
  }

  process(a: number, b: number): number {
    const N = 4 * K;
    this.pos = this.pos === 0 ? N - 1 : this.pos - 1;
    this.buf[this.pos] = a;
    this.buf[this.pos + N] = a;
    this.pos = this.pos === 0 ? N - 1 : this.pos - 1;
    this.buf[this.pos] = b;
    this.buf[this.pos + N] = b;
    // buf[pos + i] = z[m - i], m = newest. Centre tap at i = 2K - 1.
    const z = this.buf, p = this.pos, c = p + 2 * K - 1;
    let acc = 0.5 * z[c];
    for (let j = 0; j < K; j++) acc += TAPS[j] * (z[c - (2 * j + 1)] + z[c + (2 * j + 1)]);
    return acc;
  }
}

/** Total latency of an up+down pair, in base-rate samples (for tests). */
export const OVERSAMPLE_LATENCY = K;
