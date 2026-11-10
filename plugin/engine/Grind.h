// GRIND (port of src/engine/core/grind.ts): the neuro-bass chain, four moving filter → drive
// stages before the main filter (SAT and PRE OTT in front), and the OTT used on the whole synth.
#pragma once
#include <algorithm>
#include <array>
#include <vector>
#include <cmath>
#include "Dsp.h"
#include "Params.h"

namespace lt {

constexpr int GRIND_STAGES = 8;
constexpr int GRIND_SLOTS = 8;  // the RUIN page's eight boxes (grind.slot1..8)
constexpr int GF_NOTCH = 0, GF_PEAK = 1, GF_BAND = 2, GF_COMB = 3, GF_PHASER = 4;
constexpr int GC_HZ = 0, GC_SYNC = 1, GC_RANDOM = 2;
constexpr int GM_NOTE = 0, GM_WANDER = 1;
constexpr double GRIND_BEATS[6] = {4, 2, 1, 0.5, 0.25, 0.125};
inline double grindRandomSpeed(Rng& rng) { return std::pow(2.0, 1.5 * rng.next()); }
inline double grindHz(double rate) { return 0.1 * std::pow(2.0, rate * 8); }
inline int grindBeat(double rate) { return (int)jsRound(std::fmin(1, std::fmax(0, rate)) * 5); }
/** grind<n>.drive_type option order: tape, tube, amp (driven amp, speaker cab, mic and room), soft clip. */
constexpr int GD_TAPE = 0, GD_TUBE = 1, GD_AMP = 2, GD_SOFT = 3, GD_HARD = 4, GD_FOLD = 5, GD_RECT = 6, GD_DOWN = 7, GD_DIODE = 8, GD_STARVED = 9;
constexpr double DC_HZ = 15, PEAK_GAIN = 6;
constexpr double STARVED_A = 0.08, STARVED_B = 0.25, STARVED_NEG = 0.7;
/** 0 … +30 dB of drive (see grind.ts). */
inline double grindGain(double drive) { return std::pow(10.0, 1.5 * drive); }
constexpr double TAPE_EMPH = 2, TAPE_EMPH_HZ = 3000, TAPE_LOSS_HZ = 11000, TAPE_BIAS = 0.08;
inline const double TAPE_OFFSET = TAPE_BIAS / std::sqrt(1 + TAPE_BIAS * TAPE_BIAS);
constexpr double TUBE_LOSS_HZ = 9000;
constexpr double AMP_GAIN = 3, AMP_BIAS = 0.3, AMP_TIGHT_HZ = 90;
inline const double AMP_OFFSET = fastTanh(AMP_BIAS);
constexpr int ROOM_LEN = 8192;
constexpr double ROOM_MS[8] = {6.3, 11.9, 18.7, 27.1, 7.7, 13.4, 21.2, 29.5};
constexpr double ROOM_GAIN[4] = {0.3, 0.21, 0.15, 0.1};
constexpr double ROOM_TONE_HZ = 3500;
constexpr int GRIND_COMB_LEN = 4096;
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
/** The amp's speaker side on its own, for the FX distortion's amp type (see grind.ts AmpCab). */
struct AmpCab {
  Biquad tight[2], cab[10];
  std::vector<float> room[2];
  double roomLp[2] = {}, roomTap[8] = {};
  int roomPos = 0;
  double roomK = 0, fs = 0;
  AmpCab() {
    room[0].assign(ROOM_LEN, 0.0f);
    room[1].assign(ROOM_LEN, 0.0f);
  }
  void setFs(double f) {
    fs = f;
    roomK = 1 - std::exp((-2 * PI * ROOM_TONE_HZ) / f);
    for (int ch = 0; ch < 2; ch++) {
      tight[ch].setHighpass(AMP_TIGHT_HZ, 0.7, f);
      const int o = 5 * ch;
      cab[o].setHighpass(55, 0.8, f);
      cab[o + 1].setPeak(110, 3, 1.2, f);
      cab[o + 2].setPeak(450, -4, 0.9, f);
      cab[o + 3].setPeak(2400, 5, 1.3, f);
      cab[o + 4].setLowpass(std::fmin(5200, 0.45 * f), 0.9, f);
      for (int j = 0; j < 4; j++) roomTap[4 * ch + j] = std::fmin(ROOM_LEN - 2, (ROOM_MS[4 * ch + j] / 1000) * f);
    }
  }
  double pre(double x, int ch) { return tight[ch].process(x); }
  double post(double y, int ch) {
    const int o = 5 * ch;
    y = cab[o + 4].process(cab[o + 3].process(cab[o + 2].process(cab[o + 1].process(cab[o].process(y)))));
    roomLp[ch] += (y - roomLp[ch]) * roomK;
    auto& buf = room[ch];
    const int pos = roomPos;
    buf[(size_t)pos] = (float)roomLp[ch];
    double r = 0;
    for (int j = 0; j < 4; j++) {
      double rp = pos - roomTap[4 * ch + j];
      if (rp < 0) rp += ROOM_LEN;
      const int i = (int)std::floor(rp);
      const double fr = rp - i;
      r += ROOM_GAIN[j] * (buf[(size_t)i] + (buf[(size_t)((i + 1) & (ROOM_LEN - 1))] - buf[(size_t)i]) * fr);
    }
    if (ch == 1) roomPos = (pos + 1) & (ROOM_LEN - 1);
    return y + r;
  }
};
inline double ampCurve(double u) { return fastTanh(AMP_GAIN * u + AMP_BIAS) - AMP_OFFSET; }
inline double ampCurveIntegral(double u) { return tanhIntegral(AMP_GAIN * u + AMP_BIAS) / AMP_GAIN - AMP_OFFSET * u; }

struct GrindStage {
  bool on = false;
  int ftype = GF_NOTCH, dtype = GD_TAPE;
  double phase = 0, wFrom = 0, wTo = 0, wPos = 0, spd = 1, depth = 1, fLvT = 1, fLv = 1, dLvT = 1, dLv = 1;
  double wCycle = -1;
  double fcNow = -1, resNow = 0;
  double g = 0.05, gStep = 0, k = 1, peak = 0, delay = 100, delayStep = 0, fb = 0;
  bool driveOn = false, filterOn = true;
  double gain = 1, inEnv = 0, outEnv = 0, mix = 1;
  Svf svf[2];
  double ap[10] = {};
  std::array<float, GRIND_COMB_LEN> comb[2] = {};
  double adaaU[2] = {}, adaaF[2] = {};
  double dsHold[2] = {}, dsLeft[2] = {}, dcK = 0;
  double bias = 0, biasOff = 0, dcS[2] = {};
  // drive colour (per channel): tape emphasis / de-emphasis and loss, tube loss, amp tightening, cab and room
  double pre[2] = {}, post[2] = {}, loss[2] = {}, roomLp[2] = {};
  Biquad tight[2], cab[10];
  // the drive's band (Overdrive's X-Y), tone and the followers for Dynamics (see grind.ts)
  // the drive's band: a 24 dB/oct Linkwitz-Riley split (per channel: low LP x2, low HP x2, high LP x2, high HP x2);
  // only the band is driven, below and above pass untouched and are added back
  Biquad bandX[16];
  // the EQ part: the FX page's four-band EQ, static; bands at 0 dB are skipped
  bool eqOn = false;
  Biquad eqL[4], eqR[4];
  bool eqBand[4] = {};
  double eqLast[16] = {NAN, NAN, NAN, NAN, NAN, NAN, NAN, NAN, NAN, NAN, NAN, NAN, NAN, NAN, NAN, NAN};
  double eqLvT = 1, eqLv = 1;
  bool bandOn = false, bandLoOn = false, bandHiOn = false;
  double rest[2] = {};
  void setBand(double bandHz, double bandOct, double fs, double fsOs) {
    const double bk = bandHz * 31 + bandOct + fsOs * 1e-9;
    if (bk == bandKey) return;
    bandKey = bk;
    bandOn = bandOct < 8.95;
    if (!bandOn) return;
    const double lo = bandHz * std::pow(2.0, -bandOct / 2), hi = bandHz * std::pow(2.0, bandOct / 2);
    bandLoOn = lo > 20;
    bandHiOn = hi < 0.45 * fs;
    for (int c = 0; c < 2; c++) {
      const int o = 8 * c;
      if (bandLoOn) {
        bandX[o].setLowpass(lo, SQRT1_2, fsOs);
        bandX[o + 1].setLowpass(lo, SQRT1_2, fsOs);
        bandX[o + 2].setHighpass(lo, SQRT1_2, fsOs);
        bandX[o + 3].setHighpass(lo, SQRT1_2, fsOs);
      }
      if (bandHiOn) {
        bandX[o + 4].setLowpass(hi, SQRT1_2, fsOs);
        bandX[o + 5].setLowpass(hi, SQRT1_2, fsOs);
        bandX[o + 6].setHighpass(hi, SQRT1_2, fsOs);
        bandX[o + 7].setHighpass(hi, SQRT1_2, fsOs);
      }
    }
  }
  double split(double x, int ch) {
    if (!bandOn) {
      rest[ch] = 0;
      return x;
    }
    const int o = 8 * ch;
    double low = 0, mid = x, high = 0;
    if (bandLoOn) {
      low = bandX[o + 1].process(bandX[o].process(x));
      mid = bandX[o + 3].process(bandX[o + 2].process(x));
    }
    if (bandHiOn) {
      high = bandX[o + 7].process(bandX[o + 6].process(mid));
      mid = bandX[o + 5].process(bandX[o + 4].process(mid));
    }
    rest[ch] = low + high;
    return mid;
  }
  double bandKey = NAN, toneLp[2] = {}, toneK = 1, dyn = 0.5, inSlow = 0, outSlow = 0, inFast = 0, outFast = 0;
  std::vector<float> room[2];
  double roomTap[8] = {};
  int roomPos = 0;
  double emphK = 0, lossK = 0, roomK = 0, colourFs = 0;

