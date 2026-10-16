// One synth voice (port of src/engine/core/voice.ts): oscillators (+FM),
// noise and breath → [2× oversampled: drive → filter → distortion] →
// bitcrusher → tape → DC filter → amp, + transient + clean mono sub.
// Plugin addition: per-note MPE (bend, pressure, slide), zero unless an MPE
// controller sends it, so the sound is the prototype's otherwise.
#pragma once
#include <array>
#include <cmath>
#include <vector>
#include "Dsp.h"
#include "Fx.h"
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
  /** The main filter's current cutoff (Hz) and resonance, for the texture bed's copy of it. */
  double fcNow = 1000, resNow = 0;
  double velocity = 1;
  bool gate = false;
  long long order = 0;
  int tail = 0;
  double subOn = 1;
  Envelope ampEnv;
  std::array<double, DEST_COUNT> dst{};
  double tapeLpCoef = 1;
  // MPE: the MIDI channel this note came from (-1 = none) and its expression.
  int channel = -1;
  double mpeBend = 0;      // semitones
  double mpePressure = 0;  // 0..1
  double mpeSlide = 0.5;   // 0..1, 0.5 = neutral

  Voice(double fs_, const double* cur_, const float* table_, uint32_t seed, const double* dstMask_)
      : fs(fs_), cur(cur_), table(table_), rng(seed), dstMask(dstMask_),
        combL((int)std::ceil((fs_ * OS) / 20)), combR((int)std::ceil((fs_ * OS) / 20)),
        strings{KarplusString((int)std::ceil(fs_ / 15)), KarplusString((int)std::ceil(fs_ / 15))}, tape(fs_), subClip(fs_), midClip(fs_) {
    subRamp = 1 / (0.01 * fs);
    voiceDcL.setHighpass(VOICE_DC_HZ, SQRT1_2, fs);
    voiceDcR.setHighpass(VOICE_DC_HZ, SQRT1_2, fs);
    lfoFade.fill(1);
    driveF.fill(tanhIntegral(0));
  }

  bool active() const { return ampEnv.stage != 0; }

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
      const bool free = cur[P.analog] > 0.01;
      for (auto& o : osc)
        for (int j = 0; j < MAX_UNISON; j++)
          o.phase[j] = j == 0 ? 0 : free ? 0.5 * (rng.next() + 1) : std::fmod(j * 0.381966, 1.0);
      subPhase = 0;
      syncPhase = 0;
      osc[1].held.fill(0);
      fmPhase = 0;
      pmPrev = 0;
      ladL.reset();
      ladR.reset();
      upL.reset();
      upR.reset();
      dnL.reset();
      dnR.reset();
      diodeL.reset();
      diodeR.reset();
      fm2Phase = 0;
      fmPrevOut = 0;
    }
    noteCutoffJitter = rng.next();
    fmEnv = 1;
    const double noteHz = 440 * std::pow(2.0, (n + 12 * cur[P.octave] - 69) / 12);
    for (int k = 0; k < 2; k++) {
      if (cur[P.osc[k].wave] == WAVE_STRING) {
        const double hz = noteHz * std::pow(2.0, cur[P.osc[k].semi] / 12);
        strings[k].pluck(fs / hz);
      }
    }
    // The transient's pitch follows the sub's register (an octave above the sub, as at the default).
    if (cur[P.clickLevel] > 0) transient.trigger((int)cur[P.clickType], cur[P.clickDecay], cur[P.clickTone], noteHz * std::pow(2.0, cur[P.subOct] + 1), fs);
    ampEnv.trigger();
    modEnv.trigger();
    env2.trigger();
    pitchEnvLevel = 1;
    noteRandom = rng.next();
    for (int l = 0; l < 4; l++) lfoFade[l] = cur[P.lfo[l].fade] > 0 ? 0 : 1;
    noteTime = 0;
    vibPhase = 0.5 * (rng.next() + 1);
    vibRate = cur[P.vibRate] * (1 + 0.05 * rng.next());
    chiffEnv = 1;
  }

  void release() {
    gate = false;
    ampEnv.release();
    modEnv.release();
    env2.release();
  }

  void reset() {
    gate = false;
    ampEnv.reset();
    modEnv.reset();
    env2.reset();
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
    toneL = toneR = 0;
    upL.reset();
    upR.reset();
    dnL.reset();
    dnR.reset();
    voiceDcL.reset();
    voiceDcR.reset();
    for (auto& f : split) f.reset();
    diodeL.reset();
    diodeR.reset();
    for (auto& f : notchL) f.reset();
    for (auto& f : notchR) f.reset();
    lpgL.reset();
    lpgR.reset();
    combL.reset();
    combR.reset();
    for (auto& s : strings) s.reset();
    for (auto& s : shepards) s.reset();
    transient.reset();
    breathSvf.reset();
    crusher.reset();
    tape.reset();
    subClip.reset();
    midClip.reset();
    subDelay.fill(0);
    for (auto& f : oscF) f.reset();
    subF.reset();
    postCut.reset();
    upBL.reset();
    upBR.reset();
    fatL.reset();
    fatR.reset();
    tail = 0;
  }

  void applyDiscrete() {
    const auto& P = PI_();
    for (int n = 0; n < 2; n++) {
      osc[n].wave = (int)cur[P.osc[n].wave];
      osc[n].voices = (int)cur[P.osc[n].voices];
    }
    filterType = (int)cur[P.fType];
    distType = (int)cur[P.dType];
    adaaF[0] = curveIntegral(adaaU[0]);
    adaaF[1] = curveIntegral(adaaU[1]);
    subWave = (int)cur[P.subWave];
  }

  void control(const double* gsrc, double bend, const double* xdst) {
    const auto& P = PI_();
    ampEnv.set(cur[P.amp[0]], cur[P.amp[1]], cur[P.amp[2]], cur[P.amp[3]], fs, cur[P.ampCurve]);
    modEnv.set(cur[P.mod[0]], cur[P.mod[1]], cur[P.mod[2]], cur[P.mod[3]], fs);
    env2.set(cur[P.env2[0]], cur[P.env2[1]], cur[P.env2[2]], cur[P.env2[3]], fs / CONTROL_BLOCK);
    if (env2.stage != 0) env2.tick();

    const double glideMs = cur[P.glide];
    if (glideMs > 0.5) {
      const double c = 1 - std::exp((-CONTROL_BLOCK * 4.6) / ((glideMs / 1000) * fs));
      pitch += (note - pitch) * c;
    } else {
      pitch = note;
    }
    pitchEnvLevel *= std::exp((-CONTROL_BLOCK * 4.6) / ((cur[P.peDecay] / 1000) * fs));

    for (int i = 0; i < SRC_COUNT; i++) src[i] = gsrc[i];
    for (int l = 0; l < 4; l++) {
      if (lfoFade[l] < 1) {
        const double fadeMs = cur[P.lfo[l].fade];
        lfoFade[l] = fadeMs > 0 ? std::fmin(1, lfoFade[l] + (CONTROL_BLOCK * 1000) / (fadeMs * fs)) : 1;
      }
    }
    src[SRC_LFO1] *= lfoFade[0];
    src[SRC_LFO2] *= lfoFade[1];
    src[SRC_LFO3] *= lfoFade[2];
    src[SRC_LFO4] *= lfoFade[3];
    src[SRC_PRODUCT] = src[SRC_LFO1] * src[SRC_LFO2];
    src[SRC_MOD_ENV] = modEnv.level;
    src[SRC_AMP_ENV] = ampEnv.level;
    src[SRC_VEL] = velocity;
    src[SRC_KEY] = clampd((pitch - KEYTRACK_CENTER) / 24, -1, 1);
    src[SRC_RANDOM] = noteRandom;
    src[SRC_ENV2] = env2.level;
    for (int d = 0; d < DEST_COUNT; d++) dst[d] = xdst[d];
    for (int s = 0; s < SLOT_COUNT; s++) {
      const auto& slot = P.slots[s];
      const int d = (int)cur[slot.dst];
      if (d > 0) dst[d] += cur[slot.amt] * src[(int)cur[slot.src]];
    }
    // MPE: pressure plays the note harder (brighter, dirtier, louder); slide moves the brightness.
    if (mpePressure != 0 || mpeSlide != 0.5) {
      dst[D_CUTOFF] += 0.22 * mpePressure + 0.6 * (mpeSlide - 0.5);
      dst[D_DRIVE] += 0.25 * mpePressure;
      dst[D_AMP] += 0.15 * mpePressure;
    }
    if (dstMask)
      for (int d = 1; d < DEST_COUNT; d++) dst[d] *= dstMask[d];

    analog = cur[P.analog];
    syncOn = cur[P.osc2Sync] > 0.5;

    noteTime += CONTROL_BLOCK / fs;
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

    const double basePitch = pitch + 12 * cur[P.octave] + 2 * bend + mpeBend + cur[P.peAmount] * pitchEnvLevel + 24 * dst[D_PITCH] + vib;

    for (int n = 0; n < 2; n++) {
      OscState& o = osc[n];
      const auto& op = P.osc[n];
      const double p = basePitch + cur[op.semi] + cur[op.fine] / 100 + 24 * dst[n == 0 ? D_OSC1_PITCH : D_OSC2_PITCH];
      double center = toInc(p);
      while (center < 20 / fs) center *= 2;
      if (n == 0) syncInc = center;
      const int voices = o.voices;
      const double detune = clampd(cur[op.detune] + 100 * dst[D_DETUNE], 0, 100);
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
          const double cents = analog * (j == 0 ? 2.5 : 7) * o.drift[j];
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
      if (o.wave == WAVE_STRING || o.wave == WAVE_SHEPARD) {
        o.gain = level;
        strPeriod[n] = 1 / center;
        const double t60 = 0.08 * std::pow(100.0, cur[P.strDecay]);
        strGain[n] = std::pow(10.0, (-3 * strPeriod[n]) / (t60 * fs));
      } else {
        o.gain = level / std::sqrt((double)voices);
      }
      o.pw = clampd(cur[op.pw] + 0.45 * dst[n == 0 ? D_OSC1_PW : D_OSC2_PW], 0.05, 0.95);
      double wt;
      if (o.wave == WAVE_SINE) wt = 0;
      else if (o.wave == WAVE_TRI) wt = (double)FRAMES_PER_SEGMENT / (FRAME_COUNT - 1);
      else wt = clampd(cur[op.wt] + dst[n == 0 ? D_OSC1_WT : D_OSC2_WT], 0, 1);
      const double fpos = wt * (FRAME_COUNT - 1);
      const int fa = std::min(FRAME_COUNT - 2, (int)std::floor(fpos));
      const int mip = mipForIncrement(o.inc[voices - 1] * (n == 0 && fmActive ? 2 : 1));
      o.baseA = (fa * MIP_LEVELS + mip) * TABLE_SIZE;
      o.baseB = ((fa + 1) * MIP_LEVELS + mip) * TABLE_SIZE;
      o.frac = fpos - fa;
      o.baseSaw = (SAW_FRAME * MIP_LEVELS + mip) * TABLE_SIZE;
    }
    const double keyOct = std::pow(2.0, (pitch + 12 * cur[P.octave] - KEYTRACK_CENTER) / 12);
    for (int n = 0; n < 2; n++) {
      const SlotKind sk = oscSlot(cur[P.osc[n].fType]);
      double hz = cur[P.osc[n].hp];
      if (cur[P.osc[n].fKey] > 0.5) hz *= keyOct;
      oscF[n].set(sk.kind, sk.p24, hz, fs);
    }
    routeA = cur[P.routeA] > 0.5;
    routeB = cur[P.routeB] > 0.5;
    routeS = cur[P.routeS] > 0.5;
    routeBr = cur[P.routeBr] > 0.5;
    routeCl = cur[P.routeCl] > 0.5;
    {
      double hz = INFINITY;
      for (int n = 0; n < 2; n++) {
        const double t = cur[P.osc[n].fType];
        if (t <= 1 && cur[P.osc[n].hp] > 21) hz = std::fmin(hz, cur[P.osc[n].hp]);  // high 24 / high 12
      }
      const bool on = cur[P.postCut] > 0.5 && !routeS && hz < INFINITY;
      postCut.set(on ? SLOT_HP : SLOT_OFF, true, on ? hz : 20, fs);
    }
    subDirect = cur[P.subDirect] > 0.5;
    const bool bypass = !routeA || !routeB || !routeBr;
    if (bypass && !bypassOn) {
      upBL.reset();
      upBR.reset();
    }
    bypassOn = bypass;
    {
      const SlotKind sk = auxSlot(cur[P.subFType]);
      double hz = cur[P.subFCut];
      if (cur[P.subFKey] > 0.5) hz *= keyOct;
      subF.set(sk.kind, sk.p24, hz, fs);
    }
    strTone = cur[P.strTone];
    shepRate = (cur[P.shepRate] * 0.4) / fs;

    const double fmAmt = clampd(cur[P.fmAmount] + dst[D_FM], 0, 1);
    const double fm2 = clampd(cur[P.fm2Amount] + dst[D_FM2], 0, 1);
    fmIndex = fmAmt * fmAmt * 1.3;
    fmPunchIdx = cur[P.fmPunch] * 2;
    fm2Index = fm2 * fm2 * 1.3;
    fmFbAmt = cur[P.fmFb] * 0.3;
    fmAlgo = (int)cur[P.fmAlgo];
    fmEnvCoef = std::exp(-4.6 / ((cur[P.fmDecay] / 1000) * fs));
    fmActive = fmIndex > 0 || fmPunchIdx > 0 || fm2Index > 0;
    const double carrier = toInc(basePitch + cur[P.osc[0].semi]);
    fmInc = std::fmin(0.45, carrier * cur[P.fmRatio]);
    fm2Inc = std::fmin(0.45, carrier * cur[P.fm2Ratio]);
    clickLevel = cur[P.clickLevel];

    // The sub follows the played note (glide, bend, pitch envelope) but never the pitch modulation.
    const double subPitch = pitch + 12 * cur[P.octave] + 2 * bend + mpeBend + cur[P.peAmount] * pitchEnvLevel;
    double sInc = toInc(subPitch + 12 * cur[P.subOct]);
    while (sInc < 20 / fs) sInc *= 2;
    subInc = sInc;
    subLevel = clampd(cur[P.subLevel] + dst[D_SUB], 0, 1) * SUB_GAIN;
    noiseLevel = clampd(cur[P.noise] + dst[D_NOISE], 0, 1) * 0.5;
    chiffAmt = cur[P.chiff];
    breathLvl = clampd(cur[P.breath] + dst[D_BREATH], 0, 1);
    breathOn = chiffAmt > 0 || breathLvl > 0;
    if (breathOn) {
      breathG = std::tan((PI * std::fmin(500 * std::pow(16.0, cur[P.breathTone]), fs * 0.45)) / fs);
      chiffCoef = std::exp(-4.6 / ((cur[P.chiffDecay] / 1000) * fs));
    }

    const double drive = clampd(cur[P.drive] + dst[D_DRIVE], 0, 1);
    driveMix = std::fmin(1, drive * 4);
    driveGain = 1 + 15 * drive * drive;
    driveComp = 1 / (1 + 0.6 * drive);

    accentAmt = cur[P.accent] * clampd((velocity - 0.6) / 0.4, 0, 1);
    const double res = clampd(cur[P.res] + dst[D_RES] + 0.15 * accentAmt, 0, 1);
    const double fsOs = fs * OS;
    double octs = (cur[P.keytrack] * (pitch + 12 * cur[P.octave] - KEYTRACK_CENTER)) / 12 +
                  6 * cur[P.envAmt] * (1 + 1.5 * accentAmt) * modEnv.level + 6 * dst[D_CUTOFF] + 0.12 * analog * noteCutoffJitter;
    if (filterType == FILTER_LPG) octs += 1.5 * std::log2(std::fmax(ampEnv.level, 0.002));
    const double fc = clampd(cur[P.cutoff] * std::pow(2.0, octs), 20, std::fmin(20000, fs * 0.45));
    const double gTarget = std::tan((PI * fc) / fsOs);
    fcNow = fc;
    resNow = res;
    // Fat: a low shelf below the cutoff that grows with the resonance, and saturation, after the filter.
    fat = cur[P.fat];
    fMix = cur[P.fMix];
    if (fat > 0) {
      const double shelf = clampd(0.5 * fc, 40, 400);
      const double db = fat * (3 + 9 * res);
      fatL.setLowShelf(shelf, db, fsOs);
      fatR.setLowShelf(shelf, db, fsOs);
      fatDrive = 1 + 2 * fat;
    }
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

    const double dDrive = clampd(cur[P.dDrive] + dst[D_DIST_DRIVE], 0, 1);
    const double dMix = clampd(cur[P.dMix] + dst[D_DIST_MIX], 0, 1);
    distAmt = std::fmin(1, dDrive * 5) * dMix;
    distGain = 1 + 49 * dDrive * dDrive;
    const double dTone = clampd(cur[P.dTone] + dst[D_DIST_TONE], 0, 1);
    if (dTone != lastTone) {
      const double toneHz = 300 * std::pow(20000.0 / 300, dTone);
      toneCoef = 1 - std::exp((-TWO_PI * std::fmin(toneHz, fs * 0.45)) / fsOs);
      lastTone = dTone;
    }
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

    tapeWow = clampd(cur[P.tapeWow] + dst[D_TAPE_WOW], 0, 1);
    tapeOn = cur[P.tapeDrive] > 0 || tapeWow > 0 || cur[P.tapeAge] > 0;
    if (cur[P.tapeAge] != lastTapeAge) {
      const double hz = 20000 * std::pow(0.15, cur[P.tapeAge]);
      tapeLpCoef = 1 - std::exp((-TWO_PI * std::fmin(hz, fs * 0.45)) / fs);
      lastTapeAge = cur[P.tapeAge];
    }

    subClip.setDrive(cur[P.subClip]);
    midClip.setDrive(cur[P.midClip]);

    const double ampTarget = clampd(1 + dst[D_AMP], 0, 2);
    ampModStep = (ampTarget - ampMod) / CONTROL_BLOCK;
    velGain = (1 - cur[P.velocity] * (1 - velocity)) * (1 + 0.4 * accentAmt);
  }

  void render(double duck, double* out) {
    const auto& P = PI_();
    double l = 0, r = 0;
    ampMod += ampModStep;
    OscState& o1 = osc[0];
    OscState& o2 = osc[1];

    if (ampEnv.stage != 0) {
      const double env = ampEnv.tick();
      modEnv.tick();

      double dpm = 0;
      if (fmActive) {
        fmEnv *= fmEnvCoef;
        fm2Phase += fm2Inc;
        if (fm2Phase >= 1) fm2Phase -= 1;
        const double op2 = fm2Index > 0 ? fm2Index * std::sin(TWO_PI * fm2Phase) : 0;
        fmPhase += fmInc;
        if (fmPhase >= 1) fmPhase -= 1;
        const bool stack = fmAlgo == 0;
        const double op1 = std::sin(TWO_PI * (fmPhase + (stack ? op2 : 0) + fmFbAmt * fmPrevOut));
        fmPrevOut = op1;
        const double pm = (fmIndex + fmPunchIdx * fmEnv) * op1 + (stack ? 0 : op2);
        dpm = pm - pmPrev;
        pmPrev = pm;
      } else if (pmPrev != 0) {
        dpm = -pmPrev;
        pmPrev = 0;
      }

      if (o1.gain > 0 && o1.wave >= WAVE_STRING) {
        const double s = specialOsc(0, o1) * o1.gain;
        l += s;
        r += s;
      } else if (o1.gain > 0) {
        for (int j = 0; j < o1.voices; j++) {
          double ph = o1.phase[j] + o1.inc[j] + dpm;
          ph -= std::floor(ph);
          o1.phase[j] = ph;
          const double s = oscSample(o1, ph) * o1.gain;
          l += s * o1.panL[j];
          r += s * o1.panR[j];
        }
      } else if (dpm != 0) {
        for (int j = 0; j < o1.voices; j++) {
          const double ph = o1.phase[j] + o1.inc[j] + dpm;
          o1.phase[j] = ph - std::floor(ph);
        }
      }
      if (oscF[0].active) {
        l = oscF[0].process(l, 0);
        r = oscF[0].process(r, 1);
      }
      // Oscillator 2 sums on its own when it has a filter or a different routing.
      const bool sepB = oscF[1].active || routeA != routeB;
      const double preL = l, preR = r;
      if (sepB) l = r = 0;
      if (o2.gain > 0 && o2.wave >= WAVE_STRING) {
        const double s = specialOsc(1, o2) * o2.gain;
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
      // Routing: what goes through the drive and main filter, and what skips them.
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
      if (breathOn) {
        chiffEnv *= chiffCoef;
        const double ba = chiffAmt * chiffEnv + 0.5 * breathLvl;
        breathSvf.process(rng.next(), breathG, 1.1);
        const double b = breathSvf.bp * ba * 1.6;
        if (routeBr) {
          l += b;
          r += b;
        } else {
          byL += b;
          byR += b;
        }
      }
      // Click into the filter (C): level-matched to its usual place after the amp.
      if (routeCl && clickLevel > 0) {
        const double c = transient.process() * clickLevel * 1.5 / (PRE_FILTER_GAIN * POST_FILTER_GAIN);
        l += c;
        r += c;
      }
      // Sub: clean, mono, phase-stable (in poly mode only the lowest note carries it). Its own
      // filter and clip shape it; with "sub into filter" (S) it joins the oscillators instead.
      const double amp = env * velGain * duck;
      double sub = 0;
      subMix += subMix < subOn ? subRamp : subMix > subOn ? -subRamp : 0;
      if (subMix < 0) subMix = 0;
      else if (subMix > 1) subMix = 1;
      if (subLevel > 0 && subMix > 0) {
        double sp = subPhase + subInc;
        if (sp >= 1) sp -= 1;
        subPhase = sp;
        if (subWave == 0) sub = std::sin(TWO_PI * sp);
        else if (subWave == 1) sub = sp < 0.25 ? 4 * sp : sp < 0.75 ? 2 - 4 * sp : 4 * sp - 4;
        else {
          // Square, band-limited with polyBLEP at both edges.
          const double dt = subInc;
          double sp2 = sp + 0.5;
          if (sp2 >= 1) sp2 -= 1;
          sub = (sp < 0.5 ? 1 : -1) + polyBlep(sp, dt) - polyBlep(sp2, dt);
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
            double co[2];
            subClip.process(sub, 0, subLevel * velGain, co);
            sub = co[0];
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
      l = dnL.process(osOut[0], osOut[2]);
      r = dnR.process(osOut[1], osOut[3]);

      if (crushMix > 0) {
        crusher.process(l, r, crushMix, crushQ, crushRate, tmp);
        l = tmp[0];
        r = tmp[1];
      }
      if (tapeOn) {
        tape.process(l, r, cur[P.tapeDrive], tapeWow, cur[P.tapeAge], tapeLpCoef, env, tmp);
        l = tmp[0];
        r = tmp[1];
      }
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
        double co[2];
        midClip.process(l, r, MID_CLIP_REF * ampMod * VOICE_GAIN * velGain, co);
        l = co[0];
        r = co[1];
      }

      if (clickLevel > 0 && !routeCl) {
        const double c = transient.process() * clickLevel * velGain * duck * VOICE_GAIN * 1.5;
        l += c;
        r += c;
      }

      subDelay[subDelayPos] = sub;
    } else {
      subDelay[subDelayPos] = 0;
      if (tail > 0) tail--;
    }
    int rp = subDelayPos - OVERSAMPLE_LATENCY;
    if (rp < 0) rp += 32;
    const double subOut = subDelay[rp];
    subDelayPos = (subDelayPos + 1) & 31;
    // With direct out off the sub joins the voice and goes through the dynamics, effects and EQ.
    if (subDirect) {
      out[0] = l;
      out[1] = r;
      out[2] = subOut;
    } else {
      out[0] = l + subOut;
      out[1] = r + subOut;
      out[2] = 0;
    }
  }

 private:
  double fs;
  const double* cur;
  const float* table;
  Rng rng;
  const double* dstMask;
  bool hasPlayed = false;
  double noteRandom = 0, subMix = 1, subRamp = 0;
  Envelope modEnv, env2;
  double pitchEnvLevel = 0;
  std::array<double, SRC_COUNT> src{};
  std::array<double, 4> lfoFade{};
  std::array<OscState, 2> osc{};
  double fmPhase = 0, fmInc = 0, fmIndex = 0, pmPrev = 0, fm2Phase = 0, fm2Inc = 0, fm2Index = 0, fmFbAmt = 0, fmPrevOut = 0;
  double fmEnv = 0, fmEnvCoef = 0.99, fmPunchIdx = 0;
  int fmAlgo = 0;
  bool fmActive = false;
  Comb combL, combR;
  KarplusString strings[2];
  std::array<double, 2> strPeriod{}, strGain{};
  double strTone = 0.5;
  Shepard shepards[2];
  double shepRate = 0;
  Transient transient;
  double clickLevel = 0;
  double noteTime = 0, vibPhase = 0, vibRate = 5;
  Svf breathSvf;
  double breathG = 0.1, chiffEnv = 0, chiffCoef = 0.99, chiffAmt = 0, breathLvl = 0;
  bool breathOn = false;
  double accentAmt = 0, subPhase = 0, syncPhase = 0, syncInc = 0;
  bool syncOn = false;
  std::array<double, 32> subDelay{};
  int subDelayPos = 0;
  double subInc = 0, subLevel = 0;
  int subWave = 0;
  // Each oscillator's own filter slot, the sub's, and the oscillators' low cut after the dirt.
  SlotFilter<2> oscF[2];
  SlotFilter<1> subF;
  SlotFilter<2> postCut;
  bool routeA = true, routeB = true, routeS = false, routeBr = true, routeCl = false, subDirect = true;
  // Some source skips the drive and main filter: it gets its own oversampled path.
  bool bypassOn = false;
  Upsampler2x upBL, upBR;
  // Filter fat (low shelf + saturation after the filter) and mix (dry/filtered).
  double fat = 0, fatDrive = 1, fMix = 1;
  Biquad fatL, fatR;
  double noiseLevel = 0;

  double driveMix = 0, driveGain = 1, driveComp = 1;
  int filterType = FILTER_LP;
  double g = 0.1, gStep = 0, gPrevTarget = -1, k = 0;
  Ladder ladL, ladR;
  DiodeLadder diodeL, diodeR;
  Svf notchL[2], notchR[2], lpgL, lpgR;
  double combDelay = 100, combFb = 0;
  Svf bpL[2], bpR[2], fmtL[3], fmtR[3];
  std::array<double, 3> fmtG{};
  double fmtK = 0.2;

  Upsampler2x upL, upR;
  Downsampler2x dnL, dnR;
  double osOut[4] = {0, 0, 0, 0};
  Biquad voiceDcL, voiceDcR;
  double analog = 0, noteCutoffJitter = 0;

  int distType = DIST_SOFT;
  double distGain = 1, distAmt = 0, toneCoef = 1, toneL = 0, toneR = 0, lastTone = -1;
  double splitG = 0, lastSplit = std::nan("");
  std::array<double, 2> adaaU{}, driveU{}, driveF{}, adaaF{};
  Svf split[6];

  Crusher crusher;
  double crushQ = 128, crushRate = 1, crushMix = 0;
  Tape tape;
  Clipper subClip, midClip;
  double tapeWow = 0, lastTapeAge = -1;
  bool tapeOn = false;

  double ampMod = 1, ampModStep = 0, velGain = 1;
  double tmp[2] = {0, 0};

  double toInc(double semis) const { return std::fmin(0.45, (440 * std::pow(2.0, (semis - 69) / 12)) / fs); }

  double readTable(int base, double ph) const {
    const double pos = ph * TABLE_SIZE;
    const int i = (int)pos;
    const double f = pos - i;
    const double a = table[base + i];
    return a + (table[base + ((i + 1) & TABLE_MASK)] - a) * f;
  }

  double specialOsc(int n, OscState& o) {
    if (o.wave == WAVE_STRING) return strings[n].process(strPeriod[n], strTone, strGain[n]) * 1.4;
    return shepards[n].process(o.inc[0], shepRate);
  }

  double oscSample(const OscState& o, double ph) const {
    switch (o.wave) {
      case WAVE_PWMSAW: {
        double p2 = ph - o.pw;
        if (p2 < 0) p2 += 1;
        const double saw = readTable(o.baseSaw, ph);
        return 0.6 * saw + 0.35 * (saw - readTable(o.baseSaw, p2));
      }
      case WAVE_SAW:
        return readTable(o.baseSaw, ph);
      case WAVE_PULSE: {
        double p2 = ph - o.pw;
        if (p2 < 0) p2 += 1;
        return 0.5 * (readTable(o.baseSaw, ph) - readTable(o.baseSaw, p2));
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

  double curve(double u) const {
    switch (distType) {
      case DIST_SOFT: return fastTanh(u);
      case DIST_HARD: return u > 1 ? 1 : u < -1 ? -1 : u;
      case DIST_FOLD: return std::sin(HALF_PI * u);
      default: return fastTanh(u + TUBE_BIAS) - TUBE_OFFSET;
    }
  }

  double curveIntegral(double u) const {
    switch (distType) {
      case DIST_SOFT: return tanhIntegral(u);
      case DIST_HARD: return u > 1 ? u - 0.5 : u < -1 ? -u - 0.5 : 0.5 * u * u;
      case DIST_FOLD: return -std::cos(HALF_PI * u) / HALF_PI;
      default: return tanhIntegral(u + TUBE_BIAS) - TUBE_OFFSET * u;
    }
  }

  double shape(double x, int ch) {
    const double u = distGain * x;
    const double up = adaaU[ch];
    const double fu = curveIntegral(u);
    const double du = u - up;
    const double y = std::fabs(du) > 1e-5 ? (fu - adaaF[ch]) / du : curve(0.5 * (u + up));
    adaaU[ch] = u;
    adaaF[ch] = fu;
    return y;
  }

  void nonlinear(double l, double r, int slot, double bl, double br) {
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
      bpL[0].process(l, gg, k);
      bpL[1].process(bpL[0].bp * k, gg, k);
      l = bpL[1].bp * k * 1.5;
      bpR[0].process(r, gg, k);
      bpR[1].process(bpR[0].bp * k, gg, k);
      r = bpR[1].bp * k * 1.5;
    } else if (filterType == FILTER_DIODE) {
      l = diodeL.process(l, gg, k) * 1.4;
      r = diodeR.process(r, gg, k) * 1.4;
    } else if (filterType == FILTER_NOTCH) {
      notchL[0].process(l, gg, k);
      notchL[1].process(notchL[0].lp + notchL[0].hp, gg, k);
      l = notchL[1].lp + notchL[1].hp;
      notchR[0].process(r, gg, k);
      notchR[1].process(notchR[0].lp + notchR[0].hp, gg, k);
      r = notchR[1].lp + notchR[1].hp;
    } else if (filterType == FILTER_COMB) {
      l = combL.process(l, combDelay, combFb);
      r = combR.process(r, combDelay, combFb);
    } else if (filterType == FILTER_LPG) {
      lpgL.process(l, gg, k);
      lpgR.process(r, gg, k);
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
    // Mix (dry/filtered) and fat (body back below the cutoff, saturation).
    if (fMix < 1) {
      l = dryL + (l - dryL) * fMix;
      r = dryR + (r - dryR) * fMix;
    }
    if (fat > 0) {
      const double d = fatDrive;
      l = std::tanh(fatL.process(l) * d) / d;
      r = std::tanh(fatR.process(r) * d) / d;
    }
    l *= POST_FILTER_GAIN;
    r *= POST_FILTER_GAIN;
    // Sources that skip the drive and filter rejoin here.
    if (bypassOn) {
      l += bl * POST_FILTER_GAIN;
      r += br * POST_FILTER_GAIN;
    }

    if (distAmt > 0) {
      double lowL = 0, lowR = 0, hl = l, hr = r;
      if (splitG > 0) {
        split[0].processFixed(l);
        split[1].processFixed(split[0].lp);
        split[2].processFixed(split[0].hp);
        lowL = split[1].lp;
        hl = split[2].hp;
        split[3].processFixed(r);
        split[4].processFixed(split[3].lp);
        split[5].processFixed(split[3].hp);
        lowR = split[4].lp;
        hr = split[5].hp;
      }
      toneL += (shape(hl, 0) - toneL) * toneCoef;
      toneR += (shape(hr, 1) - toneR) * toneCoef;
      l = lowL + hl + (toneL - hl) * distAmt;
      r = lowR + hr + (toneR - hr) * distAmt;
    }
    osOut[slot] = l;
    osOut[slot + 1] = r;
  }
};

}  // namespace lt
