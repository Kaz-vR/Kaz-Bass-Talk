#include "PluginEditor.h"
#include <cstring>
#include <map>

namespace ui {

namespace {
struct GroupInfo { const char* id; const char* title; const char* tip; };
const GroupInfo GROUPS[] = {
  {"voice", "Voice", "How notes are played: mono or chords, glide, octave, touch and analog drift."},
  {"wheel", "Mod wheel", "One connected move: several things change together, like playing harder. Wheel at 0 = the preset as designed."},
  {"vibrato", "Vibrato", "A human vibrato that starts after a short delay and fades in."},
  {"osc1", "Oscillator 1", "The main sound source: waveform, pitch, unison and level."},
  {"osc2", "Oscillator 2", "A second source, often an octave or a detuned layer."},
  {"string", "String / Shepard", "Settings for the plucked-string and endless-glide waveforms."},
  {"fm", "FM", "Frequency modulation: metallic, glassy, bell or growly edges."},
  {"sub", "Sub", "A clean sine or triangle below, always mono: the weight in the low end."},
  {"noise", "Noise", "White noise before the filter: air, grit and breath in the tone."},
  {"breath", "Breath", "The player's air: a puff at the start of each note and a soft breathy band."},
  {"click", "Transient", "A short attack at the start of each note so it cuts through."},
  {"pitch_env", "Pitch envelope", "A quick pitch drop or rise at the start of each note."},
  {"drive", "Drive", "Saturation before the filter: dirt the filter then shapes."},
  {"filter", "Filter", "Low-pass, band-pass, formant, 303 diode, notch, comb or low-pass gate."},
  {"dist", "Distortion", "Soft, hard, fold or tube, optionally on the mids only."},
  {"crush", "Bitcrusher", "Lower bit depth and sample rate: digital grain."},
  {"tape", "Tape", "Saturation, wow and flutter, and age (a dull, worn top)."},
  {"clip", "Mid clip", "A transparent soft clipper on oscillators 1 and 2: denser at the same level."},
  {"amp_env", "Amp envelope", "Volume over time for each note."},
  {"mod_env", "Mod envelope", "Sweeps the filter on each note; a source for the matrix."},
  {"env2", "Env 2 (bloom)", "A slow envelope for long changes while a note is held."},
  {"wobble", "Wobble", "A tempo-locked wobble: the filter swings shut and open on the beat."},
  {"lfo1", "LFO 1", "A repeating or smoothly random movement; route it in the matrix."},
  {"lfo2", "LFO 2", "A repeating or smoothly random movement; route it in the matrix."},
  {"lfo3", "LFO 3", "A repeating or smoothly random movement; route it in the matrix."},
  {"lfo4", "LFO 4", "A repeating or smoothly random movement; route it in the matrix."},
  {"mod", "Mod matrix", "Connects movement sources to what they move, with an amount each."},
  {"texture", "Texture", "A bed of crackle, dust, rumble or air that plays with the notes."},
  {"dynamics", "Dynamics", "Compression, the tempo pump and a multiband squash (OTT)."},
  {"fx", "Effects", "Chorus, flanger, phaser, delay and reverb, only above the low end."},
  {"eq", "EQ", "Final tone shaping and the high cut."},
  {"output", "Output", "Final level. The limiter and mono low end are always on."},
};
struct SectionInfo { const char* title; const char* hint; std::vector<const char*> groups; };
const std::vector<SectionInfo> SECTIONS = {
  {"Play", "How it is played: voices, glide, touch, the mod wheel and a player's vibrato.", {"voice", "wheel", "vibrato"}},
  {"Sources", "What makes the sound: oscillators, FM, sub, noise, breath, the transient and the start of the pitch.",
   {"osc1", "osc2", "string", "fm", "sub", "noise", "breath", "click", "pitch_env"}},
  {"Tone and dirt", "The fixed chain, left to right: drive > filter > distortion > bitcrusher > tape > mid clip.", {"drive", "filter", "dist", "crush", "tape", "clip"}},
  {"Shape over time", "Per-note envelopes: volume, the filter sweep and the slow bloom.", {"amp_env", "mod_env", "env2"}},
  {"Movement", "What keeps it alive: the wobble, four LFOs and the matrix that routes them.", {"wobble", "lfo1", "lfo2", "lfo3", "lfo4", "mod"}},
  {"Space and finish", "After the voices, in order: the texture bed, dynamics, effects and EQ.", {"texture", "dynamics", "fx", "eq"}},
  {"Output", "Final level. The limiter and the mono low end are always on.", {"output"}},
};

juce::String shortLabel(const juce::String& label) {
  static const char* prefixes[] = {"Osc 1 ", "Osc 2 ", "LFO 1 ", "LFO 2 ", "LFO 3 ", "LFO 4 ", "Amp ", "Mod ", "Sub ",
                                   "Filter ", "Distortion ", "Pitch envelope ", "EQ ", "FX ", "FM "};
  for (auto* p : prefixes)
    if (label.startsWith(p)) return label.substring((int)strlen(p));
  return label;
}
constexpr int ROW = 24, TITLE = 26, PAD = 10, BOX_W = 250, GAP = 10;
}  // namespace

LookAndFeel::LookAndFeel() {
  setColour(juce::ResizableWindow::backgroundColourId, col::bg);
  setColour(juce::Label::textColourId, col::text);
  setColour(juce::ComboBox::backgroundColourId, col::panel2);
  setColour(juce::ComboBox::outlineColourId, col::line);
  setColour(juce::ComboBox::textColourId, col::text);
  setColour(juce::ComboBox::arrowColourId, col::dim);
  setColour(juce::PopupMenu::backgroundColourId, col::panel);
  setColour(juce::PopupMenu::textColourId, col::text);
  setColour(juce::PopupMenu::highlightedBackgroundColourId, col::accent.withAlpha(0.25f));
  setColour(juce::PopupMenu::highlightedTextColourId, col::text);
  setColour(juce::Slider::textBoxTextColourId, col::text);
  setColour(juce::Slider::textBoxOutlineColourId, juce::Colours::transparentBlack);
  setColour(juce::Slider::textBoxBackgroundColourId, juce::Colours::transparentBlack);
  setColour(juce::TextButton::buttonColourId, col::panel2);
  setColour(juce::TextButton::textColourOffId, col::text);
  setColour(juce::ToggleButton::textColourId, col::text);
  setColour(juce::ScrollBar::thumbColourId, col::line);
  setColour(juce::Label::outlineColourId, juce::Colours::transparentBlack);
  setColour(juce::TextEditor::outlineColourId, juce::Colours::transparentBlack);
  setColour(juce::TextEditor::focusedOutlineColourId, col::accent);
  setColour(juce::TextEditor::backgroundColourId, col::panel2);
}

void LookAndFeel::drawLinearSlider(juce::Graphics& g, int x, int y, int w, int h, float pos, float, float,
                                   juce::Slider::SliderStyle style, juce::Slider& s) {
  if (style == juce::Slider::LinearVertical) {
    const float cx = x + w * 0.5f;
    g.setColour(col::panel2);
    g.fillRoundedRectangle(cx - 5, (float)y, 10, (float)h, 5);
    g.setColour(col::accent);
    g.fillRoundedRectangle(cx - 5, pos, 10, (float)(y + h) - pos, 5);
    g.setColour(col::text);
    g.fillEllipse(cx - 8, pos - 8, 16, 16);
    return;
  }
  const float cy = y + h * 0.5f;
  g.setColour(col::panel2);
  g.fillRoundedRectangle((float)x, cy - 2, (float)w, 4, 2);
  g.setColour(s.isEnabled() ? col::accent : col::dim);
  g.fillRoundedRectangle((float)x, cy - 2, pos - x, 4, 2);
  g.setColour(col::text);
  g.fillEllipse(pos - 5, cy - 5, 10, 10);
}

void LookAndFeel::drawToggleButton(juce::Graphics& g, juce::ToggleButton& b, bool over, bool) {
  auto r = b.getLocalBounds().toFloat().reduced(1);
  const bool on = b.getToggleState();
  g.setColour(on ? col::accent : col::panel2);
  g.fillRoundedRectangle(r, 4);
  g.setColour(over ? col::dim : col::line);
  g.drawRoundedRectangle(r, 4, 1);
  g.setColour(on ? juce::Colour(0xff0b1a10) : col::dim);
  g.setFont(juce::FontOptions(11.f, juce::Font::bold));
  // Switches read "on"/"off"; named toggles (MPE) keep their name.
  const juce::String text = b.getButtonText() == "on" ? juce::String(on ? "on" : "off") : b.getButtonText();
  g.drawText(text, r, juce::Justification::centred);
}

juce::Label* LookAndFeel::createSliderTextBox(juce::Slider& s) {
  auto* l = LookAndFeel_V4::createSliderTextBox(s);
  l->setColour(juce::Label::outlineColourId, juce::Colours::transparentBlack);
  l->setColour(juce::Label::backgroundColourId, juce::Colours::transparentBlack);
  l->setColour(juce::Label::textColourId, col::text);
  l->setJustificationType(juce::Justification::centredRight);
  l->setFont(juce::FontOptions(12.f));
  return l;
}

ParamControl::ParamControl(juce::AudioProcessorValueTreeState& state, const lt::ParamSpec& spec) {
  label.setText(shortLabel(spec.label), juce::dontSendNotification);
  label.setColour(juce::Label::textColourId, col::dim);
  label.setFont(juce::FontOptions(12.f));
  label.setTooltip(spec.describes);
  addAndMakeVisible(label);
  switch (spec.type) {
    case lt::PType::Enum:
      combo = std::make_unique<juce::ComboBox>();
      {
        juce::StringArray opts;
        opts.addTokens(spec.options, "|", "");
        combo->addItemList(opts, 1);
      }
      cAtt = std::make_unique<juce::AudioProcessorValueTreeState::ComboBoxAttachment>(state, spec.id, *combo);
      combo->setTooltip(spec.describes);
      addAndMakeVisible(*combo);
      break;
    case lt::PType::Bool:
      toggle = std::make_unique<juce::ToggleButton>("on");
      bAtt = std::make_unique<juce::AudioProcessorValueTreeState::ButtonAttachment>(state, spec.id, *toggle);
      addAndMakeVisible(*toggle);
      break;
    default:
      slider = std::make_unique<juce::Slider>(juce::Slider::LinearHorizontal, juce::Slider::TextBoxRight);
      slider->setTextBoxStyle(juce::Slider::TextBoxRight, false, 70, 18);
      slider->setTooltip(spec.describes);
      sAtt = std::make_unique<juce::AudioProcessorValueTreeState::SliderAttachment>(state, spec.id, *slider);
      addAndMakeVisible(*slider);
  }
}

void ParamControl::resized() {
  auto r = getLocalBounds();
  label.setBounds(r.removeFromLeft(92));
  if (slider) slider->setBounds(r);
  if (combo) combo->setBounds(r.reduced(0, 1));
  if (toggle) toggle->setBounds(r.removeFromLeft(44).reduced(0, 3));
}

namespace {
/** One mod matrix slot: source, destination, amount. */
class SlotRow : public juce::Component {
 public:
  SlotRow(juce::AudioProcessorValueTreeState& s, int n) {
    num.setText(juce::String(n), juce::dontSendNotification);
    num.setColour(juce::Label::textColourId, col::dim);
    addAndMakeVisible(num);
    const juce::String base = "mod" + juce::String(n) + ".";
    for (auto* c : {&src, &dst}) {
      const auto& spec = lt::PARAMS[lt::paramIndex((base + (c == &src ? "source" : "dest")).toRawUTF8())];
      juce::StringArray opts;
      opts.addTokens(spec.options, "|", "");
      c->addItemList(opts, 1);
      addAndMakeVisible(*c);
    }
    srcAtt = std::make_unique<juce::AudioProcessorValueTreeState::ComboBoxAttachment>(s, base + "source", src);
    dstAtt = std::make_unique<juce::AudioProcessorValueTreeState::ComboBoxAttachment>(s, base + "dest", dst);
    amt.setSliderStyle(juce::Slider::LinearHorizontal);
    amt.setTextBoxStyle(juce::Slider::TextBoxRight, false, 64, 18);
    amtAtt = std::make_unique<juce::AudioProcessorValueTreeState::SliderAttachment>(s, base + "amount", amt);
    addAndMakeVisible(amt);
  }
  void resized() override {
    auto r = getLocalBounds();
    num.setBounds(r.removeFromLeft(24));
    const int w = (r.getWidth() - 12) / 3;
    src.setBounds(r.removeFromLeft(w).reduced(0, 1));
    r.removeFromLeft(6);
    dst.setBounds(r.removeFromLeft(w).reduced(0, 1));
    r.removeFromLeft(6);
    amt.setBounds(r);
  }

