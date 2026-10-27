// GRIND (port of src/engine/core/grind.ts): the neuro-bass chain, four moving filter → drive
// stages before the main filter (SAT and PRE OTT in front), and the OTT used on the whole synth.
#pragma once
#include <algorithm>
#include <array>
#include <cmath>
#include "Dsp.h"
#include "Params.h"

namespace lt {

constexpr int GRIND_STAGES = 4;
constexpr int GF_NOTCH = 0, GF_PEAK = 1, GF_BAND = 2, GF_COMB = 3, GF_PHASER = 4;
constexpr int GC_HZ = 0, GC_SYNC = 1, GC_RANDOM = 2;
constexpr int GM_NOTE = 0, GM_WANDER = 1;
constexpr double GRIND_BEATS[6] = {4, 2, 1, 0.5, 0.25, 0.125};
inline double grindRandomSpeed(Rng& rng) { return std::pow(2.0, 1.5 * rng.next()); }
inline double grindHz(double rate) { return 0.1 * std::pow(2.0, rate * 8); }
inline int grindBeat(double rate) { return (int)jsRound(std::fmin(1, std::fmax(0, rate)) * 5); }
inline double grindGain(double drive) { return 1 + 29 * drive * drive; }
constexpr int GRIND_COMB_LEN = 4096;
constexpr double SAT_BIAS = 0.35;
inline const double SAT_OFFSET = fastTanh(SAT_BIAS);
constexpr double OTT_ABOVE[3] = {-33.8, -30.2, -35.5};
constexpr double OTT_BELOW[3] = {-40.8, -41.8, -40.8};
constexpr double OTT_BAND_DB[3] = {10.3, 5.7, 10.3};
constexpr double OTT_ATTACK[3] = {0.0478, 0.0224, 0.0135};
constexpr double OTT_RELEASE[3] = {0.282, 0.282, 0.132};
constexpr double OTT_MAX_UP = 36;
constexpr double OTT_IN_DB = 18;
constexpr double OTT_MAKEUP_DB = 15;

/** OTT (Ableton's OTT preset): three bands, squashed from above and pulled up from below. */
class Ott {
 public:
  double l = 0, r = 0;
  explicit Ott(double inDb = OTT_IN_DB, double makeupDb = OTT_MAKEUP_DB, bool match = false) : inDb(inDb), makeupDb(makeupDb), match(match) {
    gain.fill(1);
  }
  bool on() const { return amt > 0; }
  void set(double depth, double lowcut, double sr) {
    if (depth > 0 && amt == 0) reset();
    amt = depth;
    if (depth <= 0) return;
    if (sr != fs) {
      fs = sr;
      lastLc = -1;
      for (int c = 0; c < 2; c++)
        for (int j = 0; j < 2; j++) {
          const int o = 8 * c;
          x[o + j].setLowpass(88, SQRT1_2, fs);
          x[o + 2 + j].setHighpass(88, SQRT1_2, fs);
          x[o + 4 + j].setLowpass(2500, SQRT1_2, fs);
          x[o + 6 + j].setHighpass(2500, SQRT1_2, fs);
        }
      lvlK = 1 - std::exp(-1 / (0.3 * fs));
      for (int b = 0; b < 3; b++) {
        atk[b] = 1 - std::exp(-1 / (OTT_ATTACK[b] * fs));
        rel[b] = 1 - std::exp(-1 / (OTT_RELEASE[b] * fs));
      }
    }
    if (lowcut != lastLc) {
      lastLc = lowcut;
      lcOn = lowcut > 21;
      if (lcOn)
        for (int c = 0; c < 2; c++)
          for (int j = 0; j < 2; j++) {
            split[4 * c + j].setLowpass(std::fmin(lowcut, fs * 0.45), SQRT1_2, fs);
            split[4 * c + 2 + j].setHighpass(std::fmin(lowcut, fs * 0.45), SQRT1_2, fs);
          }
    }
  }
  void reset() {
    for (auto& f : x) f.reset();
    for (auto& f : split) f.reset();
    env.fill(0);
    gain.fill(1);
    inLvl = outLvl = 0;
  }
  void process(double inL, double inR) {
    double lowL = 0, lowR = 0, L = inL, R = inR;
    if (lcOn) {
      lowL = split[1].process(split[0].process(inL));
      L = split[3].process(split[2].process(inL));
      lowR = split[5].process(split[4].process(inR));
      R = split[7].process(split[6].process(inR));
    }
    const double rest0 = x[3].process(x[2].process(L)), rest1 = x[11].process(x[10].process(R));
    bd[0] = x[1].process(x[0].process(L));
    bd[1] = x[5].process(x[4].process(rest0));
    bd[2] = x[7].process(x[6].process(rest0));
    bd[3] = x[9].process(x[8].process(R));
    bd[4] = x[13].process(x[12].process(rest1));
    bd[5] = x[15].process(x[14].process(rest1));
    tick = (tick + 1) & 3;
    const bool recompute = tick == 0;
    double ol = 0, orr = 0;
    for (int b = 0; b < 3; b++) {
      const double a = std::fmax(std::fabs(bd[b]), std::fabs(bd[b + 3]));
      env[b] += (a - env[b]) * (a > env[b] ? atk[b] : rel[b]);
      if (recompute) {
        const double lvl = 20 * std::log10(env[b] + 1e-9) + inDb;
        double g = 0;
        if (lvl > OTT_ABOVE[b]) g = (OTT_ABOVE[b] - lvl) * (1 - 1.0 / 66);
        else if (lvl < OTT_BELOW[b]) g = std::fmin(OTT_MAX_UP, (OTT_BELOW[b] - lvl) * (1 - 1 / 4.17)) * std::fmin(1, std::fmax(0, (lvl - inDb + 80) / 10));
        gain[b] = std::pow(10.0, (g + OTT_BAND_DB[b] + makeupDb) / 20);
      }
      ol += bd[b] * gain[b];
      orr += bd[b + 3] * gain[b];
    }
    const double dl = bd[0] + bd[1] + bd[2], dr = bd[3] + bd[4] + bd[5], d = amt;
    if (match) {
      const double k = lvlK;
      inLvl += (std::fabs(dl) + std::fabs(dr) - inLvl) * k;
      outLvl += (std::fabs(ol) + std::fabs(orr) - outLvl) * k;
      const double m = outLvl > 1e-9 ? std::fmin(4, inLvl / outLvl) : 1;
      ol *= m;
      orr *= m;
    }
    l = lowL + dl + (ol - dl) * d;
    r = lowR + dr + (orr - dr) * d;
  }

