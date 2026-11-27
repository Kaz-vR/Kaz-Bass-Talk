// The reverb: the figure-eight tank of the classic digital reverbs (a line-by-line port of src/engine/core/verb.ts).
#pragma once
#include <cmath>
#include <vector>
#include "Dsp.h"

namespace lt {

namespace verb_detail {
constexpr double BASE_FS = 29761;
constexpr double IN_DIFF[4] = {142, 107, 379, 277};
constexpr double IN_G[4] = {0.75, 0.75, 0.625, 0.625};
constexpr double BR_AP1[2] = {672, 908}, BR_D1[2] = {4453, 4217}, BR_AP2[2] = {1800, 2656}, BR_D2[2] = {3720, 3163};
/** [branch, element (0 delay 1, 1 all-pass 2, 2 delay 2), position, sign], left then right. */
constexpr double TAPS[14][4] = {{1, 0, 266, 1}, {1, 0, 2974, 1}, {1, 1, 1913, -1}, {1, 2, 1996, 1}, {0, 0, 1990, -1}, {0, 1, 187, -1}, {0, 2, 1066, -1},
                                {0, 0, 353, 1}, {0, 0, 3627, 1}, {0, 1, 1228, -1}, {0, 2, 2673, 1}, {1, 0, 2111, -1}, {1, 1, 335, -1}, {1, 2, 121, -1}};
constexpr double MOD_EXC = 16;
constexpr double MOD_HZ[2] = {0.87, 1.13};
struct Type { double size, diff, dd1, dd2, lo, hi, mod, bw, level; };
constexpr Type TYPES[4] = {{0.42, 0.45, 0.7, 0.5, 1.36, 0.71, 0.6, 9000, 1.019}, {0.7, 0.7, 0.7, 0.5, 1.18, 0.4, 0.8, 14000, 0.965},
                           {1.25, 0.5, 0.7, 0.5, 1.56, 0.34, 1.2, 7000, 1.494}, {2.0, 0.5, 0.68, 0.45, 1.5, 0.29, 1.6, 6000, 1.545}};
constexpr double MAX_SIZE = 2.0, MAX_PRE = 0.26;

struct Line {
  std::vector<float> buf;
  int mask = 0, w = 0;
  explicit Line(double len = 4) {
    int n = 1;
    while (n < len + 4) n <<= 1;
    buf.assign(n, 0.f);
    mask = n - 1;
  }
  double read(double d) const {
    const double p = w - d;
    const int i = (int)std::floor(p);
    const double f = p - i;
    const double a = buf[i & mask];
    return a + (buf[(i + 1) & mask] - a) * f;
  }
  void write(double v) {
    buf[w] = (float)v;
    w = (w + 1) & mask;
  }
};
}  // namespace verb_detail

class Reverb {
 public:
  explicit Reverb(double fs_) : fs(fs_) {
    using namespace verb_detail;
    const double k = (fs / BASE_FS) * MAX_SIZE;
    pre = Line(std::ceil(MAX_PRE * fs) + 4);
    for (int i = 0; i < 4; i++) inAp[i] = Line(std::ceil(IN_DIFF[i] * k) + 4);
    for (int b = 0; b < 2; b++) {
      ap1[b] = Line(std::ceil((BR_AP1[b] + 2 * MOD_EXC) * k) + 4);
      d1[b] = Line(std::ceil(BR_D1[b] * k) + 4);
      ap2[b] = Line(std::ceil(BR_AP2[b] * k) + 4);
      d2[b] = Line(std::ceil(BR_D2[b] * k) + 4);
    }
    modPh[1] = 0.25;
  }
  void reset() {
    for (auto* l : {&pre, &inAp[0], &inAp[1], &inAp[2], &inAp[3], &ap1[0], &ap1[1], &d1[0], &d1[1], &ap2[0], &ap2[1], &d2[0], &d2[1]}) std::fill(l->buf.begin(), l->buf.end(), 0.f);
    absS[0] = absS[1] = fb[0] = fb[1] = 0;
    bwS = bwS2 = 0;
  }
  /** Wet stereo into out[0], out[1] (dry not included). type 0..3, decay = RT60 seconds, predelay in ms. */
  void process(double input, double type, double decay, double predelayMs, double* out) {
    using namespace verb_detail;
    if (type != lastType || std::fabs(decay - lastDecay) > 1e-4 * decay) setup(type, decay);
    const double pd = std::fmin(MAX_PRE * fs, std::fmax(0.0, (predelayMs * fs) / 1000));
    pre.write(input);
    double x = pre.read(pd + 1);
    bwS += bwK * (x - bwS);
    bwS2 += bwK * (bwS - bwS2);
    x = bwS2;
    for (int i = 0; i < 4; i++) {
      const double g = IN_G[i] * diff / 0.75;
      const double dl = inAp[i].read(inLen[i]);
      const double v = x + g * dl;
      inAp[i].write(v);
      x = dl - g * v;
    }
    const double early = x;
    const double in0 = x + fb[1], in1 = x + fb[0];
    for (int b = 0; b < 2; b++) {
      double s = b == 0 ? in0 : in1;
      double ph = modPh[b] + MOD_HZ[b] / fs;
      if (ph >= 1) ph -= 1;
      modPh[b] = ph;
      const double g1 = -dd1;
      const double dl1 = ap1[b].read(len[4 * b] + exc * (1 + std::sin(2 * PI * ph)));
      const double v1 = s + g1 * dl1;
      ap1[b].write(v1);
      s = dl1 - g1 * v1;
      const double y1 = d1[b].read(len[4 * b + 1]);
      d1[b].write(s);
      absS[b] = absB[b] * y1 + absA[b] * absS[b];
      s = absS[b];
      const double g2 = dd2;
      const double dl2 = ap2[b].read(len[4 * b + 2]);
      const double v2 = s + g2 * dl2;
      ap2[b].write(v2);
      s = dl2 - g2 * v2;
      fb[b] = d2[b].read(len[4 * b + 3]);
      d2[b].write(s);
    }
    double l = 0, r = 0;
    for (int i = 0; i < 14; i++) {
      const int br = (int)TAPS[i][0], el = (int)TAPS[i][1];
      const Line& line = el == 0 ? d1[br] : el == 1 ? ap2[br] : d2[br];
      const double v = TAPS[i][3] * line.read(tapPos[i]);
      if (i < 7) l += v;
      else r += v;
    }
    out[0] = (0.6 * l + 0.12 * early) * level;
    out[1] = (0.6 * r + 0.12 * early) * level;
  }