 private:
  juce::Label num;
  juce::ComboBox src, dst;
  juce::Slider amt;
  std::unique_ptr<juce::AudioProcessorValueTreeState::ComboBoxAttachment> srcAtt, dstAtt;
  std::unique_ptr<juce::AudioProcessorValueTreeState::SliderAttachment> amtAtt;
};
}  // namespace

GroupBox::GroupBox(LowTalkProcessor& p, const juce::String& group, const juce::String& t, const juce::String& tip)
    : proc(p), title(t) {
  setTooltip(tip);
  auto& state = proc.apvts;
  const juce::String powerId = group + ".on";
  if (state.getParameter(powerId)) {
    power = std::make_unique<juce::ToggleButton>("on");
    powerAtt = std::make_unique<juce::AudioProcessorValueTreeState::ButtonAttachment>(state, powerId, *power);
    addAndMakeVisible(*power);
  }
  if (group == "mod") {
    wide = true;
    for (int n = 1; n <= lt::SLOT_COUNT; n++) {
      rows.push_back(std::make_unique<SlotRow>(state, n));
      rowHeights.push_back(ROW);
    }
  } else {
    for (int i = 0; i < lt::PARAM_COUNT; i++) {
      const auto& spec = lt::PARAMS[i];
      if (group != spec.group || powerId == spec.id) continue;
      rows.push_back(std::make_unique<ParamControl>(state, spec));
      rowHeights.push_back(ROW);
    }
  }
  if (group == "wheel") {
    wheel = std::make_unique<juce::Slider>(juce::Slider::LinearVertical, juce::Slider::TextBoxBelow);
    wheel->setTextBoxStyle(juce::Slider::TextBoxBelow, false, 50, 18);
    wheelAtt = std::make_unique<juce::AudioProcessorValueTreeState::SliderAttachment>(state, LowTalkProcessor::WHEEL_ID, *wheel);
    wheel->setTooltip("The mod wheel: follows your hardware wheel, or drag it here.");
    addAndMakeVisible(*wheel);
    rowHeights.push_back(110);
  }
  for (auto& r : rows) addAndMakeVisible(*r);
}

int GroupBox::preferredHeight() const {
  int h = TITLE + PAD;
  for (int rh : rowHeights) h += rh + 2;
  return h;
}

void GroupBox::paint(juce::Graphics& g) {
  g.setColour(col::panel);
  g.fillRoundedRectangle(getLocalBounds().toFloat(), 8);
  g.setColour(col::line);
  g.drawRoundedRectangle(getLocalBounds().toFloat().reduced(0.5f), 8, 1);
  g.setColour(col::accent2);
  g.setFont(juce::FontOptions(11.f, juce::Font::bold));
  g.drawText(title.toUpperCase(), PAD, 6, getWidth() - 2 * PAD - 50, 16, juce::Justification::centredLeft);
}

void GroupBox::resized() {
  if (power) power->setBounds(getWidth() - PAD - 34, 5, 34, 18);
  int y = TITLE;
  size_t i = 0;
  for (auto& r : rows) {
    r->setBounds(PAD, y, getWidth() - 2 * PAD, rowHeights[i]);
    y += rowHeights[i++] + 2;
  }
  if (wheel) wheel->setBounds(PAD, y, 60, 108);
}

void GroupBox::tickWheel() {
  if (!wheel || wheel->isMouseButtonDown()) return;
  const double v = proc.effectiveWheel.load();
  if (std::abs(wheel->getValue() - v) > 1e-3) wheel->setValue(v, juce::dontSendNotification);
}

void SectionHead::paint(juce::Graphics& g) {
  g.setColour(col::line);
  g.drawHorizontalLine(getHeight() - 1, 0, (float)getWidth());
  g.setColour(folded ? col::dim : col::text);
  g.setFont(juce::FontOptions(13.f, juce::Font::bold));
  const juce::String t = juce::String(folded ? juce::CharPointer_UTF8("\xe2\x96\xb8 ") : juce::CharPointer_UTF8("\xe2\x96\xbe ")) + title.toUpperCase();
  g.drawText(t, 2, 0, 220, getHeight() - 4, juce::Justification::bottomLeft);
  g.setColour(col::dim);
  g.setFont(juce::FontOptions(12.f));
  g.drawText(hint, 200, 0, getWidth() - 204, getHeight() - 4, juce::Justification::bottomLeft);
}

Body::Body(LowTalkProcessor& p) {
  std::map<juce::String, GroupBox*> byId;
  for (const auto& gi : GROUPS) {
    boxes.push_back(std::make_unique<GroupBox>(p, gi.id, gi.title, gi.tip));
    byId[gi.id] = boxes.back().get();
    addAndMakeVisible(*boxes.back());
  }
  for (const auto& s : SECTIONS) {
    Section sec;
    sec.head = std::make_unique<SectionHead>(s.title, s.hint);
    sec.head->onToggle = [this] { layout(getWidth()); };
    addAndMakeVisible(*sec.head);
    for (auto* gId : s.groups)
      if (byId.count(gId)) sec.boxes.push_back(byId[gId]);
    sections.push_back(std::move(sec));
  }
  startTimerHz(30);
}

void Body::layout(int width) {
  const int cols = std::max(1, (width - GAP) / (BOX_W + GAP));
  const int boxW = (width - GAP - cols * GAP) / cols;
  int y = 6;
  for (auto& s : sections) {
    s.head->setBounds(GAP, y, width - 2 * GAP, 30);
    s.head->repaint();
    y += 36;
    int col = 0, rowH = 0;
    for (auto* b : s.boxes) {
      b->setVisible(!s.head->folded);
      if (s.head->folded) continue;
      const int h = b->preferredHeight();
      if (b->wide) {
        if (col > 0) {
          y += rowH + GAP;
          col = 0;
          rowH = 0;
        }
        b->setBounds(GAP, y, width - 2 * GAP, h);
        y += h + GAP;
        continue;
      }
      b->setBounds(GAP + col * (boxW + GAP), y, boxW, h);
      rowH = std::max(rowH, h);
      if (++col == cols) {
        y += rowH + GAP;
        col = 0;
        rowH = 0;
      }
    }
    if (col > 0) y += rowH + GAP;
  }
  setSize(width, y + 10);
}

void Body::timerCallback() {
  for (auto& b : boxes) b->tickWheel();
}

}  // namespace ui

