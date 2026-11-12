# Website, tech stack, layout, phases, deletion list, testing

*(Moved out of CLAUDE.md word for word to keep every session's context small; CLAUDE.md is the index. Read this file when a task touches it.)*

## Website — `website/`

The product site (owner's call: built in this repository so it stays connected to the synth): static HTML / CSS / JS. **Its whole look is defined in `website/DESIGN.md`** (the "Siren" direction: pure black, the siren red-orange palette, square buttons, no lines, Manrope self-hosted from `design/fonts/`, the six parts and the owner's likes and dislikes): read it before any site work and update it with every style change. The logo lives in `design/` (`logo.svg`, `logo-tight.svg`). The product images are taken from the synth: `node tools/site-shots.mjs` (`website/assets/shots/`) and the features carousel's clips `node tools/site-pages.mjs` (`website/assets/pages/`); rerun them after the synth's look changes. The header's synth is 3D (`website/hero3d.js`, three.js self-hosted in `website/vendor/`, MIT) and draws from `website/assets/shots/osc.jpg`, so retaking the shots updates it too. The reference library of top-tier sites is `references/` (`tools/references.mjs`). Its software twin for the synth's own UI is `references-ui/` (60 synth, plugin, hardware and pro-software interfaces with notes, `tools/ui-references.mjs` + `tools/ui-references-index.mjs`); **read `references-ui/RULES.md` before any synth UI design work** and name the references used in every pitch. Both libraries are dev-only and never shipped. The site's copy describes only what the synth really has; macOS / AU are "coming" until they exist. See `website/README.md`.

## Tech stack

- **Phase A (prototype):** TypeScript + Vite, Web Audio with an AudioWorklet for the synth engine. Runs in the browser, no backend.
- **Phase B (plugin):** C++ with JUCE, VST3 + AU (and standalone app). The DSP is ported from the prototype; schema, categories, bank, wheel moves, rules and vocabulary are reused.
- `data/` is plain JSON shared by both phases. Keep analysis, quality, generator, tree and history code free of browser APIs.

## Repository layout

```
/data
  schema.json
  categories.json the 14 categories (identity, recipe, limits, style zone)
  directory.json  bass types (coverage map for the Bass Atlas)
  quality.json    critic limits
  vocabulary.json descriptor words (naming generated presets, reading leans)
  /library        presets (bank + Bass Atlas)
  /loops          audition MIDI riffs
/src
  /engine         synth DSP + AudioWorklet
  /analysis       offline render + feature extraction
  /quality        rules, critic, style checks
  /generator      preset generator
  /tree           Sound Tree
  /history
  /ui
/plugin           JUCE project (Phase B)
/tools            DEV ONLY: preset building, validation, batch rendering
/tests
```

---

## Build phases

Finish each phase, with its tests passing, before starting the next. At the end of each phase, summarize what was built. Don't ask the human to review or listen to batches of sounds.

1. **Engine + schema.** *(Done.)*
2. **Analysis + quality critic.** *(Done.)*
3. **Engine additions for full bass coverage.** *(Done.)*
4. **Bass library.** The Bass Atlas (51 types then, 48 since Yoi and talk-box basses left with the formant filter and Endless Fall with the shepard wave) and the 13 Terror basses, with movement additions (4 LFOs then, wander, env 2 then, 12 slots, FX mod targets), the alive check and texture beds. *(Done.)*
5. **Polyphony + instrument additions.** 8 voices with voice stealing (mono mode unchanged), delayed vibrato, breath attack, richer vowels, bell partials, long riser/fall envelopes; CPU within budget. *(Done.)*
6. **Style checks.** `data/categories.json`, per-category critic limits, earns-its-place, LORN fingerprint, bank consistency. *(Done.)*
7. **Preset bank.** Every category covering the producer range (below), at most 35 per shelf, all passing every check. *(Done; widened to the producer range afterwards.)*
8. **UI.** Category browser in the mockup's style, all controls on one page. *(Done; the create area follows its phase.)*
9. **Expression.** Mod wheel moves, wobble, pump rate, texture before/after dynamics. *(Done; the pump, compressor and OTT were removed later, owner's call.)*
10. **Generator + Sound Tree.** Create presets per category; exploration rounds; taste learning.
11. **History + A/B + morphing.**
12. **JUCE plugin port.** Same data, same behavior, host MIDI, every parameter and the mod wheel as automatable host parameters, preset save/load. Also at the port: the wobble locked to the host's transport (essential, or it wobbles off the beat); **MPE** (per-note bend, pressure, slide, drawable in Ableton/Bitwig); **loading your own texture recordings** (seamless loop, random start, kept off the low end, auto-levelled, stored with the preset) plus a few built-in CC0/own recordings. Port the engine once to C++ and compile it to WebAssembly for the browser prototype, so engine changes are made once.
    *(Started: a VST3 for Windows built by GitHub Actions (`.github/workflows/plugin.yml`, validated with pluginval) with the C++ engine in `plugin/engine` (matches the TypeScript engine on every preset: `tools/plugin-parity.ts`), all parameters as host parameters, the bank built in, the synced LFOs and RUIN on the host's tempo and bar, MPE (per-note bend, pressure, slide), and the web UI as its window (a WebView2 showing the same page as the prototype, served from memory, talking to the C++ engine; the Randomizer, presets page and "All controls" come with it). Not yet: texture recordings, AU, WebAssembly. The plugin engine is a line-by-line port of `src/engine/core` (synced again after it had fallen months behind, owner's report: "completely broken"); until WebAssembly, an engine change goes into both engines and the parity check must pass (`tools/plugin-parity.ts <lowtalk_render> [filter] --set=id:value,...`, enum values by name, exercises features the bank leaves at their defaults). The plugin's parameter list and presets are generated from the shared data (`tools/gen-plugin-data.ts`, run by the CI build too); `tests/plugin-data.test.ts` fails when the checked-in copy is stale. The window's moving prints (filter, LFOs, RUIN) get the engine's live values with the scope (`lt-live`). In the plugin window there is never a start screen (an inline script marks the page as the plugin's before anything draws), and Space is never the page's: it is caught first and passed to the host's main window (play / stop in the DAW). See `plugin/README.md`.)*

