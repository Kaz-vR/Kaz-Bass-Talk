#pragma once
#include <JuceHeader.h>
#include <array>
#include <vector>
#include "PluginProcessor.h"

/**
 * The plugin window is the web UI (the same page as the browser prototype, built into
 * the plugin and served from memory: no network). It talks to the processor through
 * JUCE events: the page sends edits, notes and the audition loop ("lt"); the window
 * sends it the patch ("lt-state"), host automation ("lt-params") and the live output,
 * held notes and mod wheel ("lt-live").
 */
class LowTalkEditor : public juce::AudioProcessorEditor, private juce::Timer {
 public:
  explicit LowTalkEditor(LowTalkProcessor&);
  ~LowTalkEditor() override;
  void paint(juce::Graphics&) override;
  void resized() override;

 private:
  void timerCallback() override;
  void onMessage(const juce::var& m);
  void passKeyToHost(const juce::String& key, bool down);
  void sendState();
  std::optional<juce::WebBrowserComponent::Resource> getResource(const juce::String& url);

  LowTalkProcessor& proc;
  juce::WebBrowserComponent browser;
  bool ready = false;
  int lastSerial = -1;
  std::array<float, lt::PARAM_COUNT> lastSent{};
  std::vector<lt::LoopEvent> queuedLoop;
  double queuedLength = 4, queuedBpm = 120;
  bool loopQueued = false;
  std::vector<float> scopeOut;

  JUCE_DECLARE_NON_COPYABLE_WITH_LEAK_DETECTOR(LowTalkEditor)
};