LowTalkEditor::LowTalkEditor(LowTalkProcessor& p) : AudioProcessorEditor(&p), proc(p) {
  setLookAndFeel(&lnf);
  for (const auto& pr : proc.getPresets())
    if (!shelves.contains(pr.shelf)) shelves.add(pr.shelf);
  shelfBox.addItemList(shelves, 1);
  shelfBox.onChange = [this] { fillPresets(false); };
  presetBox.onChange = [this] {
    const int i = presetBox.getSelectedItemIndex();
    if (i >= 0 && i < (int)shown.size() && shown[(size_t)i] != proc.getCurrentProgram()) loadProgram(shown[(size_t)i]);
  };
  prev.onClick = [this] {
    if (shown.empty()) return;
    const int i = presetBox.getSelectedItemIndex();
    loadProgram(shown[(size_t)((i <= 0 ? (int)shown.size() : i) - 1)]);
  };
  next.onClick = [this] {
    if (shown.empty()) return;
    const int i = presetBox.getSelectedItemIndex();
    loadProgram(shown[(size_t)((i + 1) % (int)shown.size())]);
  };
  nameLabel.setFont(juce::FontOptions(16.f, juce::Font::bold));
  descLabel.setColour(juce::Label::textColourId, ui::col::dim);
  descLabel.setFont(juce::FontOptions(12.f));
  safetyLabel.setText("low end mono  -  limiter on", juce::dontSendNotification);
  safetyLabel.setColour(juce::Label::textColourId, ui::col::accent);
  safetyLabel.setFont(juce::FontOptions(12.f));
  safetyLabel.setJustificationType(juce::Justification::centredRight);
  mpeToggle.setTooltip("MPE: each note gets its own pitch bend, pressure (plays it harder) and slide (brightness). Normal keyboards work either way.");
  mpeAtt = std::make_unique<juce::AudioProcessorValueTreeState::ButtonAttachment>(proc.apvts, LowTalkProcessor::MPE_ID, mpeToggle);
  for (auto* c : std::initializer_list<juce::Component*>{&shelfBox, &presetBox, &prev, &next, &nameLabel, &descLabel, &safetyLabel, &mpeToggle})
    addAndMakeVisible(c);
  body = std::make_unique<ui::Body>(proc);
  viewport.setViewedComponent(body.get(), false);
  viewport.setScrollBarsShown(true, false);
  addAndMakeVisible(viewport);
  // The controls were built before they joined this window: let them pick up its look.
  sendLookAndFeelChange();
  showCurrent();
  setResizable(true, true);
  setResizeLimits(620, 420, 2400, 2000);
  setSize(1120, 780);
}

