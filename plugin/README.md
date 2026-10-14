# Low Talk plugin (VST3)

The synth as a VST3 instrument: the same engine as the browser prototype
(ported to C++ and checked against it sample by sample), all ~200 parameters
as automatable host parameters, the whole preset bank built in (also in the
host's preset list), the pump and wobble locked to the host's tempo and bar,
and MPE.

## Install (Windows)

1. On GitHub, open **Actions → Plugin (Windows VST3)**, pick the latest green
   run and download the **LowTalk-VST3-Windows** artifact.
2. Unzip it and copy the `Low Talk.vst3` folder into
   `C:\Program Files\Common Files\VST3\`.
3. Rescan plugins in your DAW. Low Talk shows up as an instrument.

## Playing it

- **Presets:** pick a tab (Dark Basses, Leads, Pads ...) and a preset at the
  top, or step with `<` `>`. They're also in the host's preset menu.
- **Mod wheel:** your hardware wheel (CC 1) or the wheel in the Play section;
  the move is chosen in the same box.
- **MPE** (on by default): each note gets its own pitch bend (±48 semitones),
  pressure (plays it harder: brighter, dirtier, louder) and slide (CC 74,
  brightness). A normal keyboard works the same with MPE on or off.
- **Tempo:** the pump and the wobble follow the host's tempo and lock to its
  bar while the transport runs.

## Building

    npx tsx tools/gen-plugin-data.ts          # after changing data/schema.json or the presets
    cmake -S plugin -B build && cmake --build build --config Release --target LowTalk_VST3

Checks: `tools/plugin-parity.ts` (C++ engine = TypeScript engine, every
preset), `plugin/tools/engine_test.cpp` (MPE, host tempo), pluginval in CI.
Until the engine is compiled to WebAssembly for the browser, an engine change
is made in both `src/engine/core` and `plugin/engine`, and the parity check
must pass.
