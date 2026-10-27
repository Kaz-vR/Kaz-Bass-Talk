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
#include "generated/Wobble.h"

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
/** texture.type index of air hit (the breath): the matrix's Breath destination moves its level. */
constexpr int TEX_BREATH = 4;
constexpr double KEYTRACK_CENTER = 48;

constexpr double PRE_FILTER_GAIN = 0.5;
constexpr double POST_FILTER_GAIN = 1.6;
constexpr double VOICE_GAIN = 0.55;
constexpr double SUB_GAIN = 0.55;

constexpr int WAVE_SINE = 0, WAVE_TRI = 1, WAVE_SAW = 2, WAVE_PULSE = 3, WAVE_PWMSAW = 5, WAVE_STRING = 6, WAVE_SHEPARD = 7;
constexpr int FILTER_LP = 0, FILTER_BP = 1, FILTER_DIODE = 3, FILTER_NOTCH = 4, FILTER_COMB = 5, FILTER_LPG = 6, FILTER_HP = 7;
constexpr int DIST_SOFT = 0, DIST_HARD = 1, DIST_FOLD = 2, DIST_FUZZ = 4;
constexpr double TUBE_BIAS = 0.4;
inline const double TUBE_OFFSET = std::tanh(TUBE_BIAS);
constexpr double HALF_PI = PI / 2;

inline const double TANH_INT_3 = 9.0 / 18 + (4.0 / 3) * std::log(12.0);
/** Antiderivative of fastTanh: x²/18 + (4/3)·ln(x² + 3) inside ±3, linear outside. */
inline double tanhIntegral(double x) {
  if (x > 3) return TANH_INT_3 + (x - 3);
  if (x < -3) return TANH_INT_3 + (-x - 3);
  const double x2 = x * x;
  return x2 / 18 + (4.0 / 3) * std::log(x2 + 3);
}

/** Fuzz: a guitar fuzz pedal's curve, piecewise linear so its antiderivative is exact (see params.ts). */
constexpr double FUZZ_DEAD = 0.1, FUZZ_SLOPE = 2.4, FUZZ_TOP = 1, FUZZ_BOTTOM = -0.55;
constexpr double FUZZ_VP = FUZZ_DEAD + FUZZ_TOP / FUZZ_SLOPE, FUZZ_VN = -FUZZ_DEAD + FUZZ_BOTTOM / FUZZ_SLOPE;
inline double fuzz(double v) {
  if (v > FUZZ_DEAD) return v >= FUZZ_VP ? FUZZ_TOP : FUZZ_SLOPE * (v - FUZZ_DEAD);
  if (v < -FUZZ_DEAD) return v <= FUZZ_VN ? FUZZ_BOTTOM : FUZZ_SLOPE * (v + FUZZ_DEAD);
  return 0;
}
inline double fuzzIntegral(double v) {
  const double h = 0.5 * FUZZ_SLOPE;
  if (v > FUZZ_DEAD) return v >= FUZZ_VP ? h * (FUZZ_VP - FUZZ_DEAD) * (FUZZ_VP - FUZZ_DEAD) + FUZZ_TOP * (v - FUZZ_VP) : h * (v - FUZZ_DEAD) * (v - FUZZ_DEAD);
  if (v < -FUZZ_DEAD) return v <= FUZZ_VN ? h * (FUZZ_VN + FUZZ_DEAD) * (FUZZ_VN + FUZZ_DEAD) + FUZZ_BOTTOM * (v - FUZZ_VN) : h * (v + FUZZ_DEAD) * (v + FUZZ_DEAD);
  return 0;
}
/** The fuzz's bias grows with the drive (a fraction of the input before the gain). */
constexpr double FUZZ_BIAS_REL = 0.12;

constexpr int LFO_SINE = 0, LFO_TRI = 1, LFO_SAW_UP = 2, LFO_SAW_DOWN = 3, LFO_SQUARE = 4, LFO_SH = 5, LFO_WANDER = 6;
constexpr int LFO_COUNT = 4;
constexpr int SLOT_COUNT = 12;
constexpr double SYNC_BEATS[16] = {0, 16, 8, 4, 2, 3, 1, 1.5, 2.0 / 3, 0.5, 0.75, 1.0 / 3, 0.25, 0.375, 1.0 / 6, 0.125};
constexpr double DELAY_BEATS[13] = {0.125, 1.0 / 6, 0.25, 0.375, 1.0 / 3, 0.5, 0.75, 2.0 / 3, 1, 1.5, 2, 3, 4};

constexpr int SRC_LFO1 = 1, SRC_LFO2 = 2, SRC_MOD_ENV = 3, SRC_AMP_ENV = 4, SRC_VEL = 5, SRC_KEY = 6, SRC_MODWHEEL = 7,
              SRC_RANDOM = 8, SRC_DRIFT = 9, SRC_PRODUCT = 10, SRC_LFO3 = 11, SRC_LFO4 = 12, SRC_DRIFT_SLOW = 13, SRC_ENV2 = 14,
              SRC_ENV3 = 15;
