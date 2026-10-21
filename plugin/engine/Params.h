// Engine constants (port of src/engine/core/params.ts): parameter indices,
// enum option indices, mod matrix sources/destinations, gain staging, the
// mod wheel's moves. Indices come from the generated schema, so the engine
// and data/schema.json can never disagree.
#pragma once
#include <array>
#include <cmath>
#include <cstring>
#include <stdexcept>
#include <string>
#include "Dsp.h"
#include "Wavetable.h"
#include "generated/Schema.h"

namespace lt {

constexpr int CONTROL_BLOCK = 16;
constexpr int MAX_UNISON = 7;
constexpr double DUCK_MS = 3;
constexpr double SMOOTH_MS = 15;
constexpr double LIMITER_CEILING_DB = -1;
constexpr double SUBSONIC_HZ = 15;
constexpr double SUBSONIC_Q[2] = {0.5412, 1.3066};
constexpr double VOICE_DC_HZ = 8;
constexpr int OS = 2;
constexpr double XO_Q[4] = {0.5098, 0.6013, 0.9000, 2.5629};
constexpr int SAW_FRAME = 2 * FRAMES_PER_SEGMENT;
constexpr double KEYTRACK_CENTER = 48;

constexpr double PRE_FILTER_GAIN = 0.5;
constexpr double POST_FILTER_GAIN = 1.6;
constexpr double VOICE_GAIN = 0.55;
constexpr double SUB_GAIN = 0.55;

constexpr int WAVE_SINE = 0, WAVE_TRI = 1, WAVE_SAW = 2, WAVE_PULSE = 3, WAVE_PWMSAW = 5, WAVE_STRING = 6, WAVE_SHEPARD = 7;
constexpr int FILTER_LP = 0, FILTER_BP = 1, FILTER_DIODE = 3, FILTER_NOTCH = 4, FILTER_COMB = 5, FILTER_LPG = 6;
constexpr int DIST_SOFT = 0, DIST_HARD = 1, DIST_FOLD = 2;
constexpr double TUBE_BIAS = 0.4;
inline const double TUBE_OFFSET = std::tanh(TUBE_BIAS);
constexpr double HALF_PI = PI / 2;

inline const double TANH_INT_3 = 9.0 / 18 + (4.0 / 3) * std::log(12.0);
inline double tanhIntegral(double x) {
  if (x > 3) return TANH_INT_3 + (x - 3);
  if (x < -3) return TANH_INT_3 + (-x - 3);
  const double x2 = x * x;
  return x2 / 18 + (4.0 / 3) * std::log(x2 + 3);
}

constexpr int LFO_SINE = 0, LFO_TRI = 1, LFO_SAW_UP = 2, LFO_SAW_DOWN = 3, LFO_SQUARE = 4, LFO_SH = 5, LFO_WANDER = 6;
constexpr int LFO_COUNT = 4;
constexpr int SLOT_COUNT = 12;
constexpr double SYNC_BEATS[16] = {0, 16, 8, 4, 2, 3, 1, 1.5, 2.0 / 3, 0.5, 0.75, 1.0 / 3, 0.25, 0.375, 1.0 / 6, 0.125};
constexpr double PUMP_BEATS[4] = {4, 2, 1, 0.5};
constexpr double DELAY_BEATS[13] = {0.125, 1.0 / 6, 0.25, 0.375, 1.0 / 3, 0.5, 0.75, 2.0 / 3, 1, 1.5, 2, 3, 4};

constexpr int SRC_LFO1 = 1, SRC_LFO2 = 2, SRC_MOD_ENV = 3, SRC_AMP_ENV = 4, SRC_VEL = 5, SRC_KEY = 6, SRC_MODWHEEL = 7,
              SRC_RANDOM = 8, SRC_DRIFT = 9, SRC_PRODUCT = 10, SRC_LFO3 = 11, SRC_LFO4 = 12, SRC_DRIFT_SLOW = 13, SRC_ENV2 = 14;
constexpr int SRC_COUNT = 15;
constexpr int D_PITCH = 1, D_OSC1_PITCH = 2, D_OSC2_PITCH = 3, D_OSC1_WT = 4, D_OSC2_WT = 5, D_OSC1_PW = 6, D_OSC2_PW = 7,
              D_OSC1_LEVEL = 8, D_OSC2_LEVEL = 9, D_DETUNE = 10, D_FM = 11, D_SUB = 12, D_NOISE = 13, D_DRIVE = 14,
              D_CUTOFF = 15, D_RES = 16, D_VOWEL = 17, D_DIST_DRIVE = 18, D_DIST_MIX = 19, D_AMP = 20, D_LFO1_RATE = 21,
              D_LFO2_RATE = 22, D_FM2 = 23, D_CRUSH = 24, D_LFO3_RATE = 25, D_LFO4_RATE = 26, D_CHORUS_DEPTH = 27,
              D_PHASER_MIX = 28, D_DELAY_TIME = 29, D_DELAY_MIX = 30, D_REVERB_MIX = 31, D_WIDTH = 32, D_TAPE_WOW = 33,
              D_DIST_TONE = 34, D_TEXTURE = 35, D_VIBRATO = 36, D_BREATH = 37;
constexpr int DEST_COUNT = 38;
constexpr double TEXTURE_GAIN = 0.5;
/** Sound layers for solo / mute (Synth::setMonitor bit positions). */
constexpr int MON_OSC1 = 0, MON_OSC2 = 1, MON_SUB = 2, MON_NOISE = 3, MON_CLICK = 4, MON_BREATH = 5, MON_TEXTURE = 6;

constexpr double WOBBLE_BEATS[8] = {2, 1, 2.0 / 3, 0.5, 1.0 / 3, 0.25, 1.0 / 6, 0.125};
constexpr int WOB_FILTER = 0, WOB_FILTER_DRIVE = 1, WOB_FILTER_DRIVE_TEXTURE = 2;
constexpr int WOB_SINE = 0, WOB_TRI = 1, WOB_SAW_DOWN = 2, WOB_SQUARE = 3;

inline bool wheelMovingDest(int d) {
  switch (d) {
    case D_NOISE: case D_BREATH: case D_VIBRATO: case D_TAPE_WOW: case D_DETUNE: case D_TEXTURE: case D_CRUSH:
    case D_PITCH: case D_LFO2_RATE: case D_CHORUS_DEPTH: case D_REVERB_MIX: case D_DELAY_MIX: case D_WIDTH:
      return true;
    default:
      return false;
  }
}

struct WheelStep { int dest; double amount; };
struct WheelMove { int count; WheelStep steps[6]; };
/** Mod wheel moves (wheel.preset option order): what a fully raised wheel adds to each destination. */
inline const WheelMove WHEEL_MOVES[8] = {
  {6, {{D_AMP, 0.2}, {D_CUTOFF, 0.22}, {D_DRIVE, 0.25}, {D_NOISE, 0.04}, {D_BREATH, 0.12}, {D_PITCH, 0.0008}}},        // pressure
  {6, {{D_DIST_DRIVE, 0.4}, {D_DRIVE, 0.3}, {D_RES, 0.22}, {D_DIST_TONE, 0.15}, {D_CUTOFF, 0.08}, {D_AMP, -0.15}}},   // snarl
  {4, {{D_CUTOFF, 0.42}, {D_DIST_TONE, 0.15}, {D_RES, 0.05}, {D_WIDTH, 0.15}}},                                      // open
  {6, {{D_CUTOFF, -0.26}, {D_WIDTH, -0.5}, {D_REVERB_MIX, -0.2}, {D_DELAY_MIX, -0.15}, {D_RES, 0.1}, {D_AMP, -0.1}}}, // choke
  {3, {{D_VIBRATO, 0.4}, {D_BREATH, 0.05}, {D_CUTOFF, 0.03}}},                                                       // vibrato
  {5, {{D_TAPE_WOW, 0.6}, {D_DETUNE, 0.15}, {D_CHORUS_DEPTH, 0.3}, {D_PITCH, -0.002}, {D_LFO2_RATE, 0.3}}},          // unstable
  {4, {{D_TAPE_WOW, 0.3}, {D_CRUSH, 0.35}, {D_DIST_TONE, -0.15}, {D_CUTOFF, -0.12}}},                               // decay
  {5, {{D_REVERB_MIX, 0.45}, {D_DELAY_MIX, 0.3}, {D_WIDTH, 0.45}, {D_CHORUS_DEPTH, 0.3}, {D_AMP, -0.2}}},        // bloom
};
constexpr int LFO_RATE_DEST[4] = {D_LFO1_RATE, D_LFO2_RATE, D_LFO3_RATE, D_LFO4_RATE};

constexpr double VOWELS[5][3] = {{730, 1090, 2440}, {530, 1840, 2480}, {270, 2290, 3010}, {570, 840, 2410}, {300, 870, 2240}};
constexpr double FORMANT_GAIN[3] = {1, 0.5, 0.25};

inline int paramIndex(const char* id) {
  for (int i = 0; i < PARAM_COUNT; i++)
    if (std::strcmp(PARAMS[i].id, id) == 0) return i;
  throw std::runtime_error(std::string("Unknown parameter: ") + id);
}

/** Parameter indices, resolved once from the generated schema. */
struct ParamIndex {
  struct Osc { int wave, semi, fine, pw, wt, voices, detune, spread, level, hp, fType, fKey; };
  struct Lfo { int shape, rate, sync, retrig, fade; };
  struct Slot { int src, dst, amt; };
  int legato, glide, octave, velocity, analog;
  Osc osc[2];
  int fmAmount, fmRatio, fmPunch, fmDecay, fmFb, fm2Amount, fm2Ratio, fmAlgo;
  int strTone, strDecay, shepRate, accent, ampCurve, chorusMode;
  int clickType, clickLevel, clickDecay, clickTone, subWave, subOct, subLevel, subClip, midClip, noise, drive;
  int texType, texLevel, texTone, texTail, texPosition;
  int subFType, subFCut, subFKey, subDirect, texPan, texDirect, texFType, texFCut, texFKey;
  int routeA, routeB, routeN, routeS, routeBr, routeCl, postCut, fat, fMix;
  int fType, cutoff, res, keytrack, envAmt, vowel;
  int dType, dDrive, dMix, dTone, dSplit, crushMix, crushBits, crushRate, tapeDrive, tapeWow, tapeAge;
  int compAmount, compSpeed, compPump, compPumpRate, osc2Sync;
  int fmOn, driveOn, filterOn, distOn, crushOn, tapeOn, vibOn, lfoOn[4], wobOn, modOn, dynOn, eqOn, chorusOn, flangerOn,
      phaserOn, delayOn, reverbOn;
  int wheelMove, wheelPreset, wobDepth, wobRate, wobTarget, wobShape, wobLife, ott;
  int flangerMix, flangerRate, flangerFb, delayMix, delayTime, delayFb, delayTone, reverbTone, eqHighcut;
  int amp[4], mod[4], peAmount, peDecay, vibDepth, vibRate, vibDelay, vibFade, chiff, chiffDecay, breath, breathTone;
  Lfo lfo[4];
  int env2[4];
  Slot slots[SLOT_COUNT];
  int chorusMix, chorusDepth, phaserMix, phaserRate, reverbMix, reverbSize, fxLowcut;
  int eqLow, eqMid, eqMidFreq, eqHigh, outGain, crossover, poly;

