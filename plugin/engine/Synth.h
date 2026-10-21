// Low Talk synth engine (port of src/engine/core/synth.ts). Real-time rules:
// after construction nothing here allocates or locks. Patch changes arrive as
// a flat array in schema order and are smoothed; discrete switches duck.
//
// Plugin additions: notes carry their MIDI channel so MPE per-note bend,
// pressure and slide reach the right voice; the host's tempo and bar
// position drive the pump and wobble clock (setTempo / syncBeat).
#pragma once
#include <array>
#include <cmath>
#include <memory>
#include <string>
#include <vector>
#include "Dsp.h"
#include "Fx.h"
#include "Oversample.h"
#include "Params.h"
#include "Voice.h"
#include "VoiceFx.h"
#include "Wavetable.h"

namespace lt {

constexpr int MAX_VOICES = 8;

class Synth {
 public:
  const double sampleRate;
  double peak = 0;
  bool wheelFrozen = false;

  explicit Synth(double fs)
      : sampleRate(fs), chorus(fs), phaser(fs), reverb(fs), flanger(fs), delay(fs), ott(fs), limiter(fs, LIMITER_CEILING_DB) {
    const auto& P = PI_();
    smoothCoef = 1 - std::exp(-CONTROL_BLOCK / ((SMOOTH_MS / 1000) * fs));
    duckStep = 1 / ((DUCK_MS / 1000) * fs);
    postDcR = 1 - (2 * PI * 5) / fs;
    for (int i = 0; i < PARAM_COUNT; i++) {
      isLog[i] = PARAMS[i].curve == 1;
      isDiscrete[i] = PARAMS[i].type != PType::Float;
      raw[i] = target[i] = cur[i] = PARAMS[i].def;
    }
    dstMask.fill(1);
    const float* table = getWavetable().data();
    for (int i = 0; i < MAX_VOICES; i++)
      voices.push_back(std::make_unique<Voice>(fs, cur.data(), table, 0x2468aceu + 0x9e3779bu * (uint32_t)i, dstMask.data()));
    for (int i = 0; i < 2; i++) {
      dcL[i].setHighpass(SUBSONIC_HZ, SUBSONIC_Q[i], fs);
      dcR[i].setHighpass(SUBSONIC_HZ, SUBSONIC_Q[i], fs);
    }
    lastFx.fill(std::nan(""));
    for (int l = 0; l < LFO_COUNT; l++) {
      lfoPrev[l] = rng.next();
      lfoHold[l] = rng.next();
    }
    (void)P;
    applyDiscrete();
    control();
  }

  int latency() const { return limiter.lookahead - 1 + OVERSAMPLE_LATENCY; }
  double takeLimiterMinGain() {
    const double g = limiter.minGain;
    limiter.minGain = 1;
    return g;
  }

  void setParams(const double* values, bool immediate = false) {
    for (int i = 0; i < PARAM_COUNT; i++) raw[i] = values[i];
    resolve();
    if (immediate || !anyActive()) {
      cur = target;
      applyDiscrete();
    }
  }
  void setParam(int index, double value) {
    raw[index] = value;
    resolve();
  }
  /** Solo / mute sound layers (bit masks of MON_*): with any solo, only soloed layers play. */
  void setMonitor(int solo, int mute) {
    monSolo = solo;
    monMute = mute;
    resolve();
    if (!anyActive()) {
      cur = target;
      applyDiscrete();
      texMon = texMonTarget;
    }
  }
  void setTempo(double bpm) { tempo = clampd(bpm, 20, 400); }
  void syncBeat(double beat) { beatPos = beat - 4 * std::floor(beat / 4); }
  void pitchBend(double v) { bend = clampd(v, -1, 1); }
  void setModWheel(double v) { modWheel = clampd(v, 0, 1); }

  // ---------------------------------------------------------------- MPE
  void setChannelBend(int ch, double semis) {
    for (auto& v : voices) if (v->channel == ch) v->mpeBend = semis;
    if (ch >= 0 && ch < 16) chBend[ch] = semis;
  }
  void setChannelPressure(int ch, double p) {
    for (auto& v : voices) if (v->channel == ch && v->gate) v->mpePressure = clampd(p, 0, 1);
    if (ch >= 0 && ch < 16) chPressure[ch] = clampd(p, 0, 1);
  }
  void setChannelSlide(int ch, double s) {
    for (auto& v : voices) if (v->channel == ch && v->gate) v->mpeSlide = clampd(s, 0, 1);
    if (ch >= 0 && ch < 16) chSlide[ch] = clampd(s, 0, 1);
  }
  /** Forget per-channel expression (MPE switched off or reset). */
  void clearChannelExpression() {
    for (int c = 0; c < 16; c++) {
      chBend[c] = 0;
      chPressure[c] = 0;
      chSlide[c] = 0.5;
    }
    for (auto& v : voices) {
      v->mpeBend = 0;
      v->mpePressure = 0;
      v->mpeSlide = 0.5;
    }
  }