  GrindStage() {
    room[0].assign(ROOM_LEN, 0.0f);
    room[1].assign(ROOM_LEN, 0.0f);
  }

  double curve(double u) const {
    switch (dtype) {
      case GD_TAPE: { const double v = u + TAPE_BIAS; return v / std::sqrt(1 + v * v) - TAPE_OFFSET; }
      case GD_AMP: return fastTanh(u + AMP_BIAS) - AMP_OFFSET;
      case GD_SOFT: return u > 1 ? 1 : u < -1 ? -1 : 1.5 * u - 0.5 * u * u * u;
      case GD_HARD: return u > 1 ? 1 : u < -1 ? -1 : u;
      case GD_FOLD: return std::sin(u);
      case GD_RECT: return std::fabs(fastTanh(u));
      case GD_DIODE: return u >= 0 ? fastTanh(u) : 0.5 * fastTanh(2 * u);
      case GD_STARVED: return u > STARVED_A ? fastTanh(u - STARVED_A) : u < -STARVED_B ? STARVED_NEG * fastTanh(u + STARVED_B) : 0;
      default: return fastTanh(u + TUBE_BIAS) - TUBE_OFFSET;
    }
  }
  double curveIntegral(double u) const {
    switch (dtype) {
      case GD_TAPE: { const double v = u + TAPE_BIAS; return std::sqrt(1 + v * v) - TAPE_OFFSET * u; }
      case GD_AMP: return tanhIntegral(u + AMP_BIAS) - AMP_OFFSET * u;
      case GD_SOFT: {
        if (u > 1) return u - 0.375;
        if (u < -1) return -u - 0.375;
        const double u2 = u * u;
        return 0.75 * u2 - 0.125 * u2 * u2;
      }
      case GD_HARD: return u > 1 ? u - 0.5 : u < -1 ? -u - 0.5 : 0.5 * u * u;
      case GD_FOLD: return 1 - std::cos(u);
      case GD_RECT: { const double t0 = tanhIntegral(0); return u >= 0 ? tanhIntegral(u) - t0 : t0 - tanhIntegral(u); }
      case GD_DIODE: { const double t0 = tanhIntegral(0); return u >= 0 ? tanhIntegral(u) - t0 : 0.25 * (tanhIntegral(2 * u) - t0); }
      case GD_STARVED: { const double t0 = tanhIntegral(0); return u > STARVED_A ? tanhIntegral(u - STARVED_A) - t0 : u < -STARVED_B ? STARVED_NEG * (tanhIntegral(u + STARVED_B) - t0) : 0; }
      default: return tanhIntegral(u + TUBE_BIAS) - TUBE_OFFSET * u;
    }
  }
  void setColour(double fs) {
    colourFs = fs;
    emphK = 1 - std::exp((-2 * PI * TAPE_EMPH_HZ) / fs);
    lossK = 1 - std::exp((-2 * PI * (dtype == GD_TUBE || dtype == GD_STARVED ? TUBE_LOSS_HZ : TAPE_LOSS_HZ)) / fs);
    roomK = 1 - std::exp((-2 * PI * ROOM_TONE_HZ) / fs);
    dcK = 1 - std::exp((-2 * PI * DC_HZ) / fs);
    for (int ch = 0; ch < 2; ch++) {
      tight[ch].setHighpass(AMP_TIGHT_HZ, 0.7, fs);
      const int o = 5 * ch;
      cab[o].setHighpass(55, 0.8, fs);
      cab[o + 1].setPeak(110, 3, 1.2, fs);
      cab[o + 2].setPeak(450, -4, 0.9, fs);
      cab[o + 3].setPeak(2400, 5, 1.3, fs);
      cab[o + 4].setLowpass(std::fmin(5200, 0.45 * fs), 0.9, fs);
      for (int j = 0; j < 4; j++) roomTap[4 * ch + j] = std::fmin(ROOM_LEN - 2, (ROOM_MS[4 * ch + j] / 1000) * fs);
    }
  }
  double shape(double x, int ch, double norm) {
    const int t = dtype;
    if (t == GD_DOWN) {
      if (--dsLeft[ch] <= 0) {
        dsHold[ch] = x;
        dsLeft[ch] = jsRound(std::pow(gain, 1.4));
      }
      return dsHold[ch];
    }
    double v = x;
    if (t == GD_TAPE) {
      pre[ch] += (v - pre[ch]) * emphK;
      v += TAPE_EMPH * (v - pre[ch]);
    } else if (t == GD_AMP) {
      v = tight[ch].process(v);
    }
    const double u = gain * norm * (t == GD_AMP ? AMP_GAIN : 1) * v + bias;
    const double up = adaaU[ch];
    const double fu = curveIntegral(u);
    const double du = u - up;
    double y = (std::fabs(du) > 1e-5 ? (fu - adaaF[ch]) / du : curve(0.5 * (u + up))) - biasOff;
    adaaU[ch] = u;
    adaaF[ch] = fu;
    y = colour(y, ch);
    {
      dcS[ch] += (y - dcS[ch]) * dcK;
      y -= dcS[ch];
    }
    return y;
  }
  double colour(double y, int ch) {
    const int t = dtype;
    switch (t) {
      case GD_TAPE: {
        post[ch] += (y - post[ch]) * emphK;
        y -= (TAPE_EMPH / (1 + TAPE_EMPH)) * (y - post[ch]);
        loss[ch] += (y - loss[ch]) * lossK;
        return loss[ch];
      }
      case GD_TUBE:
      case GD_STARVED: {
        loss[ch] += (y - loss[ch]) * lossK;
        return loss[ch];
      }
      case GD_AMP: {
        const int o = 5 * ch;
        y = cab[o + 4].process(cab[o + 3].process(cab[o + 2].process(cab[o + 1].process(cab[o].process(y)))));
        roomLp[ch] += (y - roomLp[ch]) * roomK;
        auto& buf = room[ch];
        const int pos = roomPos;
        buf[(size_t)pos] = (float)roomLp[ch];
        double r = 0;
        for (int j = 0; j < 4; j++) {
          double rp = pos - roomTap[4 * ch + j];
          if (rp < 0) rp += ROOM_LEN;
          const int i = (int)std::floor(rp);
          const double fr = rp - i;
          r += ROOM_GAIN[j] * (buf[(size_t)i] + (buf[(size_t)((i + 1) & (ROOM_LEN - 1))] - buf[(size_t)i]) * fr);
        }
        if (ch == 1) roomPos = (pos + 1) & (ROOM_LEN - 1);
        return y + r;
      }
      default: return y;
    }
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
        return x + peak * f.bp * k;
      }
      case GF_BAND: {
        Svf& f = svf[ch];
        f.process(x, gg, k);
        return f.bp * k;
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
        return y * (1 - fb);
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
        return ((1 - fb) / (2 - fb)) * (x + v);
      }
    }
  }
};

