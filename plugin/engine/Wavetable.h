// Band-limited wavetables (port of src/engine/core/wavetable.ts), built once
// at engine start-up, never on the audio thread.
#pragma once
#include <algorithm>
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


// ---- The wave bank (as wavetable.ts): each new wave a small morph table, keyframes as one cycle in time.
constexpr int BANK_COUNT = 17;
constexpr int BANK_KEYS[BANK_COUNT] = {3, 3, 5, 5, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3};

namespace wt_detail {
inline double jr(double x) { return std::floor(x + 0.5); }
inline double fr(double x) { return x - std::floor(x); }
inline double S(double x) { return std::sin(2 * PI * x); }
template <class F>
inline double additive(double x, int h, F amp) {
  double y = 0;
  for (int k = 1; k <= h; k++) y += amp(k) * std::sin(2 * PI * k * x);
  return y;
}
constexpr double VF[5][3] = {{730, 1090, 2440}, {530, 1840, 2480}, {270, 2290, 3010}, {570, 840, 2410}, {300, 870, 2240}};
constexpr double VG[3] = {1, 0.5, 0.25};
inline double voice(double x, int v, double bw, double tilt) {
  return additive(x, 80, [&](int k) {
    const double f = 110.0 * k;
    double a = 0;
    for (int i = 0; i < 3; i++) {
      const double d = (f - VF[v][i]) / ((90 + 40 * i) * bw);
      a += VG[i] * std::exp(-d * d);
    }
    return (a + 0.08 / k) / std::pow((double)k, tilt);
  });
}
}  // namespace wt_detail

inline double bankKey(int w, int kf, double x) {
  using namespace wt_detail;
  auto saw = [](double t) { return 2 * fr(t) - 1; };
  switch (w) {
    case 0: { const double g = (double[]){40, 4, 1.4}[kf]; return std::tanh(g * S(x)) / std::tanh(g); }
    case 1: return saw(x) + (double[]){0, 0.5, 1}[kf] * saw(2 * x);
    case 2: return saw(x * (double[]){1, 1.6, 2.4, 3.4, 5}[kf]);
    case 3: return voice(x, (int[]){0, 1, 2, 3, 4}[kf], 1, 0);
    case 4: return voice(x, (int[]){4, 3, 0}[kf], 2.4, 0.5);
    case 5: return voice(x, (int[]){3, 2, 0}[kf], 0.8, 0.2);
    case 6: { const double ks[6] = {1, 5, 9, 14, 21, 28}, b = (double[]){0.3, 0.6, 1}[kf]; double y = 0; for (int i = 0; i < 6; i++) y += std::pow(b, i) / (1 + 0.3 * i) * std::sin(2 * PI * ks[i] * x); return y; }
    case 7: return 0.8 * S(x) * S((double[]){2, 5, 9}[kf] * x) + 0.2 * S(x);
    case 8: { const double n = (double[]){32, 8, 3}[kf]; return jr((S(x) + 0.3 * S(3 * x)) * n) / n; }
    case 9: { const double ks[6] = {1, 4, 8, 12, 16, 24}, b = (double[]){0.2, 0.5, 0.9}[kf]; double y = 0; for (int i = 0; i < 6; i++) y += std::pow(b, i) * std::sin(2 * PI * ks[i] * x); return y; }
    case 10: { const double p = (double[]){1.6, 1.3, 1}[kf]; return additive(x, 60, [&](int k) { const double a = (k - 3) / 1.5, c = (k - 8) / 3.0; return (1 + 0.8 * std::exp(-(a * a)) + 0.5 * std::exp(-(c * c))) / std::pow((double)k, p); }); }
    case 11: { const double n = (double[]){0.3, 1, 2}[kf]; return additive(x, 60, [&](int k) { const double a = (k - 7) / 3.0; return (k % 2 == 1 ? 1.0 / k : 0.15 / k) * (1 + n * std::exp(-(a * a))); }); }
    case 12: { const double h = (double[]){0.05, 0.2, 0.35}[kf]; return S(x) + h * S(2 * x) + 0.4 * h * S(3 * x); }
    case 13: { const double d = (double[]){1.5, 3, 6}[kf]; return std::tanh(d * (saw(x) + 0.1)) - std::tanh(d * 0.1); }
    case 14: { const double dr = (double[]){0.5, 1.5, 3}[kf]; return x < 0.5 ? std::exp(-dr * x) : -std::exp(-dr * (x - 0.5)); }
    case 15: { const double st = (double[]){64, 24, 10}[kf], q = (double[]){24, 8, 4}[kf], xs = std::floor(x * st) / st; return jr((0.6 * saw(xs + 0.5) + 0.4 * S(xs)) * q) / q; }
    default: { const double g = (double[]){0.8, 1.6, 2.8}[kf]; return std::sin(PI * g * S(x)); }
  }
}

struct BankLayout {
  int frame0[BANK_COUNT], frames[BANK_COUNT], total;
  constexpr BankLayout() : frame0(), frames(), total(0) {
    int f = FRAME_COUNT;
    for (int w = 0; w < BANK_COUNT; w++) {
      frame0[w] = f;
      frames[w] = (BANK_KEYS[w] - 1) * FRAMES_PER_SEGMENT + 1;
      f += frames[w];
    }
    total = f;
  }
};
constexpr BankLayout BANK_LAYOUT{};

namespace wt_detail {
inline void bandLimit(const std::vector<double>& xr, const std::vector<double>& xi, int maxH, float* out, double scale) {
  std::vector<double> re(TABLE_SIZE, 0.0), im(TABLE_SIZE, 0.0);
  for (int k = 1; k <= maxH; k++) {
    re[k] = xr[k];
    im[k] = xi[k];
    re[TABLE_SIZE - k] = xr[TABLE_SIZE - k];
    im[TABLE_SIZE - k] = xi[TABLE_SIZE - k];
  }
  fft(re, im, true);
  for (int n = 0; n < TABLE_SIZE; n++) out[n] = (float)((re[n] / TABLE_SIZE) * scale);
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
      const int seg = std::min(keys - 2, (int)std::floor((double)f / FRAMES_PER_SEGMENT));
      const double t = (double)f / FRAMES_PER_SEGMENT - seg;
      for (int k = 0; k < TABLE_SIZE; k++) {
        xr[k] = kr[seg][k] * (1 - t) + kr[seg + 1][k] * t;
        xi[k] = ki[seg][k] * (1 - t) + ki[seg + 1][k] * t;
      }
      bandLimit(xr, xi, MAX_HARMONIC, tmp.data(), 1);
      double peak = 0;
      for (int n = 0; n < TABLE_SIZE; n++) peak = std::fmax(peak, std::fabs((double)tmp[n]));
      const double scale = peak > 0 ? 1 / peak : 1;
      const int fi = BANK_LAYOUT.frame0[w] + f;
      for (int m = 0; m < MIP_LEVELS; m++) {
        const int maxH = std::min(MAX_HARMONIC, 1024 >> m);
        bandLimit(xr, xi, maxH, data.data() + (size_t)(fi * MIP_LEVELS + m) * TABLE_SIZE, scale);
      }
    }
  }
}
}  // namespace wt_detail

/** data[(frame * MIP_LEVELS + mip) * TABLE_SIZE + i], shared by every voice. */
inline const std::vector<float>& getWavetable() {
  static const std::vector<float> data = [] {
    using namespace wt_detail;
    std::vector<float> d((size_t)BANK_LAYOUT.total * MIP_LEVELS * TABLE_SIZE);
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
    buildBank(d);
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