  void noteOn(int note, double velocity = 0.8, int channel = -1) {
    if (velocity <= 0) {
      noteOff(note, channel);
      return;
    }
    if (poly <= 1) {
      removeFromStack(note);
      if (stackLen < (int)stack.size()) stack[stackLen++] = note;
      Voice& v = *voices[0];
      monoStart(note, velocity, v.gate, channel);
      return;
    }
    Voice* pick = nullptr;
    for (int i = 0; i < poly; i++) {
      Voice& v = *voices[i];
      if (v.gate && v.note == note && (channel < 0 || v.channel == channel)) {
        pick = &v;
        break;
      }
    }
    if (!pick)
      for (int i = 0; i < poly; i++) {
        Voice& v = *voices[i];
        if (!v.active() && v.tail == 0) {
          pick = &v;
          break;
        }
      }
    if (!pick) {
      Voice* best = nullptr;
      for (int i = 0; i < poly; i++) {
        Voice& v = *voices[i];
        if (!v.gate && (!best || v.order < best->order)) best = &v;
      }
      if (!best)
        for (int i = 0; i < poly; i++) {
          Voice& v = *voices[i];
          if (!best || v.order < best->order) best = &v;
        }
      pick = best;
    }
    if (!pick) return;
    const bool fresh = !pick->active();
    assignChannel(*pick, channel);
    pick->start(note, velocity, false, true, ++order);
    onTrigger();
    if (fresh) pick->control(gsrc.data(), bend, xdst.data());
  }

  void noteOff(int note, int channel = -1) {
    if (poly <= 1) {
      const bool wasCurrent = stackLen > 0 && stack[stackLen - 1] == note;
      removeFromStack(note);
      if (!wasCurrent) return;
      if (stackLen > 0) monoStart(stack[stackLen - 1], voices[0]->velocity, true, voices[0]->channel);
      else voices[0]->release();
      return;
    }
    for (auto& v : voices)
      if (v->gate && v->note == note && (channel < 0 || v->channel == channel)) v->release();
  }

  void allNotesOff() {
    stackLen = 0;
    for (auto& v : voices) v->release();
  }

  void panic() {
    allNotesOff();
    for (auto& v : voices) v->reset();
    for (int i = 0; i < 3; i++) {
      eqL[i].reset();
      eqR[i].reset();
    }
    hpL.reset();
    hpR.reset();
    for (auto& x : xo) x.reset();
    for (auto& x : xoPost) x.reset();
    chorus.reset();
    phaser.reset();
    reverb.reset();
    limiter.reset();
    postDcXL = postDcYL = postDcXR = postDcYR = 0;
    for (int i = 0; i < 2; i++) {
      dcL[i].reset();
      dcR[i].reset();
    }
    texture.reset();
    texEnv = texLpL = texLpR = 0;
    texF.reset();
    texNL.reset();
    texNR.reset();
    wobCycle = -1;
    wobScale = wobScaleTarget = 1;
    wobBright = wobBrightTarget = 0;
    hcL.reset();
    hcR.reset();
    comp.reset();
    ott.reset();
    flanger.reset();
    delay.reset();
  }

  bool idle() const { return !anyActive(); }

