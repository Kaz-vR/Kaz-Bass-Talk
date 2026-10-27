// The Wobbler's shapes (port of src/engine/core/wobshape.ts): hard and soft points, the smoothed
// table, shared maths so the plugin plays what the page draws.
#pragma once
#include <algorithm>
#include <cmath>
#include "Dsp.h"

namespace lt {

constexpr int WOB_MAX_POINTS = 32;
constexpr int WOB_RANDOM_STEPS = 8;
constexpr int WOB_TABLE = 256;

/** Value of a quadratic Bezier (a, c, b) at the t where its x equals px (x is monotonic). */
inline double wobQuadAt(double ax, double ay, double cx, double cy, double bx, double by, double px) {
  const double A = ax - 2 * cx + bx, B = 2 * (cx - ax), C = ax - px;
  double t;
  if (std::fabs(A) < 1e-9) t = std::fabs(B) < 1e-12 ? 0 : -C / B;
  else {
    const double d = std::fmax(0, B * B - 4 * A * C), r = std::sqrt(d);
    const double t1 = (-B + r) / (2 * A), t2 = (-B - r) / (2 * A);
    t = t1 >= -1e-9 && t1 <= 1 + 1e-9 ? t1 : t2;
  }
  t = std::fmin(1, std::fmax(0, t));
  const double u = 1 - t;
  return u * u * ay + 2 * t * u * cy + t * t * by;
}

/** The shape's level (0..1) at phase p (0..1); xs / ys / soft hold n points sorted by x. */
inline double wobShapeAt(const double* xs, const double* ys, const double* soft, int n, double p) {
  if (n < 2) return n > 0 ? ys[0] : 0;
  double cx = xs[0], cy = ys[0];
  for (int i = 1; i < n; i++) {
    const bool isSoft = soft[i] != 0 && i < n - 1;
    if (!isSoft) {
      const double x1 = xs[i], y1 = ys[i];
      if (p <= x1 || i == n - 1) {
        const double w = x1 - cx;
        const double v = w <= 1e-9 ? y1 : cy + ((std::fmin(std::fmax(p, cx), x1) - cx) / w) * (y1 - cy);
        return std::fmin(1, std::fmax(0, v));
      }
      cx = x1;
      cy = y1;
      continue;
    }
    const bool nextSoft = soft[i + 1] != 0 && i + 1 < n - 1;
    const double ex = nextSoft ? (xs[i] + xs[i + 1]) / 2 : xs[i + 1], ey = nextSoft ? (ys[i] + ys[i + 1]) / 2 : ys[i + 1];
    if (p <= ex) return std::fmin(1, std::fmax(0, wobQuadAt(cx, cy, xs[i], ys[i], ex, ey, std::fmax(p, cx))));
    cx = ex;
    cy = ey;
    if (!nextSoft) i++;
  }
  return ys[n - 1];
}

/** Smooth's window (half-width in table points). */
inline int wobSmoothRadius(double sm) { return (int)jsRound(std::fmax(0, std::fmin(1, sm)) * (WOB_TABLE / 16)); }

/** One cycle of f sampled into out (WOB_TABLE points), then averaged twice over a wrapping window of 2r + 1. */
template <typename F>
inline void wobSmoothTable(F&& f, int r, double* out, double* tmp) {
  const int N = WOB_TABLE;
  for (int i = 0; i < N; i++) out[i] = f((double)i / N);
  if (r < 1) return;
  const int w = 2 * r + 1;
  for (int pass = 0; pass < 2; pass++) {
    double acc = 0;
    for (int k = -r; k <= r; k++) acc += out[(k + N) % N];
    for (int i = 0; i < N; i++) {
      tmp[i] = acc / w;
      acc += out[(i + r + 1) % N] - out[(i - r + N) % N];
    }
    for (int i = 0; i < N; i++) out[i] = tmp[i];
  }
}

/** A smoothed table's value at phase p (0..1), interpolated, wrapping around the cycle. */
inline double wobTableAt(const double* t, double p) {
  const int N = WOB_TABLE;
  const double f = (p - std::floor(p)) * N;
  const int i = (int)std::floor(f) % N;
  const double u = f - std::floor(f);
  return t[i] + (t[(i + 1) % N] - t[i]) * u;
}

}  // namespace lt
