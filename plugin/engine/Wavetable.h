// Band-limited wavetables (port of src/engine/core/wavetable.ts), built once
// at engine start-up, never on the audio thread.
#pragma once
#include <algorithm>
#include <cmath>
#include <utility>
#include <vector>
#include "Dsp.h"
#include "generated/WaveTables.h"

namespace lt {

constexpr int TABLE_SIZE = 2048;
constexpr int TABLE_MASK = TABLE_SIZE - 1;
constexpr int MIP_LEVELS = 21;  // half an octave a level (as wavetable.ts)
/** How many harmonics mip level m holds (as mipHarmonics in wavetable.ts). */
constexpr int mipHarmonics(int m) {
  // (floor(o x 0.7071...) without std::floor, so it stays constexpr: the same integer)
  return (m & 1) ? (int)((1024 >> (m >> 1)) * 0.7071067811865476) : std::min(TABLE_SIZE / 2 - 1, 1024 >> (m >> 1));
}
/** Each mip level's table length (4 samples a harmonic at least, 64 .. 2048) and place in a frame (as MIP_SIZE). */
struct MipLayout {
  int size[MIP_LEVELS], offset[MIP_LEVELS], stride;
  constexpr MipLayout() : size(), offset(), stride(0) {
    for (int m = 0; m < MIP_LEVELS; m++) {
      int n = 64;
      while (n < 4 * mipHarmonics(m) && n < TABLE_SIZE) n *= 2;
      size[m] = n;
      offset[m] = stride;
      stride += n;
    }
  }
};
constexpr MipLayout MIP_LAYOUT{};
inline size_t mipBase(int f, int m) { return (size_t)f * MIP_LAYOUT.stride + MIP_LAYOUT.offset[m]; }
constexpr int FRAMES_PER_SEGMENT = 4;
constexpr int KEYFRAMES = 5;
constexpr int FRAME_COUNT = (KEYFRAMES - 1) * FRAMES_PER_SEGMENT + 1;  // 17
constexpr int MAX_HARMONIC = TABLE_SIZE / 2 - 1;

namespace wt_detail {
inline const std::vector<double>& morphVocal();
inline std::vector<double> keyframeSpectrum(int kf) {
  std::vector<double> a(MAX_HARMONIC + 1, 0.0);
  for (int k = 1; k <= MAX_HARMONIC; k++) {
    switch (kf) {
      case 0: a[k] = k == 1 ? 1 : 0; break;
      case 1: a[k] = k % 2 == 1 ? ((8 / (PI * PI)) * (((k - 1) / 2) % 2 == 0 ? 1 : -1)) / (double(k) * k) : 0; break;
      case 2: a[k] = ((2 / PI) * (k % 2 == 1 ? 1 : -1)) / k; break;
      case 3: a[k] = k % 2 == 1 ? 4 / (PI * k) : 0; break;
      case 4: a[k] = morphVocal()[k]; break;  // a sung "ah" (as wavetable.ts)
    }
  }
  return a;
}

inline void fft(std::vector<double>& re, std::vector<double>& im, bool inverse) {
  const int n = (int)re.size();
  for (int i = 1, j = 0; i < n; i++) {
    int bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      std::swap(re[i], re[j]);
      std::swap(im[i], im[j]);
    }
  }
  for (int len = 2; len <= n; len <<= 1) {
    const double ang = ((inverse ? 2 : -2) * PI) / len;
    const double wr = std::cos(ang), wi = std::sin(ang);
    for (int i = 0; i < n; i += len) {
      double cr = 1, ci = 0;
      for (int j = 0; j < len / 2; j++) {
        const double ar = re[i + j + len / 2] * cr - im[i + j + len / 2] * ci;
        const double ai = re[i + j + len / 2] * ci + im[i + j + len / 2] * cr;
        re[i + j + len / 2] = re[i + j] - ar;
        im[i + j + len / 2] = im[i + j] - ai;
        re[i + j] += ar;
        im[i + j] += ai;
        const double t = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = t;
      }
    }
  }
}

inline void synth(const std::vector<double>& a, int maxH, float* out, double scale, int N = TABLE_SIZE) {
  std::vector<double> re(N, 0.0), im(N, 0.0);
  for (int k = 1; k <= maxH; k++) {
    im[k] = -a[k] / 2;
    im[N - k] = a[k] / 2;
  }
  fft(re, im, true);
  for (int n = 0; n < N; n++) out[n] = (float)(re[n] * scale);
}
}  // namespace wt_detail


