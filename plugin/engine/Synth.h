// Low Talk synth engine (port of src/engine/core/synth.ts). Real-time rules:
// after construction nothing here allocates or locks. Patch changes arrive as
// a flat array in schema order and are smoothed; discrete switches duck.
//
// Plugin additions: notes carry their MIDI channel so MPE per-note bend,
// pressure and slide reach the right voice; the host's tempo and bar
// position drive the Wobbler's and GRIND's clock (setTempo / syncBeat); solo /
// mute come as bit masks; live values for the window (filter, LFOs, Wobbler, GRIND).
#pragma once
#include <array>
#include <cmath>
#include <memory>
#include <string>
#include <vector>
#include "Dsp.h"
#include "Fx.h"
#include "Grind.h"
#include "Oversample.h"
#include "Params.h"
#include "Voice.h"
#include "VoiceFx.h"
#include "Wavetable.h"
#include "Wobshape.h"

namespace lt {

constexpr int MAX_VOICES = 8;

class Synth {
 public:
  const double sampleRate;
  double peak = 0;
  bool wheelFrozen = false;
  // Live values for the window (the newest voice's).
  double liveCutoff = 0, liveRes = 0, liveWob = -1, liveWobFc = -1;
  std::array<double, LFO_COUNT> lfoPhase{}, lfoValue{};
  std::array<double, 4> liveGrind{}, liveGrindRes{};

  explicit Synth(double fs)
      : sampleRate(fs), rng(0x1234567), wobRng(0x60bb1e), texGrindRng(0x6a1d), texGrind(texGrindRng), ott(),
        chorus(fs), phaser(fs), flanger(fs), limiter(fs, LIMITER_CEILING_DB) {
    smoothCoef = 1 - std::exp(-CONTROL_BLOCK / ((SMOOTH_MS / 1000) * fs));
    duckStep = 1 / ((DUCK_MS / 1000) * fs);
    postDcR = 1 - (2 * PI * 5) / fs;
    for (int i = 0; i < PARAM_COUNT; i++) {
      isLog[i] = PARAMS[i].curve == 1;
      isDiscrete[i] = PARAMS[i].type != PType::Float;
      raw[i] = target[i] = cur[i] = PARAMS[i].def;
    }
    dstMask.fill(1);
    liveGrind.fill(-1);
    const float* table = getWavetable().data();
    for (int i = 0; i < MAX_VOICES; i++)
      voices.push_back(std::make_unique<Voice>(fs, cur.data(), table, 0x2468aceu + 0x9e3779bu * (uint32_t)i, dstMask.data()));
    for (int i = 0; i < 2; i++) {
      dcL[i].setHighpass(SUBSONIC_HZ, SUBSONIC_Q[i], fs);
      dcR[i].setHighpass(SUBSONIC_HZ, SUBSONIC_Q[i], fs);
    }
    lastFx.fill(NAN);
    eqLast.fill(NAN);
    wobSig = NAN;
    for (int l = 0; l < LFO_COUNT; l++) {
      lfoPrev[l] = rng.next();
      lfoHold[l] = rng.next();
    }
    applyDiscrete();
    control();
  }

  int latency() const { return limiter.lookahead - 1 + OVERSAMPLE_LATENCY; }
  double limiterCeiling() const { return limiter.ceiling; }
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
  /** Align the internal clocks to a song position in beats (the bar for GRIND, the song for the Wobbler). */
  void syncBeat(double beat) {
    beatPos = beat - 4 * std::floor(beat / 4);
    songBeat = beat;
  }
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

