// Effects (port of src/engine/core/fx.ts): chorus, phaser, limiter, flanger,
// delay, octave-down, reverb, tape and bitcrusher.
// Delay lines are float, like the prototype's Float32Arrays.
#pragma once
#include <algorithm>
#include <array>
#include <cmath>
#include <vector>
#include "Dsp.h"
#include "Verb.h"

namespace lt {

constexpr double MAX_FS = 192000;

inline int pow2Size(double n) {
  int s = 1;
  while (s < n) s <<= 1;
  return s;
}

/** Linear-interpolated read `delay` samples behind write index `w`. */
inline double readFrac(const std::vector<float>& buf, int mask, int w, double delay) {
  const double pos = w - delay;
  const int i = (int)std::floor(pos);
  const double f = pos - i;
  const double a = buf[i & mask];
  return a + (buf[(i + 1) & mask] - a) * f;
}

class Chorus {
 public:
  explicit Chorus(double fs_) : fs(fs_), rng(0xc0c0a) {
    dl = dr = 0.007 * fs;
    size = 1;
    while (size < std::ceil(0.04 * std::min(fs, MAX_FS))) size <<= 1;
    bufL.assign(size, 0.f);
    bufR.assign(size, 0.f);
  }
  void reset() {
    std::fill(bufL.begin(), bufL.end(), 0.f);
    std::fill(bufR.begin(), bufR.end(), 0.f);
  }
  void process(double l, double r, double mix, double depth, double* out, int mode) {
    if (mode == 1) {
      processEnsemble(l, r, mix, depth, out);
      return;
    }
    if (mode == 2) {
      processHyper(l, r, mix, depth, out);
      return;
    }
    if (mode == 3) {
      processBbd(l, r, mix, depth, out);
      return;
    }
    const int mask = size - 1;
    bufL[w & mask] = (float)l;
    bufR[w & mask] = (float)r;
    if (count-- <= 0) {
      count = 15;
      const double rate = (0.25 + depth * 0.9) * driftStep();
      phase += (16 * rate) / fs;
      if (phase >= 1) phase -= 1;
      const double base = 0.007 * fs;
      const double mod = (0.0005 + depth * 0.0045) * fs;
      stepL = (base + mod * (0.5 + 0.5 * std::sin(TWO_PI * phase)) - dl) / 16;
      stepR = (base + mod * (0.5 + 0.5 * std::sin(TWO_PI * (phase + 0.25))) - dr) / 16;
    }
    dl += stepL;
    dr += stepR;
    const double wl = read(bufL, dl);
    const double wr = read(bufR, dr);
    w = (w + 1) & mask;
    const double dry = 1 - 0.5 * mix;
    out[0] = l * dry + 0.5 * mix * (0.8 * wl + 0.2 * wr);
    out[1] = r * dry + 0.5 * mix * (0.8 * wr + 0.2 * wl);
  }
 private:
  double driftStep() {
    driftCount -= 16;
    if (driftCount <= 0) {
      driftTarget = rng.next();
      driftCount = (int)jsRound((1 + 0.5 * (rng.next() + 1)) * fs);
    }
    drift += (driftTarget - drift) * (16 / (0.6 * fs));
    return 1 + 0.4 * drift;
  }
  double read(const std::vector<float>& buf, double delaySamples) const {
    const int mask = size - 1;
    const double pos = w - delaySamples;
    const int i = (int)std::floor(pos);
    const double f = pos - i;
    const double a = buf[i & mask];
    const double b = buf[(i + 1) & mask];
    return a + (b - a) * f;
  }
  /** BBD: the Juno / Jupiter chorus (processBbd in fx.ts). */
  void processBbd(double l, double r, double mix, double depth, double* out) {
    const int mask = size - 1;
    bufL[w & mask] = (float)l;
    bufR[w & mask] = (float)r;
    if (bbdCoef < 0) bbdCoef = 1 - std::exp((-TWO_PI * 7000) / fs);
    if (count-- <= 0) {
      count = 15;
      bbdRate = (0.4 + 0.5 * depth) * driftStep();
    }
    bbdPhase += bbdRate / fs;
    if (bbdPhase >= 1) bbdPhase -= 1;
    const double tri = bbdPhase < 0.5 ? 4 * bbdPhase - 1 : 3 - 4 * bbdPhase;
    const double centre = 0.0035 * fs, swing = (0.0008 + 0.0016 * depth) * fs;
    double wl = read(bufL, centre + swing * tri);
    double wr = read(bufR, centre - swing * tri);
    const double c = bbdCoef;
    bbdLp[0] += (wl - bbdLp[0]) * c;
    bbdLp[1] += (bbdLp[0] - bbdLp[1]) * c;
    bbdLp[2] += (wr - bbdLp[2]) * c;
    bbdLp[3] += (bbdLp[2] - bbdLp[3]) * c;
    wl = fastTanh(1.2 * bbdLp[1]) / 1.2 + 0.0006 * bbdNoise.next();
    wr = fastTanh(1.2 * bbdLp[3]) / 1.2 + 0.0006 * bbdNoise.next();
    w = (w + 1) & mask;
    const double dry = 1 - 0.5 * mix;
    out[0] = l * dry + mix * 0.55 * wl;
    out[1] = r * dry + mix * 0.55 * wr;
  }
  double bbdPhase = 0, bbdRate = 0.5, bbdCoef = -1;
  std::array<double, 4> bbdLp{};
  Rng bbdNoise{0xbbdu};
  void processEnsemble(double l, double r, double mix, double depth, double* out) {
    const int mask = size - 1;
    bufL[w & mask] = (float)l;
    bufR[w & mask] = (float)r;
    if (count-- <= 0) {
      count = 15;
      ensRate = (0.55 + 0.4 * depth) * driftStep();
    }
    ensPhase += ensRate / fs;
    if (ensPhase >= 1) ensPhase -= 1;
    shimmer += 6.1 / fs;
    if (shimmer >= 1) shimmer -= 1;
    const double base = 0.0065 * fs;
    const double mod = (0.001 + depth * 0.003) * fs;
    const double shim = 0.00012 * fs * std::sin(TWO_PI * shimmer);
    double wl = 0, wr = 0;
    for (int t = 0; t < 3; t++) {
      const double ph = ensPhase + t / 3.0;
      const double s = std::sin(TWO_PI * ph);
      wl += read(bufL, base + mod * (0.5 + 0.5 * s) + shim);
      wr += read(bufR, base + mod * (0.5 - 0.5 * s) + shim);
    }
    w = (w + 1) & mask;
    const double dry = 1 - 0.55 * mix;
    out[0] = l * dry + mix * 0.3 * (0.7 * wl + 0.3 * wr);
    out[1] = r * dry + mix * 0.3 * (0.7 * wr + 0.3 * wl);
  }
  /** Hyper: six copies, each a little sharp or flat on its own slow cycle, spread left to right (fx.ts). */
  void processHyper(double l, double r, double mix, double depth, double* out) {
    static constexpr double RATE[6] = {0.29, 0.41, 0.53, 0.67, 0.79, 0.97};
    static const auto pans = [] {
      std::array<double, 12> p{};
      for (int i = 0; i < 6; i++) {
        const double a = ((((2.0 * i) / 5 - 1) * 0.9 + 1) * PI) / 4;
        p[i] = SQRT2 * std::cos(a);
        p[6 + i] = SQRT2 * std::sin(a);
      }
      return p;
    }();
    const int mask = size - 1;
    bufL[w & mask] = (float)l;
    bufR[w & mask] = (float)r;
    if (count-- <= 0) {
      count = 15;
      hypDrift = driftStep();
    }
    const double sp = (0.6 + 0.9 * depth) * hypDrift;
    const double amp = (0.0004 + 0.0028 * depth) * fs;
    double wl = 0, wr = 0;
    for (int t = 0; t < 6; t++) {
      double ph = hypPhase[t] + (RATE[t] * sp) / fs;
      if (ph >= 1) ph -= 1;
      hypPhase[t] = ph;
      const double d = (0.006 + 0.0011 * t) * fs + amp * (0.5 + 0.5 * std::sin(TWO_PI * ph));
      wl += read(bufL, d) * pans[t];
      wr += read(bufR, d) * pans[6 + t];
    }
    w = (w + 1) & mask;
    const double dry = 1 - 0.6 * mix;
    out[0] = l * dry + mix * 0.42 * wl;
    out[1] = r * dry + mix * 0.42 * wr;
  }
  std::vector<float> bufL, bufR;
  int size = 1, w = 0;
  double hypPhase[6] = {0, 1.0 / 6, 2.0 / 6, 3.0 / 6, 4.0 / 6, 5.0 / 6}, hypDrift = 1;
  double phase = 0, fs;
  int count = 0;
  double dl = 0, dr = 0, stepL = 0, stepR = 0;
  Rng rng;
  double drift = 0, driftTarget = 0;
  int driftCount = 0;
  double ensPhase = 0, ensRate = 0.75, shimmer = 0;
};

class Phaser {
 public:
  explicit Phaser(double fs_) : fs(fs_) {}
  void reset() {
    zl.fill(0);
    zr.fill(0);
    fbL = fbR = 0;
  }
  void process(double l, double r, double mix, double rate, double* out) {
    if (count-- <= 0) {
      count = 15;
      phase += (16 * rate) / fs;
      if (phase >= 1) phase -= 1;
      const double tl = coef(0.5 + 0.5 * std::sin(TWO_PI * phase));
      const double tr = coef(0.5 + 0.5 * std::sin(TWO_PI * (phase + 0.2)));
      stepL = (tl - aL) / 16;
      stepR = (tr - aR) / 16;
    }
    aL += stepL;
    aR += stepR;
    const double yl = chain(l + 0.4 * fbL, zl, aL);
    const double yr = chain(r + 0.4 * fbR, zr, aR);
    fbL = clampd(yl, -2, 2);
    fbR = clampd(yr, -2, 2);
    out[0] = l * (1 - 0.5 * mix) + yl * 0.5 * mix;
    out[1] = r * (1 - 0.5 * mix) + yr * 0.5 * mix;
  }
 private:
  double coef(double lfo) const {
    const double fc = 250 * std::pow(14.0, lfo);
    const double t = std::tan((PI * std::fmin(fc, fs * 0.45)) / fs);
    return (t - 1) / (t + 1);
  }
  static double chain(double x, std::array<double, 4>& z, double a) {
    for (int i = 0; i < 4; i++) {
      const double y = a * x + z[i];
      z[i] = x - a * y;
      x = y;
    }
    return x;
  }
  std::array<double, 4> zl{}, zr{};
  double fbL = 0, fbR = 0, phase = 0, fs;
  int count = 0;
  double aL = 0, aR = 0, stepL = 0, stepR = 0;
};

/** Delay of the limiter's true-peak detector (samples). */
constexpr int TP_DELAY = 4;

/** Transparent look-ahead peak limiter (stereo-linked, always on), with true-peak detection. */
class Limiter {
 public:
  double ceiling;
  int lookahead;
  double minGain = 1;

