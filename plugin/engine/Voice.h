// One synth voice (port of src/engine/core/voice.ts): oscillators (+FM) and noise →
// [2× oversampled: drive → filter] → DC filter → amp (RUIN, DRIVE, crush and tape: Bus.h, on the summed voices),
// + clean mono sub.
// Plugin addition: per-note MPE (bend, pressure, slide), zero unless an MPE
// controller sends it, so the sound is the prototype's otherwise.
#pragma once
#include <array>
#include <cmath>
#include <vector>
#include "Dsp.h"
#include "Fx.h"
#include "Grind.h"
#include "Oversample.h"
#include "Params.h"
#include "VoiceFx.h"
#include "Wavetable.h"

namespace lt {

constexpr double MID_CLIP_REF = 0.8;
/** polyBLEP residual for a unit step at phase 0 (t in 0..1, dt = phase increment). */
inline double polyBlep(double t, double dt) {
  if (t < dt) {
    const double x = t / dt;
    return x + x - x * x - 1;
  }
  if (t > 1 - dt) {
    const double x = (t - 1) / dt;
    return x * x + x + x + 1;
  }
  return 0;
}
/** The sub routed into the main filter arrives at about the level the clean path would have had. */
constexpr double SUB_ROUTE_GAIN = 1 / (VOICE_GAIN * PRE_FILTER_GAIN * POST_FILTER_GAIN);
constexpr double UNISON_SKEW[7] = {0, 0.19, -0.13, 0.08, -0.17, 0.11, 0};

struct OscState {
  std::array<double, MAX_UNISON> phase{}, inc{}, panL{}, panR{}, drift{}, driftTarget{}, held{};
  int voices = 1;
  double gain = 0;
  int wave = WAVE_SAW;
  int baseA = 0, baseB = 0, baseSaw = 0;
  double frac = 0, pw = 0.5, lastSpread = -1;
  int lastVoices = -1;
};

class Voice {
 public:
  int note = 48;
  double pitch = 48;
  double velocity = 1;
  bool gate = false;
  long long order = 0;
  /** The main filter's current cutoff (Hz) and resonance, for the texture bed's copy of it. */
  double fcNow = 1000, resNow = 0;
  int tail = 0;
  double subOn = 1;
  /** The bar position in beats (0..4) and the tempo in beats per second, set by the synth: GRIND's clock. */
  double beatPos = 0, bps = 2;
  Envelope ampEnv;
  std::array<double, DEST_COUNT> dst{};
  // MPE: the MIDI channel this note came from (-1 = none) and its expression.
  int channel = -1;
  double mpeBend = 0;      // semitones
  double mpePressure = 0;  // 0..1
  double mpeSlide = 0.5;   // 0..1, 0.5 = neutral

  Voice(double fs_, const double* cur_, const float* table_, uint32_t seed, const double* dstMask_)
      : fs(fs_), cur(cur_), table(table_), rng(seed), dstMask(dstMask_),
        combL((int)std::ceil((fs_ * OS) / 20)), combR((int)std::ceil((fs_ * OS) / 20)),
        strings{KarplusString((int)std::ceil(fs_ / 15)), KarplusString((int)std::ceil(fs_ / 15))}, subClip(fs_), midClip(fs_) {
    subRamp = 1 / (0.01 * fs);
    voiceDcL.setHighpass(VOICE_DC_HZ, SQRT1_2, fs);
    voiceDcR.setHighpass(VOICE_DC_HZ, SQRT1_2, fs);
    lfoFade.fill(1);
    driveF.fill(tanhIntegral(0));
    mixF.fill(tanhIntegral(0));
    Rng card(seed ^ 0x6c8e9cf5u);
    cardTune = card.next();
    cardCut = card.next();
    cardEnv = card.next();
    cardLevel = card.next();
  }

  bool active() const { return ampEnv.stage != 0; }

  // How far a per-note LFO shape is through its cycle (0..1).
  double lfoProgress(int l) const { return lfoProg[l]; }

  // A per-note LFO shape's value: bloom rises 0 -> 1 (eased), drop falls 1 -> 0 (fast first), per note holds its random value.
  double lfoNow(int l) const {
    const auto& P = PI_();
    const double x = lfoProg[l];
    switch ((int)cur[P.lfo[l].shape]) {
      case LFO_BLOOM: return 0.5 - 0.5 * std::cos(PI * x);
      case LFO_DROP: return (1 - x) * (1 - x);
      default: return lfoRand[l];
    }
  }

  /** Where GRIND stage i's filter is right now (Hz), or -1 when the stage (or the chain) is off. */

  // ---------------------------------------------------------------- notes

