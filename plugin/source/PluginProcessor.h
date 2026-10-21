#pragma once
#include <JuceHeader.h>
#include <array>
#include <atomic>
#include <memory>
#include <vector>
#include "Sequencer.h"
#include "Synth.h"

struct Preset {
  juce::String name, shelf, description;
  std::vector<double> values;  // engine values in schema order
};

class LowTalkProcessor : public juce::AudioProcessor {
 public:
  LowTalkProcessor();
  ~LowTalkProcessor() override = default;

  void prepareToPlay(double sampleRate, int samplesPerBlock) override;
  void releaseResources() override {}
  bool isBusesLayoutSupported(const BusesLayout& layouts) const override;
  void processBlock(juce::AudioBuffer<float>&, juce::MidiBuffer&) override;

  juce::AudioProcessorEditor* createEditor() override;
  bool hasEditor() const override { return true; }

  const juce::String getName() const override { return "Low Talk"; }
  bool acceptsMidi() const override { return true; }
  bool producesMidi() const override { return false; }
  bool isMidiEffect() const override { return false; }
  bool supportsMPE() const override { return true; }
  double getTailLengthSeconds() const override { return 8.0; }

  int getNumPrograms() override { return (int)presets.size(); }
  int getCurrentProgram() override { return currentProgram; }
  void setCurrentProgram(int index) override;
  const juce::String getProgramName(int index) override;
  void changeProgramName(int, const juce::String&) override {}

  void getStateInformation(juce::MemoryBlock& destData) override;
  void setStateInformation(const void* data, int sizeInBytes) override;

  juce::AudioProcessorValueTreeState apvts;
  const std::vector<Preset>& getPresets() const { return presets; }
  /** The wheel the engine is playing (hardware or on-screen), for the editor's display. */
  std::atomic<float> effectiveWheel{0.f};

  // ---- The window (the web UI) talks to the engine through these (message thread). ----
  /** A command for the audio thread: notes from the on-screen keyboard, bend, loop, solo/mute. */
  struct Command { int type = 0; int a = 0, b = 0; double v = 0; };
  enum { CMD_NOTE_ON = 1, CMD_NOTE_OFF, CMD_BEND, CMD_PANIC, CMD_PLAY, CMD_STOP, CMD_MONITOR };
  void sendCommand(const Command& c);
  /** Hand the audio thread a new audition loop (false: the last one isn't picked up yet, try again). */
  bool sendLoop(const std::vector<lt::LoopEvent>& events, double lengthBeats, double bpm);
  /** Set a parameter by its engine value, as a host automation gesture. */
  void setEngineValue(int index, double value);
  float getEngineValue(int index) const { return rawParams[(size_t)index]->load(); }
  void setWheelFromUi(float v);
  /** The preset or roll the window shows (saved with the project). */
  juce::String getPresetName() const;
  void setPresetName(const juce::String& n);
  /** Bumped when the whole patch changes outside the window (program change, state restored). */
  std::atomic<int> stateSerial{0};
  /** The last 8192 output samples (mono) for the scope and meter, and where the next one goes. */
  static constexpr int SCOPE_SIZE = 8192;
  std::array<float, SCOPE_SIZE> scope{};
  std::atomic<int> scopePos{0};
  /** Notes held from the host's MIDI (bits), for the on-screen keyboard. */
  std::array<std::atomic<uint32_t>, 4> heldNotes{};
  double getRate() const { return rate; }

  static constexpr const char* WHEEL_ID = "modwheel";
  static constexpr const char* MPE_ID = "mpe";

 private:
  static juce::AudioProcessorValueTreeState::ParameterLayout createLayout();
  void loadPresets();
  void pushParams(bool immediate);
  void handleMidi(const juce::MidiMessage& m);

  std::unique_ptr<lt::Synth> synth;
  std::unique_ptr<lt::LoopPlayer> player;
  double rate = 48000;
  // Commands from the window: a single-producer / single-consumer queue.
  juce::AbstractFifo commandFifo{256};
  std::array<Command, 256> commands{};
  // A new loop waiting for the audio thread (written only while loopPending is false).
  std::array<lt::LoopEvent, lt::LoopPlayer::MAX_EVENTS> pendingLoop{};
  int pendingCount = 0;
  double pendingLength = 4, pendingBpm = 120;
  std::atomic<bool> loopPending{false};
  bool loopEverSet = false;
  juce::CriticalSection nameLock;
  juce::String presetName;
  void runCommands();
  void markNote(int note, bool down);
  std::vector<Preset> presets;
  int currentProgram = 0;
  std::array<std::atomic<float>*, lt::PARAM_COUNT> rawParams{};
  std::array<double, lt::PARAM_COUNT> values{};
  std::atomic<float>* wheelParam = nullptr;
  std::atomic<float>* mpeParam = nullptr;
  float lastWheelParam = -1.f;
  float midiWheel = 0.f;
  float wheel = 0.f;
  bool mpeWas = true;

  JUCE_DECLARE_NON_COPYABLE_WITH_LEAK_DETECTOR(LowTalkProcessor)
};