LowTalkEditor::~LowTalkEditor() { setLookAndFeel(nullptr); }

void LowTalkEditor::showCurrent() {
  const auto& presets = proc.getPresets();
  const int cur = proc.getCurrentProgram();
  if (cur < 0 || cur >= (int)presets.size()) return;
  shelfBox.setSelectedItemIndex(shelves.indexOf(presets[(size_t)cur].shelf), juce::dontSendNotification);
  fillPresets(true);
  nameLabel.setText(presets[(size_t)cur].name, juce::dontSendNotification);
  descLabel.setText(presets[(size_t)cur].description, juce::dontSendNotification);
}

void LowTalkEditor::fillPresets(bool keepSelection) {
  const auto& presets = proc.getPresets();
  const juce::String shelf = shelfBox.getText();
  presetBox.clear(juce::dontSendNotification);
  shown.clear();
  for (int i = 0; i < (int)presets.size(); i++)
    if (presets[(size_t)i].shelf == shelf) {
      shown.push_back(i);
      presetBox.addItem(presets[(size_t)i].name, (int)shown.size());
    }
  const int cur = proc.getCurrentProgram();
  int sel = -1;
  for (size_t k = 0; k < shown.size(); k++)
    if (shown[k] == cur) sel = (int)k;
  if (sel >= 0) presetBox.setSelectedItemIndex(sel, juce::dontSendNotification);
  else if (!keepSelection && !shown.empty()) loadProgram(shown[0]);
}