  void start(int n, double vel, bool glide, bool retrigger, long long ord) {
    const auto& P = PI_();
    const bool sounding = ampEnv.stage != 0;
    note = n;
    if (!glide || !hasPlayed) pitch = n;
    hasPlayed = true;
    gate = true;
    order = ord;
    tail = 40;
    if (!retrigger) return;
    velocity = clampd(vel, 0, 1);
    if (!sounding) {
      const bool freeRun = cur[P.analog] > 0.01;
      for (auto& o : osc)
        for (int j = 0; j < MAX_UNISON; j++)
          o.phase[j] = j == 0 ? 0 : freeRun ? 0.5 * (rng.next() + 1) : std::fmod(j * 0.381966, 1.0);
      subPhase = 0;
      syncPhase = 0;
      osc[1].held.fill(0);
      ladL.reset();
      ladR.reset();
      upL.reset();
      upR.reset();
      dnL.reset();
      dnR.reset();
      diodeL.reset();
      diodeR.reset();
    }
    noteCutoffJitter = rng.next();
    noteEnvJitter = cur[P.poly] > 1.5 ? 1 + 0.12 * cur[P.analog] * rng.next() : 1;
    const double noteHz = 440 * std::pow(2.0, (n + 12 * cur[P.octave] - 69) / 12);
    for (int k = 0; k < 2; k++) {
      if ((int)cur[P.osc[k].wave] == WAVE_STRING) {
        const double hz = noteHz * std::pow(2.0, cur[P.osc[k].semi] / 12);
        strings[k].pluck(fs / hz);
      }
    }
    ampEnv.trigger();
    modEnv.trigger();
    for (int l = 0; l < LFO_COUNT; l++) {
      lfoFade[l] = cur[P.lfo[l].fade] > 0 ? 0 : 1;
      lfoProg[l] = 0;
      lfoRand[l] = rng.next();
    }
    noteTime = 0;
    vibPhase = 0.5 * (rng.next() + 1);
    vibRate = cur[P.vibRate] * (1 + 0.05 * rng.next());
  }

  void release() {
    gate = false;
    ampEnv.release();
    modEnv.release();
  }

  void reset() {
    gate = false;
    ampEnv.reset();
    modEnv.reset();
    ladL.reset();
    ladR.reset();
    for (int i = 0; i < 2; i++) {
      bpL[i].reset();
      bpR[i].reset();
    }
    for (int i = 0; i < 3; i++) {
      fmtL[i].reset();
      fmtR[i].reset();
    }
    upL.reset();
    upR.reset();
    dnL.reset();
    dnR.reset();
    voiceDcL.reset();
    voiceDcR.reset();
    diodeL.reset();
    diodeR.reset();
    for (auto& f : notchL) f.reset();
    for (auto& f : notchR) f.reset();
    for (auto& f : hpL) f.reset();
    for (auto& f : hpR) f.reset();
    lpgL.reset();
    lpgR.reset();
    semL.reset();
    semR.reset();
    combL.reset();
    combR.reset();
    for (auto& st : strings) st.reset();
    subClip.reset();
    midClip.reset();
    subDelay.fill(0);
    for (auto& f : oscF) f.reset();
    subF.reset();
    postCut.reset();
    upBL.reset();
    upBR.reset();
    tail = 0;
  }

  void applyDiscrete() {
    const auto& P = PI_();
    for (int n = 0; n < 2; n++) {
      osc[n].wave = (int)cur[P.osc[n].wave];
      osc[n].voices = (int)cur[P.osc[n].voices];
    }
    filterType = (int)cur[P.fType];
    subWave = (int)cur[P.subWave];
  }

  // ---------------------------------------------------------- control rate