/** One voice's GRIND chain (stereo). */
/** One drive on its own, as RUIN's stages have it (see grind.ts DriveUnit): the FX page's DRIVE box. */
class DriveUnit {
 public:
  double l = 0, r = 0;
  void control(int dtype, double drive, double tone, double outDb, double bandHz, double bandOct, double fs, double fsOs) {
    out = std::pow(10.0, outDb / 20);
    s.gain = grindGain(drive);
    s.setBand(bandHz, bandOct, fs, fsOs);
    s.toneK = tone >= 0.999 ? 1 : 1 - std::exp((-2 * PI * 200 * std::pow(100.0, tone)) / fsOs);
    if (dtype != s.dtype) {
      s.dtype = dtype;
      s.adaaF[0] = s.curveIntegral(s.adaaU[0]);
      s.adaaF[1] = s.curveIntegral(s.adaaU[1]);
      s.setColour(fsOs);
    } else if (s.colourFs != fsOs) {
      s.setColour(fsOs);
    }
    s.bias = 0;
    s.biasOff = 0;
  }
  void process(double L, double R, double mix) {
    const double bl = s.split(L, 0), br = s.split(R, 1);
    double dl = s.shape(bl, 0, 1), dr = s.shape(br, 1, 1);
    if (s.toneK < 1) {
      s.toneLp[0] += (dl - s.toneLp[0]) * s.toneK;
      s.toneLp[1] += (dr - s.toneLp[1]) * s.toneK;
      dl = s.toneLp[0];
      dr = s.toneLp[1];
    }
    l = s.rest[0] + bl + (dl * out - bl) * mix;
    r = s.rest[1] + br + (dr * out - br) * mix;
  }

