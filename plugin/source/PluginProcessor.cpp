#include "PluginProcessor.h"
#include "PluginEditor.h"
#include <BinaryData.h>

namespace {
juce::String unitText(const lt::ParamSpec& p, float v) {
  const juce::String unit(p.unit);
  if (unit == "Hz" && v >= 1000) return juce::String(v / 1000.f, 2) + " kHz";
  if (unit == "ms" && v >= 1000) return juce::String(v / 1000.f, 2) + " s";
  if (unit == "%") return juce::String(juce::roundToInt(v * 100.f)) + " %";
  const int decimals = std::abs(v) >= 100 ? 0 : std::abs(v) >= 10 ? 1 : 2;
  return juce::String(v, decimals) + (unit.isEmpty() ? "" : " " + unit);
}
}  // namespace

juce::AudioProcessorValueTreeState::ParameterLayout LowTalkProcessor::createLayout() {
  juce::AudioProcessorValueTreeState::ParameterLayout layout;
  for (int i = 0; i < lt::PARAM_COUNT; i++) {
    const lt::ParamSpec& p = lt::PARAMS[i];
    const juce::ParameterID id{p.id, 1};
    const juce::String label(p.label);
    switch (p.type) {
      case lt::PType::Enum: {
        juce::StringArray opts;
        opts.addTokens(p.options, "|", "");
        layout.add(std::make_unique<juce::AudioParameterChoice>(id, label, opts, (int)p.def));
        break;
      }
      case lt::PType::Bool:
        layout.add(std::make_unique<juce::AudioParameterBool>(id, label, p.def > 0.5));
        break;
      case lt::PType::Int:
        layout.add(std::make_unique<juce::AudioParameterInt>(id, label, (int)p.min, (int)p.max, (int)p.def));
        break;
      case lt::PType::Float: {
        const float mn = (float)p.min, mx = (float)p.max;
        const int curve = p.curve;
        const float ex = (float)p.exponent;
        // The same curves as the prototype's knobs (src/schema toNormalized/fromNormalized).
        juce::NormalisableRange<float> range(
            mn, mx,
            [curve, ex](float a, float b, float t) {
              if (curve == 1) return a * std::pow(b / a, t);
              if (curve == 2) return a + (b - a) * std::pow(t, ex);
              return a + (b - a) * t;
            },
            [curve, ex](float a, float b, float v) {
              const float t = juce::jlimit(0.f, 1.f, (v - a) / (b - a));
              if (curve == 1) return std::log(v / a) / std::log(b / a);
              if (curve == 2) return std::pow(t, 1.f / ex);
              return t;
            });
        const lt::ParamSpec* spec = &p;
        layout.add(std::make_unique<juce::AudioParameterFloat>(
            id, label, range, (float)p.def,
            juce::AudioParameterFloatAttributes().withStringFromValueFunction(
                [spec](float v, int) { return unitText(*spec, v); })));
        break;
      }
    }
  }
  layout.add(std::make_unique<juce::AudioParameterFloat>(juce::ParameterID{WHEEL_ID, 1}, "Mod wheel", 0.f, 1.f, 0.f));
  layout.add(std::make_unique<juce::AudioParameterBool>(juce::ParameterID{MPE_ID, 1}, "MPE", true));
  return layout;
}

LowTalkProcessor::LowTalkProcessor()
    : AudioProcessor(BusesProperties().withOutput("Output", juce::AudioChannelSet::stereo(), true)),
      apvts(*this, nullptr, "LowTalk", createLayout()) {
  for (int i = 0; i < lt::PARAM_COUNT; i++) rawParams[i] = apvts.getRawParameterValue(lt::PARAMS[i].id);
  wheelParam = apvts.getRawParameterValue(WHEEL_ID);
  mpeParam = apvts.getRawParameterValue(MPE_ID);
  loadPresets();
  if (!presets.empty()) setCurrentProgram(0);
}

void LowTalkProcessor::loadPresets() {
  const auto json = juce::JSON::parse(juce::String::fromUTF8(BinaryData::presets_json, BinaryData::presets_jsonSize));
  if (auto* arr = json.getArray()) {
    for (const auto& item : *arr) {
      Preset p;
      p.name = item["name"].toString();
      p.shelf = item["shelf"].toString();
      p.description = item["description"].toString();
      if (auto* vals = item["values"].getArray())
        for (const auto& v : *vals) p.values.push_back((double)v);
      if ((int)p.values.size() == lt::PARAM_COUNT) presets.push_back(std::move(p));
    }
  }
}

void LowTalkProcessor::setCurrentProgram(int index) {
  if (index < 0 || index >= (int)presets.size()) return;
  currentProgram = index;
  setPresetName(presets[(size_t)index].name);
  stateSerial++;
  const auto& vals = presets[(size_t)index].values;
  for (int i = 0; i < lt::PARAM_COUNT; i++)
    if (auto* p = apvts.getParameter(lt::PARAMS[i].id))
      p->setValueNotifyingHost(p->convertTo0to1((float)vals[(size_t)i]));
}