 private:
  double inDb, makeupDb;
  bool match;
  double amt = 0, fs = 0, lastLc = -1, lvlK = 0, inLvl = 0, outLvl = 0;
  bool lcOn = false;
  Biquad split[8], x[16];
  std::array<double, 3> env{}, gain{}, atk{}, rel{};
  double bd[6] = {};
  int tick = 0;
};

/** One GRIND stage: a moving filter into its own drive. */
struct GrindStage {
  bool on = false;
  int ftype = GF_NOTCH, dtype = DIST_SOFT;
  double phase = 0, wFrom = 0, wTo = 0, wPos = 0, spd = 1, rSpd = 1, rFrom = 0, rTo = 0, rPos = 0, resWander = 0;
  double wCycle = -1;
  double fcNow = -1, resNow = 0;
  double g = 0.05, gStep = 0, k = 1, peak = 0, delay = 100, delayStep = 0, fb = 0;
  bool driveOn = false;
  double gain = 1, inEnv = 0, outEnv = 0, mix = 1, bias = 0, offset = 0;
  Svf svf[2];
  double ap[10] = {};
  std::array<float, GRIND_COMB_LEN> comb[2] = {};
  double adaaU[2] = {}, adaaF[2] = {};

  double curve(double u) const {
    switch (dtype) {
      case DIST_SOFT: return fastTanh(u);
      case DIST_HARD: return u > 1 ? 1 : u < -1 ? -1 : u;
      case DIST_FOLD: return std::sin(HALF_PI * u);
      case DIST_FUZZ: return fuzz(u + bias) - offset;
      default: return fastTanh(u + TUBE_BIAS) - TUBE_OFFSET;
    }
  }
  double curveIntegral(double u) const {
    switch (dtype) {
      case DIST_SOFT: return tanhIntegral(u);
      case DIST_HARD: return u > 1 ? u - 0.5 : u < -1 ? -u - 0.5 : 0.5 * u * u;
      case DIST_FOLD: return -std::cos(HALF_PI * u) / HALF_PI;
      case DIST_FUZZ: return fuzzIntegral(u + bias) - offset * u;
      default: return tanhIntegral(u + TUBE_BIAS) - TUBE_OFFSET * u;
    }
  }
  double shape(double x, int ch) {
    const double u = gain * x;
    const double up = adaaU[ch];
    const double fu = curveIntegral(u);
    const double du = u - up;
    const double y = std::fabs(du) > 1e-5 ? (fu - adaaF[ch]) / du : curve(0.5 * (u + up));
    adaaU[ch] = u;
    adaaF[ch] = fu;
    return y;
  }
  double filter(double x, int ch, double gg, int pos) {
    switch (ftype) {
      case GF_NOTCH: {
        Svf& f = svf[ch];
        f.process(x, gg, k);
        return f.lp + f.hp;
      }
      case GF_PEAK: {
        Svf& f = svf[ch];
        f.process(x, gg, k);
        return (x + peak * f.bp * k) / (1 + 0.35 * peak);
      }
      case GF_BAND: {
        Svf& f = svf[ch];
        f.process(x, gg, k);
        return f.bp * k * 1.6;
      }
      case GF_COMB: {
        auto& buf = comb[ch];
        double rp = pos - delay;
        if (rp < 0) rp += GRIND_COMB_LEN;
        const int i = (int)std::floor(rp);
        const double fr = rp - i;
        const double d = buf[i] + (buf[(i + 1) & (GRIND_COMB_LEN - 1)] - buf[i]) * fr;
        const double y = x + fb * d;
        buf[pos] = (float)y;
        return y * (1 - 0.55 * fb);
      }
      default: {
        double* s = ap;
        const int o = ch * 5;
        const double G = gg / (1 + gg);
        double v = x + fb * s[o + 4];
        for (int j = 0; j < 4; j++) {
          const double w = (v - s[o + j]) * G;
          const double lp = w + s[o + j];
          s[o + j] = lp + w;
          v = 2 * lp - v;
        }
        s[o + 4] = v;
        return 0.5 * (x + v);
      }
    }
  }
};

/** One voice's GRIND chain (stereo). */
class Grind {
 public:
  GrindStage stages[GRIND_STAGES];
  double l = 0, r = 0;

