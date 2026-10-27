// Dev test for the plugin-only engine additions (not covered by the parity
// check): MPE per-note bend / pressure, and the host-locked Wobbler clock.
//   g++ -std=c++17 -O2 -I engine tools/engine_test.cpp -o engine_test && ./engine_test
#include <cstdio>
#include <vector>
#include "Synth.h"

using namespace lt;
static int fails = 0;
static void check(bool ok, const char* what) {
  std::printf("%s %s\n", ok ? "ok  " : "FAIL", what);
  if (!ok) fails++;
}

static std::vector<double> plainPatch(int poly) {
  std::vector<double> v(PARAM_COUNT);
  for (int i = 0; i < PARAM_COUNT; i++) v[i] = PARAMS[i].def;
  auto set = [&](const char* id, double x) { v[paramIndex(id)] = x; };
  set("voice.polyphony", poly);
  set("osc1.wave", WAVE_SINE);
  set("osc1.unison_voices", 1);
  set("osc2.level", 0);
  set("sub.level", 0);
  set("voice.analog", 0);
  set("texture.level", 0);
  set("reverb.mix", 0);
  set("delay.mix", 0);
  set("chorus.mix", 0);
  set("tape.wow", 0);
  set("amp_env.sustain", 1);
  return v;
}

/** Rising zero crossings per second over the last half of `n` samples. */
static double freqOf(const std::vector<float>& x) {
  int count = 0;
  const size_t start = x.size() / 2;
  for (size_t i = start + 1; i < x.size(); i++)
    if (x[i - 1] < 0 && x[i] >= 0) count++;
  return count / ((x.size() - start) / 48000.0);
}

int main() {
  const double fs = 48000;
  {
    Synth s(fs);
    auto v = plainPatch(2);
    s.setParams(v.data(), true);
    s.noteOn(57, 0.8, 1);  // A3 on channel 2
    std::vector<float> l(48000), r(48000);
    s.render(l.data(), r.data(), 0, 48000);
    const double f0 = freqOf(l);
    s.setChannelBend(1, 12);
    s.render(l.data(), r.data(), 0, 48000);
    const double f1 = freqOf(l);
    check(f0 > 210 && f0 < 230, "an A3 plays at about 220 Hz");
    check(f1 > 425 && f1 < 455, "MPE bend +12 on its channel raises that note an octave");
    s.setChannelBend(5, -12);  // another channel: no effect
    s.render(l.data(), r.data(), 0, 48000);
    check(std::abs(freqOf(l) - f1) < 6, "bend on another channel leaves the note alone");
  }
  {
    // Pressure brightens (opens the filter): more energy above the fundamental on a saw.
    auto bright = [&](double pressure) {
      Synth s(fs);
      auto v = plainPatch(2);
      v[paramIndex("osc1.wave")] = WAVE_SAW;
      v[paramIndex("filter.cutoff")] = 300;
      s.setParams(v.data(), true);
      s.noteOn(45, 0.8, 1);
      s.setChannelPressure(1, pressure);
      std::vector<float> l(24000), r(24000);
      s.render(l.data(), r.data(), 0, 24000);
      double e = 0, prev = 0;
      for (size_t i = 12000; i < l.size(); i++) {
        const double d = l[i] - prev;  // first difference ≈ high-frequency weight
        e += d * d;
        prev = l[i];
      }
      return e;
    };
    check(bright(1.0) > 1.5 * bright(0.0), "MPE pressure plays the note brighter");
  }
  {
    // The Wobbler follows syncBeat: a square on the volume, open on the beat, shut halfway, wherever the host jumps to.
    Synth s(fs);
    auto v = plainPatch(1);
    v[paramIndex("wobble.on")] = 1;
    v[paramIndex("wobble.depth")] = 1;
    v[paramIndex("wobble.volume")] = 1;
    v[paramIndex("wobble.cutoff")] = 0;
    v[paramIndex("wobble.lowcut")] = 20;
    v[paramIndex("wobble.life")] = 0;
    v[paramIndex("wobble.shape")] = 3;  // square
    v[paramIndex("wobble.rate")] = 10;  // 1/4
    s.setParams(v.data(), true);
    s.setTempo(120);
    s.noteOn(57, 0.8);
    std::vector<float> l(48000), r(48000);
    s.render(l.data(), r.data(), 0, 24000);
    auto rmsAt = [&](double beat) {
      s.syncBeat(beat);
      std::vector<float> a(960), b(960);  // 20 ms, after 10 ms for the gate to settle
      s.render(a.data(), b.data(), 0, 480);
      s.render(a.data(), b.data(), 0, 960);
      double e = 0;
      for (float x : a) e += x * x;
      return std::sqrt(e / a.size());
    };
    const double open = rmsAt(2.1);
    const double shut = rmsAt(2.6);
    check(shut < 0.3 * open, "the Wobbler gates on the host's beat");
  }
  std::printf("%s\n", fails ? "FAILED" : "all ok");
  return fails ? 1 : 0;
}