const juce::String LowTalkProcessor::getProgramName(int index) {
  if (index < 0 || index >= (int)presets.size()) return {};
  return presets[(size_t)index].shelf + ": " + presets[(size_t)index].name;
}

bool LowTalkProcessor::isBusesLayoutSupported(const BusesLayout& layouts) const {
  return layouts.getMainOutputChannelSet() == juce::AudioChannelSet::stereo();
}

void LowTalkProcessor::prepareToPlay(double sampleRate, int) {
  // A new engine: the window's loop is handed over again (the old player goes with the old synth).
  player.reset();
  rate = sampleRate;
  synth = std::make_unique<lt::Synth>(sampleRate);
  player = std::make_unique<lt::LoopPlayer>(*synth);
  if (loopEverSet && !loopPending.load()) loopPending.store(true);
  pushParams(true);
  setLatencySamples(synth->latency());
}

void LowTalkProcessor::pushParams(bool immediate) {
  bool changed = immediate;
  for (int i = 0; i < lt::PARAM_COUNT; i++) {
    const double v = rawParams[i]->load();
    if (v != values[i]) {
      values[i] = v;
      changed = true;
    }
  }
  if (changed && synth) synth->setParams(values.data(), immediate);
}

void LowTalkProcessor::handleMidi(const juce::MidiMessage& m) {
  const bool mpe = mpeParam->load() > 0.5f;
  // MPE (lower zone): channel 1 is the master channel (shared bend), channels 2-16 carry one note each.
  const int ch = m.getChannel() - 1;
  const bool member = mpe && ch > 0;
  if (m.isNoteOn()) {
    markNote(m.getNoteNumber(), true);
    synth->noteOn(m.getNoteNumber(), m.getFloatVelocity(), member ? ch : -1);
  } else if (m.isNoteOff()) {
    markNote(m.getNoteNumber(), false);
    synth->noteOff(m.getNoteNumber(), member ? ch : -1);
  } else if (m.isPitchWheel()) {
    const double v = (m.getPitchWheelValue() - 8192) / 8192.0;
    if (member) synth->setChannelBend(ch, 48 * v);  // MPE default per-note range: ±48 semitones
    else synth->pitchBend(v);                         // ±2 semitones
  } else if (m.isChannelPressure()) {
    if (member) synth->setChannelPressure(ch, m.getChannelPressureValue() / 127.0);
  } else if (m.isController()) {
    const int cc = m.getControllerNumber();
    if (cc == 1) {
      midiWheel = m.getControllerValue() / 127.f;
      wheel = midiWheel;
    } else if (cc == 74 && member) {
      synth->setChannelSlide(ch, m.getControllerValue() / 127.0);
    } else if (cc == 123 || cc == 120) {
      for (auto& h : heldNotes) h.store(0);
      synth->allNotesOff();
    }
  }
}

void LowTalkProcessor::processBlock(juce::AudioBuffer<float>& buffer, juce::MidiBuffer& midi) {
  juce::ScopedNoDenormals noDenormals;
  const int frames = buffer.getNumSamples();
  buffer.clear();
  if (!synth) return;

  pushParams(false);
  runCommands();

  const bool mpe = mpeParam->load() > 0.5f;
  if (mpe != mpeWas) {
    synth->clearChannelExpression();
    mpeWas = mpe;
  }

  // The pump and the wobble run on the host's tempo and bar, so they land on the beat.
  if (auto* head = getPlayHead()) {
    if (auto pos = head->getPosition()) {
      // (While the window's audition loop plays, it keeps its own tempo.)
      if (auto bpm = pos->getBpm(); bpm && !player->playing) synth->setTempo(*bpm);
      if (pos->getIsPlaying() && !player->playing) {
        if (auto ppq = pos->getPpqPosition()) {
          const double barStart = pos->getPpqPositionOfLastBarStart().orFallback(0.0);
          synth->syncBeat(*ppq - barStart);
        }
      }
    }
  }

  // The on-screen / automated wheel and the hardware wheel: whichever moved last plays.
  const float wp = wheelParam->load();
  if (wp != lastWheelParam) {
    lastWheelParam = wp;
    wheel = wp;
  }

  float* left = buffer.getWritePointer(0);
  float* right = buffer.getNumChannels() > 1 ? buffer.getWritePointer(1) : left;
  int pos = 0;
  for (const auto meta : midi) {
    const int at = juce::jlimit(0, frames, meta.samplePosition);
    if (at > pos) {
      synth->setModWheel(wheel);
      player->render(left, right, pos, at - pos);
      pos = at;
    }
    handleMidi(meta.getMessage());
  }
  if (pos < frames) {
    synth->setModWheel(wheel);
    player->render(left, right, pos, frames - pos);
  }
  effectiveWheel.store(wheel);
  {
    int k = 0;
    live[(size_t)k++].store((float)synth->liveCutoff);
    live[(size_t)k++].store((float)synth->liveRes);
    live[(size_t)k++].store((float)synth->liveWob);
    live[(size_t)k++].store((float)synth->liveWobFc);
    for (int l = 0; l < 4; l++) live[(size_t)k++].store((float)synth->lfoPhase[(size_t)l]);
    for (int l = 0; l < 4; l++) live[(size_t)k++].store((float)synth->lfoValue[(size_t)l]);
    for (int g = 0; g < 4; g++) live[(size_t)k++].store((float)synth->liveGrind[(size_t)g]);
    for (int g = 0; g < 4; g++) live[(size_t)k++].store((float)synth->liveGrindRes[(size_t)g]);
  }

  // Feed the window's scope and meter.
  int sp = scopePos.load(std::memory_order_relaxed);
  for (int i = 0; i < frames; i++) {
    scope[(size_t)sp] = 0.5f * (left[i] + right[i]);
    sp = (sp + 1) & (SCOPE_SIZE - 1);
  }
  scopePos.store(sp, std::memory_order_release);
}

