// Small DSP building blocks (port of src/engine/core/dsp.ts). All state lives
// in preallocated fields; nothing here allocates after construction.
#pragma once
#include <cmath>
#include <cstdint>

namespace lt {

constexpr double PI = 3.14159265358979323846;
constexpr double TWO_PI = PI * 2;
constexpr double SQRT2 = 1.4142135623730951;
constexpr double SQRT1_2 = 0.7071067811865476;

inline double clampd(double x, double lo, double hi) { return x < lo ? lo : x > hi ? hi : x; }

/** JavaScript Math.round: halves round up (towards +infinity). */
inline double jsRound(double x) { return std::floor(x + 0.5); }

/** Rational tanh approximation, exact at ±3 and saturating beyond. */
inline double fastTanh(double x) {
  if (x > 3) return 1;
  if (x < -3) return -1;
  const double x2 = x * x;
  return (x * (27 + x2)) / (27 + 9 * x2);
}

inline double dbToGain(double db) { return std::pow(10.0, db / 20); }

/** Deterministic xorshift32 PRNG, returns doubles in [-1, 1). */
class Rng {
 public:
  explicit Rng(uint32_t seed = 0x9e3779b9u) : s(seed ? seed : 1) {}
  double next() {
    uint32_t x = s;
    x ^= x << 13;
    x ^= x >> 17;
    x ^= x << 5;
    s = x;
    return (double)s / 2147483648.0 - 1;
  }
 private:
  uint32_t s;
};

/** Zero-delay-feedback 4-pole ladder low-pass (Zavalishin TPT form). */
class Ladder {
 public:
  void reset() { s1 = s2 = s3 = s4 = 0; }
  double process(double x, double g, double k) { return processG(x, g / (1 + g), k); }
  double processG(double x, double G, double k) {
    const double b = 1 - G;
    const double G2 = G * G, G3 = G2 * G, G4 = G3 * G;
    const double S = G3 * b * s1 + G2 * b * s2 + G * b * s3 + b * s4;
    const double xin = x * (1 + 0.3 * k);
    const double y4est = (G4 * xin + S) / (1 + k * G4);
    const double u = fastTanh(xin - k * y4est);
    double v = (u - s1) * G;
    const double y1 = v + s1;
    s1 = y1 + v;
    v = (y1 - s2) * G;
    const double y2 = v + s2;
    s2 = y2 + v;
    v = (y2 - s3) * G;
    const double y3 = v + s3;
    s3 = y3 + v;
    v = (y3 - s4) * G;
    const double y4 = v + s4;
    s4 = y4 + v;
    return y4;
  }
 private:
  double s1 = 0, s2 = 0, s3 = 0, s4 = 0;
};

/** Trapezoidal state-variable filter (Simper). Exposes LP/BP/HP outputs. */
class Svf {
 public:
  double lp = 0, bp = 0, hp = 0;
  void reset() { ic1 = ic2 = lp = bp = hp = 0; }
  void setCoefs(double g, double k) {
    ca1 = 1 / (1 + g * (g + k));
    ca2 = g * ca1;
    ca3 = g * ca2;
    ck = k;
  }
  void processFixed(double x) {
    const double v3 = x - ic2;
    const double v1 = ca1 * ic1 + ca2 * v3;
    const double v2 = ic2 + ca2 * ic1 + ca3 * v3;
    ic1 = 2 * v1 - ic1;
    ic2 = 2 * v2 - ic2;
    lp = v2;
    bp = v1;
    hp = x - ck * v1 - v2;
  }
  void process(double x, double g, double k) {
    const double a1 = 1 / (1 + g * (g + k));
    const double a2 = g * a1;
    const double a3 = g * a2;
    const double v3 = x - ic2;
    const double v1 = a1 * ic1 + a2 * v3;
    const double v2 = ic2 + a2 * ic1 + a3 * v3;
    ic1 = 2 * v1 - ic1;
    ic2 = 2 * v2 - ic2;
    lp = v2;
    bp = v1;
    hp = x - k * v1 - v2;
  }
 private:
  double ic1 = 0, ic2 = 0, ca1 = 0, ca2 = 0, ca3 = 0, ck = 0;
};

/** Direct-form-I biquad with RBJ cookbook designs. */
class Biquad {
 public:
  double b0 = 1, b1 = 0, b2 = 0, a1 = 0, a2 = 0;
  void reset() { x1 = x2 = y1 = y2 = 0; }
  double process(double x) {
    const double y = b0 * x + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
    x2 = x1;
    x1 = x;
    y2 = y1;
    y1 = y;
    return y;
  }
  void setHighpass(double fc, double q, double fs) {
    const double w = (TWO_PI * fc) / fs, c = std::cos(w), al = std::sin(w) / (2 * q);
    set((1 + c) / 2, -(1 + c), (1 + c) / 2, 1 + al, -2 * c, 1 - al);
  }
  void setLowpass(double fc, double q, double fs) {
    const double w = (TWO_PI * fc) / fs, c = std::cos(w), al = std::sin(w) / (2 * q);
    set((1 - c) / 2, 1 - c, (1 - c) / 2, 1 + al, -2 * c, 1 - al);
  }
  void setLowShelf(double fc, double db, double fs) {
    const double A = std::pow(10.0, db / 40), w = (TWO_PI * fc) / fs, c = std::cos(w), s = std::sin(w);
    const double al = (s / 2) * SQRT2, sa = 2 * std::sqrt(A) * al;
    set(A * (A + 1 - (A - 1) * c + sa), 2 * A * (A - 1 - (A + 1) * c), A * (A + 1 - (A - 1) * c - sa),
        A + 1 + (A - 1) * c + sa, -2 * (A - 1 + (A + 1) * c), A + 1 + (A - 1) * c - sa);
  }
  void setHighShelf(double fc, double db, double fs) {
    const double A = std::pow(10.0, db / 40), w = (TWO_PI * fc) / fs, c = std::cos(w), s = std::sin(w);
    const double al = (s / 2) * SQRT2, sa = 2 * std::sqrt(A) * al;
    set(A * (A + 1 + (A - 1) * c + sa), -2 * A * (A - 1 + (A + 1) * c), A * (A + 1 + (A - 1) * c - sa),
        A + 1 - (A - 1) * c + sa, 2 * (A - 1 - (A + 1) * c), A + 1 - (A - 1) * c - sa);
  }
  void setPeak(double fc, double db, double q, double fs) {
    const double A = std::pow(10.0, db / 40), w = (TWO_PI * fc) / fs, c = std::cos(w), al = std::sin(w) / (2 * q);
    set(1 + al * A, -2 * c, 1 - al * A, 1 + al / A, -2 * c, 1 - al / A);
  }
 private:
  double x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  void set(double nb0, double nb1, double nb2, double na0, double na1, double na2) {
    b0 = nb0 / na0;
    b1 = nb1 / na0;
    b2 = nb2 / na0;
    a1 = na1 / na0;
    a2 = na2 / na0;
  }
};

/** ADSR with analog-style exponential segments. Times are in ms. */
class Envelope {
 public:
  double level = 0;
  int stage = 0;  // 0 idle, 1 attack, 2 decay/sustain, 3 release

