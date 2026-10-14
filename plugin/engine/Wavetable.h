// Band-limited wavetables (port of src/engine/core/wavetable.ts), built once
// at engine start-up, never on the audio thread.
#pragma once
#include <cmath>
#include <utility>
#include <vector>
#include "Dsp.h"

namespace lt {

constexpr int TABLE_SIZE = 2048;
constexpr int TABLE_MASK = TABLE_SIZE - 1;
constexpr int MIP_LEVELS = 11;
constexpr int FRAMES_PER_SEGMENT = 4;
constexpr int KEYFRAMES = 5;
constexpr int FRAME_COUNT = (KEYFRAMES - 1) * FRAMES_PER_SEGMENT + 1;  // 17
constexpr int MAX_HARMONIC = TABLE_SIZE / 2 - 1;

namespace wt_detail {
inline std::vector<double> keyframeSpectrum(int kf) {
  std::vector<double> a(MAX_HARMONIC + 1, 0.0);
  for (int k = 1; k <= MAX_HARMONIC; k++) {
    switch (kf) {
      case 0: a[k] = k == 1 ? 1 : 0; break;
      case 1: a[k] = k % 2 == 1 ? ((8 / (PI * PI)) * (((k - 1) / 2) % 2 == 0 ? 1 : -1)) / (double(k) * k) : 0; break;
      case 2: a[k] = ((2 / PI) * (k % 2 == 1 ? 1 : -1)) / k; break;
      case 3: a[k] = k % 2 == 1 ? 4 / (PI * k) : 0; break;
      case 4: {
        auto hump = [k](double c, double w) { const double d = (k - c) / w; return std::exp(-(d * d)); };
        a[k] = (k == 1 ? 0.8 : 0) + (0.9 * hump(4, 1.6) + 0.55 * hump(11, 3) + 0.3 * hump(26, 7)) / std::sqrt((double)k) + 0.15 / k;
        break;
      }
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

inline void synth(const std::vector<double>& a, int maxH, float* out, double scale) {
  std::vector<double> re(TABLE_SIZE, 0.0), im(TABLE_SIZE, 0.0);
  for (int k = 1; k <= maxH; k++) {
    im[k] = -a[k] / 2;
    im[TABLE_SIZE - k] = a[k] / 2;
  }
  fft(re, im, true);
  for (int n = 0; n < TABLE_SIZE; n++) out[n] = (float)(re[n] * scale);
}
}  // namespace wt_detail

/** data[(frame * MIP_LEVELS + mip) * TABLE_SIZE + i], shared by every voice. */
inline const std::vector<float>& getWavetable() {
  static const std::vector<float> data = [] {
    using namespace wt_detail;
    std::vector<float> d((size_t)FRAME_COUNT * MIP_LEVELS * TABLE_SIZE);
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
        const int maxH = std::min(MAX_HARMONIC, 1024 >> m);
        synth(spec, maxH, d.data() + (size_t)(f * MIP_LEVELS + m) * TABLE_SIZE, scale);
      }
    }
    return d;
  }();
  return data;
}

/** Mip level for a phase increment (cycles/sample) so harmonics stay below Nyquist. */
inline int mipForIncrement(double inc) {
  const double a = std::fabs(inc);
  if (a <= 0) return 0;
  const double allowed = 0.5 / a;
  int m = 0;
  while (m < MIP_LEVELS - 1 && std::min(MAX_HARMONIC, 1024 >> m) > allowed) m++;
  return m;
}

}  // namespace lt
