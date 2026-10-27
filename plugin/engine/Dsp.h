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

/** Transparent peak soft clipper: identity up to the knee t, then a tanh curve toward t + w. */
inline double softClip(double x, double t, double w) {
  const double a = x < 0 ? -x : x;
  if (a <= t) return x;
  const double y = t + w * std::tanh((a - t) / w);
  return x < 0 ? -y : y;
}

/** Transparent soft clipper with automatic level matching (see dsp.ts Clipper). */
class Clipper {
 public:
  double knee = 0;
  explicit Clipper(double fs) : a(1 - std::exp(-1 / (0.3 * fs))) {}
  void setDrive(double driveDb) { knee = driveDb > 0 ? std::pow(10.0, -driveDb / 20) : 0; }
  void reset() { pin = pout = 1e-12; }
  void process(double l, double r, double c, double* out) {
    const double t = knee * c, w = 0.5 * (c - t);
    const double yl = softClip(l, t, w), yr = softClip(r, t, w);
    pin += (l * l + r * r - pin) * a;
    pout += (yl * yl + yr * yr - pout) * a;
    double g = std::sqrt(pin / pout);
    g = g < 1 ? 1 : g > 2 ? 2 : g;
    out[0] = yl * g;
    out[1] = yr * g;
  }

 private:
  double pin = 1e-12, pout = 1e-12, a;
};

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
  void setBandpass(double fc, double q, double fs) {
    const double w = (TWO_PI * fc) / fs, c = std::cos(w), al = std::sin(w) / (2 * q);
    set(al, 0, -al, 1 + al, -2 * c, 1 - al);
  }
  void setLowShelf(double fc, double db, double fs, double q = SQRT1_2) {
    const double A = std::pow(10.0, db / 40), w = (TWO_PI * fc) / fs, c = std::cos(w), s = std::sin(w);
    const double al = s / (2 * q), sa = 2 * std::sqrt(A) * al;
    set(A * (A + 1 - (A - 1) * c + sa), 2 * A * (A - 1 - (A + 1) * c), A * (A + 1 - (A - 1) * c - sa),
        A + 1 + (A - 1) * c + sa, -2 * (A - 1 + (A + 1) * c), A + 1 + (A - 1) * c - sa);
  }
  void setHighShelf(double fc, double db, double fs, double q = SQRT1_2) {
    const double A = std::pow(10.0, db / 40), w = (TWO_PI * fc) / fs, c = std::cos(w), s = std::sin(w);
    const double al = s / (2 * q), sa = 2 * std::sqrt(A) * al;
    set(A * (A + 1 + (A - 1) * c + sa), -2 * A * (A - 1 + (A + 1) * c), A * (A + 1 + (A - 1) * c - sa),
        A + 1 - (A - 1) * c + sa, 2 * (A - 1 - (A + 1) * c), A + 1 - (A - 1) * c - sa);
  }
  void setNotch(double fc, double q, double fs) {
    const double w = (TWO_PI * fc) / fs, c = std::cos(w), al = std::sin(w) / (2 * q);
    set(1, -2 * c, 1, 1 + al, -2 * c, 1 - al);
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

/** Filter kinds of a source's own filter slot. */
constexpr int SLOT_OFF = 0, SLOT_HP = 1, SLOT_LP = 2, SLOT_BP = 3;

/**
 * A source's own filter (oscillators, sub, texture bed): high-, low- or band-pass at 12 or
 * 24 dB/oct, on 1 or 2 channels. It switches itself off where it would do nothing (a
 * high-pass at 20 Hz, a low-pass at 20 kHz), so an unused slot costs nothing.
 */
template <int CH>
class SlotFilter {
 public:
  bool active = false;
  void reset() {
    for (auto& b : f) b.reset();
  }
  void set(int k, bool poles24, double fc, double fs) {
    const bool on = k == SLOT_HP ? fc > 21 : k == SLOT_LP ? fc < 19000 : k == SLOT_BP;
    if (!on) {
      if (active) reset();
      active = false;
      lastFc = -1;
      return;
    }
    const int st = k == SLOT_BP ? 1 : poles24 ? 2 : 1;
    if (active && k == kind && st == stages && fc == lastFc) return;
    if (!active || k != kind) reset();
    active = true;
    kind = k;
    stages = st;
    lastFc = fc;
    static constexpr double BW4_Q[2] = {0.5412, 1.3066};
    const double fl = std::fmin(fc, fs * 0.45);
    for (int ch = 0; ch < CH; ch++) {
      for (int i = 0; i < st; i++) {
        const double q = st == 2 ? BW4_Q[i] : SQRT1_2;
        Biquad& b = f[2 * ch + i];
        if (k == SLOT_HP) b.setHighpass(fl, q, fs);
        else if (k == SLOT_LP) b.setLowpass(fl, q, fs);
        else b.setBandpass(fl, 1, fs);
      }
    }
  }
  double process(double x, int ch = 0) {
    const int b = 2 * ch;
    x = f[b].process(x);
    return stages == 2 ? f[b + 1].process(x) : x;
  }
 private:
  Biquad f[2 * CH];
  int stages = 2, kind = SLOT_OFF;
  double lastFc = -1;
};

struct SlotKind { int kind; bool p24; };
/** Slot kind and slope for the oscillators' filter types: high 24, high 12, low 24, low 12, band. */
constexpr SlotKind OSC_SLOT[5] = {{SLOT_HP, true}, {SLOT_HP, false}, {SLOT_LP, true}, {SLOT_LP, false}, {SLOT_BP, false}};
/** ... and for the sub's and the texture bed's: off, low 12, low 24, high 12, high 24, band. */
constexpr SlotKind AUX_SLOT[6] = {{SLOT_OFF, false}, {SLOT_LP, false}, {SLOT_LP, true}, {SLOT_HP, false}, {SLOT_HP, true}, {SLOT_BP, false}};
inline SlotKind oscSlot(double t) { const int i = (int)t; return i >= 0 && i < 5 ? OSC_SLOT[i] : OSC_SLOT[0]; }
inline SlotKind auxSlot(double t) { const int i = (int)t; return i >= 0 && i < 6 ? AUX_SLOT[i] : AUX_SLOT[0]; }

/**
 * How each segment bends (as on Serum's envelopes): the bend b (-1..1) is a curvature k = 12·b;
 * 0 is a straight line, positive moves fast first and settles (analog), negative is a swell.
 */
constexpr double ENV_BEND_K = 12;
constexpr double ENV_ATTACK_BEND = 0.15;
constexpr double ENV_FALL_BEND = 0.38;

/** ADSR whose attack, decay and release each have their own bend. Times are in ms. */
class Envelope {
 public:
  double level = 0;
  int stage = 0;  // 0 idle, 1 attack, 2 decay/sustain, 3 release

  void set(double attackMs, double decayMs, double sustainLevel, double releaseMs, double fs,
           double attackBend = ENV_ATTACK_BEND, double decayBend = ENV_FALL_BEND, double releaseBend = ENV_FALL_BEND) {
    sustain = sustainLevel;
    if (attackMs == lastA && decayMs == lastD && releaseMs == lastR && attackBend == lastAB && decayBend == lastDB && releaseBend == lastRB) return;
    lastA = attackMs;
    lastD = decayMs;
    lastR = releaseMs;
    lastAB = attackBend;
    lastDB = decayBend;
    lastRB = releaseBend;
    const double sa = std::fmax(1, (attackMs * fs) / 1000), sd = std::fmax(1, (decayMs * fs) / 1000), sr = std::fmax(1, (releaseMs * fs) / 1000);
    incA = 1 / sa;
    incD = 1 / sd;
    incR = 1 / sr;
    kA = ENV_BEND_K * attackBend;
    kD = ENV_BEND_K * decayBend;
    kR = ENV_BEND_K * releaseBend;
    rA = std::exp(-kA * incA);
    rD = std::exp(-kD * incD);
    rR = std::exp(-kR * incR);
    nA = std::fabs(kA) < 1e-3 ? 0 : 1 / (1 - std::exp(-kA));
    nD = std::fabs(kD) < 1e-3 ? 0 : 1 / (1 - std::exp(-kD));
    nR = std::fabs(kR) < 1e-3 ? 0 : 1 / (1 - std::exp(-kR));
  }
  void trigger() {
    stage = 1;
    const double L = std::fmax(0, std::fmin(1, level));
    if (nA == 0) pos = L;
    else {
      const double inner = 1 - L / nA;
      pos = inner > 0 ? std::fmin(1, -std::log(inner) / kA) : 1;
    }
    ex = std::exp(-kA * pos);
  }
  void release() {
    if (stage == 0) return;
    stage = 3;
    from = level;
    pos = 0;
    ex = 1;
  }
  void reset() {
    stage = 0;
    level = 0;
  }
  double tick() {
    switch (stage) {
      case 1:
        pos += incA;
        ex *= rA;
        if (pos >= 1) {
          level = 1;
          stage = 2;
          pos = 0;
          ex = 1;
        } else level = nA == 0 ? pos : (1 - ex) * nA;
        break;
      case 2:
        if (pos < 1) {
          pos += incD;
          ex *= rD;
          const double g = pos >= 1 ? 1 : nD == 0 ? pos : (1 - ex) * nD;
          level = 1 - (1 - sustain) * g;
        } else level = sustain;
        break;
      case 3:
        pos += incR;
        ex *= rR;
        if (pos >= 1) {
          level = 0;
          stage = 0;
        } else level = from * (1 - (nR == 0 ? pos : (1 - ex) * nR));
        break;
    }
    return level;
  }

 private:
  double sustain = 1, pos = 0, ex = 1, from = 0;
  double incA = 0, incD = 0, incR = 0, kA = 0, kD = 0, kR = 0, rA = 1, rD = 1, rR = 1, nA = 0, nD = 0, nR = 0;
  double lastA = -1, lastD = -1, lastR = -1, lastAB = NAN, lastDB = NAN, lastRB = NAN;
};

}  // namespace lt