  void set(double attackMs, double decayMs, double sustainLevel, double releaseMs, double fs, double attackCurve = 0) {
    sustain = sustainLevel;
    curve = attackCurve;
    attackInc = 1 / std::fmax(1, (attackMs * fs) / 1000);
    if (attackMs == lastA && decayMs == lastD && releaseMs == lastR) return;
    lastA = attackMs;
    lastD = decayMs;
    lastR = releaseMs;
    ca = 1 - std::exp(-std::log(6.0) / std::fmax(1, (attackMs * fs) / 1000));
    cd = 1 - std::exp(-4.6 / std::fmax(1, (decayMs * fs) / 1000));
    cr = 1 - std::exp(-4.6 / std::fmax(1, (releaseMs * fs) / 1000));
  }
  void trigger() {
    stage = 1;
    if (curve > 0) pos = std::pow(level, 1 / (1 + 5 * curve));
  }
  void release() {
    if (stage != 0) stage = 3;
  }
  void reset() {
    stage = 0;
    level = 0;
  }
  double tick() {
    switch (stage) {
      case 1:
        if (curve > 0) {
          pos += attackInc;
          level = pos >= 1 ? 1 : std::pow(pos, 1 + 5 * curve);
        } else {
          level += (1.2 - level) * ca;
        }
        if (level >= 1) {
          level = 1;
          stage = 2;
        }
        break;
      case 2:
        level += (sustain - level) * cd;
        break;
      case 3:
        level -= level * cr;
        if (level < 1e-5) {
          level = 0;
          stage = 0;
        }
        break;
    }
    return level;
  }
 private:
  double ca = 0, cd = 0, cr = 0, sustain = 1, curve = 0, attackInc = 0, pos = 0;
  double lastA = -1, lastD = -1, lastR = -1;
};

}  // namespace lt