  explicit Grind(Rng& rng) : preOtt(0, 12, false) {
    for (auto& s : stages) {
      s.wFrom = rng.next();
      s.wTo = rng.next();
      s.wPos = 0.5 * (rng.next() + 1);
      s.rFrom = rng.next();
      s.rTo = rng.next();
      s.rPos = 0.5 * (rng.next() + 1);
    }
  }

  void noteOn(Rng* rng) {
    for (auto& s : stages) {
      s.phase = 0;
      if (rng) s.spd = grindRandomSpeed(*rng);
    }
  }

  void reset() {
    for (auto& s : stages) {
      for (auto& f : s.svf) f.reset();
      for (double& a : s.ap) a = 0;
      s.comb[0].fill(0);
      s.comb[1].fill(0);
      s.adaaU[0] = s.adaaU[1] = s.adaaF[0] = s.adaaF[1] = 0;
    }
    dcX[0] = dcX[1] = dcY[0] = dcY[1] = 0;
    for (auto& f : split) f.reset();
    satU[0] = satU[1] = satF[0] = satF[1] = 0;
    satIn = satOut = 0;
    preOtt.reset();
  }

  void control(const double* cur, double beatPos, double bps, double keyOct, double fs, double fsOs, int n, Rng& rng) {
    const auto& P = PI_();
    const double dt = n / fsOs;
    dcR = 1 - (TWO_PI * 10) / fsOs;
    envK = 1 - std::exp(-1 / (0.05 * fsOs));
    lvlK = 1 - std::exp(-1 / (0.3 * fsOs));
    mix = cur[P.grindMix];
    satAmt = cur[P.grindSat];
    satGain = 1 + 24 * satAmt * satAmt;
    preOtt.set(cur[P.grindPreOtt], 20, fsOs);
    const double lc = cur[P.grindLowcut];
    if (lc != lastLc) {
      lastLc = lc;
      lcOn = lc > 21;
      if (lcOn)
        for (int c = 0; c < 2; c++)
          for (int j = 0; j < 2; j++) {
            split[4 * c + j].setLowpass(std::fmin(lc, fs * 0.45), SQRT1_2, fsOs);
            split[4 * c + 2 + j].setHighpass(std::fmin(lc, fs * 0.45), SQRT1_2, fsOs);
          }
    }
    const double key = cur[P.grindKey] > 0.5 ? std::pow(2.0, keyOct) : 1;
    const bool oneShot = cur[P.grindOneShot] > 0.5;
    for (int i = 0; i < GRIND_STAGES; i++) {
      GrindStage& s = stages[i];
      const auto& gp = P.grind[i];
      s.on = cur[gp.on] > 0.5;
      if (!s.on) {
        s.fcNow = -1;
        continue;
      }
      const double rate = cur[gp.rate];
      const bool wander = (int)cur[gp.move] == GM_WANDER;
      const int clock = (int)cur[gp.clock];
      const double hz = clock == GC_SYNC ? bps / GRIND_BEATS[grindBeat(rate)] : grindHz(rate);
      const bool rnd = clock == GC_RANDOM;
      double m, rm;
      if (oneShot && !wander) {
        s.phase += dt;
        m = rm = -1 + 2 * std::exp((-s.phase * 2 * hz * s.spd) * 3);
      } else if (clock == GC_SYNC && !wander) {
        const double p = beatPos / GRIND_BEATS[grindBeat(rate)];
        m = rm = std::cos(TWO_PI * (p - std::floor(p)));
      } else if (!wander) {
        s.phase += hz * s.spd * dt;
        if (s.phase >= 1) {
          s.phase -= std::floor(s.phase);
          if (rnd) s.spd = grindRandomSpeed(rng);
        }
        m = rm = std::cos(TWO_PI * s.phase);
      } else {
        if (clock == GC_SYNC) {
          const double p = beatPos / GRIND_BEATS[grindBeat(rate)], cycle = std::floor(p);
          if (cycle != s.wCycle) {
            s.wCycle = cycle;
            s.wFrom = s.wTo;
            s.wTo = rng.next();
          }
          s.wPos = p - cycle;
        } else {
          s.wPos += hz * s.spd * dt;
          if (s.wPos >= 1) {
            s.wPos -= std::floor(s.wPos);
            s.wFrom = s.wTo;
            s.wTo = rng.next();
            if (rnd) s.spd = grindRandomSpeed(rng);
          }
        }
        m = s.wFrom + (s.wTo - s.wFrom) * (0.5 - 0.5 * std::cos(PI * s.wPos));
        s.rPos += hz * 0.61 * s.rSpd * dt;
        if (s.rPos >= 1) {
          s.rPos -= std::floor(s.rPos);
          s.rFrom = s.rTo;
          s.rTo = rng.next();
          if (rnd) s.rSpd = grindRandomSpeed(rng);
        }
        rm = s.rFrom + (s.rTo - s.rFrom) * (0.5 - 0.5 * std::cos(PI * s.rPos));
      }
      s.resWander = 0.5 * cur[gp.vrange] * rm;
      const double fc = std::fmin(std::fmax(cur[gp.freq] * key * std::pow(2.0, 0.5 * cur[gp.range] * m), 20), fs * 0.45);
      s.fcNow = fc;
      const int ftype = (int)cur[gp.filter];
      if (ftype != s.ftype) {
        s.ftype = ftype;
        for (auto& f : s.svf) f.reset();
        for (double& a : s.ap) a = 0;
      }
      const double res = std::fmin(1, std::fmax(0, cur[gp.res] + s.resWander));
      s.resNow = res;
      const double gT = std::tan((PI * fc) / fsOs);
      s.gStep = (gT - s.g) / n;
      switch (ftype) {
        case GF_NOTCH: s.k = 1.6 * (1 - res) + 0.08; break;
        case GF_PEAK: s.k = 1.2 * (1 - res) + 0.15; s.peak = 1 + 5 * res; break;
        case GF_BAND: s.k = 1.4 * (1 - res) + 0.1; break;
        case GF_COMB: {
          const double d = std::fmin(fsOs / fc, GRIND_COMB_LEN - 2);
          s.delayStep = (d - s.delay) / n;
          s.fb = 0.92 * res;
          break;
        }
        default: s.fb = 0.75 * res;
      }
      const double drive = cur[gp.drive];
      s.driveOn = drive > 0.001;
      s.mix = cur[gp.mix];
      s.gain = grindGain(drive);
      const int dtype = (int)cur[gp.dtype];
      const double bias = dtype == DIST_FUZZ ? FUZZ_BIAS_REL * s.gain : 0;
      if (dtype != s.dtype || bias != s.bias) {
        s.dtype = dtype;
        s.bias = bias;
        s.offset = dtype == DIST_FUZZ ? fuzz(bias) : 0;
        s.adaaF[0] = s.curveIntegral(s.adaaU[0]);
        s.adaaF[1] = s.curveIntegral(s.adaaU[1]);
      }
    }
  }

