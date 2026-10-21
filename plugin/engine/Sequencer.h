// Audition-loop player (port of src/engine/core/sequencer.ts LoopPlayer):
// fires compiled loop events at their exact sample. Used by the parity tool and
// by the plugin window's AUDITION (setLoop copies into reserved space: no allocation).
#pragma once
#include <algorithm>
#include <cmath>
#include <vector>
#include "Synth.h"

namespace lt {

struct LoopEvent { double beat; int type; int note; double vel; };

class LoopPlayer {
 public:
  bool playing = false;
  static constexpr int MAX_EVENTS = 1024;
  LoopPlayer(Synth& s, std::vector<LoopEvent> ev, double lengthBeats, double bpm)
      : synth(s), events(std::move(ev)), length(lengthBeats), tempo(bpm) {
    synth.setTempo(bpm);
  }
  explicit LoopPlayer(Synth& s) : synth(s), length(4), tempo(120) { events.reserve(MAX_EVENTS); }
  /** Replace the loop (keeps playing from its start if it was playing). */
  void setLoop(const LoopEvent* ev, int n, double lengthBeats, double bpm) {
    if (playing) synth.allNotesOff();
    events.assign(ev, ev + std::min(n, MAX_EVENTS));
    length = lengthBeats > 0 ? lengthBeats : 4;
    tempo = bpm > 0 ? bpm : 120;
    beat = 0;
    next = 0;
    if (playing) synth.syncBeat(0);
  }
  double bpm() const { return tempo; }
  void start() {
    synth.setTempo(tempo);
    beat = 0;
    next = 0;
    playing = true;
    synth.syncBeat(0);
  }
  void stop() {
    if (playing) synth.allNotesOff();
    playing = false;
  }
  void render(float* outL, float* outR, int offset, int frames) {
    const int count = (int)events.size();
    if (!playing || count == 0) {
      synth.render(outL, outR, offset, frames);
      return;
    }
    const double beatsPerSample = tempo / 60 / synth.sampleRate;
    int pos = offset;
    const int end = offset + frames;
    while (pos < end) {
      while (next < count && events[next].beat <= beat + 1e-9) {
        const auto& e = events[next];
        if (e.type == 1) synth.noteOn(e.note, e.vel);
        else synth.noteOff(e.note);
        next++;
      }
      const double nextBeat = next < count ? events[next].beat : length;
      int n = (int)std::ceil((nextBeat - beat) / beatsPerSample - 1e-9);
      if (n < 1) n = 1;
      if (n > end - pos) n = end - pos;
      synth.render(outL, outR, pos, n);
      pos += n;
      beat += n * beatsPerSample;
      if (beat >= length - 1e-9 && next >= count) {
        beat -= length;
        if (beat < 0) beat = 0;
        next = 0;
        synth.syncBeat(beat);
      }
    }
  }
 private:
  Synth& synth;
  std::vector<LoopEvent> events;
  double length, tempo, beat = 0;
  int next = 0;
};

}  // namespace lt