  // ---------------------------------------------------------------- notes
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
    onTrigger(velocity);
    if (fresh) {
      pick->beatPos = beatPos;
      pick->bps = tempo / 60;
      pick->control(gsrc.data(), bend, xdst.data());
    }
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
    for (int i = 0; i < 4; i++) {
      eqL[i].reset();
      eqR[i].reset();
    }
    for (int k = 0; k < 5; k++) {
      hpL[k].reset();
      hpR[k].reset();
    }
    for (auto& x : xo) x.reset();
    for (auto& x : xoPost) x.reset();
    chorus.reset();
    phaser.reset();
    limiter.reset();
    postDcXL = postDcYL = postDcXR = postDcYR = 0;
    for (int i = 0; i < 2; i++) {
      dcL[i].reset();
      dcR[i].reset();
    }
    texture.reset();
    texEnv = texLpL = texLpR = 0;
    wobCycle = -1;
    wobGate = wobGateTarget = 1;
    for (auto& side : wobBand) for (auto& b : side) b.reset();
    wobScale = wobScaleTarget = 1;
    wobBright = wobBrightTarget = 0;
    hcL.reset();
    hcR.reset();
    flanger.reset();
    fxOtt.reset();
  }

  bool idle() const { return !anyActive(); }
  int heldNotes() const {
    if (poly <= 1) return stackLen;
    int n = 0;
    for (auto& v : voices) if (v->gate) n++;
    return n;
  }

  // ------------------------------------------------------------ audio rate