  Limiter(double fs, double ceilingDb = -1, double lookaheadMs = 1.5, double releaseMs = 150, double holdMs = 55) {
    ceiling = std::pow(10.0, ceilingDb / 20);
    lookahead = (int)std::fmax(2 + TP_DELAY, jsRound((lookaheadMs * fs) / 1000));
    win = lookahead - TP_DELAY;
    const int L = win;
    delayL.assign(L + TP_DELAY, 0.0);
    delayR.assign(L + TP_DELAY, 0.0);
    const double fs3[3] = {0.25, 0.5, 0.75};
    for (int p = 0; p < 3; p++) {
      double sum = 0;
      for (int i = 0; i < 8; i++) {
        const double x = fs3[p] - (i - 3);
        const double sinc = std::sin(PI * x) / (PI * x);
        const double w = 0.5 + 0.5 * std::cos((PI * x) / 4.5);
        taps[p][i] = sinc * w;
        sum += taps[p][i];
      }
      for (int i = 0; i < 8; i++) taps[p][i] /= sum;
    }
    qCap = L + 2;
    qVal.assign(qCap, 0.0);
    qIdx.assign(qCap, 0.0);
    box.assign(L, 1.0);
    boxSum = L;
    release = 1 - std::exp(-1 / ((releaseMs * fs) / 1000));
    holdSamples = (int)jsRound((holdMs * fs) / 1000);
  }
  void reset() {
    std::fill(delayL.begin(), delayL.end(), 0.0);
    std::fill(delayR.begin(), delayR.end(), 0.0);
    for (int i = 0; i < 8; i++) histL[i] = histR[i] = 0;
    std::fill(box.begin(), box.end(), 1.0);
    boxSum = win;
    qHead = qTail = 0;
    gain = 1;
    holdCount = 0;
  }
  void process(double l, double r, double* out) {
    const int L = win;
    const int hp = hPos;
    histL[hp] = l;
    histR[hp] = r;
    hPos = (hp + 1) & 7;
    double peak = std::fmax(std::fabs(histL[(hp + 4) & 7]), std::fabs(histR[(hp + 4) & 7]));
    for (int ph = 0; ph < 3; ph++) {
      double al = 0, ar = 0;
      for (int i = 0; i < 8; i++) {
        const int j = (hp + 1 + i) & 7;
        al += taps[ph][i] * histL[j];
        ar += taps[ph][i] * histR[j];
      }
      if (al < 0) al = -al;
      if (ar < 0) ar = -ar;
      if (al > peak) peak = al;
      if (ar > peak) peak = ar;
    }
    const double req = peak > ceiling ? ceiling / peak : 1;
    const int cap = qCap;
    while (qTail != qHead && qVal[(qTail - 1 + cap) % cap] >= req) qTail = (qTail - 1 + cap) % cap;
    qVal[qTail] = req;
    qIdx[qTail] = (double)n;
    qTail = (qTail + 1) % cap;
    while (qIdx[qHead] <= (double)(n - L)) qHead = (qHead + 1) % cap;
    const double held = qVal[qHead];
    n++;
    boxSum += held - box[boxPos];
    box[boxPos] = held;
    boxPos = boxPos + 1 == L ? 0 : boxPos + 1;
    if (boxPos == 0) {
      double s = 0;
      for (int i = 0; i < L; i++) s += box[i];
      boxSum = s;
    }
    const double smooth = boxSum / L;
    if (smooth < gain) {
      gain = smooth;
      holdCount = holdSamples;
    } else if (holdCount > 0) {
      holdCount--;
    } else {
      const double rel = gain + (1 - gain) * release;
      gain = smooth < rel ? smooth : rel;
    }
    if (gain < minGain) minGain = gain;
    const double dl = delayL[dPos];
    const double dr = delayR[dPos];
    delayL[dPos] = l;
    delayR[dPos] = r;
    dPos = dPos + 1 == L - 1 + TP_DELAY ? 0 : dPos + 1;
    const double c = ceiling;
    const double yl = dl * gain, yr = dr * gain;
    out[0] = yl > c ? c : yl < -c ? -c : yl;
    out[1] = yr > c ? c : yr < -c ? -c : yr;
  }
 private:
  std::vector<double> delayL, delayR, qVal, qIdx, box;
  double histL[8] = {}, histR[8] = {}, taps[3][8] = {};
  int hPos = 0, win = 2;
  int dPos = 0, qHead = 0, qTail = 0, qCap = 0, boxPos = 0, holdSamples = 0, holdCount = 0;
  long long n = 0;
  double boxSum = 0, gain = 1, release = 0;
};

class Flanger {
 public:
  explicit Flanger(double fs_) : fs(fs_) {
    dl = dr = 0.0003 * fs;
    const int size = pow2Size(std::ceil(0.012 * fs));
    bufL.assign(size, 0.f);
    bufR.assign(size, 0.f);
    mask = size - 1;
  }
  void reset() {
    std::fill(bufL.begin(), bufL.end(), 0.f);
    std::fill(bufR.begin(), bufR.end(), 0.f);
    fbL = fbR = 0;
  }
  void process(double l, double r, double mix, double rate, double feedback, double* out) {
    if (count-- <= 0) {
      count = 15;
      phase += (16 * rate) / fs;
      if (phase >= 1) phase -= 1;
      const double mn = 0.0003 * fs, depth = 0.0042 * fs;
      stepL = (mn + depth * (0.5 - 0.5 * std::cos(TWO_PI * phase)) - dl) / 16;
      stepR = (mn + depth * (0.5 - 0.5 * std::cos(TWO_PI * (phase + 0.25))) - dr) / 16;
    }
    const double dL = (dl += stepL);
    const double dR = (dr += stepR);
    bufL[w] = (float)(l + feedback * fbL);
    bufR[w] = (float)(r + feedback * fbR);
    const double wl = readFrac(bufL, mask, w, dL);
    const double wr = readFrac(bufR, mask, w, dR);
    w = (w + 1) & mask;
    fbL = clampd(wl, -1.5, 1.5);
    fbR = clampd(wr, -1.5, 1.5);
    out[0] = l * (1 - 0.5 * mix) + wl * 0.5 * mix;
    out[1] = r * (1 - 0.5 * mix) + wr * 0.5 * mix;
  }
 private:
  double fs;
  std::vector<float> bufL, bufR;
  int mask = 0, w = 0, count = 0;
  double phase = 0, fbL = 0, fbR = 0, dl = 0, dr = 0, stepL = 0, stepR = 0;
};

/** HYPER / DIMENSION (as HyperDim in fx.ts). */
class HyperDim {
 public:
  explicit HyperDim(double fs_) : fs(fs_) {
    const int size = pow2Size(std::ceil(0.06 * fs));
    buf.assign(size, 0.f);
    mask = size - 1;
    const int ds = pow2Size(std::ceil(0.04 * fs));
    dl.assign(ds, 0.f);
    dr.assign(ds, 0.f);
    dmask = ds - 1;
    retrig(7);
  }
  void reset() {
    std::fill(buf.begin(), buf.end(), 0.f);
    std::fill(dl.begin(), dl.end(), 0.f);
    std::fill(dr.begin(), dr.end(), 0.f);
    retrig(7);
  }
  void retrig(double unison) {
    const int u = std::max(1, (int)jsRound(unison));
    for (int i = 0; i < 7; i++) ph[i] = (double)(i % u) / u;
  }
  void process(double l, double r, double rate, double detune, double unison, double mix, double size, double dimMix, double* out) {
    if (mix > 1e-4) {
      const int u = std::max(1, std::min(7, (int)jsRound(unison)));
      double wl = 0, wr = 0;
      for (int i = 0; i < u; i++) {
        const double ri = rate * (1 + 0.29 * (std::fmod(i * 0.618034, 1.0) - 0.5));
        double p = ph[i] + ri / fs;
        p -= std::floor(p);
        ph[i] = p;
        const double d = (0.008 + 0.0017 * i + detune * 0.005 * (0.5 + 0.5 * std::sin(2 * PI * p))) * fs;
        const double y = readFrac(buf, mask, w, d);
        const double pan = u > 1 ? (2.0 * i) / (u - 1) - 1 : 0;
        wl += y * std::sqrt(0.5 * (1 - pan));
        wr += y * std::sqrt(0.5 * (1 + pan));
      }
      buf[(size_t)w] = (float)(0.5 * (l + r));
      w = (w + 1) & mask;
      const double n = 1 / std::sqrt((double)u);
      l = l * (1 - mix) + wl * n * mix;
      r = r * (1 - mix) + wr * n * mix;
    }
    if (dimMix > 1e-4) {
      const double s = 0.003 + 0.015 * size;
      const double a = readFrac(dr, dmask, dw, s * fs), b = readFrac(dl, dmask, dw, s * 1.37 * fs);
      const double c = readFrac(dl, dmask, dw, s * 1.17 * fs), d = readFrac(dr, dmask, dw, s * 1.61 * fs);
      dl[(size_t)dw] = (float)l;
      dr[(size_t)dw] = (float)r;
      dw = (dw + 1) & dmask;
      l += dimMix * 0.5 * (a - b);
      r += dimMix * 0.5 * (c - d);
    }
    out[0] = l;
    out[1] = r;
  }
 private:
  double fs;
  std::vector<float> buf, dl, dr;
  int mask = 0, w = 0, dmask = 0, dw = 0;
  double ph[7] = {};
};

/** PITCH SHIFTER (as fx.ts PitchShifter): two crossfaded taps at the ratio's speed, grain, feedback, the formant bank. */
constexpr int SH_BANDS = 24;
constexpr double SH_F_LO = 60, SH_F_HI = 15000;
class PitchShifter {
 public:
  explicit PitchShifter(double fs_) : fs(fs_) {
    const int size = pow2Size(std::ceil(0.2 * fs));
    buf[0].assign((size_t)size, 0.0f);
    buf[1].assign((size_t)size, 0.0f);
    mask = size - 1;
    const double spacing = std::log2(SH_F_HI / SH_F_LO) / (SH_BANDS - 1);
    for (int b = 0; b < SH_BANDS; b++) {
      const double fc = std::fmin(SH_F_LO * std::pow(2.0, b * spacing), 0.45 * fs);
      fG[b] = std::tan((PI * fc) / fs);
      fK[b] = 1 / 4.2;
      gain[b] = gainT[b] = 1;
    }
    envA = 1 - std::exp(-1 / (0.003 * fs));
    envR = 1 - std::exp(-1 / (0.03 * fs));
    fbK = 1 - std::exp((-TWO_PI * 7000) / fs);
    lvK = 1 - std::exp(-1 / (0.05 * fs));
  }
  void reset() {
    std::fill(buf[0].begin(), buf[0].end(), 0.0f);
    std::fill(buf[1].begin(), buf[1].end(), 0.0f);
    ph = 0;
    lastP[0] = lastP[1] = jit[0] = jit[1] = fbS[0] = fbS[1] = 0;
    for (auto& f : aa) f.reset();
    for (int k = 0; k < 2 * SH_BANDS; k++) ic1[k] = ic2[k] = 0;
    for (int b = 0; b < SH_BANDS; b++) { env[b] = 0; gain[b] = gainT[b] = 1; }
    lvIn = lvOut = 0;
  }
  void set(double semis, double feedback, double grainV, double formantV) {
    ratio = std::pow(2.0, semis / 12);
    grain = std::fmin(1, std::fmax(0, grainV));
    win = jsRound(0.08 * std::pow(6.0 / 80, grain) * fs);
    fb = 0.95 * std::fmin(1, std::fmax(0, feedback));
    formant = std::fmin(24, std::fmax(-24, formantV));
    const double a = ratio > 1.01 ? std::fmin(0.45 * fs, (0.45 * fs) / ratio) : 0;
    if (a != lastAa) {
      lastAa = a;
      aaOn = a > 0;
      if (aaOn) for (auto& f : aa) f.setLowpass(a, SQRT1_2, fs);
    }
  }
  void process(double l, double r, double* out) {
    double p0 = ph + (1 - ratio) / win;
    p0 -= std::floor(p0);
    ph = p0;
    const double p1 = p0 + 0.5 >= 1 ? p0 - 0.5 : p0 + 0.5;
    for (int t = 0; t < 2; t++) {
      const double p = t == 0 ? p0 : p1;
      if (std::fabs(p - lastP[t]) > 0.5) jit[t] = grain * grain * 0.5 * win * (0.5 + 0.5 * rng.next());
      lastP[t] = p;
    }
    const double size = mask + 1;
    for (int c = 0; c < 2; c++) {
      double x = (c == 0 ? l : r) + fb * fbS[c];
      if (aaOn) x = aa[2 * c + 1].process(aa[2 * c].process(x));
      auto& b = buf[c];
      b[(size_t)w] = (float)x;
      double y = 0;
      for (int t = 0; t < 2; t++) {
        const double p = t == 0 ? p0 : p1;
        const double d = 2 + p * win + jit[t];
        double rp = w - d;
        rp -= std::floor(rp / size) * size;
        const int i = (int)std::floor(rp);
        const double f = rp - i;
        const double a0 = b[(size_t)(i & mask)];
        const double v = a0 + (b[(size_t)((i + 1) & mask)] - a0) * f;
        const double s = std::sin(PI * p);
        y += v * s * s;
      }
      fbS[c] += (fastTanh(y) - fbS[c]) * fbK;
      out[c] = y;
    }
    w = (w + 1) & mask;
    if (std::fabs(formant) > 1e-3) formantWarp(out);
  }