constexpr int SRC_COUNT = 16;
constexpr int D_PITCH = 1, D_OSC1_PITCH = 2, D_OSC2_PITCH = 3, D_OSC1_WT = 4, D_OSC2_WT = 5, D_OSC1_PW = 6, D_OSC2_PW = 7,
              D_OSC1_LEVEL = 8, D_OSC2_LEVEL = 9, D_DETUNE = 10, D_FM = 11, D_SUB = 12, D_NOISE = 13, D_DRIVE = 14,
              D_CUTOFF = 15, D_RES = 16, D_VOWEL = 17, D_DIST_DRIVE = 18, D_DIST_MIX = 19, D_AMP = 20, D_LFO1_RATE = 21,
              D_LFO2_RATE = 22, D_FM2 = 23, D_CRUSH = 24, D_LFO3_RATE = 25, D_LFO4_RATE = 26, D_CHORUS_DEPTH = 27,
              D_PHASER_MIX = 28, D_DELAY_TIME = 29, D_DELAY_MIX = 30, D_REVERB_MIX = 31, D_WIDTH = 32, D_TAPE_WOW = 33,
              D_DIST_TONE = 34, D_TEXTURE = 35, D_VIBRATO = 36, D_BREATH = 37, D_OSC_PITCH = 38, D_NOISE_PITCH = 39,
              D_SUB_PITCH = 40;
constexpr int DEST_COUNT = 41;
constexpr double TEXTURE_GAIN = 0.5;
/** Sound layers for solo / mute (Synth::setMonitor bit positions). */
constexpr int MON_OSC1 = 0, MON_OSC2 = 1, MON_SUB = 2, MON_NOISE = 3, MON_BREATH = 4, MON_TEXTURE = 5;

/** wobble.shape option indices with their own handling (the rest are WOB_TEMPLATE_ARRAYS). */
constexpr int WOB_RANDOM = 6, WOB_CUSTOM = 7;

inline bool wheelMovingDest(int d) {
  switch (d) {
    case D_NOISE: case D_BREATH: case D_VIBRATO: case D_TAPE_WOW: case D_DETUNE: case D_TEXTURE: case D_CRUSH:
    case D_PITCH: case D_OSC_PITCH: case D_LFO2_RATE: case D_CHORUS_DEPTH: case D_REVERB_MIX: case D_DELAY_MIX: case D_WIDTH:
      return true;
    default:
      return false;
  }
}