void LowTalkEditor::loadProgram(int index) {
  proc.setCurrentProgram(index);
  showCurrent();
}

void LowTalkEditor::paint(juce::Graphics& g) {
  g.fillAll(ui::col::bg);
  g.setColour(ui::col::panel);
  g.fillRect(0, 0, getWidth(), 64);
  g.setColour(ui::col::line);
  g.drawHorizontalLine(64, 0, (float)getWidth());
}

void LowTalkEditor::resized() {
  auto r = getLocalBounds();
  auto top = r.removeFromTop(64).reduced(10, 8);
  auto row1 = top.removeFromTop(26);
  shelfBox.setBounds(row1.removeFromLeft(160));
  row1.removeFromLeft(8);
  prev.setBounds(row1.removeFromLeft(30));
  row1.removeFromLeft(4);
  presetBox.setBounds(row1.removeFromLeft(220));
  row1.removeFromLeft(4);
  next.setBounds(row1.removeFromLeft(30));
  row1.removeFromLeft(12);
  mpeToggle.setBounds(row1.removeFromRight(56).reduced(0, 2));
  row1.removeFromRight(10);
  safetyLabel.setBounds(row1.removeFromRight(190));
  nameLabel.setBounds(row1);
  descLabel.setBounds(top.removeFromTop(22));
  viewport.setBounds(r);
  body->layout(r.getWidth() - viewport.getScrollBarThickness());
}
