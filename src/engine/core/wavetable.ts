// Band-limited wavetables, built once at engine start-up (never on the audio
// thread's process() path).
//
// The morph table sweeps sine → triangle → saw → square → vocal. Keyframes are
// defined as harmonic spectra and interpolated in the harmonic domain, so the
// in-between frames are real hybrid timbres rather than crossfades. Each frame
// has one mip level per octave so that no harmonic ever exceeds Nyquist.

export const TABLE_SIZE = 2048;
export const TABLE_MASK = TABLE_SIZE - 1;
export const MIP_LEVELS = 11; // level m holds harmonics 1..min(1023, 1024 >> m)
export const FRAMES_PER_SEGMENT = 4;
export const KEYFRAMES = 5;
export const FRAME_COUNT = (KEYFRAMES - 1) * FRAMES_PER_SEGMENT + 1; // 17

/** Normalised morph positions of the keyframes. */
export const WT_POS_SINE = 0;
export const WT_POS_TRIANGLE = 1 / (KEYFRAMES - 1);

const MAX_HARMONIC = TABLE_SIZE / 2 - 1;

function keyframeSpectrum(kf: number): Float64Array {
  const a = new Float64Array(MAX_HARMONIC + 1);
  for (let k = 1; k <= MAX_HARMONIC; k++) {
    switch (kf) {
      case 0: // sine
        a[k] = k === 1 ? 1 : 0;
        break;
      case 1: // triangle
        a[k] = k % 2 === 1 ? ((8 / (Math.PI * Math.PI)) * ((k - 1) / 2 % 2 === 0 ? 1 : -1)) / (k * k) : 0;
        break;
      case 2: // saw
        a[k] = ((2 / Math.PI) * (k % 2 === 1 ? 1 : -1)) / k;
        break;
      case 3: // square
        a[k] = k % 2 === 1 ? 4 / (Math.PI * k) : 0;
        break;
      case 4: {
        // "vocal": strong fundamental plus formant-like humps at fixed harmonics
        const hump = (c: number, w: number) => Math.exp(-(((k - c) / w) ** 2));
        a[k] = (k === 1 ? 0.8 : 0) + (0.9 * hump(4, 1.6) + 0.55 * hump(11, 3) + 0.3 * hump(26, 7)) / Math.sqrt(k) + 0.15 / k;
        break;
      }
    }
  }
  return a;
}

// Minimal iterative radix-2 complex FFT (in place), used only at init.
function fft(re: Float64Array, im: Float64Array, inverse: boolean): void {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = ((inverse ? 2 : -2) * Math.PI) / len;
    const wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let j = 0; j < len / 2; j++) {
        const ar = re[i + j + len / 2] * cr - im[i + j + len / 2] * ci;
        const ai = re[i + j + len / 2] * ci + im[i + j + len / 2] * cr;
        re[i + j + len / 2] = re[i + j] - ar;
        im[i + j + len / 2] = im[i + j] - ai;
        re[i + j] += ar;
        im[i + j] += ai;
        const t = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = t;
      }
    }
  }
}

/** Synthesise one period of Σ a[k]·sin(2πk·n/N) for k ≤ maxH. */
function synth(a: Float64Array, maxH: number, out: Float32Array, scale: number): void {
  const re = new Float64Array(TABLE_SIZE);
  const im = new Float64Array(TABLE_SIZE);
  for (let k = 1; k <= maxH; k++) {
    // sin = (e^{iθ} - e^{-iθ}) / 2i  →  X[k] = -i a/2, X[N-k] = i a/2
    im[k] = -a[k] / 2;
    im[TABLE_SIZE - k] = a[k] / 2;
  }
  fft(re, im, true);
  for (let n = 0; n < TABLE_SIZE; n++) out[n] = re[n] * scale;
}

export interface Wavetable {
  /** data[(frame * MIP_LEVELS + mip) * TABLE_SIZE + i] */
  data: Float32Array;
}

let cached: Wavetable | null = null;

export function getWavetable(): Wavetable {
  if (cached) return cached;
  const data = new Float32Array(FRAME_COUNT * MIP_LEVELS * TABLE_SIZE);
  const keys = Array.from({ length: KEYFRAMES }, (_, i) => keyframeSpectrum(i));
  const spec = new Float64Array(MAX_HARMONIC + 1);
  const tmp = new Float32Array(TABLE_SIZE);
  for (let f = 0; f < FRAME_COUNT; f++) {
    const seg = Math.min(KEYFRAMES - 2, Math.floor(f / FRAMES_PER_SEGMENT));
    const t = f / FRAMES_PER_SEGMENT - seg;
    for (let k = 0; k <= MAX_HARMONIC; k++) spec[k] = keys[seg][k] * (1 - t) + keys[seg + 1][k] * t;
    // Normalise each frame by the peak of its full-bandwidth version.
    synth(spec, MAX_HARMONIC, tmp, 1);
    let peak = 0;
    for (let n = 0; n < TABLE_SIZE; n++) peak = Math.max(peak, Math.abs(tmp[n]));
    const scale = peak > 0 ? 1 / peak : 1;
    for (let m = 0; m < MIP_LEVELS; m++) {
      const maxH = Math.min(MAX_HARMONIC, 1024 >> m);
      synth(spec, maxH, data.subarray((f * MIP_LEVELS + m) * TABLE_SIZE, (f * MIP_LEVELS + m + 1) * TABLE_SIZE), scale);
    }
  }
  cached = { data };
  return cached;
}

/** Mip level for a phase increment (cycles/sample) so harmonics stay below Nyquist. */
export function mipForIncrement(inc: number): number {
  const a = Math.abs(inc);
  if (a <= 0) return 0;
  const allowed = 0.5 / a; // highest harmonic below Nyquist
  let m = 0;
  while (m < MIP_LEVELS - 1 && Math.min(MAX_HARMONIC, 1024 >> m) > allowed) m++;
  return m;
}