  void process(double inL, double inR) {
    double lowL = 0, lowR = 0, L = inL, R = inR;
    if (lcOn) {
      lowL = split[1].process(split[0].process(inL));
      L = split[3].process(split[2].process(inL));
      lowR = split[5].process(split[4].process(inR));
      R = split[7].process(split[6].process(inR));
    }
    const double hiL = L, hiR = R;
    if (satAmt > 0) {
      const double g = satGain;
      double sl = 0, sr = 0;
      for (int ch = 0; ch < 2; ch++) {
        const double x = (ch ? R : L) * g + SAT_BIAS, up = satU[ch], fx = tanhIntegral(x), du = x - up;
        const double y = (std::fabs(du) > 1e-5 ? (fx - satF[ch]) / du : fastTanh(0.5 * (x + up))) - SAT_OFFSET;
        satU[ch] = x;
        satF[ch] = fx;
        if (ch) sr = y;
        else sl = y;
      }
      const double a = std::fmin(1, satAmt * 3);
      L += (sl - L) * a;
      R += (sr - R) * a;
    }
    if (preOtt.on()) {
      preOtt.process(L, R);
      L = preOtt.l;
      R = preOtt.r;
    }
    const bool pre = satAmt > 0 || preOtt.on();
    if (pre) {
      const double k = lvlK;
      satIn += (hiL * hiL + hiR * hiR - satIn) * k;
      satOut += (L * L + R * R - satOut) * k;
    }
    const int pos = combPos;
    for (int i = 0; i < GRIND_STAGES; i++) {
      GrindStage& s = stages[i];
      if (!s.on) continue;
      s.g += s.gStep;
      if (s.ftype == GF_COMB) s.delay += s.delayStep;
      L = s.filter(L, 0, s.g, pos);
      R = s.filter(R, 1, s.g, pos);
      if (s.driveOn) {
        const double dl = s.shape(L, 0), dr = s.shape(R, 1), k = envK;
        s.inEnv += (std::fabs(L) + std::fabs(R) - s.inEnv) * k;
        s.outEnv += (std::fabs(dl) + std::fabs(dr) - s.outEnv) * k;
        const double match = s.outEnv > 1e-9 ? std::fmin(2, s.inEnv / s.outEnv) : 1;
        L += (dl * match - L) * s.mix;
        R += (dr * match - R) * s.mix;
      }
    }
    combPos = (pos + 1) & (GRIND_COMB_LEN - 1);
    dcY[0] = L - dcX[0] + dcR * dcY[0];
    dcX[0] = L;
    dcY[1] = R - dcX[1] + dcR * dcY[1];
    dcX[1] = R;
    const double back = pre && satOut > 1e-12 ? std::fmin(4, std::fmax(0.25, std::sqrt(satIn / satOut))) : 1;
    const double wl = dcY[0] * back, wr = dcY[1] * back;
    l = lowL + hiL + (wl - hiL) * mix;
    r = lowR + hiR + (wr - hiR) * mix;
  }

 private:
  int combPos = 0;
  bool lcOn = false;
  double lastLc = -1, mix = 1;
  Biquad split[8];
  double dcX[2] = {}, dcY[2] = {}, dcR = 0.999;
  double satAmt = 0, satGain = 1, satU[2] = {}, satF[2] = {}, satIn = 0, satOut = 0;
  Ott preOtt;
  double lvlK = 0.001, envK = 0.001;
};

}  // namespace lt
