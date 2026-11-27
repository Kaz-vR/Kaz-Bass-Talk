// Minimal headless VST3 host (dev only): loads a plugin, sets parameters, runs a WAV through it.
// Built against Steinberg's pluginterfaces (fetched at build time, never shipped):
//   x86_64-w64-mingw32-g++ -O2 -static -I<pluginterfaces parent> host3.cpp <pi>/base/funknown.cpp <pi>/base/coreiids.cpp -o host3.exe -lole32
//   host3.exe plugin.vst3 list
//   host3.exe plugin.vst3 scan <paramId> <steps>
//   host3.exe plugin.vst3 render in.wav out.wav <rate> [<paramId>=<0..1> ...] [tail=<s>]
// (defines the interfaces' IIDs in this file, as the SDK does in one translation unit)
#define INIT_CLASS_IID
#include <windows.h>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <string>
#include <vector>
#include "pluginterfaces/base/ipluginbase.h"
#include "pluginterfaces/base/ibstream.h"
#include "pluginterfaces/vst/ivstaudioprocessor.h"
#include "pluginterfaces/vst/ivstcomponent.h"
#include "pluginterfaces/vst/ivsteditcontroller.h"
#include "pluginterfaces/vst/ivsthostapplication.h"
#include "pluginterfaces/vst/ivstmessage.h"
#include "pluginterfaces/vst/ivstparameterchanges.h"
#include "pluginterfaces/vst/ivstprocesscontext.h"

using namespace Steinberg;
using namespace Steinberg::Vst;

// ---- host objects ----
class HostApp : public IHostApplication {
 public:
  tresult PLUGIN_API getName(String128 name) override { const char* n = "lthost3"; for (int i = 0; i < 8; i++) name[i] = (char16)n[i]; return kResultOk; }
  tresult PLUGIN_API createInstance(TUID, TUID, void** obj) override { *obj = nullptr; return kResultFalse; }
  tresult PLUGIN_API queryInterface(const TUID iid, void** obj) override {
    if (FUnknownPrivate::iidEqual(iid, IHostApplication::iid) || FUnknownPrivate::iidEqual(iid, FUnknown::iid)) { *obj = this; return kResultOk; }
    *obj = nullptr; return kNoInterface;
  }
  uint32 PLUGIN_API addRef() override { return 1; }
  uint32 PLUGIN_API release() override { return 1; }
};

class MemStream : public IBStream {
 public:
  std::vector<char> d; int64 pos = 0;
  tresult PLUGIN_API read(void* buf, int32 n, int32* got) override { int32 k = (int32)std::min<int64>(n, (int64)d.size() - pos); if (k < 0) k = 0; memcpy(buf, d.data() + pos, k); pos += k; if (got) *got = k; return kResultOk; }
  tresult PLUGIN_API write(void* buf, int32 n, int32* put) override { if (pos + n > (int64)d.size()) d.resize(pos + n); memcpy(d.data() + pos, buf, n); pos += n; if (put) *put = n; return kResultOk; }
  tresult PLUGIN_API seek(int64 p, int32 mode, int64* res) override { pos = mode == kIBSeekSet ? p : mode == kIBSeekCur ? pos + p : (int64)d.size() + p; if (res) *res = pos; return kResultOk; }
  tresult PLUGIN_API tell(int64* p) override { if (p) *p = pos; return kResultOk; }
  tresult PLUGIN_API queryInterface(const TUID iid, void** obj) override {
    if (FUnknownPrivate::iidEqual(iid, IBStream::iid) || FUnknownPrivate::iidEqual(iid, FUnknown::iid)) { *obj = this; return kResultOk; }
    *obj = nullptr; return kNoInterface;
  }
  uint32 PLUGIN_API addRef() override { return 1; }
  uint32 PLUGIN_API release() override { return 1; }
};

