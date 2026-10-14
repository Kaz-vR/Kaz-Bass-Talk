#pragma once
#include <JuceHeader.h>
#include <memory>
#include <vector>
#include "PluginProcessor.h"

namespace ui {

/** Colours of the prototype's page (index.html / style.css). */
namespace col {
const juce::Colour bg{0xff111316}, panel{0xff1a1d22}, panel2{0xff22262c}, line{0xff2e333b}, text{0xffe6e8eb},
    dim{0xff8a929e}, accent{0xff7cf29a}, accent2{0xff5cc8ff};
}

class LookAndFeel : public juce::LookAndFeel_V4 {
 public:
  LookAndFeel();
  void drawLinearSlider(juce::Graphics&, int x, int y, int w, int h, float pos, float, float, juce::Slider::SliderStyle,
                        juce::Slider&) override;
  void drawToggleButton(juce::Graphics&, juce::ToggleButton&, bool, bool) override;
  juce::Label* createSliderTextBox(juce::Slider&) override;
};

/** One parameter: label + slider, dropdown or switch, attached to the host parameter. */
class ParamControl : public juce::Component {
 public:
  ParamControl(juce::AudioProcessorValueTreeState& state, const lt::ParamSpec& spec);
  void resized() override;

 private:
  juce::Label label;
  std::unique_ptr<juce::Slider> slider;
  std::unique_ptr<juce::ComboBox> combo;
  std::unique_ptr<juce::ToggleButton> toggle;
  std::unique_ptr<juce::AudioProcessorValueTreeState::SliderAttachment> sAtt;
  std::unique_ptr<juce::AudioProcessorValueTreeState::ComboBoxAttachment> cAtt;
  std::unique_ptr<juce::AudioProcessorValueTreeState::ButtonAttachment> bAtt;
};

/** A box of controls (one schema group), with its power switch in the title when it has one. */
class GroupBox : public juce::Component, public juce::SettableTooltipClient {
 public:
  GroupBox(LowTalkProcessor& p, const juce::String& group, const juce::String& title, const juce::String& tip);
  int preferredHeight() const;
  bool wide = false;
  void paint(juce::Graphics&) override;
  void resized() override;

 private:
  LowTalkProcessor& proc;
  juce::String title;
  std::unique_ptr<juce::ToggleButton> power;
  std::unique_ptr<juce::AudioProcessorValueTreeState::ButtonAttachment> powerAtt;
  std::vector<std::unique_ptr<juce::Component>> rows;
  std::vector<int> rowHeights;
  // Mod wheel box: a wheel that follows the hardware wheel.
  std::unique_ptr<juce::Slider> wheel;
  std::unique_ptr<juce::AudioProcessorValueTreeState::SliderAttachment> wheelAtt;
  friend class Body;
  void tickWheel();
};

/** A section header (Play, Sources, ...): click to fold. */
class SectionHead : public juce::Component {
 public:
  SectionHead(const juce::String& t, const juce::String& h) : title(t), hint(h) {}
  bool folded = false;
  std::function<void()> onToggle;
  void paint(juce::Graphics&) override;
  void mouseUp(const juce::MouseEvent&) override {
    folded = !folded;
    if (onToggle) onToggle();
  }

 private:
  juce::String title, hint;
};

class Body : public juce::Component, private juce::Timer {
 public:
  explicit Body(LowTalkProcessor& p);
  void layout(int width);
  void paint(juce::Graphics& g) override { g.fillAll(col::bg); }

 private:
  struct Section {
    std::unique_ptr<SectionHead> head;
    std::vector<GroupBox*> boxes;
  };
  std::vector<std::unique_ptr<GroupBox>> boxes;
  std::vector<Section> sections;
  void timerCallback() override;
};

}  // namespace ui

class LowTalkEditor : public juce::AudioProcessorEditor {
 public:
  explicit LowTalkEditor(LowTalkProcessor&);
  ~LowTalkEditor() override;
  void paint(juce::Graphics&) override;
  void resized() override;

 private:
  LowTalkProcessor& proc;
  ui::LookAndFeel lnf;
  juce::TooltipWindow tooltips{this, 600};
  juce::ComboBox shelfBox, presetBox;
  juce::TextButton prev{"<"}, next{">"};
  juce::Label nameLabel, descLabel, safetyLabel;
  juce::ToggleButton mpeToggle{"MPE"};
  std::unique_ptr<juce::AudioProcessorValueTreeState::ButtonAttachment> mpeAtt;
  juce::Viewport viewport;
  std::unique_ptr<ui::Body> body;
  juce::StringArray shelves;
  std::vector<int> shown;  // program indices listed in presetBox

  void fillPresets(bool keepSelection);
  void loadProgram(int index);
  void showCurrent();
};
