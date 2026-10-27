// Voice building blocks (port of src/engine/core/voicefx.ts): 303-style diode
// filter, comb filter, physical-model string, Shepard oscillator, attack
// texture bed. Buffers are sized in the constructor.
#pragma once
#include <algorithm>
#include <array>
#include <cmath>
#include <vector>
#include "Dsp.h"

namespace lt {

class DiodeLadder {
 public:
  void reset() { s1 = s2 = s3 = y = 0; }
  double process(double x, double g, double k) {
    const double G = g / (1 + g);
    const double u = fastTanh(x * (1 + 0.15 * k) - k * y);
    double v = (u - s1) * G;
    const double y1 = v + s1;
    s1 = y1 + v;
    v = (fastTanh(y1) - s2) * G;
    const double y2 = v + s2;
    s2 = y2 + v;
    v = (y2 - s3) * G;
    const double y3 = v + s3;
    s3 = y3 + v;
    y = y3;
    return y3;
  }
 private:
  double s1 = 0, s2 = 0, s3 = 0, y = 0;
};

class Comb {
 public:
  explicit Comb(int maxDelaySamples) {
    int size = 1;
    while (size < maxDelaySamples + 4) size <<= 1;
    buf.assign(size, 0.0);
    mask = size - 1;
  }
  void reset() { std::fill(buf.begin(), buf.end(), 0.0); }
  double process(double x, double delaySamples, double feedback) {
    const double pos = w - delaySamples;
    const int i = (int)std::floor(pos);
    const double f = pos - i;
    const double a = buf[i & mask];
    const double d = a + (buf[(i + 1) & mask] - a) * f;
    const double y = x + feedback * d;
    buf[w] = y > 4 ? 4 : y < -4 ? -4 : y;
    w = (w + 1) & mask;
    return y * (1 - 0.7 * std::fabs(feedback));
  }
 private:
  std::vector<double> buf;
  int mask = 0, w = 0;
};

class KarplusString {
 public:
  explicit KarplusString(int maxPeriodSamples) : rng(0x5eed) {
    int size = 1;
    while (size < maxPeriodSamples + 8) size <<= 1;
    buf.assign(size, 0.0);
    mask = size - 1;
  }
  void reset() {
    std::fill(buf.begin(), buf.end(), 0.0);
    lp = dc = dcIn = 0;
  }
  void pluck(double periodSamples) {
    excite = (int)std::fmax(1, jsRound(periodSamples));
    exciteLp = 0;
  }
  double process(double period, double tone, double loopGain) {
    const double a = 0.08 + 0.9 * tone;
    const double filterDelay = (1 - a) / a;
    const double d = std::fmax(2, period - filterDelay - 1);
    const double pos = w - d;
    const int i = (int)std::floor(pos);
    const double f = pos - i;
    const double s0 = buf[i & mask];
    const double delayed = s0 + (buf[(i + 1) & mask] - s0) * f;
    lp += (delayed - lp) * a;
    double input = 0;
    if (excite > 0) {
      exciteLp += (rng.next() - exciteLp) * (0.15 + 0.85 * tone);
      input = exciteLp;
      excite--;
    }
    const double y = lp * loopGain + input;
    buf[w] = y;
    w = (w + 1) & mask;
    const double out = y - dcIn + 0.995 * dc;
    dcIn = y;
    dc = out;
    return out;
  }
 private:
  std::vector<double> buf;
  int mask = 0, w = 0;
  double lp = 0, dc = 0, dcIn = 0;
  Rng rng;
  int excite = 0;
  double exciteLp = 0;
};

constexpr int SHEPARD_PARTIALS = 8;

class Shepard {
 public:
  void reset() {
    phase.fill(0);
    pos = 0;
  }
  double process(double inc, double rateOctPerSample) {
    pos += rateOctPerSample;
    if (pos >= 1) {
      pos -= 1;
      for (int j = 0; j < SHEPARD_PARTIALS - 1; j++) phase[j] = phase[j + 1];
      phase[SHEPARD_PARTIALS - 1] = 0;
    } else if (pos < 0) {
      pos += 1;
      for (int j = SHEPARD_PARTIALS - 1; j > 0; j--) phase[j] = phase[j - 1];
      phase[0] = 0;
    }
    double out = 0, wsum = 0;
    const double center = SHEPARD_PARTIALS / 2 - 1;
    for (int j = 0; j < SHEPARD_PARTIALS; j++) {
      const double oct = j - center + pos;
      const double wgt = std::exp(-((oct - 0.5) * (oct - 0.5)) / 1.6);
      wsum += wgt;
      const double pinc = inc * std::pow(2.0, oct);
      if (pinc >= 0.45) continue;
      double ph = phase[j] + pinc;
      if (ph >= 1) ph -= 1;
      phase[j] = ph;
      out += wgt * std::sin(TWO_PI * ph);
    }
    return wsum > 0 ? (out / wsum) * 1.6 : 0;
  }
 private:
  std::array<double, SHEPARD_PARTIALS> phase{};
  double pos = 0;
};

constexpr int TEX_CRACKLE = 0, TEX_DUST = 1, TEX_RUMBLE = 2, TEX_AIR = 3, TEX_AIR_HIT = 4, TEX_TAPE = 5, TEX_STATIC = 6;
/** The HIT types: each bed as one burst per note (fading over Tail), nothing between. */
constexpr int TEX_CRACKLE_HIT = 7, TEX_DUST_HIT = 8, TEX_STATIC_HIT = 9, TEX_TAPE_HIT = 10, TEX_RUMBLE_HIT = 11;
constexpr int TEX_WHITE = 12, TEX_WHITE_HIT = 13;
constexpr int TEX_TYPES = 14;
inline bool texIsHit(int type) { return type == TEX_AIR_HIT || (type >= TEX_CRACKLE_HIT && type <= TEX_RUMBLE_HIT) || type == TEX_WHITE_HIT; }
/** The bed each type plays (a hit plays its bed), by texture.type index. */
constexpr int TEX_BED[TEX_TYPES] = {TEX_CRACKLE, TEX_DUST, TEX_RUMBLE, TEX_AIR, TEX_AIR, TEX_TAPE, TEX_STATIC, TEX_CRACKLE, TEX_DUST, TEX_STATIC, TEX_TAPE, TEX_RUMBLE, TEX_WHITE, TEX_WHITE};
/** Loudness trim per type (dB) at Tone 0, 0.25, 0.5, 0.75, 1 (see voicefx.ts TEX_TRIM_DB). */
constexpr double TEX_TRIM_DB[TEX_TYPES][5] = {
  {7.8, 6, 4.4, 3.1, 2.1},
  {4.4, 1.5, -0.2, -1.3, -2.1},
  {11.4, 8, 6.2, 5, 4},
  {1.5, -0.8, -2.9, -4.6, -5.8},
  {8.6, 6.3, 4.2, 2.5, 1.3},
  {-2.5, -2.3, -2.1, -1.7, -1.1},
  {1.7, 0.2, -1, -2.1, -3.1},
  {3.7, 1.9, 0.4, -0.9, -1.9},
  {8.8, 6.4, 5.1, 4, 3.4},
  {6.2, 4.8, 3.5, 2.4, 1.5},
  {4.4, 4.6, 4.8, 5.2, 5.8},
  {18, 14.7, 12.9, 11.7, 10.8},
  {18.5, 13.5, 8.8, 4.8, 1.6},
  {25.4, 20.4, 15.7, 11.7, 8.5},
};
inline double texTrim(int type, double tone) {
  static const auto table = [] {
    std::array<std::array<double, 5>, TEX_TYPES> t{};
    for (int a = 0; a < TEX_TYPES; a++)
      for (int b = 0; b < 5; b++) t[a][b] = std::pow(10.0, TEX_TRIM_DB[a][b] / 20);
    return t;
  }();
  const auto& row = table[type >= 0 && type < TEX_TYPES ? type : 0];
  const double f = std::fmax(0, std::fmin(1, tone)) * 4;
  const int i = std::min(3, (int)std::floor(f));
  return row[i] + (row[i + 1] - row[i]) * (f - i);
}

/**
 * Texture bed (port of voicefx.ts Texture): grains (crackle, dust, static), noise (tape hiss, air,
 * rumble, white) and a HIT of each (one burst per note, fading over Tail).
 */
class Texture {
 public:
  double puffLen = 0.7;
  Texture() : rngL(0x7e47c0), rngR(0x51de55), rngW(0x3a11ee) {}
  void trigger(double velocity = 1) {
    puffIn = 0;
    puffOut = 1;
    hitVel = 0.35 + 0.65 * std::fmax(0, std::fmin(1, velocity));
    hitKick = true;
  }
  void reset() {
    svfL.reset();
    svfR.reset();
    svf2.reset();
  }
  void process(int type, double tone, double density, double fs, double* out) {
    const double k = density - 0.5;
    const double wide = std::pow(2.0, 1.6 * k);
    if (--wanderCount <= 0) {
      wanderTarget = rngW.next();
      wanderCount = (int)jsRound((0.4 + 0.6 * (rngW.next() + 1)) * fs);
    }
    wander += (wanderTarget - wander) * (8 / fs);
    const double w = 1 + 0.45 * wander;
    const int typeIn = type;
    const bool hit = texIsHit(type);
    type = type >= 0 && type < TEX_TYPES ? TEX_BED[type] : TEX_AIR;
    const bool grain = type == TEX_CRACKLE || type == TEX_DUST || type == TEX_STATIC;
    if (hit) {
      puffIn += (1 - puffIn) * (1 / (0.01 * fs));
      puffOut *= std::exp(-4.6 / (std::fmax(0.02, puffLen) * fs));
    }
    const double boost = hit && grain ? 4 : 1;
    const bool kick = hit && grain && hitKick;
    if (kick) hitKick = false;
    double l, r;
    switch (type) {
      case TEX_CRACKLE: {
        const double p = ((16 * boost) / fs) * std::pow(2.0, 5 * k);
        const double g = std::tan((PI * std::fmin(1500 * std::pow(4.0, tone), fs * 0.4)) / fs);
        const double el = kick ? 0.8 : 0.5 * (rngL.next() + 1) < p ? popSize(rngL) : 0;
        const double er = kick ? -0.7 : 0.5 * (rngR.next() + 1) < p ? popSize(rngR) : 0;
        svfL.process(el, g, 1.1);
        svfR.process(er, g, 1.1);
        l = 40 * svfL.bp;
        r = 40 * svfR.bp;
        break;
      }
      case TEX_DUST: {
        const double p = ((250 + 900 * tone) / fs) * std::pow(2.0, 3 * k);
        const double g = std::tan((PI * std::fmin(2500 * std::pow(2.5, tone), fs * 0.4)) / fs);
        const double el = kick ? 0.9 : 0.5 * (rngL.next() + 1) < p ? rngL.next() : 0;
        const double er = kick ? -0.9 : 0.5 * (rngR.next() + 1) < p ? rngR.next() : 0;
        svfL.process(el, g, 0.9);
        svfR.process(er, g, 0.9);
        l = 4 * svfL.hp * w;
        r = 4 * svfR.hp * w;
        break;
      }
      case TEX_RUMBLE: {
        const double g = std::tan((PI * std::fmin((140 + 260 * tone) * wide, fs * 0.4)) / fs);
        svfL.process(rngL.next(), g, 0.9);
        svf2.process(svfL.lp, std::tan((PI * 110) / fs), 1.2);
        l = r = (2.4 / std::sqrt(wide)) * svf2.hp * (0.6 + 0.4 * w);
        break;
      }
      case TEX_TAPE: {
        const double g = std::tan((PI * std::fmin((2000 * std::pow(4.0, tone)) / (wide * wide), fs * 0.4)) / fs);
        svfL.process(rngL.next(), g, 1.4);
        svfR.process(rngR.next(), g, 1.4);
        const double a = 0.48 * std::pow(wide, -0.3) * (0.9 + 0.1 * w);
        l = svfL.hp * a;
        r = svfR.hp * a;
        break;
      }
      case TEX_WHITE: {
        const double a = tone >= 0.999 ? 1 : 1 - std::exp((-2 * PI * std::fmin(600 * std::pow(34.0, tone), fs * 0.45)) / fs);
        const double nl = rngL.next(), nr = rngR.next(), sp = std::fmin(1, density * 1.4);
        whiteL += ((nl + (1 - sp) * nr) / (2 - sp) - whiteL) * a;
        whiteR += ((nr + (1 - sp) * nl) / (2 - sp) - whiteR) * a;
        l = 0.5 * whiteL * w;
        r = 0.5 * whiteR * w;
        break;
      }
      case TEX_STATIC: {
        if (--flick <= 0) {
          flickG = 0.35 + 0.65 * std::fabs(rngW.next());
          flick = (int)jsRound(fs / (300 + 300 * (rngW.next() + 1)));
        }
        const double g = std::tan((PI * std::fmin(1500 * std::pow(3.0, tone), fs * 0.4)) / fs);
        const double pop = kick ? 6 : 0.5 * (rngW.next() + 1) < (35 * boost * std::pow(2.0, 4 * k)) / fs ? rngW.next() * 6 : 0;
        svfL.process(rngL.next() * flickG + pop, g, 1.2);
        svfR.process(rngR.next() * flickG + pop, g, 1.2);
        l = 1.6 * svfL.bp;
        r = 1.6 * svfR.bp;
        break;
      }
      default: {
        if (--breathCount <= 0) {
          breathTarget = rngW.next();
          breathCount = (int)jsRound((2 + 1.5 * (rngW.next() + 1)) * fs);
        }
        breath += (breathTarget - breath) * (1.5 / fs);
        const double b = std::exp(0.46 * breath);
        const double g = std::tan((PI * std::fmin(1000 * std::pow(6.0, tone), fs * 0.4)) / fs);
        const double q = 1.5 * wide;
        svfL.process(rngL.next(), g, q);
        svfR.process(rngR.next(), g, q);
        l = 2.4 * std::sqrt(wide) * svfL.bp * b;
        r = 2.4 * std::sqrt(wide) * svfR.bp * b;
      }
    }
    if (hit) {
      const double e = (grain ? 1 : puffIn) * puffOut * hitVel;
      l *= e;
      r *= e;
    }
    const double g = texTrim(typeIn, tone);
    out[0] = l * g;
    out[1] = r * g;
  }
 private:
  static double popSize(Rng& rng) {
    const double u = 0.5 * (rng.next() + 1);
    // JS evaluates the size before the sign: keep that order.
    const double size = 0.15 + 0.85 * u * u * u;
    return size * (rng.next() < 0 ? -1 : 1);
  }
  Rng rngL, rngR, rngW;
  Svf svfL, svfR, svf2;
  double whiteL = 0, whiteR = 0, wander = 0, wanderTarget = 0;
  int wanderCount = 0;
  double breath = 0, breathTarget = 0;
  int breathCount = 0;
  double puffIn = 0, puffOut = 0, hitVel = 1;
  bool hitKick = false;
  int flick = 0;
  double flickG = 1;
};

}  // namespace lt