void LowTalkProcessor::getStateInformation(juce::MemoryBlock& destData) {
  auto state = apvts.copyState();
  state.setProperty("program", currentProgram, nullptr);
  state.setProperty("presetName", getPresetName(), nullptr);
  if (auto xml = state.createXml()) copyXmlToBinary(*xml, destData);
}

void LowTalkProcessor::setStateInformation(const void* data, int sizeInBytes) {
  if (auto xml = getXmlFromBinary(data, sizeInBytes)) {
    auto tree = juce::ValueTree::fromXml(*xml);
    if (tree.hasType(apvts.state.getType())) {
      currentProgram = tree.getProperty("program", 0);
      const juce::String name = tree.getProperty("presetName", "").toString();
      apvts.replaceState(tree);
      setPresetName(name.isNotEmpty() || presets.empty() ? name : presets[(size_t)juce::jlimit(0, (int)presets.size() - 1, currentProgram)].name);
      stateSerial++;
    }
  }
}

void LowTalkProcessor::markNote(int note, bool down) {
  if (note < 0 || note > 127) return;
  const uint32_t bit = 1u << (note & 31);
  auto& w = heldNotes[(size_t)(note >> 5)];
  if (down) w.fetch_or(bit);
  else w.fetch_and(~bit);
}

void LowTalkProcessor::sendCommand(const Command& c) {
  const auto w = commandFifo.write(1);
  if (w.blockSize1 > 0) commands[(size_t)w.startIndex1] = c;
  else if (w.blockSize2 > 0) commands[(size_t)w.startIndex2] = c;
}

void LowTalkProcessor::runCommands() {
  if (loopPending.load(std::memory_order_acquire)) {
    player->setLoop(pendingLoop.data(), pendingCount, pendingLength, pendingBpm);
    loopPending.store(false, std::memory_order_release);
  }
  const auto rd = commandFifo.read(commandFifo.getNumReady());
  auto run = [this](const Command& c) {
    switch (c.type) {
      case CMD_NOTE_ON: synth->noteOn(c.a, c.v); break;
      case CMD_NOTE_OFF: synth->noteOff(c.a); break;
      case CMD_BEND: synth->pitchBend(c.v); break;
      case CMD_PANIC: player->stop(); synth->panic(); break;
      case CMD_PLAY: player->start(); break;
      case CMD_STOP: player->stop(); break;
      case CMD_MONITOR: synth->setMonitor(c.a, c.b); break;
      default: break;
    }
  };
  for (int i = 0; i < rd.blockSize1; i++) run(commands[(size_t)(rd.startIndex1 + i)]);
  for (int i = 0; i < rd.blockSize2; i++) run(commands[(size_t)(rd.startIndex2 + i)]);
}

bool LowTalkProcessor::sendLoop(const std::vector<lt::LoopEvent>& events, double lengthBeats, double bpm) {
  if (loopPending.load(std::memory_order_acquire)) return false;
  pendingCount = (int)std::min(events.size(), pendingLoop.size());
  std::copy(events.begin(), events.begin() + pendingCount, pendingLoop.begin());
  pendingLength = lengthBeats;
  pendingBpm = bpm;
  loopEverSet = true;
  loopPending.store(true, std::memory_order_release);
  return true;
}

void LowTalkProcessor::setEngineValue(int index, double value) {
  if (index < 0 || index >= lt::PARAM_COUNT) return;
  if (auto* p = apvts.getParameter(lt::PARAMS[index].id)) {
    p->beginChangeGesture();
    p->setValueNotifyingHost(p->convertTo0to1((float)value));
    p->endChangeGesture();
  }
}

void LowTalkProcessor::setWheelFromUi(float v) {
  if (auto* p = apvts.getParameter(WHEEL_ID)) p->setValueNotifyingHost(juce::jlimit(0.f, 1.f, v));
}

juce::String LowTalkProcessor::getPresetName() const {
  const juce::ScopedLock sl(nameLock);
  return presetName;
}

void LowTalkProcessor::setPresetName(const juce::String& n) {
  const juce::ScopedLock sl(nameLock);
  presetName = n;
}

juce::AudioProcessorEditor* LowTalkProcessor::createEditor() { return new LowTalkEditor(*this); }

juce::AudioProcessor* JUCE_CALLTYPE createPluginFilter() { return new LowTalkProcessor(); }