class Queue : public IParamValueQueue {
 public:
  ParamID id = 0; std::vector<std::pair<int32, ParamValue>> pts;
  ParamID PLUGIN_API getParameterId() override { return id; }
  int32 PLUGIN_API getPointCount() override { return (int32)pts.size(); }
  tresult PLUGIN_API getPoint(int32 i, int32& off, ParamValue& v) override { if (i < 0 || i >= (int32)pts.size()) return kResultFalse; off = pts[i].first; v = pts[i].second; return kResultOk; }
  tresult PLUGIN_API addPoint(int32 off, ParamValue v, int32& i) override { pts.push_back({off, v}); i = (int32)pts.size() - 1; return kResultOk; }
  tresult PLUGIN_API queryInterface(const TUID iid, void** obj) override {
    if (FUnknownPrivate::iidEqual(iid, IParamValueQueue::iid) || FUnknownPrivate::iidEqual(iid, FUnknown::iid)) { *obj = this; return kResultOk; }
    *obj = nullptr; return kNoInterface;
  }
  uint32 PLUGIN_API addRef() override { return 1; }
  uint32 PLUGIN_API release() override { return 1; }
};

class Changes : public IParameterChanges {
 public:
  std::vector<Queue*> qs;
  int32 PLUGIN_API getParameterCount() override { return (int32)qs.size(); }
  IParamValueQueue* PLUGIN_API getParameterData(int32 i) override { return i >= 0 && i < (int32)qs.size() ? qs[i] : nullptr; }
  IParamValueQueue* PLUGIN_API addParameterData(const ParamID& id, int32& i) override {
    for (size_t k = 0; k < qs.size(); k++) if (qs[k]->id == id) { i = (int32)k; return qs[k]; }
    Queue* q = new Queue(); q->id = id; qs.push_back(q); i = (int32)qs.size() - 1; return q;
  }
  tresult PLUGIN_API queryInterface(const TUID iid, void** obj) override {
    if (FUnknownPrivate::iidEqual(iid, IParameterChanges::iid) || FUnknownPrivate::iidEqual(iid, FUnknown::iid)) { *obj = this; return kResultOk; }
    *obj = nullptr; return kNoInterface;
  }
  uint32 PLUGIN_API addRef() override { return 1; }
  uint32 PLUGIN_API release() override { return 1; }
};

class Handler : public IComponentHandler {
 public:
  tresult PLUGIN_API beginEdit(ParamID) override { return kResultOk; }
  tresult PLUGIN_API performEdit(ParamID, ParamValue) override { return kResultOk; }
  tresult PLUGIN_API endEdit(ParamID) override { return kResultOk; }
  tresult PLUGIN_API restartComponent(int32) override { return kResultOk; }
  tresult PLUGIN_API queryInterface(const TUID iid, void** obj) override {
    if (FUnknownPrivate::iidEqual(iid, IComponentHandler::iid) || FUnknownPrivate::iidEqual(iid, FUnknown::iid)) { *obj = this; return kResultOk; }
    *obj = nullptr; return kNoInterface;
  }
  uint32 PLUGIN_API addRef() override { return 1; }
  uint32 PLUGIN_API release() override { return 1; }
};

// ---- WAV ----
static std::vector<float> readWav(const char* p, int& ch) {
  FILE* f = fopen(p, "rb"); std::vector<float> out; if (!f) return out;
  std::vector<unsigned char> b; unsigned char buf[65536]; size_t n; while ((n = fread(buf, 1, sizeof buf, f)) > 0) b.insert(b.end(), buf, buf + n); fclose(f);
  size_t i = 12; int fmt = 1, bits = 16; ch = 1;
  while (i + 8 <= b.size()) {
    uint32_t sz; memcpy(&sz, &b[i + 4], 4); const unsigned char* d = &b[i + 8];
    if (!memcmp(&b[i], "fmt ", 4)) { uint16_t v; memcpy(&v, d, 2); fmt = v; memcpy(&v, d + 2, 2); ch = v; memcpy(&v, d + 14, 2); bits = v; }
    if (!memcmp(&b[i], "data", 4)) for (size_t k = 0; k < sz / (bits / 8); k++) {
      if (fmt == 3 && bits == 32) { float v; memcpy(&v, d + 4 * k, 4); out.push_back(v); }
      else if (bits == 16) { int16_t v; memcpy(&v, d + 2 * k, 2); out.push_back(v / 32768.f); }
    }
    i += 8 + sz + (sz & 1);
  }
  return out;
}
static void writeWav(const char* p, const std::vector<float>& x, int sr) {
  FILE* f = fopen(p, "wb"); uint32_t ds = (uint32_t)x.size() * 4, rs = 36 + ds; uint16_t fmt = 3, c = 2, ba = 8, bits = 32; uint32_t s = sr, br = sr * 8, fs = 16;
  fwrite("RIFF", 1, 4, f); fwrite(&rs, 4, 1, f); fwrite("WAVEfmt ", 1, 8, f); fwrite(&fs, 4, 1, f); fwrite(&fmt, 2, 1, f); fwrite(&c, 2, 1, f);
  fwrite(&s, 4, 1, f); fwrite(&br, 4, 1, f); fwrite(&ba, 2, 1, f); fwrite(&bits, 2, 1, f); fwrite("data", 1, 4, f); fwrite(&ds, 4, 1, f); fwrite(x.data(), 4, x.size(), f); fclose(f);
}
static std::string narrow(const String128 s) { std::string o; for (int i = 0; i < 128 && s[i]; i++) o += (char)(s[i] < 128 ? s[i] : '?'); return o; }