  void control(const double* gsrc, double bend, const double* xdst) {
    const auto& P = PI_();
    // the voice card (poly only, scaled by Analog) and this note's jitter stretch the envelope times
    const double card = cur[P.poly] > 1.5 ? cur[P.analog] : 0;
    const double et = (1 + 0.2 * card * cardEnv) * noteEnvJitter;
    ampEnv.set(cur[P.amp[0]] * et, cur[P.amp[1]] * et, cur[P.amp[2]], cur[P.amp[3]] * et, fs, cur[P.ampBend[0]], cur[P.ampBend[1]], cur[P.ampBend[2]]);
    modEnv.set(cur[P.mod[0]] * et, cur[P.mod[1]] * et, cur[P.mod[2]], cur[P.mod[3]] * et, fs, cur[P.modBend[0]], cur[P.modBend[1]], cur[P.modBend[2]]);

    const double glideMs = cur[P.glide];
    if (glideMs > 0.5) {
      const double c = 1 - std::exp((-CONTROL_BLOCK * 4.6) / ((glideMs / 1000) * fs));
      pitch += (note - pitch) * c;
    } else {
      pitch = note;
    }

    for (int i = 0; i < SRC_COUNT; i++) src[i] = gsrc[i];
    for (int l = 0; l < LFO_COUNT; l++) {
      const auto& lp = P.lfo[l];
      if (lfoFade[l] < 1) {
        const double fadeMs = cur[lp.fade];
        lfoFade[l] = fadeMs > 0 ? std::fmin(1, lfoFade[l] + (CONTROL_BLOCK * 1000) / (fadeMs * fs)) : 1;
      }
      const int s = SRC_LFO[l];
      if (lfoPerNote((int)cur[lp.shape])) {
        // A per-note shape: one cycle from this note's start (Rate or the synced note value), then held.
        const int sync = (int)cur[lp.sync];
        double rate = sync > 0 ? bps / SYNC_BEATS[sync] : cur[lp.rate];
        const double rm = dst[LFO_RATE_DEST[l]];
        if (rm != 0) rate *= std::pow(2.0, 3 * rm);
        lfoProg[l] = std::fmin(1, lfoProg[l] + (rate * CONTROL_BLOCK) / fs);
        src[s] = lfoNow(l) * cur[P.lfoOn[l]] * lfoFade[l];
      } else {
        src[s] *= lfoFade[l];
      }
    }
    src[SRC_MOD_ENV] = modEnv.level * cur[P.modEnvOn];
    src[SRC_AMP_ENV] = ampEnv.level;
    src[SRC_VEL] = velocity;
    src[SRC_KEY] = clampd((pitch - KEYTRACK_CENTER) / 24, -1, 1);
    for (int d = 0; d < DEST_COUNT; d++) dst[d] = xdst[d];
    for (int s = 0; s < SLOT_COUNT; s++) {
      const auto& slot = P.slots[s];
      const int d = (int)cur[slot.dst];
      if (d > 0) dst[d] += cur[slot.amt] * src[(int)cur[slot.src]];
    }
    if (dstMask)
      for (int d = 1; d < DEST_COUNT; d++) dst[d] *= dstMask[d];
    // MPE: pressure plays the note harder (brighter, dirtier, louder); slide moves the brightness.
    if (mpePressure != 0 || mpeSlide != 0.5) {
      dst[D_CUTOFF] += 0.22 * mpePressure + 0.6 * (mpeSlide - 0.5);
      dst[D_DRIVE] += 0.25 * mpePressure;
      dst[D_AMP] += 0.15 * mpePressure;
    }

    analog = cur[P.analog];
    sawBow = analog;
    syncOn = cur[P.osc2Sync] > 0.5;

    noteTime += (double)CONTROL_BLOCK / fs;
    double vib = 0;
    const double vibDepth = clampd(cur[P.vibDepth] + 100 * dst[D_VIBRATO], 0, 100);
    if (vibDepth > 0) {
      const double t = noteTime - cur[P.vibDelay] / 1000;
      if (t > 0) {
        vibPhase += (vibRate * CONTROL_BLOCK) / fs;
        if (vibPhase >= 1) vibPhase -= 1;
        vib = (vibDepth / 100) * std::fmin(1, t / (cur[P.vibFade] / 1000)) * std::sin(TWO_PI * vibPhase);
      }
    }

    // Pitch moves the whole note (the sub too); Osc A+B pitch and vibrato only the two oscillators.
    const double notePitch = pitch + 12 * cur[P.octave] + 2 * bend + mpeBend + 24 * dst[D_PITCH];
    const double basePitch = notePitch + 24 * dst[D_OSC_PITCH] + vib + 0.1 * card * cardTune;

    for (int n = 0; n < 2; n++) {
      OscState& o = osc[n];
      const auto& op = P.osc[n];
      const double p = basePitch + cur[op.semi] + cur[op.fine] / 100 + 24 * dst[n == 0 ? D_OSC1_PITCH : D_OSC2_PITCH];
      double center = toInc(p);
      while (center < 20 / fs) center *= 2;
      if (n == 0) syncInc = center;
      const int voices = o.voices;
      const double detune = clampd(cur[op.detune] + 100 * (dst[D_DETUNE] + dst[n == 0 ? D_OSC1_DETUNE : D_OSC2_DETUNE]), 0, 100);
      const double spread = cur[op.spread];
      if (voices == 1) {
        o.inc[0] = center;
      } else {
        const int last = voices - 1;
        for (int j = 0; j < voices; j++) {
          const double pos = (double)j / last - 0.5 + (j > 0 && j < last ? UNISON_SKEW[j] / last : 0);
          const double inc = center * std::pow(2.0, (detune * pos) / 1200);
          o.inc[j] = inc < 0.45 ? inc : 0.45;
        }
      }
      if (analog > 0) {
        for (int j = 0; j < voices; j++) {
          if (rng.next() > 0.996) o.driftTarget[j] = rng.next();
          o.drift[j] += (o.driftTarget[j] - o.drift[j]) * 0.003;
          const double a4 = analog * analog * analog * analog;
          const double cents = (j == 0 ? 2.5 * analog + 37.5 * a4 : 7 * analog + 53 * a4) * o.drift[j];
          o.inc[j] *= 1 + cents * 0.000577623;
        }
      }
      if (spread != o.lastSpread || voices != o.lastVoices) {
        for (int j = 0; j < voices; j++) {
          const double pos = voices == 1 ? 0 : (2.0 * j) / (voices - 1) - 1;
          const double a = ((pos * spread + 1) * PI) / 4;
          o.panL[j] = SQRT2 * std::cos(a);
          o.panR[j] = SQRT2 * std::sin(a);
        }
        o.lastSpread = spread;
        o.lastVoices = voices;
      }
      const double level = clampd(cur[op.level] + dst[n == 0 ? D_OSC1_LEVEL : D_OSC2_LEVEL], 0, 1);
      if (o.wave == WAVE_STRING) {
        o.gain = level;
        strPeriod[n] = 1 / center;
        const double t60 = 0.08 * std::pow(100.0, cur[P.strDecay]);
        strGain[n] = std::pow(10.0, (-3 * strPeriod[n]) / (t60 * fs));
      } else {
        o.gain = level / std::sqrt((double)voices);
      }
      // A / B shape (and A+B shape) move the Shape knob: pulse width, or the wavetable position below.
      const double shape = dst[n == 0 ? D_OSC1_PW : D_OSC2_PW] + dst[D_SHAPE];
      o.pw = clampd(cur[op.pw] + 0.45 * shape + 0.04 * analog * o.drift[0], 0.05, 0.95);
      double wt;
      if (o.wave == WAVE_SINE) wt = 0;
      else if (o.wave == WAVE_TRI) wt = (double)FRAMES_PER_SEGMENT / (FRAME_COUNT - 1);
      else wt = clampd(cur[op.wt] + dst[n == 0 ? D_OSC1_WT : D_OSC2_WT] + shape, 0, 1);
      const double fpos = wt * (FRAME_COUNT - 1);
      const int fa = std::min(FRAME_COUNT - 2, (int)std::floor(fpos));
      const int mip = mipForIncrement(o.inc[voices - 1]);
      o.baseA = (fa * MIP_LEVELS + mip) * TABLE_SIZE;
      o.baseB = ((fa + 1) * MIP_LEVELS + mip) * TABLE_SIZE;
      o.frac = fpos - fa;
      o.baseSaw = (SAW_FRAME * MIP_LEVELS + mip) * TABLE_SIZE;
    }
    for (int n = 0; n < 2; n++) {
      const SlotKind sk = oscSlot(cur[P.osc[n].fType]);
      double hz = cur[P.osc[n].hp];
      if (cur[P.osc[n].fKey] > 0.5) hz *= std::pow(2.0, (pitch + 12 * cur[P.octave] - KEYTRACK_CENTER) / 12);
      oscF[n].set(sk.kind, sk.p24, hz, fs);
    }
    routeA = cur[P.routeA] > 0.5;
    routeB = cur[P.routeB] > 0.5;
    routeS = cur[P.routeS] > 0.5 && cur[P.subDirect] < 0.5;
    {
      double hz = INFINITY;
      for (int n = 0; n < 2; n++) {
        const double t = cur[P.osc[n].fType];
        if (t <= 1 && cur[P.osc[n].hp] > 21) hz = std::fmin(hz, cur[P.osc[n].hp]);
      }
      const bool on = cur[P.postCut] > 0.5 && !routeS && hz < INFINITY;
      postCut.set(on ? 1 : 0, true, on ? hz : 20, fs);
    }
    subDirect = cur[P.subDirect] > 0.5;
    const bool bypass = !routeA || !routeB;
    if (bypass && !bypassOn) {
      upBL.reset();
      upBR.reset();
    }
    bypassOn = bypass;
    {
      const SlotKind sk = auxSlot(cur[P.subFType]);
      double hz = cur[P.subFCut];
      if (cur[P.subFKey] > 0.5) hz *= std::pow(2.0, (pitch + 12 * cur[P.octave] - KEYTRACK_CENTER) / 12);
      subF.set(sk.kind, sk.p24, hz, fs);
    }
    strTone = cur[P.strTone];

    double sInc = toInc(notePitch + 12 * cur[P.subOct] + 24 * dst[D_SUB_PITCH]);
    while (sInc < 20 / fs) sInc *= 2;
    while (sInc > 0.45) sInc *= 0.5;
    subInc = sInc;
    subLevel = clampd(cur[P.subLevel] + dst[D_SUB], 0, 1) * SUB_GAIN;
    noiseLevel = clampd(cur[P.noise] + dst[D_NOISE], 0, 1) * 0.5;

    // mixer drive (see voice.ts)
    const double md = cur[P.mixDrive];
    mixGain = 1 + 8 * md;
    mixComp = 1 / std::sqrt(mixGain);
    const double drive = clampd(cur[P.drive] + dst[D_DRIVE], 0, 1);
    driveMix = std::fmin(1, drive * 4);
    driveGain = 1 + 15 * drive * drive;
    driveComp = 1 / (1 + 0.6 * drive);

    accentAmt = cur[P.accent] * clampd((velocity - 0.6) / 0.4, 0, 1);
    const double res = clampd(cur[P.res] + dst[D_RES] + 0.15 * accentAmt, 0, 1);
    const double fsOs = fs * OS;
    double octs = (cur[P.keytrack] * (pitch + 12 * cur[P.octave] - KEYTRACK_CENTER)) / 12 +
                  6 * cur[P.envAmt] * cur[P.modEnvOn] * (1 + 1.5 * accentAmt) * modEnv.level + 6 * dst[D_CUTOFF] + 0.12 * analog * noteCutoffJitter + 0.3 * card * cardCut;
    if (filterType == FILTER_LPG) octs += 1.5 * std::log2(std::fmax(ampEnv.level, 0.002));
    const double fc = clampd(cur[P.cutoff] * std::pow(2.0, octs), 20, std::fmin(20000, fs * 0.45));
    const double gTarget = std::tan((PI * fc) / fsOs);
    fcNow = fc;
    resNow = res;
    fMix = cur[P.fMix];
    if (gPrevTarget < 0) g = gTarget;
    gStep = (gTarget - g) / (CONTROL_BLOCK * OS);
    gPrevTarget = gTarget;
    if (filterType == FILTER_LP) {
      k = 3.85 * res;
    } else if (filterType == FILTER_BP) {
      k = 1.4 * (1 - res) + 0.08;
    } else if (filterType == FILTER_DIODE) {
      k = 7.2 * res;
    } else if (filterType == FILTER_NOTCH) {
      k = 2 * (1 - res) + 0.05;
    } else if (filterType == FILTER_COMB) {
      combDelay = fsOs / fc;
      combFb = 0.96 * res;
    } else if (filterType == FILTER_LPG) {
      k = 1.4 - 1.1 * res;
    } else if (filterType == FILTER_HP) {
      k = 0.765 * (1 - res) + 0.05;
    } else if (filterType == FILTER_SEM) {
      k = 1.9 * (1 - res) + 0.12;
    } else {
      const double v = clampd(cur[P.vowel] + dst[D_VOWEL], 0, 1) * 4;
      const int vi = std::min(3, (int)std::floor(v));
      const double vf = v - vi;
      const double shift = std::sqrt(fc / 2000);
      for (int f = 0; f < 3; f++) {
        const double hz = VOWELS[vi][f] * std::pow(VOWELS[vi + 1][f] / VOWELS[vi][f], vf) * shift;
        fmtG[f] = std::tan((PI * clampd(hz, 40, fs * 0.45)) / fsOs);
      }
      fmtK = 1 / (3 + 15 * res);
    }


    subClip.setDrive(cur[P.subClip]);
    midClip.setDrive(cur[P.midClip]);

    const double ampTarget = clampd(1 + dst[D_AMP], 0, 2);
    ampModStep = (ampTarget - ampMod) / CONTROL_BLOCK;
    velGain = (1 - cur[P.velocity] * (1 - velocity)) * (1 + 0.4 * accentAmt) * (1 + 0.12 * card * cardLevel);
  }

