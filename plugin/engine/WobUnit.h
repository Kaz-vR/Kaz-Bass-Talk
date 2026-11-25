// One custom LFO (four of them, `wobble.*` and `wobble2.*` .. `wobble4.*`): a line-by-line port of
// src/engine/core/wobunit.ts. Run once per control block; adds its matrix targets, reports its FILTER and
// VOLUME lines for the synth's own filter and gate.
#pragma once

#include <algorithm>
#include <array>
#include <cmath>
#include "Dsp.h"
#include "Params.h"
#include "Wobshape.h"

namespace lt {

constexpr int WOB_TARGETS = 4;

class WobUnit {
 public:
  explicit WobUnit(uint32_t seed) : rng(seed) {}

  /** Where it is in its cycle (0..1), -1 when it does nothing. */
  double live = -1;
  /** Its FILTER line (0 shut .. 1 open) and depth, -1 without a FILTER target; its VOLUME line, -1 without. */
  double filt = -1, filtDepth = 0, gate = -1;

  template <class C, size_t N>
  void step(const C& cur, const ParamIndex::Wob& w, double songBeat, double tempo, double start, double note, std::array<double, N>& x) {
    live = -1;
    filt = -1;
    gate = -1;
    filtDepth = 0;
    const double master = cur[w.master];
    double depth = 0;
    for (int t = 0; t < WOB_TARGETS; t++) depth = std::fmax(depth, std::fmax(std::fabs(cur[w.amts[t]]), std::fabs(cur[w.offs[t]])));
    if (depth * master <= 1e-4) return;
    const int ri = (int)jsRound(cur[w.rate]);
    const double cycle = cur[w.free] > 0.5 ? tempo / 60 / std::fmax(0.01, cur[w.hz])
                         : ri >= 0 && ri < WOBBLE_RATE_COUNT ? WOBBLE_BEATS[ri] : 0.5;
    const bool one = cur[w.oneShot] > 0.5;
    const double nC = one ? -1.0 - note : std::floor(songBeat / cycle);
    const double p = one ? std::fmin(0.99999, std::fmax(0.0, (songBeat - start) / cycle)) : (songBeat - nC * cycle) / cycle;
    live = p;
    double q = p - cur[w.phase];
    q -= std::floor(q);
    const int shape = (int)jsRound(cur[w.shape]);
    if (shape == WOB_RANDOM && randCycle != nC) {
      randCycle = nC;
      for (int k = 0; k < WOB_RANDOM_STEPS; k++) rand[k] = 0.5 + 0.5 * rng.next();
    }
    int m = 0;
    if (shape == WOB_CUSTOM) {
      m = std::max(2, std::min(WOB_MAX_POINTS, (int)jsRound(cur[w.pts])));
      for (int k = 0; k < m; k++) {
        xs[k] = cur[w.x[k]];
        ys[k] = cur[w.y[k]];
        ss[k] = cur[w.s[k]] > 0.5 ? 1 : 0;
      }
    }
    shapeNow = shape;
    ptsNow = m;
    const int rr = wobSmoothRadius(cur[w.smooth]);
    double tgt;
    if (rr == 0) tgt = raw(q);
    else {
      double s = shape * 7919 + rr * 104729 + m * 13;
      if (shape == WOB_RANDOM) s += nC * 1.618;
      for (int k = 0; k < m; k++) s += xs[k] * (k + 1.31) * 3.7 + ys[k] * (k + 2.17) * 5.3 + ss[k] * (k + 3.1);
      if (!(s == sig)) {
        sig = s;
        wobSmoothTable([this](double qq) { return raw(qq); }, rr, table.data(), tmp.data());
      }
      tgt = wobTableAt(table.data(), q);
    }
    v += (tgt - v) * 0.35;
    double fD = -1, gD = -1;
    for (int t = 0; t < WOB_TARGETS; t++) {
      const int dest = (int)jsRound(cur[w.dests[t]]);
      const double a = cur[w.amts[t]], o = cur[w.offs[t]];
      if (dest <= 0 || dest >= DEST_COUNT || (a == 0 && o == 0)) continue;
      const double y = master * (a * (v - 0.5) + o / 2);
      if (dest == D_LF_ALL) {
        if (std::fabs(a) > fD) { fD = std::fabs(a); filt = std::fmax(0.0, std::fmin(1.0, 0.5 + y)); filtDepth = std::fmin(1.0, fD * master); }
      } else if (dest == D_AMP) {
        if (std::fabs(a) > gD) { gD = std::fabs(a); gate = std::fmax(0.0, std::fmin(1.0, 0.5 + y)); }
      } else x[(size_t)dest] += y;
    }
  }

 private:
  Rng rng;
  std::array<double, WOB_MAX_POINTS> xs{}, ys{}, ss{};
  double v = 0;
  int shapeNow = 0, ptsNow = 0;
  double sig = std::nan("");
  std::array<double, WOB_TABLE> table{}, tmp{};
  std::array<double, WOB_RANDOM_STEPS> rand{};
  double randCycle = -1;

  double raw(double q) const {
    const int shape = shapeNow;
    if (shape == WOB_RANDOM) return rand[std::min(WOB_RANDOM_STEPS - 1, (int)std::floor(q * WOB_RANDOM_STEPS))];
    if (shape == WOB_CUSTOM) return wobShapeAt(xs.data(), ys.data(), ss.data(), ptsNow, q);
    const WobTemplate& t = WOB_TEMPLATE_ARRAYS[shape >= 0 && shape < WOB_SHAPE_COUNT ? shape : 0];
    return wobShapeAt(t.xs, t.ys, t.ss, t.n, q);
  }
};

/** Two phases (0..1, or -1 = off) packed into one float for the page (as packWob in wobunit.ts). */
inline double packWob(double a, double b) {
  auto e = [](double p) { return p < 0 ? 4095.0 : std::fmin(4094.0, std::floor(p * 4095)); };
  return e(a) * 4096 + e(b);
}

}  // namespace lt