 private:
  void formantWarp(double* out) {
    const int NB = SH_BANDS;
    double sl = 0, sr = 0;
    for (int b = 0; b < NB; b++) {
      const double g = fG[b], k = fK[b], a1 = 1 / (1 + g * (g + k)), a2 = g * a1;
      double e = 0;
      for (int c = 0; c < 2; c++) {
        const int o = c * NB + b;
        const double v0 = out[c];
        const double v1 = a1 * ic1[o] + a2 * (v0 - ic2[o]);
        const double v2 = ic2[o] + g * v1;
        ic1[o] = 2 * v1 - ic1[o];
        ic2[o] = 2 * v2 - ic2[o];
        const double bp = k * v1;
        bandOut[o] = bp;
        e += std::fabs(bp);
      }
      e *= 0.5;
      env[b] += (e - env[b]) * (e > env[b] ? envA : envR);
    }
    if ((tick = (tick + 1) & 15) == 0) {
      const double spacing = std::log2(SH_F_HI / SH_F_LO) / (SH_BANDS - 1);
      const double shift = -formant / 12 / spacing;
      for (int b = 0; b < NB; b++) {
        const double s = std::fmax(0, std::fmin(NB - 1, b + shift));
        const int i = std::min(NB - 2, (int)std::floor(s));
        const double f = s - i;
        const double src = env[i] + (env[i + 1] - env[i]) * f;
        gainT[b] = std::fmin(6, src / (env[b] + 1e-5));
      }
    }
    for (int b = 0; b < NB; b++) {
      gain[b] += (gainT[b] - gain[b]) * 0.02;
      sl += gain[b] * bandOut[b];
      sr += gain[b] * bandOut[NB + b];
    }
    lvIn += (std::fabs(out[0]) + std::fabs(out[1]) - lvIn) * lvK;
    lvOut += (std::fabs(sl) + std::fabs(sr) - lvOut) * lvK;
    const double lg = std::fmax(0.25, std::fmin(2, lvIn / (lvOut + 1e-9)));
    sl *= lg;
    sr *= lg;
    const double m = std::fmin(1, std::fabs(formant));
    out[0] += (sl - out[0]) * m;
    out[1] += (sr - out[1]) * m;
  }
  double fs;
  std::vector<float> buf[2];
  int mask = 0, w = 0, tick = 0;
  double ph = 0, lastP[2] = {}, jit[2] = {}, fbS[2] = {};
  Rng rng{0x51f7a3u};
  Biquad aa[4];
  bool aaOn = false;
  double lastAa = -1, ratio = 1, win = 1, grain = 0, fb = 0, fbK = 0, formant = 0;
  double fG[SH_BANDS] = {}, fK[SH_BANDS] = {}, ic1[2 * SH_BANDS] = {}, ic2[2 * SH_BANDS] = {}, env[SH_BANDS] = {};
  double gain[SH_BANDS] = {}, gainT[SH_BANDS] = {}, bandOut[2 * SH_BANDS] = {};
  double envA = 0, envR = 0, lvIn = 0, lvOut = 0, lvK = 0;
};

/**
 * Octave-down pitch shifter for the reverb's input: two read taps sliding through a short delay
 * line at half speed, crossfaded (sin²) so each tap is silent while it jumps back.
 */
class OctaveDown {
 public:
  explicit OctaveDown(double fs) : win((int)jsRound(0.06 * fs)) { buf.assign(win * 2 + 8, 0.f); }
  void reset() {
    std::fill(buf.begin(), buf.end(), 0.f);
    ph = 0;
  }
  double process(double x) {
    const int n = (int)buf.size();
    buf[w] = (float)x;
    ph += 0.5 / win;
    if (ph >= 1) ph -= 1;
    double y = 0;
    for (int t = 0; t < 2; t++) {
      double p = ph + 0.5 * t;
      if (p >= 1) p -= 1;
      const double d = 2 + p * win;
      double r = w - d;
      if (r < 0) r += n;
      const int i = (int)std::floor(r);
      const double f = r - i;
      const double v = buf[i] * (1 - f) + buf[i + 1 == n ? 0 : i + 1] * f;
      const double s = std::sin(PI * p);
      y += v * s * s;
    }
    w = w + 1 == n ? 0 : w + 1;
    return y;
  }
 private:
  std::vector<float> buf;
  int w = 0;
  double ph = 0;
  int win;
};

constexpr int VERB_ROOM = 0, VERB_PLATE = 1, VERB_HALL = 2, VERB_CATHEDRAL = 3;

class Tape {
 public:
  explicit Tape(double fs_) : fs(fs_), hiss(0x7a9e) {
    d = 0.0025 * fs;
    const int size = pow2Size(std::ceil(0.12 * fs));
    bufL.assign(size, 0.f);
    bufR.assign(size, 0.f);
    mask = size - 1;
  }
  void reset() {
    std::fill(bufL.begin(), bufL.end(), 0.f);
    std::fill(bufR.begin(), bufR.end(), 0.f);
  }
  void process(double l, double r, double wow, double* out) {
    if (wow > 0) {
      if (count-- <= 0) {
        count = 15;
        wowPh += (16 * (0.55 * (1 + 0.5 * drift))) / fs;
        if (wowPh >= 1) wowPh -= 1;
        flutPh += (16 * 7.3) / fs;
        if (flutPh >= 1) flutPh -= 1;
        driftCount -= 16;
        if (driftCount <= 0) {
          driftTarget = hiss.next();
          driftCount = (int)jsRound(fs * 0.4);
        }
        drift += (driftTarget - drift) * 0.0016;
        // wow ±13 → ±200 cents, flutter ±9.5 → ±50, curved; the resting delay sits just past the swing
        const double w4 = wow * wow * wow * wow;
        const double aw = (13.2 * wow + 186.8 * w4) * 1.672e-4, af = (9.5 * wow + 40.5 * w4) * 1.2596e-5;
        const double target = fs * (0.0025 + 1.4 * aw + af + aw * std::sin(TWO_PI * wowPh) * (1 + 0.4 * drift) + af * std::sin(TWO_PI * flutPh));
        dStep = (target - d) / 16;
      }
      d += dStep;
      bufL[w] = (float)l;
      bufR[w] = (float)r;
      l = readFrac(bufL, mask, w, d);
      r = readFrac(bufR, mask, w, d);
      w = (w + 1) & mask;
    }
    out[0] = l;
    out[1] = r;
  }
 private:
  double fs;
  std::vector<float> bufL, bufR;
  int mask = 0, w = 0;
  double wowPh = 0, flutPh = 0, drift = 0, driftTarget = 0;
  int driftCount = 0;
  Rng hiss;
  int count = 0;
  double d = 0, dStep = 0;
};

class Crusher {
 public:
  void reset() {
    holdL = holdR = 0;
    acc = 1;
  }
  void process(double l, double r, double mix, double q, double rate, double* out) {
    acc += 1;
    if (acc >= rate) {
      acc -= rate;
      holdL = jsRound(clampd(l, -1, 1) * q) / q;
      holdR = jsRound(clampd(r, -1, 1) * q) / q;
    }
    out[0] = l + (holdL - l) * mix;
    out[1] = r + (holdR - r) * mix;
  }
 private:
  double holdL = 0, holdR = 0, acc = 1;
};

}  // namespace lt
