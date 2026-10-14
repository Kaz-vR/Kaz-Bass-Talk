// Audition-loop player (port of src/engine/core/sequencer.ts LoopPlayer):
// fires compiled loop events at their exact sample. Used by the parity tool.
#pragma once
#include <cmath>
#include <vector>
#include "Synth.h"

namespace lt {

struct LoopEvent { double beat; int type; int note; double vel; };

class LoopPlayer {
 public:
  bool playing = false;
  LoopPlayer(Synth& s, std::vector<LoopEvent> ev, double lengthBeats, double bpm)
      : synth(s), events(std::move(ev)), length(lengthBeats), tempo(bpm) {
    synth.setTempo(bpm);
  }
  void start() {
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
