// Voice building blocks (port of src/engine/core/voicefx.ts): 303-style diode
// filter, comb filter, physical-model string, Shepard oscillator, attack
// transient and the texture bed. Buffers are sized in the constructor.
#pragma once
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

constexpr int CLICK_NOISE = 0, CLICK_CLICK = 1, CLICK_KNOCK = 2, CLICK_KICK = 3;

class Transient {
 public:
  Transient() : rng(0xc11c) {}
  void reset() {
    env = 0;
    svf.reset();
    dcX = dcY = 0;
  }
  void trigger(int t, double decayMs, double tone, double noteHz, double fs) {
    type = t;
    env = 1;
    dcR = 1 - (2 * PI * 20) / fs;
    envCoef = std::exp(-4.6 / std::fmax(1, (decayMs / 1000) * fs));
    phase = 0;
    g = std::tan((PI * std::fmin(tone, fs * 0.45)) / fs);
    if (t == CLICK_KNOCK) {
      freq = tone / fs;
      freqTarget = (tone * 0.6) / fs;
      sweep = std::exp(-1 / (0.01 * fs));
    } else if (t == CLICK_KICK) {
      freq = tone / fs;
      freqTarget = std::fmax(30, noteHz) / fs;
      sweep = std::exp(-1 / (std::fmax(5, decayMs * 0.25) * 0.001 * fs));
    }
  }
  double process() {
    if (env < 1e-5) {
      const double y0 = -dcX + dcR * dcY;
      dcX = 0;
      dcY = y0;
      return y0;
    }
    double y;
    switch (type) {
      case CLICK_NOISE:
        svf.process(rng.next(), g, 0.7);
        y = svf.bp * 1.4;
        break;
      case CLICK_CLICK:
        svf.process(rng.next(), g, 1.2);
        y = svf.hp;
        break;
      default:
        freq = freqTarget + (freq - freqTarget) * sweep;
        phase += freq;
        if (phase >= 1) phase -= 1;
        y = std::sin(TWO_PI * phase);
        if (type == CLICK_KICK) y = fastTanh(2.2 * y);
    }
    y *= env;
    env *= envCoef;
    const double out = y - dcX + dcR * dcY;
    dcX = y;
    dcY = out;
    return out;
  }
 private:
  double env = 0, envCoef = 0.99, phase = 0, freq = 0, freqTarget = 0, sweep = 0.999;
  Svf svf;
  Rng rng;
  int type = CLICK_CLICK;
  double g = 0.1, dcX = 0, dcY = 0, dcR = 0.997;
};

constexpr int TEX_CRACKLE = 0, TEX_DUST = 1, TEX_RUMBLE = 2, TEX_AIR = 3;

class Texture {
 public:
  Texture() : rngL(0x7e47c0), rngR(0x51de55), rngW(0x3a11ee) {}
  void reset() {
    svfL.reset();
    svfR.reset();
    svf2.reset();
    lpL = lpR = 0;
  }
  void process(int type, double tone, double fs, double* out) {
    if (--wanderCount <= 0) {
      wanderTarget = rngW.next();
      wanderCount = (int)jsRound((0.4 + 0.6 * (rngW.next() + 1)) * fs);
    }
    wander += (wanderTarget - wander) * (8 / fs);
    const double w = 1 + 0.45 * wander;
    double l, r;
    switch (type) {
      case TEX_CRACKLE: {
        const double p = (6 + 30 * tone) / fs;
        const double g = std::tan((PI * std::fmin(1500 * std::pow(4.0, tone), fs * 0.4)) / fs);
        const double el = 0.5 * (rngL.next() + 1) < p ? popSize(rngL) : 0;
        const double er = 0.5 * (rngR.next() + 1) < p ? popSize(rngR) : 0;
        svfL.process(el, g, 1.1);
        svfR.process(er, g, 1.1);
        lpL += (rngL.next() - lpL) * 0.25;
        lpR += (rngR.next() - lpR) * 0.25;
        l = 24 * svfL.bp + 0.27 * lpL;
        r = 24 * svfR.bp + 0.27 * lpR;
        break;
      }
      case TEX_DUST: {
        const double p = (250 + 900 * tone) / fs;
        const double g = std::tan((PI * std::fmin(2500 * std::pow(2.5, tone), fs * 0.4)) / fs);
        const double el = 0.5 * (rngL.next() + 1) < p ? rngL.next() : 0;
        const double er = 0.5 * (rngR.next() + 1) < p ? rngR.next() : 0;
        svfL.process(el, g, 0.9);
        svfR.process(er, g, 0.9);
        l = 4 * svfL.hp * w;
        r = 4 * svfR.hp * w;
        break;
      }
      case TEX_RUMBLE: {
        const double g = std::tan((PI * (140 + 260 * tone)) / fs);
        svfL.process(rngL.next(), g, 0.9);
        svf2.process(svfL.lp, std::tan((PI * 110) / fs), 1.2);
        l = r = 2.4 * svf2.hp * (0.6 + 0.4 * w);
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
        svfL.process(rngL.next(), g, 1.5);
        svfR.process(rngR.next(), g, 1.5);
        l = 2.4 * svfL.bp * b;
        r = 2.4 * svfR.bp * b;
      }
    }
    out[0] = l;
    out[1] = r;
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
  double lpL = 0, lpR = 0, wander = 0, wanderTarget = 0;
  int wanderCount = 0;
  double breath = 0, breathTarget = 0;
  int breathCount = 0;
};

}  // namespace lt
