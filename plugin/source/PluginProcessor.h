#pragma once
#include <JuceHeader.h>
#include <array>
#include <atomic>
#include <memory>
#include <vector>
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

  static constexpr const char* WHEEL_ID = "modwheel";
  static constexpr const char* MPE_ID = "mpe";

 private:
  static juce::AudioProcessorValueTreeState::ParameterLayout createLayout();
  void loadPresets();
  void pushParams(bool immediate);
  void handleMidi(const juce::MidiMessage& m);

  std::unique_ptr<lt::Synth> synth;
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