  // ------------------------------------------------------------ audio rate

  /** One stereo sample of this voice (out[0], out[1]) and its clean sub (out[2]). */
  void render(double duck, double* out) {
    double l = 0, r = 0;
    ampMod += ampModStep;
    double* os = osOut;
    OscState& o1 = osc[0];
    OscState& o2 = osc[1];

    if (ampEnv.stage != 0) {
      const double env = ampEnv.tick();
      modEnv.tick();

      if (o1.gain > 0 && o1.wave >= WAVE_STRING) {
        const double s = specialOsc(0) * o1.gain;
        l += s;
        r += s;
      } else if (o1.gain > 0) {
        for (int j = 0; j < o1.voices; j++) {
          double ph = o1.phase[j] + o1.inc[j];
          ph -= std::floor(ph);
          o1.phase[j] = ph;
          const double s = oscSample(o1, ph) * o1.gain;
          l += s * o1.panL[j];
          r += s * o1.panR[j];
        }
      }
      if (oscF[0].active) {
        l = oscF[0].process(l, 0);
        r = oscF[0].process(r, 1);
      }
      const bool sepB = oscF[1].active || routeA != routeB;
      const double preL = l, preR = r;
      if (sepB) l = r = 0;
      if (o2.gain > 0 && o2.wave >= WAVE_STRING) {
        const double s = specialOsc(1) * o2.gain;
        l += s;
        r += s;
      } else if (o2.gain > 0 && syncOn) {
        double mp = syncPhase + syncInc;
        const bool wrapped = mp >= 1;
        double x = 0;
        if (wrapped) {
          mp -= 1;
          x = mp / syncInc;
        }
        syncPhase = mp;
        for (int j = 0; j < o2.voices; j++) {
          const double inc = o2.inc[j];
          double ph = o2.phase[j] + inc;
          double corr = 0;
          if (wrapped) {
            double at = ph - x * inc;
            at -= std::floor(at);
            const double jump = oscSample(o2, 0) - oscSample(o2, at);
            o2.held[j] += 0.5 * jump * x * x;
            corr = -0.5 * jump * (1 - x) * (1 - x);
            ph = x * inc;
          }
          ph -= std::floor(ph);
          o2.phase[j] = ph;
          const double now = oscSample(o2, ph) + corr;
          const double s = o2.held[j] * o2.gain;
          o2.held[j] = now;
          l += s * o2.panL[j];
          r += s * o2.panR[j];
        }
      } else if (o2.gain > 0) {
        for (int j = 0; j < o2.voices; j++) {
          double ph = o2.phase[j] + o2.inc[j];
          if (ph >= 1) ph -= 1;
          o2.phase[j] = ph;
          const double s = oscSample(o2, ph) * o2.gain;
          l += s * o2.panL[j];
          r += s * o2.panR[j];
        }
      }
      double byL = 0, byR = 0;
      if (sepB) {
        double bl = l, br = r;
        if (oscF[1].active) {
          bl = oscF[1].process(bl, 0);
          br = oscF[1].process(br, 1);
        }
        if (routeA && routeB) {
          l = preL + bl;
          r = preR + br;
        } else {
          l = (routeA ? preL : 0) + (routeB ? bl : 0);
          r = (routeA ? preR : 0) + (routeB ? br : 0);
          byL = (routeA ? 0 : preL) + (routeB ? 0 : bl);
          byR = (routeA ? 0 : preR) + (routeB ? 0 : br);
        }
      } else if (!routeA) {
        byL = l;
        byR = r;
        l = r = 0;
      }
      if (noiseLevel > 0) {
        const double nz = rng.next() * noiseLevel;
        l += nz;
        r += nz;
      }
      const double amp = env * velGain * duck;
      double sub = 0;
      subMix += subMix < subOn ? subRamp : subMix > subOn ? -subRamp : 0;
      if (subMix < 0) subMix = 0;
      else if (subMix > 1) subMix = 1;
      if (subLevel > 0 && subMix > 0) {
        double sp = subPhase + subInc;
        if (sp >= 1) sp -= 1;
        subPhase = sp;
        const int sw = subWave;
        if (sw == 0) sub = std::sin(TWO_PI * sp);
        else if (sw == 1) sub = 0.86 * (std::sin(TWO_PI * sp) + 0.3 * std::sin(2 * TWO_PI * sp));
        else if (sw == 2) sub = sp < 0.25 ? 4 * sp : sp < 0.75 ? 2 - 4 * sp : 4 * sp - 4;
        else if (sw == 5) sub = 0.8 * (1 - 2 * sp + polyBlep(sp, subInc));
        else {
          const double dt = subInc, w = sw == 4 ? 0.25 : 0.5;
          double sp2 = sp + 1 - w;
          if (sp2 >= 1) sp2 -= 1;
          sub = (sp < w ? 1 : -1) + polyBlep(sp, dt) - polyBlep(sp2, dt);
          if (sw == 4) sub = 0.8 * (sub + 0.5);
        }
        if (subF.active) sub = subF.process(sub);
        if (routeS) {
          const double s = sub * subLevel * subMix * SUB_ROUTE_GAIN;
          l += s;
          r += s;
          sub = 0;
        } else {
          sub *= subLevel * amp * subMix;
          if (subClip.knee > 0) {
            subClip.process(sub, 0, subLevel * velGain, clipOut);
            sub = clipOut[0];
          }
        }
      } else {
        subPhase += subInc;
        if (subPhase >= 1) subPhase -= 1;
      }

      l *= PRE_FILTER_GAIN;
      r *= PRE_FILTER_GAIN;

      upL.process(l);
      upR.process(r);
      if (bypassOn) {
        upBL.process(byL * PRE_FILTER_GAIN);
        upBR.process(byR * PRE_FILTER_GAIN);
        nonlinear(upL.out0, upR.out0, 0, upBL.out0, upBR.out0);
        nonlinear(upL.out1, upR.out1, 2, upBL.out1, upBR.out1);
      } else {
        nonlinear(upL.out0, upR.out0, 0, 0, 0);
        nonlinear(upL.out1, upR.out1, 2, 0, 0);
      }
      l = dnL.process(os[0], os[2]);
      r = dnR.process(os[1], os[3]);

      if (postCut.active) {
        l = postCut.process(l, 0);
        r = postCut.process(r, 1);
      }

      l = voiceDcL.process(l);
      r = voiceDcR.process(r);

      const double va = amp * ampMod * VOICE_GAIN;
      l *= va;
      r *= va;

      if (midClip.knee > 0) {
        midClip.process(l, r, MID_CLIP_REF * ampMod * VOICE_GAIN * velGain, clipOut);
        l = clipOut[0];
        r = clipOut[1];
      }

      subDelay[subDelayPos] = sub;
    } else {
      subDelay[subDelayPos] = 0;
      if (tail > 0) tail--;
    }
    int rp = subDelayPos - OVERSAMPLE_LATENCY;
    if (rp < 0) rp += 32;
    const double sub = subDelay[rp];
    subDelayPos = (subDelayPos + 1) & 31;
    if (subDirect) {
      out[0] = l;
      out[1] = r;
      out[2] = sub;
    } else {
      out[0] = l + sub;
      out[1] = r + sub;
      out[2] = 0;
    }
  }

