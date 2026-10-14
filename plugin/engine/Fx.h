// Effects (port of src/engine/core/fx.ts): chorus, phaser, limiter, flanger,
// delay, reverb, tape, bitcrusher, compressor and the multiband "OTT".
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
  void process(double l, double r, double mix, double depth, double* out, bool ensemble) {
    if (ensemble) {
      processEnsemble(l, r, mix, depth, out);
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
  std::vector<float> bufL, bufR;
  int size = 1, w = 0;
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

/** Transparent look-ahead peak limiter (stereo-linked, always on). */
class Limiter {
 public:
  double ceiling;
  int lookahead;
  double minGain = 1;

  Limiter(double fs, double ceilingDb = -1, double lookaheadMs = 1.5, double releaseMs = 150, double holdMs = 55) {
    ceiling = std::pow(10.0, ceilingDb / 20);
    lookahead = (int)std::fmax(2, jsRound((lookaheadMs * fs) / 1000));
    const int L = lookahead;
    delayL.assign(L, 0.0);
    delayR.assign(L, 0.0);
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
    std::fill(box.begin(), box.end(), 1.0);
    boxSum = lookahead;
    qHead = qTail = 0;
    gain = 1;
    holdCount = 0;
  }
  void process(double l, double r, double* out) {
    const int L = lookahead;
    const double peak = std::fmax(std::fabs(l), std::fabs(r));
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
    dPos = dPos + 1 == L - 1 ? 0 : dPos + 1;
    const double c = ceiling;
    const double yl = dl * gain, yr = dr * gain;
    out[0] = yl > c ? c : yl < -c ? -c : yl;
    out[1] = yr > c ? c : yr < -c ? -c : yr;
  }
 private:
  std::vector<double> delayL, delayR, qVal, qIdx, box;
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

class Reverb {
 public:
  explicit Reverb(double fs) {
    const double s = fs / 44100;
    const int combLens[8] = {1116, 1188, 1277, 1356, 1422, 1491, 1557, 1617};
    const int apLens[4] = {556, 441, 341, 225};
    for (int ch = 0; ch < 2; ch++) {
      for (int c : combLens) combs.emplace_back((size_t)jsRound((c + ch * 23) * s), 0.f);
      for (int a : apLens) aps.emplace_back((size_t)jsRound((a + ch * 23) * s), 0.f);
    }
    pre.assign((size_t)jsRound(0.018 * fs), 0.f);
  }
  void reset() {
    for (auto& c : combs) std::fill(c.begin(), c.end(), 0.f);
    for (auto& a : aps) std::fill(a.begin(), a.end(), 0.f);
    combLp.fill(0);
    std::fill(pre.begin(), pre.end(), 0.f);
  }
  void process(double input, double size, double tone, double* out) {
    const double fb = 0.72 + 0.26 * size;
    const double damp = 0.05 + 0.65 * tone;
    const double x = pre[preIdx] * 0.03;
    pre[preIdx] = (float)input;
    preIdx = preIdx + 1 == (int)pre.size() ? 0 : preIdx + 1;
    for (int ch = 0; ch < 2; ch++) {
      double acc = 0;
      for (int c = 0; c < 8; c++) {
        const int k = ch * 8 + c;
        auto& buf = combs[k];
        const int i = combIdx[k];
        const double y = buf[i];
        combLp[k] = y * (1 - damp) + combLp[k] * damp;
        buf[i] = (float)(x + combLp[k] * fb);
        combIdx[k] = i + 1 == (int)buf.size() ? 0 : i + 1;
        acc += y;
      }
      for (int a = 0; a < 4; a++) {
        const int k = ch * 4 + a;
        auto& buf = aps[k];
        const int i = apIdx[k];
        const double b = buf[i];
        buf[i] = (float)(acc + b * 0.5);
        apIdx[k] = i + 1 == (int)buf.size() ? 0 : i + 1;
        acc = b - acc;
      }
      out[ch] = acc;
    }
  }
 private:
  std::vector<std::vector<float>> combs, aps;
  std::array<int, 16> combIdx{};
  std::array<double, 16> combLp{};
  std::array<int, 8> apIdx{};
  std::vector<float> pre;
  int preIdx = 0;
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

class Compressor {
 public:
  void reset() {
    env = 0;
    gain = 1;
    gainStep = 0;
  }
  void update(double amount, double speed, double pumpGain, double fs, int block) {
    active = amount > 0.001;
    const double atkMs = 30 * std::pow(1.0 / 30, speed);
    const double relMs = 300 * std::pow(40.0 / 300, speed);
    atk = 1 - std::exp(-1 / ((atkMs * fs) / 1000));
    rel = 1 - std::exp(-1 / ((relMs * fs) / 1000));
    const double threshDb = -30 * amount;
    const double ratio = 1.5 + 6 * amount;
    thresh = std::pow(10.0, threshDb / 20);
    slope = 1 - 1 / ratio;
    makeup = std::pow(10.0, (-threshDb * slope * 0.5) / 20);
    double g = 1;
    if (active && env > thresh) g = std::pow(env / thresh, -slope);
    const double target = (active ? g * makeup : 1) * pumpGain;
    gainStep = (target - gain) / block;
  }
  void process(double l, double r, double* out) {
    const double a = std::fmax(std::fabs(l), std::fabs(r));
    env += (a - env) * (a > env ? atk : rel);
    gain += gainStep;
    out[0] = l * gain;
    out[1] = r * gain;
  }
 private:
  double env = 0, gain = 1, gainStep = 0, atk = 0, rel = 0, thresh = 1, slope = 0, makeup = 1;
  bool active = false;
};

class Ott {
 public:
  explicit Ott(double fs) {
    gLow = std::tan((PI * 120) / fs);
    gMid = std::tan((PI * 2500) / fs);
    lowL.setCoefs(gLow, SQRT2);
    lowR.setCoefs(gLow, SQRT2);
    midL.setCoefs(gMid, SQRT2);
    midR.setCoefs(gMid, SQRT2);
    atk = 1 - std::exp(-1 / (0.004 * fs));
    rel = 1 - std::exp(-1 / (0.12 * fs));
  }
  void reset() {
    lowL.reset();
    lowR.reset();
    midL.reset();
    midR.reset();
    env.fill(0);
    gain.fill(1);
    step.fill(0);
  }
  void update(double amount, int block) {
    static const double UP_MAX_DB[3] = {3, 12, 14};
    static const double THRESH_DB[3] = {-14, -20, -24};
    for (int b = 0; b < 3; b++) {
      double target = 1;
      if (amount > 0.001) {
        const double e = std::fmax(env[b], 1e-6);
        const double db = 20 * std::log10(e);
        const double t = THRESH_DB[b];
        double gDb;
        if (db > t) gDb = -(db - t) * 0.75;
        else gDb = std::fmin(UP_MAX_DB[b], (t - db) * 0.6);
        if (db < -70) gDb = std::fmin(gDb, 0);
        target = 1 + amount * (std::pow(10.0, gDb / 20) - 1);
      }
      step[b] = (target - gain[b]) / block;
    }
  }
  void process(double l, double r, double* out) {
    lowL.processFixed(l);
    lowR.processFixed(r);
    const double loL = lowL.lp, loR = lowR.lp;
    const double restL = l - loL, restR = r - loR;
    midL.processFixed(restL);
    midR.processFixed(restR);
    const double miL = midL.lp, miR = midR.lp;
    const double hiL = restL - miL, hiR = restR - miR;
    const double b0 = std::fmax(std::fabs(loL), std::fabs(loR));
    const double b1 = std::fmax(std::fabs(miL), std::fabs(miR));
    const double b2 = std::fmax(std::fabs(hiL), std::fabs(hiR));
    env[0] += (b0 - env[0]) * (b0 > env[0] ? atk : rel);
    env[1] += (b1 - env[1]) * (b1 > env[1] ? atk : rel);
    env[2] += (b2 - env[2]) * (b2 > env[2] ? atk : rel);
    gain[0] += step[0];
    gain[1] += step[1];
    gain[2] += step[2];
    out[0] = loL * gain[0] + miL * gain[1] + hiL * gain[2];
    out[1] = loR * gain[0] + miR * gain[1] + hiR * gain[2];
  }
 private:
  Svf lowL, lowR, midL, midR;
  double gLow = 0, gMid = 0, atk = 0, rel = 0;
  std::array<double, 3> env{}, gain{1, 1, 1}, step{};
};

}  // namespace lt
