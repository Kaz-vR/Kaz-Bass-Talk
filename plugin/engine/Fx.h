// Effects (port of src/engine/core/fx.ts): chorus, phaser, limiter, flanger,
// delay, octave-down, reverb, tape and bitcrusher.
// Delay lines are float, like the prototype's Float32Arrays.
#pragma once
#include <algorithm>
#include <array>
#include <cmath>
#include <vector>
#include "Dsp.h"

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

class Delay {
 public:
  explicit Delay(double fs_) : fs(fs_) {
    const int size = pow2Size(std::ceil(3.1 * fs));
    bufL.assign(size, 0.f);
    bufR.assign(size, 0.f);
    mask = size - 1;
    hpCoef = 1 - std::exp((-TWO_PI * 150) / fs);
  }
  void reset() {
    std::fill(bufL.begin(), bufL.end(), 0.f);
    std::fill(bufR.begin(), bufR.end(), 0.f);
    lpL = lpR = hpL = hpR = 0;
  }
  void process(double l, double r, double seconds, double feedback, double toneCoef, double* out) {
    const double target = std::fmin(seconds * fs, mask - 2);
    time = time < 0 ? target : time + (target - time) * 0.0005;
    const double yl = readFrac(bufL, mask, w, time);
    const double yr = readFrac(bufR, mask, w, time);
    lpL += (yl - lpL) * toneCoef;
    lpR += (yr - lpR) * toneCoef;
    hpL += (lpL - hpL) * hpCoef;
    hpR += (lpR - hpR) * hpCoef;
    const double fl = lpL - hpL, fr = lpR - hpR;
    bufL[w] = (float)(0.5 * (l + r) + feedback * fr);
    bufR[w] = (float)(feedback * fl);
    w = (w + 1) & mask;
    out[0] = yl;
    out[1] = yr;
  }
 private:
  double fs;
  std::vector<float> bufL, bufR;
  int mask = 0, w = 0;
  double time = -1, lpL = 0, lpR = 0, hpL = 0, hpR = 0, hpCoef = 0;
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
struct VerbType { double size, diff, damp, mod, build, level; };
constexpr VerbType VERB_TYPES[4] = {
  {0.36, 0.62, 5200, 0.35, 0.55, 0.27}, {0.52, 0.78, 6800, 0.5, 0.25, 0.255}, {1.0, 0.7, 4400, 0.8, 0.7, 0.4}, {1.75, 0.72, 3300, 1.1, 1, 0.58}};
constexpr double VERB_LINES_MS[8] = {29.7, 37.1, 41.1, 43.7, 53.3, 59.9, 67.7, 73.1};
constexpr double VERB_DIFF_MS[4] = {4.77, 3.59, 12.73, 9.3};
constexpr double VERB_MOD_HZ[8] = {0.31, 0.47, 0.61, 0.83, 0.37, 0.53, 0.71, 1.07};
constexpr double VERB_SIGN_L[8] = {1, -1, 1, 1, -1, 1, -1, -1};
constexpr double VERB_SIGN_R[8] = {1, 1, -1, 1, 1, -1, -1, 1};
constexpr double VERB_MAX_PRE = 0.26;

/** Vintage digital reverb (1970s colour): band-limited, diffused input, eight chorused lines (see fx.ts Reverb). */
class Reverb {
 public:
  explicit Reverb(double fs_) : fs(fs_) {
    pre.assign((size_t)std::ceil(VERB_MAX_PRE * fs) + 4, 0.f);
    const double maxScale = VERB_TYPES[VERB_CATHEDRAL].size;
    for (int i = 0; i < 4; i++) diff[i].assign((size_t)std::ceil((VERB_DIFF_MS[i] * maxScale * fs) / 1000) + 4, 0.f);
    for (int i = 0; i < 8; i++) lines[i].assign((size_t)std::ceil(((VERB_LINES_MS[i] * maxScale + 3) * fs) / 1000) + 4, 0.f);
    bwCoef = 1 - std::exp((-2 * PI * 7500) / fs);
    for (int i = 0; i < 8; i++) modPh[i] = i / 8.0;
  }
  void reset() {
    std::fill(pre.begin(), pre.end(), 0.f);
    for (auto& d : diff) std::fill(d.begin(), d.end(), 0.f);
    for (auto& l : lines) std::fill(l.begin(), l.end(), 0.f);
    for (auto& d : damp) d = 0;
    inLp = inLp2 = outL = outR = 0;
  }
  void process(double input, double type, double decay, double predelayMs, double* out) {
    if (type != lastType || std::fabs(decay - lastDecay) > 1e-4 * decay) setup(type, decay);
    const int pn = (int)pre.size();
    pre[preW] = (float)input;
    const double pd = std::fmin(VERB_MAX_PRE * fs, std::fmax(0, (predelayMs * fs) / 1000));
    double rp = preW - pd;
    if (rp < 0) rp += pn;
    const int ri = (int)std::floor(rp);
    const double rf = rp - ri;
    double x = pre[ri] * (1 - rf) + pre[ri + 1 == pn ? 0 : ri + 1] * rf;
    preW = preW + 1 == pn ? 0 : preW + 1;
    inLp += bwCoef * (x - inLp);
    inLp2 += bwCoef * (inLp - inLp2);
    x = inLp2;
    const double g = diffG;
    for (int i = 0; i < 4; i++) {
      auto& buf = diff[i];
      const int n = (int)buf.size();
      int r = diffW[i] - diffLen[i];
      if (r < 0) r += n;
      const double d = buf[r];
      const double v = x + g * d;
      buf[diffW[i]] = (float)v;
      x = d - g * v;
      diffW[i] = diffW[i] + 1 == n ? 0 : diffW[i] + 1;
    }
    double sum = 0;
    const double dc = dampCoef;
    for (int i = 0; i < 8; i++) {
      auto& buf = lines[i];
      const int n = (int)buf.size();
      double ph = modPh[i] + VERB_MOD_HZ[i] / fs;
      if (ph >= 1) ph -= 1;
      modPh[i] = ph;
      const double m = 1 + modDepth * (0.5 + 0.5 * std::sin(2 * PI * ph));
      double r = lineW[i] - len[i] - m;
      while (r < 0) r += n;
      const int j = (int)std::floor(r);
      const double f = r - j;
      const double y = buf[j] * (1 - f) + buf[j + 1 == n ? 0 : j + 1] * f;
      damp[i] = y * (1 - dc) + damp[i] * dc;
      const double v = damp[i] * gain[i];
      lineOut[i] = v;
      sum += v;
    }
    const double hh = (2.0 / 8) * sum;
    const double b = build;
    double l = 0, rr = 0;
    for (int i = 0; i < 8; i++) {
      const double v = lineOut[i];
      const double inject = i < 4 ? x : x * (1 - 0.5 * b);
      auto& buf = lines[i];
      buf[lineW[i]] = (float)(v - hh + inject);
      lineW[i] = lineW[i] + 1 == (int)buf.size() ? 0 : lineW[i] + 1;
      l += VERB_SIGN_L[i] * v;
      rr += VERB_SIGN_R[i] * v;
    }
    outL += bwCoef * (l - outL);
    outR += bwCoef * (rr - outR);
    out[0] = outL * level;
    out[1] = outR * level;
  }
 private:
  void setup(double type, double decay) {
    const VerbType& t = VERB_TYPES[std::max(0, std::min(3, (int)type))];
    for (int i = 0; i < 8; i++) {
      len[i] = (VERB_LINES_MS[i] * t.size * fs) / 1000;
      gain[i] = std::pow(10.0, (-3 * len[i]) / (std::fmax(0.1, decay) * (1 + 0.055 * decay) * fs));
    }
    for (int i = 0; i < 4; i++) diffLen[i] = std::max(1, (int)jsRound((VERB_DIFF_MS[i] * std::sqrt(t.size) * fs) / 1000));
    dampCoef = std::exp((-2 * PI * t.damp) / fs);
    modDepth = (t.mod * fs) / 1000;
    diffG = t.diff;
    build = t.build;
    level = t.level * std::fmin(2, std::pow(std::fmax(0.1, decay) / 2, -0.37));
    lastType = type;
    lastDecay = decay;
  }
  double fs;
  std::vector<float> pre, diff[4], lines[8];
  int preW = 0, diffW[4] = {}, lineW[8] = {}, diffLen[4] = {};
  double damp[8] = {}, modPh[8] = {}, lineOut[8] = {}, len[8] = {}, gain[8] = {};
  double inLp = 0, inLp2 = 0, outL = 0, outR = 0, lastType = -1, lastDecay = -1;
  double dampCoef = 0, modDepth = 0, diffG = 0.7, build = 0.7, level = 0.4, bwCoef = 0;
};

class Tape {
 public:
  explicit Tape(double fs_) : fs(fs_), hiss(0x7a9e) {
    d = 0.0025 * fs;
    const int size = pow2Size(std::ceil(0.02 * fs));
    bufL.assign(size, 0.f);
    bufR.assign(size, 0.f);
    mask = size - 1;
  }
  void reset() {
    std::fill(bufL.begin(), bufL.end(), 0.f);
    std::fill(bufR.begin(), bufR.end(), 0.f);
    lpL = lpR = hissLp = 0;
  }
  void process(double l, double r, double drive, double wow, double age, double lpCoef, double env, double* out) {
    if (drive > 0) {
      const double g = 1 + 5 * drive;
      const double bias = 0.15 * drive;
      const double tb = fastTanh(bias);
      const double comp = 1 / (1 + 1.2 * drive);
      l += ((fastTanh(g * l + bias) - tb) * comp - l) * std::fmin(1, drive * 4);
      r += ((fastTanh(g * r + bias) - tb) * comp - r) * std::fmin(1, drive * 4);
    }
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
        const double target = fs * (0.0025 + wow * (0.0022 * std::sin(TWO_PI * wowPh) * (1 + 0.4 * drift) + 0.00012 * std::sin(TWO_PI * flutPh)));
        dStep = (target - d) / 16;
      }
      d += dStep;
      bufL[w] = (float)l;
      bufR[w] = (float)r;
      l = readFrac(bufL, mask, w, d);
      r = readFrac(bufR, mask, w, d);
      w = (w + 1) & mask;
    }
    if (age > 0) {
      lpL += (l - lpL) * lpCoef;
      lpR += (r - lpR) * lpCoef;
      l = lpL;
      r = lpR;
      const double n = hiss.next();
      const double hp = n - hissLp;
      hissLp += (n - hissLp) * 0.3;
      const double h = hp * age * 0.004 * std::fmin(1, env * 4);
      l += h;
      r += h;
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
  double lpL = 0, lpR = 0;
  Rng hiss;
  double hissLp = 0;
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