 private:
  double toInc(double semis) const { return std::fmin(0.45, (440 * std::pow(2.0, (semis - 69) / 12)) / fs); }

  double readTable(int base, double ph) const {
    const double pos = ph * TABLE_SIZE;
    const int i = (int)pos;
    const double f = pos - i;
    const double a = table[base + i];
    return a + (table[base + ((i + 1) & TABLE_MASK)] - a) * f;
  }

  double specialOsc(int n) {
    return strings[n].process(strPeriod[n], strTone, strGain[n]) * 1.4;
  }

  // the analog-bowed saw (see voice.ts)
  double saw(int base, double ph) const {
    const double s = readTable(base, ph);
    if (sawBow == 0) return s;
    double r = ph + 0.5;
    if (r >= 1) r -= 1;
    return s + sawBow * r * (1 - r);
  }

  double oscSample(const OscState& o, double ph) const {
    switch (o.wave) {
      case WAVE_PWMSAW: {
        double p2 = ph - o.pw;
        if (p2 < 0) p2 += 1;
        const double sw = saw(o.baseSaw, ph);
        return 0.6 * sw + 0.35 * (sw - saw(o.baseSaw, p2));
      }
      case WAVE_SAW:
        return saw(o.baseSaw, ph);
      case WAVE_PULSE: {
        double p2 = ph - o.pw;
        if (p2 < 0) p2 += 1;
        return 0.5 * (saw(o.baseSaw, ph) - saw(o.baseSaw, p2));
      }
      default: {
        const double pos = ph * TABLE_SIZE;
        const int i = (int)pos;
        const double f = pos - i;
        const int i2 = (i + 1) & TABLE_MASK;
        const double a = table[o.baseA + i] + ((double)table[o.baseA + i2] - table[o.baseA + i]) * f;
        if (o.frac == 0) return a;
        const double b = table[o.baseB + i] + ((double)table[o.baseB + i2] - table[o.baseB + i]) * f;
        return a + (b - a) * o.frac;
      }
    }
  }

