# Low Talk plugin (VST3)

The synth as a VST3 instrument: the same engine as the browser prototype
(ported to C++ and checked against it sample by sample), all ~200 parameters
as automatable host parameters, the whole preset bank built in (also in the
host's preset list), the Wobbler and GRIND locked to the host's tempo and bar,
and MPE. Its window is the prototype's own page (the synth page, PRESETS with
the Randomizer and your starred sounds, "All controls"), shown in a WebView2
and served from inside the plugin: no network, nothing to install besides the
WebView2 runtime that ships with Windows 10/11.

## Install (Windows)

1. On GitHub, open **Actions → Plugin (Windows VST3)**, pick the latest green
   run and download the **LowTalk-VST3-Windows** artifact.
2. Unzip it and copy the `Low Talk.vst3` folder into
   `C:\Program Files\Common Files\VST3\`.
3. Rescan plugins in your DAW. Low Talk shows up as an instrument.

## Playing it

- **Presets:** the name at the top (‹ name ▾ ›) or the PRESETS tab. The bank
  is also in the host's preset menu. AUDITION / the spacebar plays the loop.
- **Mod wheel:** your hardware wheel (CC 1) or the wheel next to the keyboard;
  the move is picked there too.
- **Everything you change** is a host parameter: automatable and saved with
  the project (with the preset's name).
- **MPE** (on by default): each note gets its own pitch bend (±48 semitones),
  pressure (plays it harder: brighter, dirtier, louder) and slide (CC 74,
  brightness). A normal keyboard works the same with MPE on or off.
- **Tempo:** the Wobbler and GRIND follow the host's tempo and lock to its
  bar while the transport runs.

## Building

    npx tsx tools/gen-plugin-data.ts          # after changing data/schema.json, the Wobbler shapes or the presets (CI runs it too)
    npm ci && npx vite build                  # the window (embedded from dist/)
    cmake -S plugin -B build && cmake --build build --config Release --target LowTalk_VST3

Checks: `tools/plugin-parity.ts` (C++ engine = TypeScript engine, every
preset; `--set=id:value,...` switches on features the bank doesn't use), `plugin/tools/engine_test.cpp` (MPE, host tempo), pluginval in CI.
Until the engine is compiled to WebAssembly for the browser, an engine change
is made in both `src/engine/core` and `plugin/engine`, and the parity check
must pass.

On Windows CMake needs the WebView2 SDK (static loader): the CI downloads the
`Microsoft.Web.WebView2` NuGet package and passes
`-DJUCE_WEBVIEW2_PACKAGE_LOCATION=<folder holding it>`.