  /** Render `frames` samples into outL/outR starting at `offset`. Allocation-free. */
  void render(float* outL, float* outR, int offset, int frames) {
    const auto& P = PI_();
    const int end = offset + frames;
    double pk = peak;
    double out[2], vout[3];
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
        const double k = 1 / (0.005 * sampleRate);
        texMon += std::fmax(-k, std::fmin(k, texMonTarget - texMon));
      }
      double texL = 0, texR = 0;
      if (texGain > 0 && (anyGate || texEnv > 1e-5)) {
        texEnv = anyGate ? texEnv + (1 - texEnv) * texAtk : texEnv * texRel;
        texPos += texRate;
        while (texPos >= 1) {
          texPos -= 1;
          texture.process(texType, texTone, texDensity, sampleRate, out);
          texPrev[0] = texCur[0];
          texPrev[1] = texCur[1];
          texCur[0] = out[0];
          texCur[1] = out[1];
        }
        const double tf = texPos;
        double tl = texPrev[0] + (texCur[0] - texPrev[0]) * tf, tr = texPrev[1] + (texCur[1] - texPrev[1]) * tf;
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
          const double g = texNG, k = texNK;
          texNL.process(tl, g, k);
          texNR.process(tr, g, k);
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
      const bool direct = texDirect;
      if (!direct) {
        if (texGrindOn) {
          texGrind.process(texL, texR);
          texL = texGrind.l;
          texR = texGrind.r;
        }
        l += texL;
        r += texR;
      }
      if (ott.on()) {
        ott.process(l, r);
        l = ott.l;
        r = ott.r;
      }

      const double cMix = cur[P.chorusMix];
      if (cMix > 1e-4) {
        const double hl = hpL[0].process(l), hr = hpR[0].process(r);
        chorus.process(hl, hr, cMix, chorusDepth, out, (int)cur[P.chorusMode]);
        l += out[0] - hl;
        r += out[1] - hr;
      }
      const double fMix = cur[P.flangerMix];
      if (fMix > 1e-4) {
        const double hl = hpL[1].process(l), hr = hpR[1].process(r);
        flanger.process(hl, hr, fMix, cur[P.flangerRate], cur[P.flangerFb], out);
        l += out[0] - hl;
        r += out[1] - hr;
      }
      const double pMix = phaserMix;
      if (pMix > 1e-4) {
        const double hl = hpL[2].process(l), hr = hpR[2].process(r);
        phaser.process(hl, hr, pMix, cur[P.phaserRate], out);
        l += out[0] - hl;
        r += out[1] - hr;
      }
      // The FX page's OTT (below its Lo cut the sound passes as it is).
      if (fxOtt.on()) {
        fxOtt.process(l, r);
        l = fxOtt.l;
        r = fxOtt.r;
      }

      for (int b = 0; b < 4; b++) {
        if (eqOn[b]) {
          l = eqL[b].process(l);
          r = eqR[b].process(r);
        }
      }
      if (highcutOn) {
        l = hcL.process(l);
        r = hcR.process(r);
      }

      l += sub;
      r += sub;
      if (direct) {
        l += texL;
        r += texR;
      }

      if (wobFiltOn || wobGate != 1 || wobGateTarget != 1) {
        wobGate += (wobGateTarget - wobGate) * 0.02;
        wobG += wobGStep;
        if (std::fabs(wobGate - 1) < 1e-6 && wobGateTarget == 1) wobGate = 1;
        const double lc = cur[P.wobLowcut];
        const bool loOn = lc > 21;
        if (lc != wobBandLc) {
          wobBandLc = lc;
          if (loOn)
            for (auto& f : wobBand)
              for (int k = 0; k < 2; k++) {
                f[k].setLowpass(lc, SQRT1_2, sampleRate);
                f[2 + k].setHighpass(lc, SQRT1_2, sampleRate);
              }
        }
        l = wobSide(l, 0, loOn, wobGate, wobFiltOn);
        r = wobSide(r, 1, loOn, wobGate, wobFiltOn);
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

      limiter.process(l, r, out);
      {
        const double pm = 0.5 * (out[0] + out[1]);
        const double ps = xoPost[1].process(xoPost[0].process(0.5 * (out[0] - out[1])));
        out[0] = pm + ps;
        out[1] = pm - ps;
      }
      const double c = limiter.ceiling;
      double yl = out[0] - postDcXL + postDcR * postDcYL;
      postDcXL = out[0];
      postDcYL = yl;
      double yr = out[1] - postDcXR + postDcR * postDcYR;
      postDcXR = out[1];
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

  /** Target values = the patch, with switched-off blocks zeroed (and their mod destinations blocked) and silenced layers turned down. */
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
    for (const auto& s : P.slots)
      if (off(P.modOn) || off(s.on)) t[s.amt] = 0;
    if (off(P.eqOn)) {
      t[P.eqScale] = 0;
      for (const auto& b : P.eq) t[b.type] = 0;
      t[P.eqHighcut] = 20000;
    }
    if (off(P.chorusOn)) { zero({P.chorusMix}); block({D_CHORUS_DEPTH}); }
    if (off(P.flangerOn)) zero({P.flangerMix});
    if (off(P.phaserOn)) { zero({P.phaserMix}); block({D_PHASER_MIX}); }
    if (off(P.delayOn)) { zero({P.delayMix}); block({D_DELAY_MIX, D_DELAY_TIME}); }
    if (off(P.reverbOn)) { zero({P.reverbMix}); block({D_REVERB_MIX}); }
    if (off(P.ottOn)) zero({P.ottDepth});
    // reverb and delay were taken out of the synth (owner's call: every producer has their own)
    block({D_REVERB_MIX, D_DELAY_MIX, D_DELAY_TIME});
    // Solo / mute (a listening aid from the window, not part of the patch).
    auto hear = [&](int layer) { return !(monMute >> layer & 1) && (monSolo == 0 || (monSolo >> layer & 1)); };
    if (!hear(MON_OSC1)) { zero({P.osc[0].level}); block({D_OSC1_LEVEL}); }
    if (!hear(MON_OSC2)) { zero({P.osc[1].level}); block({D_OSC2_LEVEL}); }
    if (!hear(MON_SUB)) { zero({P.subLevel}); block({D_SUB}); }
    if (!hear(MON_NOISE)) { zero({P.noise}); block({D_NOISE}); }
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
    if (retrigger) onTrigger(velocity);
    if (fresh) {
      v.beatPos = beatPos;
      v.bps = tempo / 60;
      v.control(gsrc.data(), bend, xdst.data());
    }
  }

  void onTrigger(double velocity) {
    const auto& P = PI_();
    texture.trigger(velocity);
    texGrind.noteOn(&rng);
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

  // ---------------------------------------------------------- control rate

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
    double v = prev + (rng.next() < 0 ? -1 : 1) * (0.6 + 0.3 * (rng.next() + 1));
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

  /** The wobble shape set up for this block, unsmoothed, at q (0..1). */
  double wobRaw(double q) const {
    const int shape = wobShapeNow;
    if (shape == WOB_RANDOM) return wobRand[std::min(WOB_RANDOM_STEPS - 1, (int)std::floor(q * WOB_RANDOM_STEPS))];
    if (shape == WOB_CUSTOM) return wobShapeAt(wobXs.data(), wobYs.data(), wobSs.data(), wobPtsNow, q);
    const WobTemplate& t = WOB_TEMPLATE_ARRAYS[shape >= 0 && shape < WOB_SHAPE_COUNT ? shape : 0];
    return wobShapeAt(t.xs, t.ys, t.ss, t.n, q);
  }

  double wobSide(double x, int c, bool loOn, double g, bool filt) {
    auto& f = wobBand[c];
    double low = 0, mid = x;
    if (loOn) {
      low = f[1].process(f[0].process(x));
      mid = f[3].process(f[2].process(x));
    }
    if (filt) {
      auto& sv = wobSvf[c];
      sv[0].process(mid, wobG, wobK);
      sv[1].process(sv[0].lp, wobG, SQRT2);
      mid = sv[1].lp;
    }
    return low + mid * g;
  }

  /** The mod wheel's move and the wobble, as offsets every voice adds to its mod matrix. */
  void extraModulation() {
    const auto& P = PI_();
    auto& x = xdst;
    x.fill(0);
    const double w = wheel;
    if (w > 1e-4) {
      const int sel = (int)jsRound(cur[P.wheelMove]);
      const int idx = sel > 0 ? sel - 1 : (int)jsRound(cur[P.wheelPreset]);
      const WheelMove& move = WHEEL_MOVES[idx >= 0 && idx < 8 ? idx : 0];
      for (int i = 0; i < move.count; i++) {
        const auto& st = move.steps[i];
        if (!wheelFrozen || !wheelMovingDest(st.dest)) x[st.dest] += st.amount * w;
      }
    }
    const double depth = cur[P.wobDepth];
    liveWob = -1;
    wobGateTarget = 1;
    wobFiltWas = wobFiltOn;
    wobFiltOn = false;
    liveWobFc = -1;
    if (depth > 1e-4) {
      const int ri = (int)jsRound(cur[P.wobRate]);
      const double cycle = ri >= 0 && ri < WOBBLE_RATE_COUNT ? WOBBLE_BEATS[ri] : 0.5;
      const double nC = std::floor(songBeat / cycle);
      const double p = (songBeat - nC * cycle) / cycle;
      liveWob = p;
      if (nC != wobCycle) {
        wobCycle = nC;
        const double life = cur[P.wobLife];
        wobScaleTarget = 1 + 0.45 * life * wobRng.next();
        wobBrightTarget = 0.05 * life * wobRng.next();
      }
      wobScale += (wobScaleTarget - wobScale) * 0.1;
      wobBright += (wobBrightTarget - wobBright) * 0.05;
      double q = p - cur[P.wobPhase];
      q -= std::floor(q);
      const int shape = (int)jsRound(cur[P.wobShape]);
      if (shape == WOB_RANDOM && wobRandCycle != nC) {
        wobRandCycle = nC;
        for (int k = 0; k < WOB_RANDOM_STEPS; k++) wobRand[k] = 0.5 + 0.5 * wobRng.next();
      }
      int m = 0;
      if (shape == WOB_CUSTOM) {
        m = std::max(2, std::min(WOB_MAX_POINTS, (int)jsRound(cur[P.wobPts])));
        for (int k = 0; k < m; k++) {
          wobXs[k] = cur[P.wobX[k]];
          wobYs[k] = cur[P.wobY[k]];
          wobSs[k] = cur[P.wobS[k]] > 0.5 ? 1 : 0;
        }
      }
      wobShapeNow = shape;
      wobPtsNow = m;
      const int rr = wobSmoothRadius(cur[P.wobSmooth]);
      double tgt;
      if (rr == 0) tgt = wobRaw(q);
      else {
        double sig = shape * 7919 + rr * 104729 + m * 13;
        if (shape == WOB_RANDOM) sig += nC * 1.618;
        for (int k = 0; k < m; k++) sig += wobXs[k] * (k + 1.31) * 3.7 + wobYs[k] * (k + 2.17) * 5.3 + wobSs[k] * (k + 3.1);
        if (sig != wobSig) {
          wobSig = sig;
          wobSmoothTable([this](double qq) { return wobRaw(qq); }, rr, wobTable.data(), wobTmp.data());
        }
        tgt = wobTableAt(wobTable.data(), q);
      }
      wobV += (tgt - wobV) * 0.35;
      const double v = wobV;
      if (cur[P.wobCutoff] > 0.5) {
        const double lc = cur[P.wobLowcut];
        const double lo = lc > 21 ? lc : 60, hi = std::fmin(18000, sampleRate * 0.45);
        const double d = std::fmin(1, depth * wobScale);
        const double fc = std::fmax(20, std::fmin(hi, hi * std::pow(lo / hi, d * (1 - v)) * std::pow(2.0, 6 * wobBright)));
        const double gT = std::tan((PI * fc) / sampleRate);
        if (!wobFiltWas) {
          wobG = gT;
          for (auto& sv : wobSvf) for (auto& f : sv) f.reset();
        }
        wobFiltOn = true;
        wobGStep = (gT - wobG) / CONTROL_BLOCK;
        wobK = 1.3 - 0.75 * d;
        liveWobFc = fc;
      }
      if (cur[P.wobVolume] > 0.5) wobGateTarget = 1 - std::fmin(1, depth * wobScale) * (1 - v);
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
      if (v.active() || v.gate) {
        v.beatPos = beatPos;
        v.bps = tempo / 60;
        v.control(src.data(), bend, xdst.data());
      }
    }
    anyGate = gateAny;
    liveCutoff = lead->active() ? lead->fcNow : 0;
    for (int i = 0; i < 4; i++) {
      liveGrind[i] = lead->active() ? lead->grindFc(i) : -1;
      liveGrindRes[i] = lead->grindRes(i);
    }
    liveRes = lead->resNow;
    if (poly > 1) {
      for (int i = 0; i < MAX_VOICES; i++) {
        Voice& v = *voices[i];
        v.subOn = lowest ? (&v == lowest ? 1 : 0) : 1;
      }
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
        lfoHold[l] = (int)cur[lp.shape] == LFO_WANDER ? wanderStep(lfoHold[l]) : rng.next();
      }
      lfoPhase[l] = ph;
      lfoValue[l] = lfoShape((int)cur[lp.shape], ph, lfoHold[l], lfoPrev[l]);
    }

    const double tex = clampd(cur[P.texLevel] + dst[D_TEXTURE] + ((int)cur[P.texType] == TEX_BREATH ? dst[D_BREATH] : 0), 0, 1);
    texGain = tex * tex * TEXTURE_GAIN;
    texType = (int)cur[P.texType];
    texTone = clampd(cur[P.texTone], 0, 1);
    texDensity = clampd(cur[P.texDensity], 0, 1);
    const double texOct = jsRound(cur[P.texOct]) + (cur[P.texKey] > 0.5 ? (lead->pitch + 12 * cur[P.octave] + 2 * bend - 60) / 12 : 0) + 6 * dst[D_NOISE_PITCH];
    texRate = std::pow(2.0, clampd(texOct, -6, 2));
    texAtk = 1 - std::exp(-1 / (std::fmax(0.03, cur[P.amp[0]] / 3000) * fs));
    texRel = std::exp(-4.6 / ((cur[P.texTail] / 1000) * fs));
    texture.puffLen = cur[P.texTail] / 1000;
    texLpCoef = lead->tapeLpCoef;
    {
      const SlotKind sk = auxSlot(cur[P.texFType]);
      double hz = cur[P.texFCut];
      if (cur[P.texFKey] > 0.5) hz *= std::pow(2.0, (lead->pitch + 12 * cur[P.octave] - KEYTRACK_CENTER) / 12);
      texF.set(sk.kind, sk.p24, hz, fs);
    }
    const bool routeN = cur[P.routeN] > 0.5 && cur[P.texDirect] < 0.5;
    if (routeN && !texRouteN) {
      texNL.reset();
      texNR.reset();
    }
    texRouteN = routeN;
    if (routeN) {
      texNG = std::tan((PI * std::fmin(lead->fcNow, fs * 0.45)) / fs);
      texNK = 2 - 1.85 * lead->resNow;
      const int t = (int)jsRound(cur[P.fType]);
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
    const bool tg = cur[P.grindOn] > 0.5 && !texDirect;
    if (tg && !texGrindOn) texGrind.reset();
    texGrindOn = tg;
    ott.set(cur[P.grindOn] > 0.5 ? cur[P.grindOtt] : 0, cur[P.grindLowcut], fs);
    if (tg) texGrind.control(cur.data(), beatPos, tempo / 60, (lead->pitch + 12 * cur[P.octave] - KEYTRACK_CENTER) / 12, fs, fs, CONTROL_BLOCK, rng);

    beatPos += (tempo / 60) * ((double)CONTROL_BLOCK / fs);
    songBeat += (tempo / 60) * ((double)CONTROL_BLOCK / fs);
    if (beatPos >= 4) beatPos -= 4;

    fxOtt.set(cur[P.ottDepth], cur[P.ottLowcut], fs);

    chorusDepth = clampd(cur[P.chorusDepth] + dst[D_CHORUS_DEPTH], 0, 1);
    phaserMix = clampd(cur[P.phaserMix] + dst[D_PHASER_MIX], 0, 1);
    widthTarget = clampd(1 + dst[D_WIDTH], 0, 2);
    widthStep = (widthTarget - width) / CONTROL_BLOCK;

    for (int k = 0; k < 5; k++) {
      const double lowcut = cur[P.fxLowcut[k]];
      if (lowcut != lastLowcut[k]) {
        hpL[k].setHighpass(lowcut, SQRT1_2, fs);
        hpR[k].setHighpass(lowcut, SQRT1_2, fs);
        lastLowcut[k] = lowcut;
      }
    }
    for (int b = 0; b < 4; b++) {
      const auto& e = P.eq[b];
      const int o = 4 * b;
      const double type = cur[e.type], hz = std::fmin(cur[e.freq], fs * 0.45), db = cur[e.gain] * cur[P.eqScale], q = cur[e.q];
      eqOn[b] = type > 0.5 || std::fabs(db) > 0.01;
      if (!eqOn[b] || (eqLast[o] == type && eqLast[o + 1] == hz && eqLast[o + 2] == db && eqLast[o + 3] == q)) continue;
      eqLast[o] = type;
      eqLast[o + 1] = hz;
      eqLast[o + 2] = db;
      eqLast[o + 3] = q;
      for (Biquad* f : {&eqL[b], &eqR[b]}) {
        if (b == 0) type > 0.5 ? f->setHighpass(hz, q, fs) : f->setLowShelf(hz, db, fs, q);
        else if (b == 3) type > 0.5 ? f->setLowpass(hz, q, fs) : f->setHighShelf(hz, db, fs, q);
        else type > 0.5 ? f->setNotch(hz, q, fs) : f->setPeak(hz, db, q, fs);
      }
    }
    if (cur[P.crossover] != lastFx[5]) {
      for (int i = 0; i < 4; i++) xo[i].setHighpass(cur[P.crossover], XO_Q[i], fs);
      for (int i = 0; i < 2; i++) xoPost[i].setHighpass(cur[P.crossover], SUBSONIC_Q[i], fs);
      lastFx[5] = cur[P.crossover];
    }
    if (cur[P.eqHighcut] != lastFx[6]) {
      const double hc = cur[P.eqHighcut];
      highcutOn = hc < 19500;
      if (highcutOn) {
        hcL.setLowpass(std::fmin(hc, fs * 0.45), SQRT1_2, fs);
        hcR.setLowpass(std::fmin(hc, fs * 0.45), SQRT1_2, fs);
      }
      lastFx[6] = hc;
    }
    if (cur[P.outGain] != lastOutDb) {
      outTarget = std::pow(10.0, cur[P.outGain] / 20);
      lastOutDb = cur[P.outGain];
    }
    outGainStep = (outTarget - outGain) / CONTROL_BLOCK;
  }

  // Parameters.
  std::array<double, PARAM_COUNT> target{}, cur{}, raw{};
  std::array<double, DEST_COUNT> dstMask{};
  std::array<bool, PARAM_COUNT> isLog{}, isDiscrete{};
  int monSolo = 0, monMute = 0;
  double smoothCoef = 0, duckGain = 1, duckStep = 0;
  int duckDir = 0, duckHold = 0;

  // Voices and notes.
  std::vector<std::unique_ptr<Voice>> voices;
  int poly = 1;
  long long order = 0;
  std::array<int, 16> stack{};
  int stackLen = 0;
  double bend = 0, modWheel = 0, wheel = 0, texMon = 1, texMonTarget = 1;
  std::array<double, DEST_COUNT> xdst{};
  double chBend[16] = {}, chPressure[16] = {}, chSlide[16] = {0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5};

  // Shared modulation.
  Rng rng;
  Rng wobRng;
  std::array<double, LFO_COUNT> lfoHold{}, lfoPrev{};
  std::array<double, SRC_COUNT> gsrc{};
  double driftVal = 0, driftTarget = 0;
  int driftCount = 0;
  double slowA = 0, slowB = 0, slowPos = 1, slowStep = 0;
  double tempo = 120, beatPos = 0, songBeat = 0;

  // The Wobbler.
  double wobCycle = -1, wobScale = 1, wobScaleTarget = 1, wobBright = 0, wobBrightTarget = 0;
  std::array<double, WOB_MAX_POINTS> wobXs{}, wobYs{}, wobSs{};
  double wobV = 0;
  int wobShapeNow = 0, wobPtsNow = 0;
  double wobSig = 0;
  std::array<double, WOB_TABLE> wobTable{}, wobTmp{};
  std::array<double, WOB_RANDOM_STEPS> wobRand{};
  double wobRandCycle = -1;
  Biquad wobBand[2][4];
  double wobBandLc = -1;
  Svf wobSvf[2][2];
  bool wobFiltOn = false, wobFiltWas = false;
  double wobG = 0, wobGStep = 0, wobK = 1.3, wobGate = 1, wobGateTarget = 1;

  // GRIND on the noise bed, and its OTT on the whole synth.
  Rng texGrindRng;
  Grind texGrind;
  bool texGrindOn = false;
  Ott ott;
  /** The FX page's OTT: after the phaser, before the EQ. */
  Ott fxOtt;

  // Texture bed.
  Texture texture;
  SlotFilter<2> texF;
  Svf texNL, texNR;
  bool texRouteN = false;
  double texNG = 0.1, texNK = 1.4;
  int texNMode = 0;
  bool texPanOn = false;
  double texPanL = 1, texPanR = 1;
  bool texDirect = false;
  double texEnv = 0, texGain = 0;
  int texType = 0;
  double texTone = 0.4, texDensity = 0.5, texRate = 1, texPos = 1;
  double texPrev[2] = {}, texCur[2] = {};
  double texAtk = 0.001, texRel = 0.999, texLpL = 0, texLpR = 0, texLpCoef = 1;
  bool anyGate = false;

  // FX + output.
  Chorus chorus;
  Phaser phaser;
  Flanger flanger;
  double chorusDepth = 0, phaserMix = 0, width = 1, widthStep = 0, widthTarget = 1;
  Biquad hcL, hcR;
  bool highcutOn = false;
  std::array<bool, 4> eqOn{};
  std::array<double, 16> eqLast{};
  Biquad hpL[5], hpR[5];
  std::array<double, 5> lastLowcut{};
  Biquad eqL[4], eqR[4], dcL[2], dcR[2], xo[4], xoPost[2];
  Limiter limiter;
  double outGain = 1, outGainStep = 0, outTarget = 1, lastOutDb = NAN;
  double postDcXL = 0, postDcYL = 0, postDcXR = 0, postDcYR = 0, postDcR = 0;
  std::array<double, 8> lastFx{};
  int ctrlCount = 0;
};

}  // namespace lt