// ---- The wave bank (as wavetable.ts): each new wave a small morph table, keyframes as one cycle in time.
constexpr int BANK_COUNT = 27;
/** Each bank wave's sampled table (an index into WAVE_TABLE_DATA: acid, ring, scream, gritty), -1 for a formula (as BANK_SAMPLED). */
constexpr int BANK_SAMPLED[BANK_COUNT] = {-1, WT_DOUBLE_SAW, WT_SYNC_SAW, WT_VOWEL, WT_CHOIR, WT_TALK, WT_BELL, WT_RING,
    WT_DIGITAL, WT_GLASS, WT_BOWED, WT_REED, WT_BREATH, WT_TAPE_SAW, WT_CASSETTE_PULSE, WT_LOFI_SAMPLE, WT_BROKEN_SINE,
    WT_ELECTRIC_GUITAR, WT_ACID, WT_SCREAM, WT_GROWL, WT_FOLD, -1, WT_CRUSH, WT_SPECTRAL, WT_FORMANT_SCAN, WT_GRITTY};
/** Keyframes of each bank wave: a sampled table's frames, else its formula's (square 3, harmonic 9). */
constexpr int bankKeys(int w) { return BANK_SAMPLED[w] >= 0 ? WAVE_TABLE_FRAMES[BANK_SAMPLED[w]] : w == 0 ? 3 : 9; }
constexpr int BANK_KEYS[BANK_COUNT] = {bankKeys(0), bankKeys(1), bankKeys(2), bankKeys(3), bankKeys(4), bankKeys(5), bankKeys(6),
    bankKeys(7), bankKeys(8), bankKeys(9), bankKeys(10), bankKeys(11), bankKeys(12), bankKeys(13), bankKeys(14), bankKeys(15),
    bankKeys(16), bankKeys(17), bankKeys(18), bankKeys(19), bankKeys(20), bankKeys(21), bankKeys(22), bankKeys(23),
    bankKeys(24), bankKeys(25), bankKeys(26)};
/** Frames per keyframe step of bank wave w: 1 on a sampled table, 2 on the wavetables, 4 on the rest (as bankFps). */
constexpr int bankFps(int w) { return BANK_SAMPLED[w] >= 0 ? 1 : BANK_KEYS[w] >= 8 ? 2 : FRAMES_PER_SEGMENT; }


/** The true square (as squareCycle in wavetable.ts): every odd harmonic up to 1023 at exactly 1/k. */
inline const std::vector<float>& squareCycle() {
  static const std::vector<float> c = [] {
    std::vector<double> a(MAX_HARMONIC + 1, 0.0);
    for (int k = 1; k <= MAX_HARMONIC; k += 2) a[k] = 4 / (PI * k);
    std::vector<float> out(TABLE_SIZE);
    wt_detail::synth(a, MAX_HARMONIC, out.data(), 1);
    return out;
  }();
  return c;
}

/** A sampled wave's frame kf at x (as sampledSample in wavetable.ts): the owner's Serum renders and the processed waves. */
inline double sampledSample(int t, int kf, double x) {
  return WAVE_TABLE_DATA[t][kf * TABLE_SIZE + ((int)std::floor(x * TABLE_SIZE) & TABLE_MASK)] / 32767.0;
}

namespace wt_detail {
/** The MORPH table's last keyframe: the harmonic amplitudes of the processed "ah" (as morphVocal in wavetable.ts). */
inline const std::vector<double>& morphVocal() {
  static const std::vector<double> amps = [] {
    std::vector<double> re(TABLE_SIZE, 0.0), im(TABLE_SIZE, 0.0), a(MAX_HARMONIC + 1, 0.0);
    for (int n = 0; n < TABLE_SIZE; n++) re[n] = sampledSample(WT_MORPH_VOCAL, 0, (double)n / TABLE_SIZE);
    fft(re, im, false);
    for (int k = 1; k <= MAX_HARMONIC; k++) a[k] = 2 * std::hypot(re[k], im[k]) / TABLE_SIZE;
    return a;
  }();
  return amps;
}
}  // namespace wt_detail

inline double bankKey(int w, int kf, double x) {
  if (BANK_SAMPLED[w] >= 0) return sampledSample(BANK_SAMPLED[w], kf, x);
  if (w == 0) {  // square (as wavetable.ts)
    if (kf == 0) return squareCycle()[(int)std::floor(x * TABLE_SIZE) & TABLE_MASK];
    static const double G[] = {0, 4, 1.4};
    const double g = G[kf];
    return std::tanh(g * std::sin(2 * PI * x)) / std::tanh(g);
  }
  static const int Nn[] = {1, 2, 3, 4, 6, 8, 12, 16, 24};  // harmonic: partials one by one
  double y = 0;
  for (int k = 1; k <= Nn[kf]; k++) y += std::sin(2 * PI * k * x) / std::sqrt((double)k);
  return y;
}

struct BankLayout {
  int frame0[BANK_COUNT], frames[BANK_COUNT], total;
  constexpr BankLayout() : frame0(), frames(), total(0) {
    int f = FRAME_COUNT;
    for (int w = 0; w < BANK_COUNT; w++) {
      frame0[w] = f;
      frames[w] = (BANK_KEYS[w] - 1) * bankFps(w) + 1;
      f += frames[w];
    }
    total = f;
  }
};
constexpr BankLayout BANK_LAYOUT{};