  /** Render `frames` samples into outL/outR starting at `offset`. Allocation-free. */
  void render(float* outL, float* outR, int offset, int frames) {
    const auto& P = PI_();
    const int end = offset + frames;
    double pk = peak;
    for (int n = offset; n < end; n++) {
      if (ctrlCount == 0) {
        control();
        ctrlCount = CONTROL_BLOCK;
      }
      ctrlCount--;

      if (duckDir < 0) {
        duckGain -= duckStep;
        if (duckGain <= 0) {
          duckGain = 0;
          copyDiscrete();
          duckDir = 1;
          duckHold = 2 * OVERSAMPLE_LATENCY + 8;
        }
      } else if (duckHold > 0) {
        duckHold--;
      } else if (duckDir > 0) {
        duckGain += duckStep;
        if (duckGain >= 1) {
          duckGain = 1;
          duckDir = 0;
        }
      }

      double l = 0, r = 0, sub = 0;
      outGain += outGainStep;
      for (int i = 0; i < MAX_VOICES; i++) {
        Voice& v = *voices[i];
        if (v.ampEnv.stage != 0 || v.tail > 0) {
          v.render(duckGain, vout);
          l += vout[0];
          r += vout[1];
          sub += vout[2];
        }
      }

      if (texMon != texMonTarget) {
        const double kk = 1 / (0.005 * sampleRate);
        texMon += std::fmax(-kk, std::fmin(kk, texMonTarget - texMon));
      }
      double texL = 0, texR = 0;
      if (texGain > 0 && (anyGate || texEnv > 1e-5)) {
        texEnv = anyGate ? texEnv + (1 - texEnv) * texAtk : texEnv * texRel;
        texture.process(texType, texTone, sampleRate, tmp);
        double tl = tmp[0], tr = tmp[1];
        if (cur[P.tapeAge] > 0) {
          texLpL += (tl - texLpL) * texLpCoef;
          texLpR += (tr - texLpR) * texLpCoef;
          tl = texLpL;
          tr = texLpR;
        }
        if (texF.active) {
          tl = texF.process(tl, 0);
          tr = texF.process(tr, 1);
        }
        if (texRouteN) {
          texNL.process(tl, texNG, texNK);
          texNR.process(tr, texNG, texNK);
          const int m = texNMode;
          tl = m == 1 ? texNL.bp : m == 2 ? texNL.lp + texNL.hp : texNL.lp;
          tr = m == 1 ? texNR.bp : m == 2 ? texNR.lp + texNR.hp : texNR.lp;
        }
        if (texPanOn) {
          tl *= texPanL;
          tr *= texPanR;
        }
        const double tg = texGain * texEnv * duckGain * texMon;
        texL = tl * tg;
        texR = tr * tg;
      } else if (!anyGate) {
        texEnv = 0;
      }
      const bool texPost = cur[P.texPosition] > 0.5;
      // Direct out: the bed joins the clean sub after every effect.
      if (!texDirect && !texPost) {
        l += texL;
        r += texR;
      }

      if (compOn) {
        comp.process(l, r, tmp);
        l = tmp[0];
        r = tmp[1];
      }
      if (ottOn) {
        ott.process(l, r, tmp);
        l = tmp[0];
        r = tmp[1];
      }
      if (texPost && !texDirect) {
        l += texL;
        r += texR;
      }

      const double hl = hpL.process(l);
      const double hr = hpR.process(r);
      double xl = hl, xr = hr;
      const double cMix = cur[P.chorusMix];
      if (cMix > 1e-4) {
        chorus.process(xl, xr, cMix, chorusDepth, tmp, cur[P.chorusMode] > 0.5);
        xl = tmp[0];
        xr = tmp[1];
      }
      const double fMix = cur[P.flangerMix];
      if (fMix > 1e-4) {
        flanger.process(xl, xr, fMix, cur[P.flangerRate], cur[P.flangerFb], tmp);
        xl = tmp[0];
        xr = tmp[1];
      }
      if (phaserMix > 1e-4) {
        phaser.process(xl, xr, phaserMix, cur[P.phaserRate], tmp);
        xl = tmp[0];
        xr = tmp[1];
      }
      if (delayMix > 1e-4) {
        delay.process(xl, xr, delaySeconds, cur[P.delayFb], delayToneCoef, tmp);
        xl += tmp[0] * delayMix;
        xr += tmp[1] * delayMix;
      }
      if (reverbMix > 1e-4) {
        reverb.process(0.5 * (xl + xr), cur[P.reverbSize], cur[P.reverbTone], tmp);
        xl += tmp[0] * reverbMix;
        xr += tmp[1] * reverbMix;
      }
      l = l - hl + xl;
      r = r - hr + xr;

      for (int b = 0; b < 3; b++)
        if (eqOn[b]) {
          l = eqL[b].process(l);
          r = eqR[b].process(r);
        }
      if (highcutOn) {
        l = hcL.process(l);
        r = hcR.process(r);
      }
      l += sub;
      r += sub;
      if (texDirect) {
        l += texL;
        r += texR;
      }
      l = dcL[1].process(dcL[0].process(l));
      r = dcR[1].process(dcR[0].process(r));

      const double m = 0.5 * (l + r);
      width += widthStep;
      const double s = width * xo[3].process(xo[2].process(xo[1].process(xo[0].process(0.5 * (l - r)))));
      l = (m + s) * outGain;
      r = (m - s) * outGain;

      if (!(std::fabs(l) < 1e6) || !(std::fabs(r) < 1e6)) {
        panic();
        l = r = 0;
      }

      limiter.process(l, r, tmp);
      {
        const double pm = 0.5 * (tmp[0] + tmp[1]);
        const double ps = xoPost[1].process(xoPost[0].process(0.5 * (tmp[0] - tmp[1])));
        tmp[0] = pm + ps;
        tmp[1] = pm - ps;
      }
      const double c = limiter.ceiling;
      double yl = tmp[0] - postDcXL + postDcR * postDcYL;
      postDcXL = tmp[0];
      postDcYL = yl;
      double yr = tmp[1] - postDcXR + postDcR * postDcYR;
      postDcXR = tmp[1];
      postDcYR = yr;
      yl = yl > c ? c : yl < -c ? -c : yl;
      yr = yr > c ? c : yr < -c ? -c : yr;
      outL[n] = (float)yl;
      outR[n] = (float)yr;
      const double a = std::fabs(yl) > std::fabs(yr) ? std::fabs(yl) : std::fabs(yr);
      if (a > pk) pk = a;
    }
    peak = pk;
  }