  double mixShape(double x, int ch) {
    const double u = mixGain * x;
    const double up = mixU[ch];
    const double fu = tanhIntegral(u);
    const double du = u - up;
    const double y = std::fabs(du) > 1e-5 ? (fu - mixF[ch]) / du : fastTanh(0.5 * (u + up));
    mixU[ch] = u;
    mixF[ch] = fu;
    return y * mixComp;
  }

  double driveShape(double x, int ch) {
    const double u = driveGain * x;
    const double up = driveU[ch];
    const double fu = tanhIntegral(u);
    const double du = u - up;
    const double y = std::fabs(du) > 1e-5 ? (fu - driveF[ch]) / du : fastTanh(0.5 * (u + up));
    driveU[ch] = u;
    driveF[ch] = fu;
    return y;
  }

  void nonlinear(double l, double r, int slot, double bl, double br) {
    if (mixGain > 1) {
      l = mixShape(l, 0);
      r = mixShape(r, 1);
    }
    if (driveMix > 0) {
      const double dc = driveComp, dm = driveMix;
      l += (driveShape(l, 0) * dc - l) * dm;
      r += (driveShape(r, 1) * dc - r) * dm;
    }
    const double dryL = l, dryR = r;
    g += gStep;
    const double gg = g;
    if (filterType == FILTER_LP) {
      const double G = gg / (1 + gg);
      l = ladL.processG(l, G, k);
      r = ladR.processG(r, G, k);
    } else if (filterType == FILTER_BP) {
      bpL[0].processSat(l, gg, k);
      bpL[1].processSat(bpL[0].bp * k, gg, k);
      l = bpL[1].bp * k * 1.5;
      bpR[0].processSat(r, gg, k);
      bpR[1].processSat(bpR[0].bp * k, gg, k);
      r = bpR[1].bp * k * 1.5;
    } else if (filterType == FILTER_DIODE) {
      l = diodeL.process(l, gg, k) * 1.4;
      r = diodeR.process(r, gg, k) * 1.4;
    } else if (filterType == FILTER_NOTCH) {
      notchL[0].processSat(l, gg, k);
      notchL[1].processSat(notchL[0].lp + notchL[0].hp, gg, k);
      l = notchL[1].lp + notchL[1].hp;
      notchR[0].processSat(r, gg, k);
      notchR[1].processSat(notchR[0].lp + notchR[0].hp, gg, k);
      r = notchR[1].lp + notchR[1].hp;
    } else if (filterType == FILTER_COMB) {
      l = combL.process(l, combDelay, combFb);
      r = combR.process(r, combDelay, combFb);
    } else if (filterType == FILTER_HP) {
      hpL[0].processSat(l, gg, 1.848);
      hpL[1].processSat(hpL[0].hp, gg, k);
      l = hpL[1].hp;
      hpR[0].processSat(r, gg, 1.848);
      hpR[1].processSat(hpR[0].hp, gg, k);
      r = hpR[1].hp;
    } else if (filterType == FILTER_SEM) {
      semL.processSat(l, gg, k);
      semR.processSat(r, gg, k);
      l = semL.lp;
      r = semR.lp;
    } else if (filterType == FILTER_LPG) {
      lpgL.processSat(l, gg, k);
      lpgR.processSat(r, gg, k);
      l = lpgL.lp;
      r = lpgR.lp;
    } else {
      double fl = 0, fr = 0;
      const double kk = fmtK;
      for (int f = 0; f < 3; f++) {
        fmtL[f].process(l, fmtG[f], kk);
        fmtR[f].process(r, fmtG[f], kk);
        fl += fmtL[f].bp * kk * FORMANT_GAIN[f];
        fr += fmtR[f].bp * kk * FORMANT_GAIN[f];
      }
      l = fl * 2.2;
      r = fr * 2.2;
    }
    if (fMix < 1) {
      l = dryL + (l - dryL) * fMix;
      r = dryR + (r - dryR) * fMix;
    }
    l *= POST_FILTER_GAIN;
    r *= POST_FILTER_GAIN;
    if (bypassOn) {
      l += bl * POST_FILTER_GAIN;
      r += br * POST_FILTER_GAIN;
    }
    osOut[slot] = l;
    osOut[slot + 1] = r;
  }