namespace wt_detail {
inline void bandLimit(const std::vector<double>& xr, const std::vector<double>& xi, int maxH, float* out, double scale, int N = TABLE_SIZE) {
  std::vector<double> re(N, 0.0), im(N, 0.0);
  for (int k = 1; k <= maxH; k++) {
    re[k] = xr[k];
    im[k] = xi[k];
    re[N - k] = xr[TABLE_SIZE - k];
    im[N - k] = xi[TABLE_SIZE - k];
  }
  fft(re, im, true);
  for (int n = 0; n < N; n++) out[n] = (float)((re[n] / TABLE_SIZE) * scale);
}
inline void buildBank(std::vector<float>& data) {
  std::vector<float> tmp(TABLE_SIZE);
  for (int w = 0; w < BANK_COUNT; w++) {
    const int keys = BANK_KEYS[w];
    std::vector<std::vector<double>> kr, ki;
    for (int kf = 0; kf < keys; kf++) {
      std::vector<double> re(TABLE_SIZE, 0.0), im(TABLE_SIZE, 0.0);
      for (int n = 0; n < TABLE_SIZE; n++) re[n] = bankKey(w, kf, (double)n / TABLE_SIZE);
      fft(re, im, false);
      kr.push_back(re);
      ki.push_back(im);
    }
    std::vector<double> xr(TABLE_SIZE), xi(TABLE_SIZE);
    for (int f = 0; f < BANK_LAYOUT.frames[w]; f++) {
      const int fps = bankFps(w);
      const int seg = std::min(keys - 2, (int)std::floor((double)f / fps));
      const double t = (double)f / fps - seg;
      for (int k = 0; k < TABLE_SIZE; k++) {
        xr[k] = kr[seg][k] * (1 - t) + kr[seg + 1][k] * t;
        xi[k] = ki[seg][k] * (1 - t) + ki[seg + 1][k] * t;
      }
      bandLimit(xr, xi, MAX_HARMONIC, tmp.data(), 1);
      double peak = 0;
      for (int n = 0; n < TABLE_SIZE; n++) peak = std::fmax(peak, std::fabs((double)tmp[n]));
      const double scale = BANK_SAMPLED[w] >= 0 || peak <= 0 ? 1 : 1 / peak;
      const int fi = BANK_LAYOUT.frame0[w] + f;
      for (int m = 0; m < MIP_LEVELS; m++) {
        const int maxH = mipHarmonics(m);
        bandLimit(xr, xi, maxH, data.data() + mipBase(fi, m), scale, MIP_LAYOUT.size[m]);
      }
    }
  }
}
}  // namespace wt_detail

/** data[mipBase(frame, mip) + i], i < MIP_LAYOUT.size[mip], shared by every voice. */
inline const std::vector<float>& getWavetable() {
  static const std::vector<float> data = [] {
    using namespace wt_detail;
    std::vector<float> d((size_t)BANK_LAYOUT.total * MIP_LAYOUT.stride);
    std::vector<std::vector<double>> keys;
    for (int i = 0; i < KEYFRAMES; i++) keys.push_back(keyframeSpectrum(i));
    std::vector<double> spec(MAX_HARMONIC + 1);
    std::vector<float> tmp(TABLE_SIZE);
    for (int f = 0; f < FRAME_COUNT; f++) {
      const int seg = std::min(KEYFRAMES - 2, (int)std::floor((double)f / FRAMES_PER_SEGMENT));
      const double t = (double)f / FRAMES_PER_SEGMENT - seg;
      for (int k = 0; k <= MAX_HARMONIC; k++) spec[k] = keys[seg][k] * (1 - t) + keys[seg + 1][k] * t;
      synth(spec, MAX_HARMONIC, tmp.data(), 1);
      double peak = 0;
      for (int n = 0; n < TABLE_SIZE; n++) peak = std::fmax(peak, std::fabs((double)tmp[n]));
      const double scale = peak > 0 ? 1 / peak : 1;
      for (int m = 0; m < MIP_LEVELS; m++) {
        const int maxH = mipHarmonics(m);
        synth(spec, maxH, d.data() + mipBase(f, m), scale, MIP_LAYOUT.size[m]);
      }
    }
    buildBank(d);
    return d;
  }();
  return data;
}

/** Mip level for a phase increment at sample rate fs: folding back only above 20 kHz (as wavetable.ts). */
inline int mipForIncrement(double inc, double fs) {
  const double a = std::fabs(inc);
  if (a <= 0) return 0;
  const double allowed = std::fmax(0.5, 1 - 20000 / fs) / a;
  int m = 0;
  while (m < MIP_LEVELS - 1 && mipHarmonics(m) > allowed) m++;
  return m;
}

}  // namespace lt