 private:
  GrindStage s;
  double out = 1;
};

class Grind {
 public:
  GrindStage stages[GRIND_STAGES];
  double l = 0, r = 0;

  explicit Grind(Rng& rng) {
    for (auto& s : stages) {
      s.wFrom = rng.next();
      s.wTo = rng.next();
      s.wPos = 0.5 * (rng.next() + 1);
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
      for (int c = 0; c < 2; c++) {
        s.pre[c] = s.post[c] = s.loss[c] = s.roomLp[c] = 0;
        s.tight[c].reset();
        s.toneLp[c] = 0;
        std::fill(s.room[c].begin(), s.room[c].end(), 0.0f);
      }
      for (auto& f : s.cab) f.reset();
      for (auto& f : s.bandX) f.reset();
      for (auto& f : s.eqL) f.reset();
      for (auto& f : s.eqR) f.reset();
    }
    dcX[0] = dcX[1] = dcY[0] = dcY[1] = 0;
    for (auto& f : split) f.reset();
  }

  void control(const double* cur, double beatPos, double bps, double keyOct, double fs, double fsOs, int n, Rng& rng) {
    const auto& P = PI_();
    const double dt = n / fsOs;
    dcR = 1 - (TWO_PI * 10) / fsOs;
    mix = cur[P.grindMix];
    outGain = std::pow(10.0, cur[P.grindOut] / 20);
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
    for (int k = 0; k < GRIND_SLOTS; k++) slots[k] = (int)cur[P.grindSlot[k]];
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
      double m;
      if (oneShot && !wander) {
        s.phase += dt;
        m = -1 + 2 * std::exp((-s.phase * 2 * hz * s.spd) * 3);
      } else if (clock == GC_SYNC && !wander) {
        const double p = beatPos / GRIND_BEATS[grindBeat(rate)];
        m = std::cos(TWO_PI * (p - std::floor(p)));
      } else if (!wander) {
        s.phase += hz * s.spd * dt;
        if (s.phase >= 1) {
          s.phase -= std::floor(s.phase);
          if (rnd) s.spd = grindRandomSpeed(rng);
        }
        m = std::cos(TWO_PI * s.phase);
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
      }
      // where it moves: Freq (times KEY) ± half the H Range, slid inside 20 Hz-20 kHz; the top of the range = the whole spectrum
      const double gzLo = std::log2(20.0), gzHi = std::log2(20000.0);
      const double c = std::log2(std::fmax(cur[gp.freq] * key, 1.0)), h = 0.5 * cur[gp.range];
      double lo = c - h, hi = c + h;
      if (hi - lo >= gzHi - gzLo) { lo = gzLo; hi = gzHi; }
      else if (lo < gzLo) { hi += gzLo - lo; lo = gzLo; }
      else if (hi > gzHi) { lo -= hi - gzHi; hi = gzHi; }
      const double fc = std::fmin(std::pow(2.0, lo + (hi - lo) * 0.5 * (m + 1)), fs * 0.45);
      s.fcNow = fc;
      const int ftype = (int)cur[gp.filter];
      if (ftype != s.ftype) {
        s.ftype = ftype;
        for (auto& f : s.svf) f.reset();
        for (double& a : s.ap) a = 0;
      }
      const double res = 1 - cur[gp.width];
      s.depth = cur[gp.depth];
      s.fLvT = std::pow(10.0, cur[gp.fLevel] / 20);
      s.dLvT = std::pow(10.0, cur[gp.dLevel] / 20);
      s.eqLvT = std::pow(10.0, cur[gp.eqLevel] / 20);
      s.eqOn = cur[gp.eqOn] > 0.5;
      if (s.eqOn) {
        for (int b = 0; b < 4; b++) {
          const auto& e = gp.eq[b];
          const int o = 4 * b;
          const double type = cur[e.type], hz = std::fmin(cur[e.freq], fs * 0.45), db = cur[e.gain] * cur[gp.eqScale], q = cur[e.q];
          s.eqBand[b] = type > 0.5 || std::fabs(db) > 0.01;
          if (!s.eqBand[b] || (s.eqLast[o] == type && s.eqLast[o + 1] == hz && s.eqLast[o + 2] == db && s.eqLast[o + 3] == q)) continue;
          s.eqLast[o] = type;
          s.eqLast[o + 1] = hz;
          s.eqLast[o + 2] = db;
          s.eqLast[o + 3] = q;
          for (Biquad* f : {&s.eqL[b], &s.eqR[b]}) {
            if (b == 0) type > 0.5 ? f->setHighpass(hz, q, fsOs) : f->setLowShelf(hz, db, fsOs, q);
            else if (b == 3) type > 0.5 ? f->setLowpass(hz, q, fsOs) : f->setHighShelf(hz, db, fsOs, q);
            else type > 0.5 ? f->setNotch(hz, q, fsOs) : f->setPeak(hz, db, q, fsOs);
          }
        }
      }
      s.resNow = res;
      const double gT = std::tan((PI * fc) / fsOs);
      s.gStep = (gT - s.g) / n;
      switch (ftype) {
        case GF_NOTCH: s.k = 1.6 * (1 - res) + 0.08; break;
        case GF_PEAK: s.k = 1.2 * (1 - res) + 0.15; s.peak = PEAK_GAIN; break;
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
      s.driveOn = drive > 0.001 && cur[gp.driveOn] > 0.5;
      s.filterOn = cur[gp.filterOn] > 0.5;
      s.mix = cur[gp.mix];
      s.gain = grindGain(drive);
      {
        s.setBand(cur[gp.dFreq], cur[gp.dWidth], fs, fsOs);
        const double tone = cur[gp.dTone];
        s.toneK = tone >= 0.999 ? 1 : 1 - std::exp((-2 * PI * 200 * std::pow(100.0, tone)) / fsOs);
      }
      const int dtype = (int)cur[gp.dtype];
      if (dtype != s.dtype) {
        s.dtype = dtype;
        s.adaaF[0] = s.curveIntegral(s.adaaU[0]);
        s.adaaF[1] = s.curveIntegral(s.adaaU[1]);
        s.setColour(fsOs);
      } else if (s.colourFs != fsOs) {
        s.setColour(fsOs);
      }
      s.bias = 0;
      s.biasOff = 0;
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
    const int pos = combPos;
    for (int i = 0; i < GRIND_STAGES; i++) {
      GrindStage& s = stages[i];
      if (!s.on) continue;
      s.g += s.gStep;
      if (s.ftype == GF_COMB) s.delay += s.delayStep;
    }
    // the eight boxes in their order: each holds filter n, drive n or nothing
    for (int k = 0; k < GRIND_SLOTS; k++) {
      const int v = slots[k];
      if (v <= 0) continue;
      // 1-8 filter 1-8, 9-16 drive 1-8, 17-24 EQ 1-8
      const int kind = (v - 1) / GRIND_STAGES;
      const bool drive = kind == 1;
      GrindStage& s = stages[(v - 1) % GRIND_STAGES];
      if (!s.on || !(kind == 0 ? s.filterOn : kind == 1 ? s.driveOn : s.eqOn)) continue;
      if (kind == 2) {
        for (int b = 0; b < 4; b++) {
          if (s.eqBand[b]) {
            L = s.eqL[b].process(L);
            R = s.eqR[b].process(R);
          }
        }
        s.eqLv += (s.eqLvT - s.eqLv) * 0.002;
        L *= s.eqLv;
        R *= s.eqLv;
        continue;
      }
      if (!drive) {
        const double iL = L, iR = R;
        L = iL + s.depth * (s.filter(iL, 0, s.g, pos) - iL);
        R = iR + s.depth * (s.filter(iR, 1, s.g, pos) - iR);
      } else {
        const double bl = s.split(L, 0), br = s.split(R, 1);
        double dl = s.shape(bl, 0, 1), dr = s.shape(br, 1, 1);
        if (s.toneK < 1) {
          s.toneLp[0] += (dl - s.toneLp[0]) * s.toneK;
          s.toneLp[1] += (dr - s.toneLp[1]) * s.toneK;
          dl = s.toneLp[0];
          dr = s.toneLp[1];
        }
        L = s.rest[0] + bl + (dl - bl) * s.mix;
        R = s.rest[1] + br + (dr - br) * s.mix;
      }
      // the box's level, smoothed so the handle never clicks
      if (drive) {
        s.dLv += (s.dLvT - s.dLv) * 0.002;
        L *= s.dLv;
        R *= s.dLv;
      } else {
        s.fLv += (s.fLvT - s.fLv) * 0.002;
        L *= s.fLv;
        R *= s.fLv;
      }
    }
    combPos = (pos + 1) & (GRIND_COMB_LEN - 1);
    dcY[0] = L - dcX[0] + dcR * dcY[0];
    dcX[0] = L;
    dcY[1] = R - dcX[1] + dcR * dcY[1];
    dcX[1] = R;
    const double wl = dcY[0] * outGain, wr = dcY[1] * outGain;
    l = inL + (lowL + wl - inL) * mix;
    r = inR + (lowR + wr - inR) * mix;
  }

 private:
  int slots[GRIND_SLOTS] = {};
  int combPos = 0;
  bool lcOn = false;
  double lastLc = -1, mix = 1;
  Biquad split[8];
  double dcX[2] = {}, dcY[2] = {}, dcR = 0.999;
  double outGain = 1;
};

}  // namespace lt