  const double fs;
  const double* cur;
  const float* table;
  Rng rng;
  const double* dstMask;

  bool hasPlayed = false;
  double subMix = 1, subRamp = 0;

  Envelope modEnv;
  std::array<double, SRC_COUNT> src{};
  std::array<double, LFO_COUNT> lfoFade{}, lfoProg{}, lfoRand{};

  OscState osc[2];
  DiodeLadder diodeL, diodeR;
  Comb combL, combR;
  KarplusString strings[2];
  double strPeriod[2] = {}, strGain[2] = {}, strTone = 0.5;
  double noteTime = 0, vibPhase = 0, vibRate = 5, accentAmt = 0, subPhase = 0;
  double syncPhase = 0, syncInc = 0;
  bool syncOn = false;
  std::array<double, 32> subDelay{};
  int subDelayPos = 0;
  double subInc = 0, subLevel = 0;
  int subWave = 0;
  Clipper subClip, midClip;
  double clipOut[2] = {};
  SlotFilter<2> oscF[2];
  SlotFilter<1> subF;
  SlotFilter<2> postCut;
  bool routeA = true, routeB = true, routeS = false, subDirect = true, bypassOn = false;
  Upsampler2x upBL, upBR;
  double fMix = 1, noiseLevel = 0;

  double mixGain = 1, mixComp = 1;
  std::array<double, 2> mixU{}, mixF{};
  double driveMix = 0, driveGain = 1, driveComp = 1;
  int filterType = FILTER_LP;
  double g = 0.1, gStep = 0, gPrevTarget = -1, k = 0;
  Ladder ladL, ladR;
  Svf hpL[2], hpR[2], notchL[2], notchR[2], lpgL, lpgR, semL, semR;
  double combDelay = 100, combFb = 0;
  Svf bpL[2], bpR[2], fmtL[3], fmtR[3];
  double fmtG[3] = {}, fmtK = 0.2;

  Upsampler2x upL, upR;
  Downsampler2x dnL, dnR;
  double osOut[4] = {};
  Biquad voiceDcL, voiceDcR;
  double analog = 0, noteCutoffJitter = 0, sawBow = 0;
  // the voice card (fixed per voice) and this note's envelope jitter (see voice.ts)
  double cardTune = 0, cardCut = 0, cardEnv = 0, cardLevel = 0, noteEnvJitter = 1;

  std::array<double, 2> driveU{}, driveF{};


  double ampMod = 1, ampModStep = 0, velGain = 1;
};

}  // namespace lt