 private:
  std::array<double, PARAM_COUNT> target{}, cur{}, raw{};
  std::array<double, DEST_COUNT> dstMask{};
  std::array<bool, PARAM_COUNT> isLog{}, isDiscrete{};
  double smoothCoef = 0, duckGain = 1, duckStep = 0;
  int duckDir = 0, duckHold = 0;

  std::vector<std::unique_ptr<Voice>> voices;
  int poly = 1;
  long long order = 0;
  std::array<int, 16> stack{};
  int stackLen = 0;
  double bend = 0, modWheel = 0, wheel = 0;
  double texMon = 1, texMonTarget = 1;
  int monSolo = 0, monMute = 0;
  std::array<double, DEST_COUNT> xdst{};
  Rng wobRng{0x60bb1e};
  long long wobCycle = -1;
  double wobScale = 1, wobScaleTarget = 1, wobBright = 0, wobBrightTarget = 0, wobTexTone = 0;
  double tempo = 120;
  std::array<double, 16> chBend{}, chPressure{}, chSlide{0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5};

  std::array<double, LFO_COUNT> lfoPhase{}, lfoValue{}, lfoHold{}, lfoPrev{};
  std::array<double, SRC_COUNT> gsrc{};
  Rng rng{0x1234567};
  double driftVal = 0, driftTarget = 0;
  int driftCount = 0;
  double slowA = 0, slowB = 0, slowPos = 1, slowStep = 0;

  Texture texture;
  double texEnv = 0, texGain = 0;
  int texType = 0;
  double texTone = 0.4, texAtk = 0.001, texRel = 0.999, texLpL = 0, texLpR = 0, texLpCoef = 1;
  bool anyGate = false;
  // The bed's own filter, its copy of the main filter (N), pan and direct out.
  SlotFilter<2> texF;
  Svf texNL, texNR;
  bool texRouteN = false, texPanOn = false, texDirect = false;
  double texNG = 0.1, texNK = 1.4, texPanL = 1, texPanR = 1;
  int texNMode = 0;  // 0 low, 1 band, 2 notch

  Compressor comp;
  bool compOn = false, ottOn = false;
  double beatPos = 0;

  Chorus chorus;
  Phaser phaser;
  Reverb reverb;
  Flanger flanger;
  Delay delay;
  Ott ott;
  Limiter limiter;
  double delaySeconds = 0.375, delayToneCoef = 0.5;
  double chorusDepth = 0, phaserMix = 0, delayMix = 0, reverbMix = 0, width = 1, widthStep = 0, widthTarget = 1;
  Biquad hcL, hcR;
  bool highcutOn = false;
  std::array<bool, 3> eqOn{};
  Biquad hpL, hpR;
  Biquad eqL[3], eqR[3], dcL[2], dcR[2], xo[4], xoPost[2];
  double outGain = 1, outGainStep = 0, postDcXL = 0, postDcYL = 0, postDcXR = 0, postDcYR = 0, postDcR = 0;
  double outTarget = 1, lastOutDb = std::nan("");
  std::array<double, 8> lastFx{};
  double tmp[2] = {0, 0}, vout[3] = {0, 0, 0};
  int ctrlCount = 0;

  bool anyActive() const {
    for (auto& v : voices)
      if (v->active()) return true;
    return false;
  }

  void assignChannel(Voice& v, int channel) {
    v.channel = channel;
    if (channel >= 0 && channel < 16) {
      v.mpeBend = chBend[channel];
      v.mpePressure = chPressure[channel];
      v.mpeSlide = chSlide[channel];
    } else {
      v.mpeBend = 0;
      v.mpePressure = 0;
      v.mpeSlide = 0.5;
    }
  }

