// DEV ONLY. Quick level/brightness numbers for review tables. (The real
// feature extractor arrives in Phase 3 under src/analysis.)

export interface QuickStats {
  peak: number;
  rmsDb: number;
  centroidHz: number;
  subRatio: number; // energy share below 80 Hz
}

export function quickStats(left: Float32Array, right: Float32Array, sampleRate: number): QuickStats {
  let peak = 0, sum = 0;
  for (let i = 0; i < left.length; i++) {
    peak = Math.max(peak, Math.abs(left[i]), Math.abs(right[i]));
    sum += 0.5 * (left[i] * left[i] + right[i] * right[i]);
  }
  // Average magnitude spectrum over 4096-sample frames (naive DFT is too slow; use radix-2 FFT).
  const N = 4096;
  const mag = new Float64Array(N / 2);
  const re = new Float64Array(N), im = new Float64Array(N);
  let frames = 0;
  for (let start = 0; start + N <= left.length; start += N) {
    for (let i = 0; i < N; i++) {
      const w = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (N - 1));
      re[i] = 0.5 * (left[start + i] + right[start + i]) * w;
      im[i] = 0;
    }
    fft(re, im);
    for (let k = 0; k < N / 2; k++) mag[k] += re[k] * re[k] + im[k] * im[k];
    frames++;
  }
  let num = 0, den = 0, sub = 0;
  for (let k = 1; k < N / 2; k++) {
    const f = (k * sampleRate) / N;
    num += f * mag[k];
    den += mag[k];
    if (f < 80) sub += mag[k];
  }
  return {
    peak,
    rmsDb: 10 * Math.log10(sum / left.length + 1e-20),
    centroidHz: frames && den > 0 ? num / den : 0,
    subRatio: den > 0 ? sub / den : 0,
  };
}

function fft(re: Float64Array, im: Float64Array): void {
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
    const ang = (-2 * Math.PI) / len;
    for (let i = 0; i < n; i += len) {
      for (let j = 0; j < len / 2; j++) {
        const cr = Math.cos(ang * j), ci = Math.sin(ang * j);
        const a = i + j, b = a + len / 2;
        const tr = re[b] * cr - im[b] * ci, ti = re[b] * ci + im[b] * cr;
        re[b] = re[a] - tr;
        im[b] = im[a] - ti;
        re[a] += tr;
        im[a] += ti;
      }
    }
  }
}