 private:
  void setup(double type, double decay) {
    using namespace verb_detail;
    const Type& t = TYPES[std::max(0, std::min(3, (int)type))];
    const double k = (fs / BASE_FS) * t.size;
    for (int i = 0; i < 4; i++) inLen[i] = std::max(1.0, (double)jsRound(IN_DIFF[i] * std::sqrt(t.size) * (fs / BASE_FS)));
    const double d = std::fmax(0.1, decay);
    for (int b = 0; b < 2; b++) {
      len[4 * b] = BR_AP1[b] * k;
      len[4 * b + 1] = BR_D1[b] * k;
      len[4 * b + 2] = BR_AP2[b] * k;
      len[4 * b + 3] = BR_D2[b] * k;
      const double L = len[4 * b] + len[4 * b + 1] + len[4 * b + 2] + len[4 * b + 3];
      const double gdc = std::pow(10.0, (-3 * L) / (t.lo * d * fs)), gny = std::pow(10.0, (-3 * L) / (t.hi * d * fs));
      absA[b] = (gdc - gny) / (gdc + gny);
      absB[b] = gdc * (1 - absA[b]);
    }
    for (int i = 0; i < 14; i++) tapPos[i] = TAPS[i][2] * k;
    diff = t.diff;
    dd1 = t.dd1;
    dd2 = t.dd2;
    exc = MOD_EXC * t.mod * (fs / BASE_FS);
    bwK = 1 - std::exp((-2 * PI * t.bw) / fs);
    level = t.level * std::fmin(2.0, std::pow(d / 2, -0.37));
    lastType = type;
    lastDecay = decay;
  }
  double fs;
  verb_detail::Line pre, inAp[4], ap1[2], d1[2], ap2[2], d2[2];
  double absS[2] = {}, fb[2] = {}, modPh[2] = {}, bwS = 0, bwS2 = 0;
  double lastType = -1, lastDecay = -1;
  double inLen[4] = {}, len[8] = {}, absA[2] = {}, absB[2] = {}, tapPos[14] = {};
  double diff = 0.75, dd1 = 0.7, dd2 = 0.5, exc = 0, bwK = 0, level = 0.5;
};

}  // namespace lt