struct WheelStep { int dest; double amount; };
struct WheelMove { int count; WheelStep steps[6]; };
/** Mod wheel moves (wheel.preset option order): what a fully raised wheel adds to each destination. */
inline const WheelMove WHEEL_MOVES[8] = {
  {6, {{D_AMP, 0.2}, {D_CUTOFF, 0.22}, {D_DRIVE, 0.25}, {D_NOISE, 0.04}, {D_BREATH, 0.12}, {D_OSC_PITCH, 0.0008}}},    // pressure
  {6, {{D_DIST_DRIVE, 0.4}, {D_DRIVE, 0.3}, {D_RES, 0.22}, {D_DIST_TONE, 0.15}, {D_CUTOFF, 0.08}, {D_AMP, -0.15}}},   // snarl
  {4, {{D_CUTOFF, 0.42}, {D_DIST_TONE, 0.15}, {D_RES, 0.05}, {D_WIDTH, 0.15}}},                                      // open
  {6, {{D_CUTOFF, -0.26}, {D_WIDTH, -0.5}, {D_REVERB_MIX, -0.2}, {D_DELAY_MIX, -0.15}, {D_RES, 0.1}, {D_AMP, -0.1}}}, // choke
  {3, {{D_VIBRATO, 0.4}, {D_BREATH, 0.05}, {D_CUTOFF, 0.03}}},                                                       // vibrato
  {5, {{D_TAPE_WOW, 0.6}, {D_DETUNE, 0.15}, {D_CHORUS_DEPTH, 0.3}, {D_OSC_PITCH, -0.002}, {D_LFO2_RATE, 0.3}}},      // unstable
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

/** Parameter indices, resolved once from the generated schema (params.ts P). */
struct ParamIndex {
  struct Osc { int wave, semi, fine, pw, wt, voices, detune, spread, level, hp, fType, fKey; };
  struct Lfo { int shape, rate, sync, retrig, fade; };
  struct Slot { int src, dst, amt, on; };
  struct Eq { int type, freq, gain, q; };
  struct GrindStage { int on, filter, freq, range, move, rate, clock, vrange, res, dtype, drive, mix; };
  int legato, glide, octave, velocity, analog;
  Osc osc[2];
  int fmAmount, fmRatio, fmPunch, fmDecay, fmFb, fm2Amount, fm2Ratio, fmAlgo;
  int strTone, strDecay, shepRate, accent, ampBend[3], modBend[3], chorusMode;
  int subWave, subOct, subLevel, subClip, midClip, subFType, subFCut, subFKey, subDirect;
  int texPan, texDirect, texFType, texFCut, texFKey;
  int routeA, routeB, routeN, routeS, postCut, fMix, noise, drive;
  int texType, texLevel, texTone, texDensity, texOct, texKey, texTail;
  int fType, cutoff, res, keytrack, envAmt, modEnvOn, vowel;
  int dType, dDrive, dMix, dTone, dSplit, crushMix, crushBits, crushRate, crushLowcut, tapeLowcut, tapeDrive, tapeWow, tapeAge;
  int osc2Sync;
  int fmOn, driveOn, filterOn, distOn, crushOn, tapeOn, vibOn, lfoOn[4], env2On, env3On, wobOn, modOn, eqOn, chorusOn, flangerOn,
      phaserOn, delayOn, reverbOn;
  int wheelMove, wheelPreset;
  int wobDepth, wobRate, wobCutoff, wobVolume, wobShape, wobLife, wobPts, wobPhase, wobSmooth, wobLowcut, wobX[32], wobY[32], wobS[32];
  int flangerMix, flangerRate, flangerFb, delayMix, delayTime, delayFb, delayTone;
  int reverbType, reverbDecay, reverbPre, reverbOct, eqHighcut;
  int amp[4], mod[4], env3[4], vibDepth, vibRate, vibDelay, vibFade;
  Lfo lfo[4];
  int env2[4];
  Slot slots[SLOT_COUNT];
  int chorusMix, chorusDepth, phaserMix, phaserRate, reverbMix, fxLowcut[5], ottOn, ottDepth, ottLowcut;
  Eq eq[4];
  int eqScale, outGain, crossover, poly;
  int grindOn, grindMix, grindLowcut, grindKey, grindOneShot, grindOtt, grindSat, grindPreOtt;
  GrindStage grind[4];

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
    accent = ix("filter.accent"); chorusMode = ix("chorus.mode");
    const char* bends[3] = {"attack_bend", "decay_bend", "release_bend"};
    for (int b = 0; b < 3; b++) {
      ampBend[b] = ix(std::string("amp_env.") + bends[b]);
      modBend[b] = ix(std::string("mod_env.") + bends[b]);
    }
    subWave = ix("sub.wave"); subOct = ix("sub.octave"); subLevel = ix("sub.level"); subClip = ix("sub.clip"); midClip = ix("clip.mid");
    subFType = ix("sub.filter_type"); subFCut = ix("sub.filter_cutoff"); subFKey = ix("sub.filter_key"); subDirect = ix("sub.direct");
    texPan = ix("texture.pan"); texDirect = ix("texture.direct"); texFType = ix("texture.filter_type"); texFCut = ix("texture.filter_cutoff"); texFKey = ix("texture.filter_key");
    routeA = ix("filter.route_a"); routeB = ix("filter.route_b"); routeN = ix("filter.route_n"); routeS = ix("filter.route_s");
    postCut = ix("clip.low_cut"); fMix = ix("filter.mix");
    noise = ix("noise.level"); drive = ix("drive.amount");
    texType = ix("texture.type"); texLevel = ix("texture.level"); texTone = ix("texture.tone"); texDensity = ix("texture.density");
    texOct = ix("texture.octave"); texKey = ix("texture.key"); texTail = ix("texture.tail");
    fType = ix("filter.type"); cutoff = ix("filter.cutoff"); res = ix("filter.resonance"); keytrack = ix("filter.keytrack");
    envAmt = ix("filter.env_amount"); modEnvOn = ix("mod_env.on"); vowel = ix("filter.vowel");
    dType = ix("dist.type"); dDrive = ix("dist.drive"); dMix = ix("dist.mix"); dTone = ix("dist.post_tone"); dSplit = ix("dist.clean_below");
    crushMix = ix("crush.mix"); crushBits = ix("crush.bits"); crushRate = ix("crush.rate"); crushLowcut = ix("crush.lowcut"); tapeLowcut = ix("tape.lowcut");
    tapeDrive = ix("tape.drive"); tapeWow = ix("tape.wow"); tapeAge = ix("tape.age");
    osc2Sync = ix("osc2.sync");
    fmOn = ix("fm.on"); driveOn = ix("drive.on"); filterOn = ix("filter.on"); distOn = ix("dist.on"); crushOn = ix("crush.on");
    tapeOn = ix("tape.on"); vibOn = ix("vibrato.on");
    for (int n = 0; n < 4; n++) lfoOn[n] = ix("lfo" + std::to_string(n + 1) + ".on");
    env2On = ix("env2.on"); env3On = ix("env3.on"); wobOn = ix("wobble.on");
    modOn = ix("mod.on"); eqOn = ix("eq.on"); chorusOn = ix("chorus.on"); flangerOn = ix("flanger.on");
    phaserOn = ix("phaser.on"); delayOn = ix("delay.on"); reverbOn = ix("reverb.on");
    wheelMove = ix("wheel.move"); wheelPreset = ix("wheel.preset");
    wobDepth = ix("wobble.depth"); wobRate = ix("wobble.rate"); wobCutoff = ix("wobble.cutoff"); wobVolume = ix("wobble.volume");
    wobShape = ix("wobble.shape"); wobLife = ix("wobble.life"); wobPts = ix("wobble.points"); wobPhase = ix("wobble.phase");
    wobSmooth = ix("wobble.smooth"); wobLowcut = ix("wobble.lowcut");
    for (int i = 0; i < 32; i++) {
      const std::string k = std::to_string(i + 1);
      wobX[i] = ix("wobble.x" + k);
      wobY[i] = ix("wobble.y" + k);
      wobS[i] = ix("wobble.s" + k);
    }
    flangerMix = ix("flanger.mix"); flangerRate = ix("flanger.rate"); flangerFb = ix("flanger.feedback");
    delayMix = ix("delay.mix"); delayTime = ix("delay.time"); delayFb = ix("delay.feedback"); delayTone = ix("delay.tone");
    reverbType = ix("reverb.type"); reverbDecay = ix("reverb.decay"); reverbPre = ix("reverb.predelay"); reverbOct = ix("reverb.octave");
    eqHighcut = ix("eq.highcut");
    const char* stages[4] = {"attack", "decay", "sustain", "release"};
    for (int s = 0; s < 4; s++) {
      amp[s] = ix(std::string("amp_env.") + stages[s]);
      mod[s] = ix(std::string("mod_env.") + stages[s]);
      env2[s] = ix(std::string("env2.") + stages[s]);
      env3[s] = ix(std::string("env3.") + stages[s]);
    }
    vibDepth = ix("vibrato.depth"); vibRate = ix("vibrato.rate"); vibDelay = ix("vibrato.delay"); vibFade = ix("vibrato.fade");
    for (int n = 0; n < 4; n++) {
      const std::string l = "lfo" + std::to_string(n + 1) + ".";
      lfo[n] = {ix(l + "shape"), ix(l + "rate"), ix(l + "sync"), ix(l + "retrigger"), ix(l + "fade")};
    }
    for (int n = 0; n < SLOT_COUNT; n++) {
      const std::string m = "mod" + std::to_string(n + 1) + ".";
      slots[n] = {ix(m + "source"), ix(m + "dest"), ix(m + "amount"), ix(m + "on")};
    }
    chorusMix = ix("chorus.mix"); chorusDepth = ix("chorus.depth"); phaserMix = ix("phaser.mix"); phaserRate = ix("phaser.rate");
    reverbMix = ix("reverb.mix");
    ottOn = ix("ott.on"); ottDepth = ix("ott.depth"); ottLowcut = ix("ott.lowcut");
    const char* fx[5] = {"chorus", "flanger", "phaser", "delay", "reverb"};
    for (int k = 0; k < 5; k++) fxLowcut[k] = ix(std::string(fx[k]) + ".lowcut");
    for (int b = 0; b < 4; b++) {
      const std::string e = "eq.b" + std::to_string(b + 1) + "_";
      eq[b] = {ix(e + "type"), ix(e + "freq"), ix(e + "gain"), ix(e + "q")};
    }
    eqScale = ix("eq.scale");
    outGain = ix("output.gain"); crossover = ix("output.crossover"); poly = ix("voice.polyphony");
    grindOn = ix("grind.on"); grindMix = ix("grind.mix"); grindLowcut = ix("grind.lowcut"); grindKey = ix("grind.key");
    grindOneShot = ix("grind.oneshot"); grindOtt = ix("grind.ott"); grindSat = ix("grind.sat"); grindPreOtt = ix("grind.preott");
    for (int n = 0; n < 4; n++) {
      const std::string g = "grind" + std::to_string(n + 1) + ".";
      grind[n] = {ix(g + "on"), ix(g + "filter"), ix(g + "freq"), ix(g + "range"), ix(g + "move"), ix(g + "rate"), ix(g + "clock"),
                  ix(g + "vrange"), ix(g + "res"), ix(g + "drive_type"), ix(g + "drive"), ix(g + "mix")};
    }
  }
};

inline const ParamIndex& PI_() {
  static const ParamIndex p;
  return p;
}

}  // namespace lt
