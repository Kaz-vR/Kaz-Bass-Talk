// 2× oversampling with linear-phase half-band FIR filters (port of
// src/engine/core/oversample.ts). Used around every nonlinear stage of the voice.
#pragma once
#include <array>
#include <cmath>
#include "Dsp.h"

namespace lt {

constexpr int OS_K = 10;  // odd-tap pairs per side (39-tap filter)
constexpr int OVERSAMPLE_LATENCY = OS_K;

inline const std::array<double, OS_K>& halfbandTaps() {
  static const std::array<double, OS_K> taps = [] {
    auto besselI0 = [](double x) {
      double sum = 1, term = 1;
      for (int k = 1; k < 50; k++) {
        const double h = x / (2 * k);
        term *= h * h;
        sum += term;
        if (term < 1e-12 * sum) break;
      }
      return sum;
    };
    const double beta = 8;
    const int half = 2 * OS_K - 1;
    std::array<double, OS_K> t{};
    double sum = 0;
    for (int j = 0; j < OS_K; j++) {
      const double n = 2 * j + 1;
      const double sinc = std::sin((PI * n) / 2) / ((PI * n) / 2);
      const double r = n / (half + 1);
      const double w = besselI0(beta * std::sqrt(1 - r * r)) / besselI0(beta);
      t[j] = 0.5 * sinc * w;
      sum += 2 * t[j];
    }
    for (int j = 0; j < OS_K; j++) t[j] *= 0.5 / sum;
    return t;
  }();
  return taps;
}

/** Base rate → 2×. Each input sample yields two outputs (delayed by K base samples). */
class Upsampler2x {
 public:
  double out0 = 0, out1 = 0;
  void reset() {
    buf.fill(0);
    out0 = out1 = 0;
  }
  void process(double x) {
    const int N = 2 * OS_K;
    pos = pos == 0 ? N - 1 : pos - 1;
    buf[pos] = x;
    buf[pos + N] = x;
    const auto& T = halfbandTaps();
    out0 = buf[pos + OS_K];
    double acc = 0;
    for (int j = 0; j < OS_K; j++) acc += T[j] * (buf[pos + OS_K - 1 - j] + buf[pos + OS_K + j]);
    out1 = 2 * acc;
  }
 private:
  std::array<double, 4 * OS_K> buf{};
  int pos = 0;
};

/** 2× → base rate. Push two oversampled samples, get one base-rate sample. */
class Downsampler2x {
 public:
  void reset() { buf.fill(0); }
  double process(double a, double b) {
    const int N = 4 * OS_K;
    pos = pos == 0 ? N - 1 : pos - 1;
    buf[pos] = a;
    buf[pos + N] = a;
    pos = pos == 0 ? N - 1 : pos - 1;
    buf[pos] = b;
    buf[pos + N] = b;
    const auto& T = halfbandTaps();
    const int c = pos + 2 * OS_K - 1;
    double acc = 0.5 * buf[c];
    for (int j = 0; j < OS_K; j++) acc += T[j] * (buf[c - (2 * j + 1)] + buf[c + (2 * j + 1)]);
    return acc;
  }
 private:
  std::array<double, 2 * 4 * OS_K> buf{};
  int pos = 0;
};

}  // namespace lt
