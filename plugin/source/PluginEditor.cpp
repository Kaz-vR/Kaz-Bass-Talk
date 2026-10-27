#include "PluginEditor.h"
#include <UiData.h>
#if JUCE_WINDOWS
 #ifndef NOMINMAX
  #define NOMINMAX
 #endif
 #include <windows.h>
#endif

namespace {
juce::String mimeFor(const juce::String& file) {
  const auto ext = file.fromLastOccurrenceOf(".", false, false).toLowerCase();
  if (ext == "html") return "text/html; charset=utf-8";
  if (ext == "js" || ext == "mjs") return "text/javascript; charset=utf-8";
  if (ext == "css") return "text/css; charset=utf-8";
  if (ext == "json") return "application/json; charset=utf-8";
  if (ext == "svg") return "image/svg+xml";
  if (ext == "png") return "image/png";
  if (ext == "woff2") return "font/woff2";
  return "application/octet-stream";
}

juce::WebBrowserComponent::Options browserOptions(LowTalkEditor* self,
                                                  std::function<void(const juce::var&)> onMessage,
                                                  juce::WebBrowserComponent::ResourceProvider provider) {
  // The UI keeps its starred sounds in the page's local storage: give it a lasting home.
  const auto dataDir = juce::File::getSpecialLocation(juce::File::userApplicationDataDirectory)
                           .getChildFile("Low Talk")
                           .getChildFile("WebView2");
  juce::ignoreUnused(self);
  return juce::WebBrowserComponent::Options{}
      .withBackend(juce::WebBrowserComponent::Options::Backend::webview2)
      .withWinWebView2Options(juce::WebBrowserComponent::Options::WinWebView2{}
                                  .withUserDataFolder(dataDir)
                                  .withBackgroundColour(juce::Colour(0xff070101))
                                  .withStatusBarDisabled())
      .withNativeIntegrationEnabled()
      .withKeepPageLoadedWhenBrowserIsHidden()
      .withEventListener("lt", std::move(onMessage))
      .withResourceProvider(std::move(provider));
}
}  // namespace

LowTalkEditor::LowTalkEditor(LowTalkProcessor& p)
    : AudioProcessorEditor(&p),
      proc(p),
      browser(browserOptions(this, [this](const juce::var& m) { onMessage(m); },
                             [this](const juce::String& url) { return getResource(url); })) {
  lastSent.fill(std::nanf(""));
  addAndMakeVisible(browser);
  setResizable(true, true);
  setResizeLimits(900, 560, 2400, 1600);
  setSize(1200, 800);
  browser.goToURL(juce::WebBrowserComponent::getResourceProviderRoot());
  startTimerHz(30);
}

LowTalkEditor::~LowTalkEditor() { stopTimer(); }

void LowTalkEditor::paint(juce::Graphics& g) { g.fillAll(juce::Colour(0xff070101)); }

void LowTalkEditor::resized() { browser.setBounds(getLocalBounds()); }

std::optional<juce::WebBrowserComponent::Resource> LowTalkEditor::getResource(const juce::String& url) {
  auto path = url.upToFirstOccurrenceOf("?", false, false);
  if (path.isEmpty() || path == "/") path = "/index.html";
  const auto file = path.fromLastOccurrenceOf("/", false, false);
  for (int i = 0; i < UiData::namedResourceListSize; i++) {
    if (file != UiData::getNamedResourceOriginalFilename(UiData::namedResourceList[i])) continue;
    int size = 0;
    const char* data = UiData::getNamedResource(UiData::namedResourceList[i], size);
    if (data == nullptr) break;
    // Text files start with a UTF-8 byte-order mark, so every WebView reads them as UTF-8.
    const auto mime = mimeFor(file);
    const bool text = mime.startsWith("text/") || mime.startsWith("application/json");
    const size_t bom = text ? 3 : 0;
    std::vector<std::byte> bytes((size_t)size + bom);
    if (text) bytes[0] = std::byte{0xEF}, bytes[1] = std::byte{0xBB}, bytes[2] = std::byte{0xBF};
    std::memcpy(bytes.data() + bom, data, (size_t)size);
    return juce::WebBrowserComponent::Resource{std::move(bytes), mime};
  }
  return std::nullopt;
}

void LowTalkEditor::sendState() {
  juce::Array<juce::var> values;
  for (int i = 0; i < lt::PARAM_COUNT; i++) {
    lastSent[(size_t)i] = proc.getEngineValue(i);
    values.add((double)lastSent[(size_t)i]);
  }
  auto* o = new juce::DynamicObject();
  o->setProperty("values", values);
  o->setProperty("name", proc.getPresetName());
  browser.emitEventIfBrowserIsVisible("lt-state", juce::var(o));
}