  void resolve() {
    const auto& P = PI_();
    auto& t = target;
    t = raw;
    dstMask.fill(1);
    auto off = [&](int flag) { return raw[flag] < 0.5; };
    auto zero = [&](std::initializer_list<int> ix) { for (int i : ix) t[i] = 0; };
    auto block = [&](std::initializer_list<int> ds) { for (int d : ds) dstMask[d] = 0; };
    if (off(P.fmOn)) { zero({P.fmAmount, P.fm2Amount}); block({D_FM, D_FM2}); }
    if (off(P.driveOn)) { zero({P.drive}); block({D_DRIVE}); }
    if (off(P.filterOn)) {
      t[P.cutoff] = 20000;
      t[P.fType] = FILTER_LP;
      zero({P.res, P.envAmt, P.keytrack, P.accent, P.vowel});
      block({D_CUTOFF, D_RES, D_VOWEL});
    }
    if (off(P.distOn)) { zero({P.dMix}); block({D_DIST_MIX, D_DIST_DRIVE, D_DIST_TONE}); }
    if (off(P.crushOn)) { zero({P.crushMix}); block({D_CRUSH}); }
    if (off(P.tapeOn)) { zero({P.tapeDrive, P.tapeWow, P.tapeAge}); block({D_TAPE_WOW}); }
    if (off(P.vibOn)) { zero({P.vibDepth}); block({D_VIBRATO}); }
    if (off(P.wobOn)) zero({P.wobDepth});
    if (off(P.modOn)) for (const auto& s : P.slots) t[s.amt] = 0;
    if (off(P.dynOn)) zero({P.compAmount, P.compPump, P.ott});
    if (off(P.eqOn)) { zero({P.eqLow, P.eqMid, P.eqHigh}); t[P.eqHighcut] = 20000; }
    if (off(P.chorusOn)) { zero({P.chorusMix}); block({D_CHORUS_DEPTH}); }
    if (off(P.flangerOn)) zero({P.flangerMix});
    if (off(P.phaserOn)) { zero({P.phaserMix}); block({D_PHASER_MIX}); }
    if (off(P.delayOn)) { zero({P.delayMix}); block({D_DELAY_MIX, D_DELAY_TIME}); }
    if (off(P.reverbOn)) { zero({P.reverbMix}); block({D_REVERB_MIX}); }
    // Solo / mute (a listening aid from the window, not part of the patch).
    auto hear = [&](int layer) { return !(monMute >> layer & 1) && (monSolo == 0 || (monSolo >> layer & 1)); };
    if (!hear(MON_OSC1)) { zero({P.osc[0].level}); block({D_OSC1_LEVEL}); }
    if (!hear(MON_OSC2)) { zero({P.osc[1].level}); block({D_OSC2_LEVEL}); }
    if (!hear(MON_SUB)) { zero({P.subLevel}); block({D_SUB}); }
    if (!hear(MON_NOISE)) { zero({P.noise}); block({D_NOISE}); }
    if (!hear(MON_CLICK)) zero({P.clickLevel});
    if (!hear(MON_BREATH)) { zero({P.breath, P.chiff}); block({D_BREATH}); }
    // Tape age hisses on its own: with the whole oscillator path silent, the tape goes quiet too.
    if (!hear(MON_OSC1) && !hear(MON_OSC2) && !hear(MON_NOISE) && !hear(MON_BREATH)) {
      zero({P.tapeDrive, P.tapeWow, P.tapeAge});
      block({D_TAPE_WOW});
    }
    texMonTarget = hear(MON_TEXTURE) ? 1 : 0;
  }

  void monoStart(int note, double velocity, bool overlapping, int channel) {
    const auto& P = PI_();
    const bool legato = cur[P.legato] > 0.5;
    const bool glide = cur[P.glide] > 0.5;
    Voice& v = *voices[0];
    const bool retrigger = !(legato && overlapping);
    const bool fresh = !v.active();
    assignChannel(v, channel);
    v.start(note, velocity, glide && !(legato && !overlapping), retrigger, ++order);
    if (retrigger) onTrigger();
    if (fresh) v.control(gsrc.data(), bend, xdst.data());
  }

  void onTrigger() {
    const auto& P = PI_();
    for (int l = 0; l < LFO_COUNT; l++) {
      if (cur[P.lfo[l].retrig] > 0.5) {
        lfoPhase[l] = 0;
        lfoPrev[l] = lfoHold[l];
        lfoHold[l] = rng.next();
      }
    }
  }

  void removeFromStack(int note) {
    int w = 0;
    for (int r = 0; r < stackLen; r++)
      if (stack[r] != note) stack[w++] = stack[r];
    stackLen = w;
  }

  void applyDiscrete() {
    const auto& P = PI_();
    const int p = std::max(1, std::min(MAX_VOICES, (int)jsRound(cur[P.poly])));
    if (p != poly) {
      for (int i = p <= 1 ? 1 : p; i < MAX_VOICES; i++) voices[i]->release();
      if (p > 1) stackLen = 0;
      poly = p;
    }
    for (auto& v : voices) v->applyDiscrete();
  }

