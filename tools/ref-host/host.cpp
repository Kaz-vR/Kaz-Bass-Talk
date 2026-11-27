// Minimal headless VST2 host (dev only): loads a plugin, sets parameters, runs a WAV or MIDI notes through it.
//   host.exe plugin.dll list
//   host.exe plugin.dll render in.wav|note:<midi>:<sec>:<vel> out.wav sr [p<i>=<v> ...] [chunk=<file>] [tail=<sec>]
#include <windows.h>
#include <cstdio>
#include <cstdint>
#include <cstring>
#include <cstdlib>
#include <vector>
#include <string>
struct AEffect;
typedef intptr_t (*Dispatcher)(AEffect*, int32_t, int32_t, intptr_t, void*, float);
typedef void (*Process)(AEffect*, float**, float**, int32_t);
typedef void (*SetParam)(AEffect*, int32_t, float);
typedef float (*GetParam)(AEffect*, int32_t);
struct AEffect {
  int32_t magic; Dispatcher dispatcher; Process process; SetParam setParameter; GetParam getParameter;
  int32_t numPrograms, numParams, numInputs, numOutputs, flags; intptr_t r1, r2; int32_t initialDelay, rq, oq; float ioRatio;
  void* object; void* user; int32_t uniqueID, version; Process processReplacing; void* processDouble; char future[56];
};
struct MidiEv { int32_t type, byteSize, deltaFrames, flags, noteLength, noteOffset; char data[4]; char detune, offVel, r1, r2; };
struct Events { int32_t num; intptr_t reserved; void* ev[2]; };
static double g_sr = 48000; static int g_block = 256;
struct TimeInfo { double samplePos, sampleRate, nanoSeconds, ppqPos, tempo, barStartPos, cycleStart, cycleEnd; int32_t tsNum, tsDen, smpteOffset, smpteRate, samplesToNextClock, flags; };
static TimeInfo g_ti;
extern "C" intptr_t host(AEffect*, int32_t op, int32_t, intptr_t, void* ptr, float) {
  switch (op) {
    case 1: return 2400;               // version
    case 6: return 1;                  // wantMidi
    case 7: g_ti.sampleRate = g_sr; g_ti.tempo = 120; g_ti.tsNum = 4; g_ti.tsDen = 4; g_ti.flags = (1 << 1) | (1 << 9) | (1 << 10) | (1 << 13); return (intptr_t)&g_ti;
    case 16: return (intptr_t)g_sr;
    case 17: return g_block;
    case 23: return 2;                 // currentProcessLevel: realtime
    case 32: if (ptr) strcpy((char*)ptr, "lt"); return 1;
    case 33: if (ptr) strcpy((char*)ptr, "lthost"); return 1;
    case 37: { const char* s = (const char*)ptr; if (!s) return 0; return (!strcmp(s, "sendVstEvents") || !strcmp(s, "sendVstMidiEvent") || !strcmp(s, "sendVstTimeInfo") || !strcmp(s, "receiveVstEvents") || !strcmp(s, "supplyIdle")) ? 1 : 0; }
    default: return 0;
  }
}
static std::vector<float> readWav(const char* p, int& ch, int& sr) {
  FILE* f = fopen(p, "rb"); std::vector<float> out; if (!f) return out;
  std::vector<unsigned char> b; unsigned char buf[65536]; size_t n; while ((n = fread(buf, 1, sizeof buf, f)) > 0) b.insert(b.end(), buf, buf + n); fclose(f);
  size_t i = 12; int fmt = 1, bits = 16; ch = 1; sr = 48000;
  while (i + 8 <= b.size()) {
    uint32_t sz; memcpy(&sz, &b[i + 4], 4); const unsigned char* d = &b[i + 8];
    if (!memcmp(&b[i], "fmt ", 4)) { uint16_t v; memcpy(&v, d, 2); fmt = v; memcpy(&v, d + 2, 2); ch = v; uint32_t s; memcpy(&s, d + 4, 4); sr = s; memcpy(&v, d + 14, 2); bits = v; }
    if (!memcmp(&b[i], "data", 4)) {
      size_t cnt = sz / (bits / 8);
      for (size_t k = 0; k < cnt; k++) {
        if (fmt == 3 && bits == 32) { float v; memcpy(&v, d + 4 * k, 4); out.push_back(v); }
        else if (bits == 16) { int16_t v; memcpy(&v, d + 2 * k, 2); out.push_back(v / 32768.f); }
        else if (bits == 24) { int32_t v = (d[3 * k] << 8) | (d[3 * k + 1] << 16) | (d[3 * k + 2] << 24); out.push_back(v / 2147483648.f); }
      }
    }
    i += 8 + sz + (sz & 1);
  }
  return out;
}
static void writeWav(const char* p, const std::vector<float>& x, int ch, int sr) {
  FILE* f = fopen(p, "wb"); uint32_t ds = x.size() * 4, rs = 36 + ds; uint16_t fmt = 3, c = ch, ba = 4 * ch, bits = 32; uint32_t s = sr, br = sr * 4 * ch, fs = 16;
  fwrite("RIFF", 1, 4, f); fwrite(&rs, 4, 1, f); fwrite("WAVEfmt ", 1, 8, f); fwrite(&fs, 4, 1, f); fwrite(&fmt, 2, 1, f); fwrite(&c, 2, 1, f);
  fwrite(&s, 4, 1, f); fwrite(&br, 4, 1, f); fwrite(&ba, 2, 1, f); fwrite(&bits, 2, 1, f); fwrite("data", 1, 4, f); fwrite(&ds, 4, 1, f); fwrite(x.data(), 4, x.size(), f); fclose(f);
}
int main(int argc, char** argv) {
  if (argc < 3) { printf("usage\n"); return 1; }
  HMODULE m = LoadLibraryA(argv[1]); if (!m) { printf("load failed %lu\n", GetLastError()); return 2; }
  typedef AEffect* (*Main)(void*); Main mn = (Main)GetProcAddress(m, "VSTPluginMain"); if (!mn) mn = (Main)GetProcAddress(m, "main");
  if (!mn) { printf("no VST2 entry\n"); return 3; }
  AEffect* e = mn((void*)host); if (!e || e->magic != 0x56737450) { printf("bad effect\n"); return 4; }
  std::string mode = argv[2];
  if (mode == "render" && argc > 5) g_sr = atof(argv[5]);
  e->dispatcher(e, 0, 0, 0, 0, 0);
  e->dispatcher(e, 10, 0, 0, 0, (float)g_sr); e->dispatcher(e, 11, 0, g_block, 0, 0);
  char name[256] = {0}; e->dispatcher(e, 45, 0, 0, name, 0);
  if (mode == "list") {
    printf("%s: %d params, %d in, %d out, %d programs, flags %x, delay %d\n", name, e->numParams, e->numInputs, e->numOutputs, e->numPrograms, e->flags, e->initialDelay);
    for (int i = 0; i < e->numParams; i++) { char n[256] = {0}, d[256] = {0}, l[64] = {0}; e->dispatcher(e, 8, i, 0, n, 0); e->dispatcher(e, 7, i, 0, d, 0); e->dispatcher(e, 6, i, 0, l, 0); printf("%d\t%s\t%.4f\t%s %s\n", i, n, e->getParameter(e, i), d, l); }
    return 0;
  }
  if (mode == "scan" && argc > 4) {  // scan <param> <steps>: the display at each value
    const int pi = atoi(argv[3]), n = atoi(argv[4]);
    for (int k = 0; k < n; k++) { const float v = n > 1 ? (float)k / (n - 1) : 0; e->setParameter(e, pi, v); char d[256] = {0}, l[64] = {0}; e->dispatcher(e, 7, pi, 0, d, 0); e->dispatcher(e, 6, pi, 0, l, 0); printf("%.5f\t%s %s\n", v, d, l); }
    return 0;
  }
  const char* in = argv[3]; const char* outp = argv[4];
  double tail = 2; std::vector<std::pair<int, float>> sets; std::string chunk;
  for (int a = 6; a < argc; a++) {
    std::string s = argv[a];
    if (s.rfind("tail=", 0) == 0) tail = atof(s.c_str() + 5);
    else if (s.rfind("chunk=", 0) == 0) chunk = s.substr(6);
    else if (s[0] == 'p') { size_t q = s.find('='); sets.push_back({atoi(s.substr(1, q - 1).c_str()), (float)atof(s.c_str() + q + 1)}); }
  }
  if (!chunk.empty()) { FILE* f = fopen(chunk.c_str(), "rb"); std::vector<char> b; char t[65536]; size_t n; while ((n = fread(t, 1, sizeof t, f)) > 0) b.insert(b.end(), t, t + n); fclose(f); e->dispatcher(e, 24, 0, b.size(), b.data(), 0); }
  for (auto& p : sets) e->setParameter(e, p.first, p.second);
  // input: a WAV, or a held note
  int ich = 1, isr = (int)g_sr; std::vector<float> x; int note = -1, vel = 100; double noteLen = 0;
  if (!strncmp(in, "note:", 5)) { sscanf(in + 5, "%d:%lf:%d", &note, &noteLen, &vel); }
  else x = readWav(in, ich, isr);
  const size_t frames = note >= 0 ? (size_t)((noteLen + tail) * g_sr) : x.size() / ich + (size_t)(tail * g_sr);
  const int nin = e->numInputs, nout = e->numOutputs;
  std::vector<std::vector<float>> ib(nin > 0 ? nin : 1, std::vector<float>(g_block)), ob(nout, std::vector<float>(g_block));
  std::vector<float*> ip(ib.size()), op(nout); for (size_t i = 0; i < ib.size(); i++) ip[i] = ib[i].data(); for (int i = 0; i < nout; i++) op[i] = ob[i].data();
  std::vector<float> out; out.reserve(frames * 2);
  e->dispatcher(e, 12, 0, 1, 0, 0); e->dispatcher(e, 71, 0, 0, 0, 0);
  // settle (parameter smoothing) before the signal
  for (int k = 0; k < (int)(0.3 * g_sr / g_block); k++) {
    // (some plugins only take certain changes while running: set them again mid-way through the settle)
    if (k == (int)(0.15 * g_sr / g_block)) for (auto& p : sets) e->setParameter(e, p.first, p.second);
    for (auto& v : ib) std::fill(v.begin(), v.end(), 0.f);
    e->processReplacing(e, ip.data(), op.data(), g_block);
  }
  const size_t offAt = note >= 0 ? (size_t)(noteLen * g_sr) : 0;
  for (size_t pos = 0; pos < frames; pos += g_block) {
    g_ti.samplePos = pos;
    if (note >= 0) {
      static MidiEv ev; static Events evs; int sendKind = 0, d = 0;
      if (pos == 0) { sendKind = 1; d = 0; } else if (offAt >= pos && offAt < pos + g_block) { sendKind = 2; d = (int)(offAt - pos); }
      if (sendKind) {
        memset(&ev, 0, sizeof ev); ev.type = 1; ev.byteSize = sizeof ev; ev.deltaFrames = d;
        ev.data[0] = (char)(sendKind == 1 ? 0x90 : 0x80); ev.data[1] = (char)note; ev.data[2] = (char)(sendKind == 1 ? vel : 0);
        evs.num = 1; evs.reserved = 0; evs.ev[0] = &ev; e->dispatcher(e, 25, 0, 0, &evs, 0);
      }
    }
    for (int c = 0; c < (int)ib.size(); c++) for (int i = 0; i < g_block; i++) {
      size_t s = pos + i; int cc = ich > 1 ? (c < ich ? c : ich - 1) : 0;
      ib[c][i] = (note < 0 && s < x.size() / ich) ? x[s * ich + cc] : 0.f;
    }
    e->processReplacing(e, ip.data(), op.data(), g_block);
    for (int i = 0; i < g_block && pos + i < frames; i++) { out.push_back(op[0][i]); out.push_back(nout > 1 ? op[1][i] : op[0][i]); }
  }
  writeWav(outp, out, 2, (int)g_sr);
  printf("ok %s %zu frames, delay %d\n", name, out.size() / 2, e->initialDelay);
  e->dispatcher(e, 72, 0, 0, 0, 0); e->dispatcher(e, 12, 0, 0, 0, 0); e->dispatcher(e, 1, 0, 0, 0, 0);
  return 0;
}
