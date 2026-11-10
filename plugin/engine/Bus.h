// The dirt chain on the summed sound: RUIN → DRIVE → bitcrusher → tape, once on all the voices together.
// A line-by-line port of src/engine/core/bus.ts (see there).
#pragma once

#include <array>
#include <cmath>
#include "Dsp.h"
#include "Fx.h"
#include "Grind.h"
#include "Oversample.h"
#include "Params.h"

namespace lt {

class DirtBus {
 public:
  Grind grind;
  bool grindOn = false;
  double l = 0, r = 0;

  DirtBus(double fs, Rng& rng) : grind(rng), tape(fs) {}

  void reset() {
    grind.reset();
    crusher.reset();
    tape.reset();
    crushLp.fill(0);
    tapeLp.fill(0);
    for (auto& f : split) f.reset();
    upL.reset();
    upR.reset();
    dnL.reset();
    dnR.reset();
  }

  void noteOn(Rng& rng) { grind.noteOn(&rng); }

  void control(const double* cur, const double* dst, double beatPos, double bps, double keyOct, double fs, int n, Rng& rng) {
    const auto& P = PI_();
    const double fsOs = fs * OS;
    const bool on = cur[P.grindOn] > 0.5;
    if (on && !grindOn) grind.reset();
    grindOn = on;
    if (on) grind.control(cur, beatPos, bps, keyOct, fs, fsOs, n * OS, rng);

    const double dDrive = clampd(cur[P.dDrive] + dst[D_DIST_DRIVE], 0, 1);
    distMix = clampd(cur[P.dMix] + dst[D_DIST_MIX], 0, 1);
    distOn = dDrive > 0.001 && distMix > 1e-4;
    const double dTone = clampd(cur[P.dTone] + dst[D_DIST_TONE], 0, 1);
    if (distOn) drv.control((int)cur[P.dType], dDrive, dTone, cur[P.dOut], cur[P.dBandHz], cur[P.dBandOct], fs, fsOs);
    if (cur[P.dSplit] != lastSplit) {
      const double sp = cur[P.dSplit];
      splitG = sp > 22 ? std::tan((PI * sp) / fsOs) : 0;
      if (splitG > 0)
        for (auto& f : split) f.setCoefs(splitG, SQRT2);
      lastSplit = sp;
    }

    crushMix = clampd(cur[P.crushMix] + dst[D_CRUSH], 0, 1);
    crushQ = std::pow(2.0, cur[P.crushBits] - 1);
    crushRate = cur[P.crushRate];
    crushLc = cur[P.crushLowcut] > 21 ? std::exp((-TWO_PI * cur[P.crushLowcut]) / fs) : 0;
    tapeLc = cur[P.tapeLowcut] > 21 ? std::exp((-TWO_PI * cur[P.tapeLowcut]) / fs) : 0;

    tapeWow = clampd(cur[P.tapeWow] + dst[D_TAPE_WOW], 0, 1);
    tapeOn = tapeWow > 0;
  }

  void process(double L, double R) {
    upL.process(L);
    upR.process(R);
    nonlinear(upL.out0, upR.out0, 0);
    nonlinear(upL.out1, upR.out1, 2);
    L = dnL.process(os[0], os[2]);
    R = dnR.process(os[1], os[3]);

    if (crushMix > 0) {
      double lowL = 0, lowR = 0;
      if (crushLc > 0) {
        const double c = crushLc;
        auto& s = crushLp;
        s[0] = L + c * (s[0] - L);
        s[1] = s[0] + c * (s[1] - s[0]);
        s[2] = R + c * (s[2] - R);
        s[3] = s[2] + c * (s[3] - s[2]);
        lowL = s[1];
        lowR = s[3];
      }
      crusher.process(L - lowL, R - lowR, crushMix, crushQ, crushRate, tmp);
      L = lowL + tmp[0];
      R = lowR + tmp[1];
    }

    if (tapeOn) {
      double lowL = 0, lowR = 0;
      if (tapeLc > 0) {
        const double c = tapeLc;
        auto& s = tapeLp;
        s[0] = L + c * (s[0] - L);
        s[1] = s[0] + c * (s[1] - s[0]);
        s[2] = R + c * (s[2] - R);
        s[3] = s[2] + c * (s[3] - s[2]);
        lowL = s[1];
        lowR = s[3];
      }
      tape.process(L - lowL, R - lowR, tapeWow, tmp);
      L = lowL + tmp[0];
      R = lowR + tmp[1];
    }
    l = L;
    r = R;
  }

 private:
  void nonlinear(double L, double R, int slot) {
    if (grindOn) {
      grind.process(L, R);
      L = grind.l;
      R = grind.r;
    }
    if (distOn) {
      double lowL = 0, lowR = 0, hl = L, hr = R;
      if (splitG > 0) {
        auto& sp = split;
        sp[0].processFixed(L);
        sp[1].processFixed(sp[0].lp);
        sp[2].processFixed(sp[0].hp);
        lowL = sp[1].lp;
        hl = sp[2].hp;
        sp[3].processFixed(R);
        sp[4].processFixed(sp[3].lp);
        sp[5].processFixed(sp[3].hp);
        lowR = sp[4].lp;
        hr = sp[5].hp;
      }
      drv.process(hl, hr, distMix);
      L = lowL + drv.l;
      R = lowR + drv.r;
    }
    os[slot] = L;
    os[slot + 1] = R;
  }

  DriveUnit drv;
  bool distOn = false;
  double distMix = 0, splitG = 0, lastSplit = NAN;
  Svf split[6];
  Crusher crusher;
  double crushQ = 128, crushRate = 1, crushMix = 0, crushLc = 0, tapeLc = 0;
  std::array<double, 4> crushLp{}, tapeLp{};
  Tape tape;
  double tapeWow = 0;
  bool tapeOn = false;
  Upsampler2x upL, upR;
  Downsampler2x dnL, dnR;
  double os[4] = {};
  double tmp[2] = {};
};

}  // namespace lt