int main(int argc, char** argv) {
  if (argc < 3) { printf("usage\n"); return 1; }
  HMODULE m = LoadLibraryA(argv[1]); if (!m) { printf("load failed %lu\n", GetLastError()); return 2; }
  typedef bool (*InitFn)(); InitFn init = (InitFn)GetProcAddress(m, "InitDll"); if (init) init();
  typedef IPluginFactory* (*GetFactory)(); GetFactory gf = (GetFactory)GetProcAddress(m, "GetPluginFactory");
  if (!gf) { printf("no GetPluginFactory\n"); return 3; }
  IPluginFactory* fac = gf();
  HostApp host; Handler handler;
  IComponent* comp = nullptr; TUID cid;
  for (int32 i = 0; i < fac->countClasses(); i++) {
    PClassInfo ci; fac->getClassInfo(i, &ci);
    if (!strcmp(ci.category, kVstAudioEffectClass)) { memcpy(cid, ci.cid, sizeof(TUID)); if (fac->createInstance(ci.cid, IComponent::iid, (void**)&comp) == kResultOk) { printf("class: %s\n", ci.name); break; } }
  }
  if (!comp) { printf("no audio component\n"); return 4; }
  if (comp->initialize(&host) != kResultOk) { printf("component init failed\n"); return 5; }
  IEditController* ctl = nullptr;
  if (comp->queryInterface(IEditController::iid, (void**)&ctl) != kResultOk || !ctl) {
    TUID ccid; if (comp->getControllerClassId(ccid) == kResultOk && fac->createInstance(ccid, IEditController::iid, (void**)&ctl) == kResultOk) ctl->initialize(&host);
  }
  if (!ctl) { printf("no controller\n"); return 6; }
  ctl->setComponentHandler(&handler);
  IConnectionPoint *cp1 = nullptr, *cp2 = nullptr;
  if (comp->queryInterface(IConnectionPoint::iid, (void**)&cp1) == kResultOk && ctl->queryInterface(IConnectionPoint::iid, (void**)&cp2) == kResultOk && cp1 && cp2) { cp1->connect(cp2); cp2->connect(cp1); }
  { MemStream st; if (comp->getState(&st) == kResultOk) { st.pos = 0; ctl->setComponentState(&st); } }
  std::string mode = argv[2];
  if (mode == "list") {
    for (int32 i = 0; i < ctl->getParameterCount(); i++) {
      ParameterInfo pi; ctl->getParameterInfo(i, pi); String128 disp = {0}; ctl->getParamStringByValue(pi.id, ctl->getParamNormalized(pi.id), disp);
      printf("%u\t%s\t%.4f\t%s %s\t(steps %d)\n", pi.id, narrow(pi.title).c_str(), ctl->getParamNormalized(pi.id), narrow(disp).c_str(), narrow(pi.units).c_str(), pi.stepCount);
    }
    return 0;
  }
  if (mode == "scan" && argc > 4) {
    const ParamID id = (ParamID)atoi(argv[3]); const int n = atoi(argv[4]);
    for (int k = 0; k < n; k++) { const double v = n > 1 ? (double)k / (n - 1) : 0; String128 d = {0}; ctl->getParamStringByValue(id, v, d); printf("%.5f\t%s\n", v, narrow(d).c_str()); }
    return 0;
  }
  if (mode != "render" || argc < 6) { printf("usage\n"); return 1; }
  const double sr = atof(argv[5]); const int block = 256;
  double tail = 1; std::vector<std::pair<ParamID, double>> sets;
  for (int a = 6; a < argc; a++) {
    std::string s = argv[a];
    if (s.rfind("tail=", 0) == 0) tail = atof(s.c_str() + 5);
    else { size_t q = s.find('='); if (q != std::string::npos) sets.push_back({(ParamID)atoi(s.substr(0, q).c_str()), atof(s.c_str() + q + 1)}); }
  }
  IAudioProcessor* proc = nullptr;
  if (comp->queryInterface(IAudioProcessor::iid, (void**)&proc) != kResultOk) { printf("no processor\n"); return 7; }
  SpeakerArrangement st = SpeakerArr::kStereo, st2 = SpeakerArr::kStereo;
  proc->setBusArrangements(&st, 1, &st2, 1);
  ProcessSetup ps{kRealtime, kSample32, block, sr};
  proc->setupProcessing(ps);
  comp->activateBus(kAudio, kInput, 0, true); comp->activateBus(kAudio, kOutput, 0, true);
  comp->setActive(true); proc->setProcessing(true);
  for (auto& p : sets) ctl->setParamNormalized(p.first, p.second);
  int ich = 2; std::vector<float> x = readWav(argv[3], ich);
  const size_t frames = x.size() / ich + (size_t)(tail * sr);
  std::vector<float> inL(block), inR(block), outL(block), outR(block);
  float* ins[2] = {inL.data(), inR.data()}; float* outs[2] = {outL.data(), outR.data()};
  AudioBusBuffers ib, ob; ib.numChannels = 2; ib.silenceFlags = 0; ib.channelBuffers32 = ins; ob.numChannels = 2; ob.silenceFlags = 0; ob.channelBuffers32 = outs;
  ProcessContext ctx{}; ctx.sampleRate = sr; ctx.tempo = 120; ctx.timeSigNumerator = 4; ctx.timeSigDenominator = 4; ctx.state = ProcessContext::kPlaying | ProcessContext::kTempoValid;
  std::vector<float> out; out.reserve(frames * 2);
  auto run = [&](bool feed, size_t pos, Changes* ch) {
    for (int i = 0; i < block; i++) {
      size_t s = pos + i;
      inL[i] = feed && s < x.size() / ich ? x[s * ich] : 0.f;
      inR[i] = feed && s < x.size() / ich ? x[s * ich + (ich > 1 ? 1 : 0)] : 0.f;
    }
    ProcessData d; d.processMode = kRealtime; d.symbolicSampleSize = kSample32; d.numSamples = block;
    d.numInputs = 1; d.numOutputs = 1; d.inputs = &ib; d.outputs = &ob; d.inputParameterChanges = ch; d.outputParameterChanges = nullptr;
    d.inputEvents = nullptr; d.outputEvents = nullptr; d.processContext = &ctx;
    proc->process(d); ctx.projectTimeSamples += block;
  };
  // settle: parameters sent on the first block (and again half-way), then silence, so smoothing is done before the signal
  const int settle = (int)(0.3 * sr / block);
  for (int k = 0; k < settle; k++) {
    Changes ch; Changes* pc = nullptr;
    if (k == 0 || k == settle / 2) { for (auto& p : sets) { int32 qi; ch.addParameterData(p.first, qi)->addPoint(0, p.second, qi); } pc = &ch; }
    run(false, 0, pc);
  }
  for (size_t pos = 0; pos < frames; pos += block) {
    run(true, pos, nullptr);
    for (int i = 0; i < block && pos + i < frames; i++) { out.push_back(outL[i]); out.push_back(outR[i]); }
  }
  writeWav(argv[4], out, (int)sr);
  printf("ok %zu frames, latency %u\n", out.size() / 2, proc->getLatencySamples());
  proc->setProcessing(false); comp->setActive(false);
  return 0;
}