  ParamIndex() {
    auto ix = [](const std::string& s) { return paramIndex(s.c_str()); };
    legato = ix("voice.legato"); glide = ix("voice.glide"); octave = ix("voice.octave"); velocity = ix("voice.velocity"); analog = ix("voice.analog");
    for (int n = 0; n < 2; n++) {
      const std::string o = "osc" + std::to_string(n + 1) + ".";
      osc[n] = {ix(o + "wave"), ix(o + "semi"), ix(o + "fine"), ix(o + "pulse_width"), ix(o + "wt_pos"), ix(o + "unison_voices"),
                ix(o + "unison_detune"), ix(o + "unison_spread"), ix(o + "level"), ix(o + "highpass"),
                ix(o + "filter_type"), ix(o + "filter_key")};
    }
    fmAmount = ix("fm.amount"); fmRatio = ix("fm.ratio"); fmPunch = ix("fm.punch"); fmDecay = ix("fm.decay"); fmFb = ix("fm.feedback");
    fm2Amount = ix("fm2.amount"); fm2Ratio = ix("fm2.ratio"); fmAlgo = ix("fm.algorithm");
    strTone = ix("string.tone"); strDecay = ix("string.decay"); shepRate = ix("shepard.rate");
    accent = ix("filter.accent"); ampCurve = ix("amp_env.attack_curve"); chorusMode = ix("chorus.mode");
    clickType = ix("click.type"); clickLevel = ix("click.level"); clickDecay = ix("click.decay"); clickTone = ix("click.tone");
    subWave = ix("sub.wave"); subOct = ix("sub.octave"); subLevel = ix("sub.level"); subClip = ix("sub.clip"); midClip = ix("clip.mid"); noise = ix("noise.level"); drive = ix("drive.amount");
    texType = ix("texture.type"); texLevel = ix("texture.level"); texTone = ix("texture.tone"); texTail = ix("texture.tail"); texPosition = ix("texture.position");
    subFType = ix("sub.filter_type"); subFCut = ix("sub.filter_cutoff"); subFKey = ix("sub.filter_key"); subDirect = ix("sub.direct");
    texPan = ix("texture.pan"); texDirect = ix("texture.direct"); texFType = ix("texture.filter_type"); texFCut = ix("texture.filter_cutoff"); texFKey = ix("texture.filter_key");
    routeA = ix("filter.route_a"); routeB = ix("filter.route_b"); routeN = ix("filter.route_n"); routeS = ix("filter.route_s");
    routeBr = ix("filter.route_br"); routeCl = ix("filter.route_cl"); postCut = ix("clip.low_cut"); fat = ix("filter.fat"); fMix = ix("filter.mix");
    fType = ix("filter.type"); cutoff = ix("filter.cutoff"); res = ix("filter.resonance"); keytrack = ix("filter.keytrack");
    envAmt = ix("filter.env_amount"); vowel = ix("filter.vowel");
    dType = ix("dist.type"); dDrive = ix("dist.drive"); dMix = ix("dist.mix"); dTone = ix("dist.post_tone"); dSplit = ix("dist.clean_below");
    crushMix = ix("crush.mix"); crushBits = ix("crush.bits"); crushRate = ix("crush.rate");
    tapeDrive = ix("tape.drive"); tapeWow = ix("tape.wow"); tapeAge = ix("tape.age");
    compAmount = ix("comp.amount"); compSpeed = ix("comp.speed"); compPump = ix("comp.pump"); compPumpRate = ix("comp.pump_rate");
    osc2Sync = ix("osc2.sync");
    fmOn = ix("fm.on"); driveOn = ix("drive.on"); filterOn = ix("filter.on"); distOn = ix("dist.on"); crushOn = ix("crush.on");
    tapeOn = ix("tape.on"); vibOn = ix("vibrato.on");
    for (int n = 0; n < 4; n++) lfoOn[n] = ix("lfo" + std::to_string(n + 1) + ".on");
    wobOn = ix("wobble.on"); modOn = ix("mod.on"); dynOn = ix("dynamics.on"); eqOn = ix("eq.on"); chorusOn = ix("chorus.on");
    flangerOn = ix("flanger.on"); phaserOn = ix("phaser.on"); delayOn = ix("delay.on"); reverbOn = ix("reverb.on");
    wheelMove = ix("wheel.move"); wheelPreset = ix("wheel.preset");
    wobDepth = ix("wobble.depth"); wobRate = ix("wobble.rate"); wobTarget = ix("wobble.target"); wobShape = ix("wobble.shape"); wobLife = ix("wobble.life");
    ott = ix("ott.amount");
    flangerMix = ix("flanger.mix"); flangerRate = ix("flanger.rate"); flangerFb = ix("flanger.feedback");
    delayMix = ix("delay.mix"); delayTime = ix("delay.time"); delayFb = ix("delay.feedback"); delayTone = ix("delay.tone");
    reverbTone = ix("reverb.tone"); eqHighcut = ix("eq.highcut");
    const char* stages[4] = {"attack", "decay", "sustain", "release"};
    for (int s = 0; s < 4; s++) {
      amp[s] = ix(std::string("amp_env.") + stages[s]);
      mod[s] = ix(std::string("mod_env.") + stages[s]);
      env2[s] = ix(std::string("env2.") + stages[s]);
    }
    peAmount = ix("pitch_env.amount"); peDecay = ix("pitch_env.decay");
    vibDepth = ix("vibrato.depth"); vibRate = ix("vibrato.rate"); vibDelay = ix("vibrato.delay"); vibFade = ix("vibrato.fade");
    chiff = ix("breath.chiff"); chiffDecay = ix("breath.decay"); breath = ix("breath.level"); breathTone = ix("breath.tone");
    for (int n = 0; n < 4; n++) {
      const std::string l = "lfo" + std::to_string(n + 1) + ".";
      lfo[n] = {ix(l + "shape"), ix(l + "rate"), ix(l + "sync"), ix(l + "retrigger"), ix(l + "fade")};
    }
    for (int n = 0; n < SLOT_COUNT; n++) {
      const std::string m = "mod" + std::to_string(n + 1) + ".";
      slots[n] = {ix(m + "source"), ix(m + "dest"), ix(m + "amount")};
    }
    chorusMix = ix("chorus.mix"); chorusDepth = ix("chorus.depth"); phaserMix = ix("phaser.mix"); phaserRate = ix("phaser.rate");
    reverbMix = ix("reverb.mix"); reverbSize = ix("reverb.size"); fxLowcut = ix("fx.lowcut");
    eqLow = ix("eq.low_gain"); eqMid = ix("eq.mid_gain"); eqMidFreq = ix("eq.mid_freq"); eqHigh = ix("eq.high_gain");
    outGain = ix("output.gain"); crossover = ix("output.crossover"); poly = ix("voice.polyphony");
  }
};

inline const ParamIndex& PI_() {
  static const ParamIndex p;
  return p;
}

}  // namespace lt