void LowTalkEditor::onMessage(const juce::var& m) {
  const auto type = m["type"].toString();
  using C = LowTalkProcessor::Command;
  if (type == "ready") {
    ready = true;
    lastSerial = proc.stateSerial.load();
    sendState();
  } else if (type == "param") {
    const int i = (int)m["index"];
    if (i < 0 || i >= lt::PARAM_COUNT) return;
    proc.setEngineValue(i, (double)m["value"]);
    lastSent[(size_t)i] = proc.getEngineValue(i);
  } else if (type == "patch") {
    if (auto* arr = m["values"].getArray()) {
      for (int i = 0; i < lt::PARAM_COUNT && i < arr->size(); i++) {
        if ((float)(double)(*arr)[i] != proc.getEngineValue(i)) proc.setEngineValue(i, (double)(*arr)[i]);
        lastSent[(size_t)i] = proc.getEngineValue(i);
      }
    }
    proc.setPresetName(m["name"].toString());
  } else if (type == "key") {
    passKeyToHost(m["key"].toString(), (bool)m["down"]);
  } else if (type == "noteOn") {
    proc.sendCommand({LowTalkProcessor::CMD_NOTE_ON, (int)m["note"], 0, (double)m["velocity"]});
  } else if (type == "noteOff") {
    proc.sendCommand({LowTalkProcessor::CMD_NOTE_OFF, (int)m["note"], 0, 0});
  } else if (type == "bend") {
    proc.sendCommand({LowTalkProcessor::CMD_BEND, 0, 0, (double)m["value"]});
  } else if (type == "wheel") {
    proc.setWheelFromUi((float)(double)m["value"]);
  } else if (type == "monitor") {
    proc.sendCommand({LowTalkProcessor::CMD_MONITOR, (int)m["solo"], (int)m["mute"], 0});
  } else if (type == "play") {
    proc.sendCommand(C{LowTalkProcessor::CMD_PLAY, 0, 0, 0});
  } else if (type == "stop") {
    proc.sendCommand(C{LowTalkProcessor::CMD_STOP, 0, 0, 0});
  } else if (type == "panic") {
    proc.sendCommand(C{LowTalkProcessor::CMD_PANIC, 0, 0, 0});
  } else if (type == "loop") {
    queuedLoop.clear();
    if (auto* ev = m["events"].getArray()) {
      for (int i = 0; i + 3 < ev->size(); i += 4)
        queuedLoop.push_back({(double)(*ev)[i], (int)(*ev)[i + 1], (int)(*ev)[i + 2], (double)(*ev)[i + 3]});
    }
    queuedLength = (double)m["length"];
    queuedBpm = (double)m["bpm"];
    loopQueued = true;
    if (proc.sendLoop(queuedLoop, queuedLength, queuedBpm)) loopQueued = false;
  }
}

/**
 * Hand a key the page doesn't use (space: the DAW's play / stop) to the host: the window the plugin
 * sits in gets it as if it had been pressed there.
 */
void LowTalkEditor::passKeyToHost(const juce::String& key, bool down) {
#if JUCE_WINDOWS
  if (key != "space") return;
  auto* peer = getPeer();
  if (peer == nullptr) return;
  HWND own = (HWND)peer->getNativeHandle();
  // the host's main window (the DAW's own transport keys live there; a floating plugin window is owned by it)
  HWND root = GetAncestor(own, GA_ROOTOWNER);
  if (root == nullptr) root = GetAncestor(own, GA_ROOT);
  if (root == nullptr) return;
  const UINT scan = MapVirtualKeyW(VK_SPACE, MAPVK_VK_TO_VSC);
  const LPARAM lp = 1 | ((LPARAM)scan << 16) | (down ? 0 : ((LPARAM)1 << 30) | ((LPARAM)1 << 31));
  PostMessageW(root, down ? WM_KEYDOWN : WM_KEYUP, VK_SPACE, lp);
#else
  juce::ignoreUnused(key, down);
#endif
}

void LowTalkEditor::timerCallback() {
  if (loopQueued && proc.sendLoop(queuedLoop, queuedLength, queuedBpm)) loopQueued = false;
  if (!ready) return;

  // The whole patch changed outside the window (program change, project reloaded).
  const int serial = proc.stateSerial.load();
  if (serial != lastSerial) {
    lastSerial = serial;
    sendState();
  }

  // Host automation: parameters that moved since the page last heard.
  juce::Array<juce::var> changes;
  for (int i = 0; i < lt::PARAM_COUNT; i++) {
    const float v = proc.getEngineValue(i);
    if (v != lastSent[(size_t)i]) {
      lastSent[(size_t)i] = v;
      changes.add(juce::Array<juce::var>{i, (double)v});
    }
  }
  if (!changes.isEmpty()) browser.emitEventIfBrowserIsVisible("lt-params", changes);

  // Live: the newest 4096 output samples, held notes and the wheel.
  const int n = 4096;
  scopeOut.resize((size_t)n);
  const int end = proc.scopePos.load(std::memory_order_acquire);
  for (int i = 0; i < n; i++) scopeOut[(size_t)i] = proc.scope[(size_t)((end - n + i) & (LowTalkProcessor::SCOPE_SIZE - 1))];
  juce::Array<juce::var> held;
  for (int w = 0; w < 4; w++) {
    const uint32_t bits = proc.heldNotes[(size_t)w].load();
    for (int b = 0; b < 32; b++)
      if (bits >> b & 1) held.add(w * 32 + b);
  }
  auto* o = new juce::DynamicObject();
  o->setProperty("scope", juce::Base64::toBase64(scopeOut.data(), scopeOut.size() * sizeof(float)));
  o->setProperty("rate", proc.getRate());
  o->setProperty("held", held);
  o->setProperty("wheel", (double)proc.effectiveWheel.load());
  juce::Array<juce::var> live;
  for (auto& x : proc.live) live.add((double)x.load());
  o->setProperty("live", live);
  browser.emitEventIfBrowserIsVisible("lt-live", juce::var(o));
}