  void smoothParams() {
    const double c = smoothCoef;
    bool discreteChanged = false;
    for (int i = 0; i < PARAM_COUNT; i++) {
      const double t = target[i];
      const double v = cur[i];
      if (t == v) continue;
      if (isDiscrete[i]) {
        discreteChanged = true;
      } else if (isLog[i]) {
        const double nv = v * std::pow(t / v, c);
        cur[i] = std::fabs(nv - t) < 1e-6 * t ? t : nv;
      } else {
        const double nv = v + (t - v) * c;
        cur[i] = std::fabs(nv - t) < 1e-7 ? t : nv;
      }
    }
    if (discreteChanged) {
      if (!anyActive()) copyDiscrete();
      else if (duckDir == 0 || duckDir == 1) duckDir = -1;
    }
  }

  void copyDiscrete() {
    for (int i = 0; i < PARAM_COUNT; i++)
      if (isDiscrete[i]) cur[i] = target[i];
    applyDiscrete();
  }

  double wanderStep(double prev) {
    // JS evaluates the sign before the step size: keep that order.
    const double sign = rng.next() < 0 ? -1 : 1;
    double v = prev + sign * (0.6 + 0.3 * (rng.next() + 1));
    if (v > 1) v = 2 - v;
    else if (v < -1) v = -2 - v;
    return v;
  }

  static double lfoShape(int shape, double p, double hold, double prev) {
    switch (shape) {
      case LFO_SINE: return std::sin(TWO_PI * p);
      case LFO_TRI: return p < 0.5 ? 4 * p - 1 : 3 - 4 * p;
      case LFO_SAW_UP: return 2 * p - 1;
      case LFO_SAW_DOWN: return 1 - 2 * p;
      case LFO_SQUARE: return p < 0.5 ? 1 : -1;
      case LFO_SH: return hold;
      case LFO_WANDER: return prev + (hold - prev) * p * p * (3 - 2 * p);
      default: return 0;
    }
  }

  void extraModulation() {
    const auto& P = PI_();
    auto& x = xdst;
    x.fill(0);
    wobTexTone = 0;
    const double w = wheel;
    if (w > 1e-4) {
      const int sel = (int)jsRound(cur[P.wheelMove]);
      const WheelMove& move = WHEEL_MOVES[sel > 0 ? sel - 1 : (int)jsRound(cur[P.wheelPreset])];
      for (int i = 0; i < move.count; i++) {
        const auto& st = move.steps[i];
        if (!wheelFrozen || !wheelMovingDest(st.dest)) x[st.dest] += st.amount * w;
      }
    }
    const double depth = cur[P.wobDepth];
    if (depth > 1e-4) {
      const int ri = (int)jsRound(cur[P.wobRate]);
      const double cycle = ri >= 0 && ri < 8 ? WOBBLE_BEATS[ri] : 0.5;
      const long long n = (long long)std::floor(beatPos / cycle);
      const double p = (beatPos - n * cycle) / cycle;
      if (n != wobCycle) {
        wobCycle = n;
        const double life = cur[P.wobLife];
        wobScaleTarget = 1 + 0.45 * life * wobRng.next();
        wobBrightTarget = 0.05 * life * wobRng.next();
      }
      wobScale += (wobScaleTarget - wobScale) * 0.1;
      wobBright += (wobBrightTarget - wobBright) * 0.05;
      double v;
      switch ((int)jsRound(cur[P.wobShape])) {
        case WOB_TRI: v = p < 0.5 ? 2 * p : 2 - 2 * p; break;
        case WOB_SAW_DOWN: v = p < 0.95 ? 1 - p / 0.95 : (p - 0.95) / 0.05; break;
        case WOB_SQUARE: v = 0.5 + 0.5 * std::tanh(6 * std::sin(TWO_PI * p)); break;
        default: v = 0.5 - 0.5 * std::cos(TWO_PI * p);
      }
      const double a = depth * v * wobScale;
      const double swing = depth * (2 * v - 1) * wobScale;
      const int tgt = (int)jsRound(cur[P.wobTarget]);
      if (tgt == WOB_FILTER_DRIVE_TEXTURE) {
        wobTexTone = 0.35 * swing;
        x[D_TEXTURE] += 0.3 * swing;
      }
      if (tgt == WOB_FILTER_DRIVE || tgt == WOB_FILTER_DRIVE_TEXTURE) {
        x[D_CUTOFF] += 0.38 * swing + wobBright;
        x[D_RES] += 0.12 * depth;
        x[D_DRIVE] += 0.4 * a;
        x[D_DIST_DRIVE] += 0.1 * a;
      } else {
        x[D_CUTOFF] += 0.42 * swing + wobBright;
        x[D_RES] += 0.15 * depth;
      }
    }
  }

