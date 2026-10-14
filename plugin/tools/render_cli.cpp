// Dev tool: renders a patch playing a loop with the C++ engine, for the parity
// check against the TypeScript prototype (tools/plugin-parity.ts).
//   lowtalk_render <job.txt> <out.f32>
// job.txt: "sampleRate seconds tail modWheel" / PARAM_COUNT values / "bpm lengthBeats count" / count × "beat type note vel"
// out.f32: left then right channel, float32 little-endian.
#include <cstdio>
#include <fstream>
#include <vector>
#include "../engine/Sequencer.h"

int main(int argc, char** argv) {
  if (argc < 3) {
    std::fprintf(stderr, "usage: lowtalk_render job.txt out.f32\n");
    return 2;
  }
  std::ifstream in(argv[1]);
  double fs, seconds, tail, wheel;
  in >> fs >> seconds >> tail >> wheel;
  std::vector<double> values(lt::PARAM_COUNT);
  for (auto& v : values) in >> v;
  double bpm, length;
  int count;
  in >> bpm >> length >> count;
  std::vector<lt::LoopEvent> ev(count);
  for (auto& e : ev) in >> e.beat >> e.type >> e.note >> e.vel;
  lt::Synth synth(fs);
  synth.setParams(values.data(), true);
  if (wheel > 0) synth.setModWheel(wheel);
  lt::LoopPlayer player(synth, ev, length, bpm);
  player.start();
  const int total = (int)std::lround((seconds + tail) * fs);
  const int playFrames = (int)std::lround(seconds * fs);
  std::vector<float> l(total), r(total);
  for (int pos = 0; pos < total; pos += 128) {
    if (pos >= playFrames && player.playing) player.stop();
    player.render(l.data(), r.data(), pos, std::min(128, total - pos));
  }
  std::FILE* f = std::fopen(argv[2], "wb");
  std::fwrite(l.data(), 4, total, f);
  std::fwrite(r.data(), 4, total, f);
  std::fclose(f);
  return 0;
}