**Later experiments (agreed in principle, not scheduled):** a "performer" layer (a few hidden slowly-wandering states such as effort, breath supply and an unsteady hand, each driving several parameters together the way a player does), tried on ~2 presets in a few categories first; a LORN-style rhythmic wobble bass; trying "varied sound first, then lornify" on one category, with the "never like a clock" rule relaxed to allow deliberate rhythm with irregular life on top.

## Deletion list

Things up for deletion are discussed with the owner first, collected here, then removed in one go when the owner says so. Nothing is open right now.

Done (owner's calls): RUIN's SAT and PRE OTT (`grind.sat`, `grind.preott`), both engines; RUIN's V Range and the filters' wandering resonance (`grind<n>.vrange`; Res became Width, Depth is new), both engines; the drives' Bias dial (`grind<n>.drive_bias`, `dist.bias`; replaced by the starved type) and the OTT after each RUIN drive (`grind<n>.ott`), both engines; the output limiter and the forced mono low end (`output.crossover`), both engines; the Drone / FX and Texture categories with their 30 presets and builders (replaced by Noise); the formant filter, the Choir / Vocal, Bells / Mallets, Hits / Impacts and Risers & Falls categories with all their presets (77, every preset using formant included) and builders, the "hits" audition loop, and the Yoi / talk-box types of the Bass Atlas. Later: the Wobbler (removed, then restored as it was, owner's call), Env 2, Env 3 and the drift, slow drift and random sources (replaced by LFO 5–6 and the bloom, drop, random, drift and slow drift shapes; old presets' rows from them load empty, owner's call: fixed with the bank rebuild); the shepard wave (both engines, its rate dial, the Atlas's Endless Fall, the Randomizer's endless-glide idea; old patches load it as a sine). Strings and Brass / Horns merged into Pad at the same time. The formant filter later came back (owner's call, for choir). The tape's Drive and Age were removed (owner's call: duplicates of DRIVE's tape type, the EQ and the Noise box's hiss), in both engines, presets and builders. FM was removed completely (owner's call: its sound isn't wanted): both engines, its 9 parameters, the randomizer's FM idea, the coverage ingredients and the FM electric piano staple; the `fm_amount` / `D_FM` / `D_FM2` slots stay only so the other matrix destinations keep their numbers.

## Testing rules

- **Safety:** random patches (fuzzing the full schema, mono and poly) never carry DC.
- **Critic:** known-bad signals are rejected with the right reason; every preset passes; every sound the human flagged stays rejected.
- **Style:** every bank preset passes alive, earns-its-place, fingerprint and consistency; deliberately static, flat, bright-clean or fake-complex test presets are caught.
- **Coverage:** every category has its presets; every Bass Atlas type has a patch; every preset's category/family exists.
- **Polyphony:** chords render each note at the right pitch; voice stealing never clicks; mono mode behaves as before; 8 voices stay within the CPU budget.
- **Generator / Sound Tree:** every generated sound passes all checks; generated presets keep a minimum feature distance from the bank and from each other; a simulated user who always picks the option nearest a hidden target lands near it in 3 rounds for most targets.
- **Mod wheel:** at rest it changes nothing; every move changes the sound measurably; a sample of presets keeps quality and safety with every move fully up.
- **Stamps:** each preset's check results carry an audio fingerprint and the judge hash (`src/quality/stamp.ts`, `tools/lib/codehash.ts`). While both match, results are kept without re-analysis, so code changes that don't change a sound don't trigger a full re-check.
- **Performance:** a generation batch and a Sound Tree round respond fast enough to feel instant (target < 300 ms per round); the engine stays within the CPU budget.