  void control() {
    const auto& P = PI_();
    const double fs = sampleRate;
    smoothParams();

    auto& src = gsrc;
    src[0] = 0;
    src[SRC_LFO1] = lfoValue[0] * cur[P.lfoOn[0]];
    src[SRC_LFO2] = lfoValue[1] * cur[P.lfoOn[1]];
    src[SRC_LFO3] = lfoValue[2] * cur[P.lfoOn[2]];
    src[SRC_LFO4] = lfoValue[3] * cur[P.lfoOn[3]];
    wheel += (modWheel - wheel) * (1 - std::exp(-CONTROL_BLOCK / (0.02 * fs)));
    src[SRC_MODWHEEL] = wheel;
    extraModulation();
    if (--driftCount <= 0) {
      driftTarget = rng.next();
      driftCount = (int)jsRound(((0.4 + 1.2 * (0.5 + 0.5 * rng.next())) * fs) / CONTROL_BLOCK);
    }
    driftVal += (driftTarget - driftVal) * 0.004;
    src[SRC_DRIFT] = driftVal;
    src[SRC_PRODUCT] = src[SRC_LFO1] * src[SRC_LFO2];
    if (slowPos >= 1) {
      slowA = slowB;
      slowB = wanderStep(slowA);
      slowPos = 0;
      slowStep = CONTROL_BLOCK / ((2 + 4 * (0.5 + 0.5 * rng.next())) * fs);
    }
    slowPos += slowStep;
    {
      const double t = slowPos > 1 ? 1 : slowPos;
      src[SRC_DRIFT_SLOW] = slowA + (slowB - slowA) * (0.5 - 0.5 * std::cos(PI * t));
    }

    Voice* lead = voices[0].get();
    Voice* lowest = nullptr;
    bool gateAny = false;
    for (int i = 0; i < MAX_VOICES; i++) {
      Voice& v = *voices[i];
      if (v.order > lead->order) lead = &v;
      if (v.gate) {
        gateAny = true;
        if (!lowest || v.note < lowest->note) lowest = &v;
      }
      if (v.active() || v.gate) v.control(src.data(), bend, xdst.data());
    }
    anyGate = gateAny;
    if (poly > 1) {
      for (auto& v : voices) v->subOn = lowest ? (v.get() == lowest ? 1 : 0) : 1;
    } else {
      voices[0]->subOn = 1;
    }
    const auto& dst = lead->dst;

    for (int l = 0; l < LFO_COUNT; l++) {
      const auto& lp = P.lfo[l];
      const int sync = (int)cur[lp.sync];
      double rate = sync > 0 ? tempo / 60 / SYNC_BEATS[sync] : cur[lp.rate];
      const double rm = dst[LFO_RATE_DEST[l]];
      if (rm != 0) rate *= std::pow(2.0, 3 * rm);
      double ph = lfoPhase[l] + (rate * CONTROL_BLOCK) / fs;
      if (ph >= 1) {
        ph -= std::floor(ph);
        lfoPrev[l] = lfoHold[l];
        lfoHold[l] = cur[lp.shape] == LFO_WANDER ? wanderStep(lfoHold[l]) : rng.next();
      }
      lfoPhase[l] = ph;
      lfoValue[l] = lfoShape((int)cur[lp.shape], ph, lfoHold[l], lfoPrev[l]);
    }

    const double tex = clampd(cur[P.texLevel] + dst[D_TEXTURE], 0, 1);
    texGain = tex * tex * TEXTURE_GAIN;
    texType = (int)cur[P.texType];
    texTone = clampd(cur[P.texTone] + wobTexTone, 0, 1);
    texAtk = 1 - std::exp(-1 / (std::fmax(0.03, cur[P.amp[0]] / 3000) * fs));
    texRel = std::exp(-4.6 / ((cur[P.texTail] / 1000) * fs));
    texLpCoef = lead->tapeLpCoef;
    {
      const SlotKind sk = auxSlot(cur[P.texFType]);
      double hz = cur[P.texFCut];
      if (cur[P.texFKey] > 0.5) hz *= std::pow(2.0, (lead->pitch + 12 * cur[P.octave] - KEYTRACK_CENTER) / 12);
      texF.set(sk.kind, sk.p24, hz, fs);
    }
    const bool routeN = cur[P.routeN] > 0.5;
    if (routeN && !texRouteN) {
      texNL.reset();
      texNR.reset();
    }
    texRouteN = routeN;
    if (routeN) {
      // A copy of the main filter that follows the newest note (the bed is shared by all voices).
      texNG = std::tan((PI * std::fmin(lead->fcNow, fs * 0.45)) / fs);
      texNK = 2 - 1.85 * lead->resNow;
      const int t = (int)std::lround(cur[P.fType]);
      texNMode = t == FILTER_BP || t == 2 ? 1 : t == FILTER_NOTCH ? 2 : 0;
    }
    const double pan = cur[P.texPan];
    texPanOn = pan != 0;
    if (texPanOn) {
      const double a = ((pan + 1) * PI) / 4;
      texPanL = std::cos(a) * SQRT2;
      texPanR = std::sin(a) * SQRT2;
    }
    texDirect = cur[P.texDirect] > 0.5;

    beatPos += (tempo / 60) * (CONTROL_BLOCK / fs);
    if (beatPos >= 4) beatPos -= 4;
    const double pump = cur[P.compPump];
    double pumpGain = 1;
    if (pump > 0) {
      const int pr = (int)jsRound(cur[P.compPumpRate]);
      const double cycle = pr >= 0 && pr < 4 ? PUMP_BEATS[pr] : 1;
      const double b = std::fmod(beatPos, cycle) / cycle;
      const double duck = b < 0.03 ? b / 0.03 : std::exp(-(b - 0.03) * 6);
      pumpGain = 1 - pump * 0.85 * duck;
    }
    compOn = cur[P.compAmount] > 0.001 || pump > 0.001;
    if (compOn) comp.update(cur[P.compAmount], cur[P.compSpeed], pumpGain, fs, CONTROL_BLOCK);
    ottOn = cur[P.ott] > 0.0005;
    if (ottOn) ott.update(cur[P.ott], CONTROL_BLOCK);

    delaySeconds = std::fmin(3, ((DELAY_BEATS[(int)cur[P.delayTime]] * 60) / tempo) * std::pow(2.0, clampd(dst[D_DELAY_TIME], -1, 1)));
    delayToneCoef = 1 - std::exp((-TWO_PI * std::fmin(800 * std::pow(20.0, cur[P.delayTone]), fs * 0.45)) / fs);

    chorusDepth = clampd(cur[P.chorusDepth] + dst[D_CHORUS_DEPTH], 0, 1);
    phaserMix = clampd(cur[P.phaserMix] + dst[D_PHASER_MIX], 0, 1);
    delayMix = clampd(cur[P.delayMix] + dst[D_DELAY_MIX], 0, 1);
    reverbMix = clampd(cur[P.reverbMix] + dst[D_REVERB_MIX], 0, 1);
    widthTarget = clampd(1 + dst[D_WIDTH], 0, 2);
    widthStep = (widthTarget - width) / CONTROL_BLOCK;

    auto& lf = lastFx;
    const double lowcut = cur[P.fxLowcut];
    if (lowcut != lf[0]) {
      hpL.setHighpass(lowcut, SQRT1_2, fs);
      hpR.setHighpass(lowcut, SQRT1_2, fs);
      lf[0] = lowcut;
    }
    eqOn[0] = std::fabs(cur[P.eqLow]) > 0.01;
    eqOn[1] = std::fabs(cur[P.eqMid]) > 0.01;
    eqOn[2] = std::fabs(cur[P.eqHigh]) > 0.01;
    if (cur[P.eqLow] != lf[1]) {
      eqL[0].setLowShelf(100, cur[P.eqLow], fs);
      eqR[0].setLowShelf(100, cur[P.eqLow], fs);
      lf[1] = cur[P.eqLow];
    }
    if (cur[P.eqMid] != lf[2] || cur[P.eqMidFreq] != lf[3]) {
      eqL[1].setPeak(cur[P.eqMidFreq], cur[P.eqMid], 0.9, fs);
      eqR[1].setPeak(cur[P.eqMidFreq], cur[P.eqMid], 0.9, fs);
      lf[2] = cur[P.eqMid];
      lf[3] = cur[P.eqMidFreq];
    }
    if (cur[P.eqHigh] != lf[4]) {
      eqL[2].setHighShelf(5000, cur[P.eqHigh], fs);
      eqR[2].setHighShelf(5000, cur[P.eqHigh], fs);
      lf[4] = cur[P.eqHigh];
    }
    if (cur[P.crossover] != lf[5]) {
      for (int i = 0; i < 4; i++) xo[i].setHighpass(cur[P.crossover], XO_Q[i], fs);
      for (int i = 0; i < 2; i++) xoPost[i].setHighpass(cur[P.crossover], SUBSONIC_Q[i], fs);
      lf[5] = cur[P.crossover];
    }
    if (cur[P.eqHighcut] != lf[6]) {
      const double hc = cur[P.eqHighcut];
      highcutOn = hc < 19500;
      if (highcutOn) {
        hcL.setLowpass(std::fmin(hc, fs * 0.45), SQRT1_2, fs);
        hcR.setLowpass(std::fmin(hc, fs * 0.45), SQRT1_2, fs);
      }
      lf[6] = hc;
    }
    if (cur[P.outGain] != lastOutDb) {
      outTarget = std::pow(10.0, cur[P.outGain] / 20);
      lastOutDb = cur[P.outGain];
    }
    outGainStep = (outTarget - outGain) / CONTROL_BLOCK;
  }
};

}  // namespace lt
