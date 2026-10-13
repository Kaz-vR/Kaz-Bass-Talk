# CLAUDE.md — Low Talk

Low Talk is a bass synth plugin built around one flow: **seed, then dial in**. There is no typing.

1. **Seed** (ballpark the sound fast) with the **Sound Tree**: it plays 4 options, the user clicks the closest, hears 4 more around that choice, and after 2-3 clicks is in the right neighborhood. As the user picks, the tree generates new sounds that drift toward what they like, so they end up on sounds that exist nowhere in the library.
2. **Dial in** (once it's close) with **4 generated macro knobs**: recipes that each move several real parameters, chosen for this patch by how much they audibly change it, with ranges tuned so the whole knob travel sounds good.

Every sound the user can hear (library patch, generated Sound Tree option, macro position) must sound like a finished, expensive patch. Quality is enforced automatically (sound-design rules + quality critic), because nobody can listen to everything the system generates.

Read this whole file before starting any task. When something here conflicts with a request in a session, ask before deviating.

---

## Non-negotiables

1. **No AI at runtime.** The shipped plugin contains no language model, no embedding model and no neural network of any kind. All behavior comes from data files and plain code.
2. **Fully offline.** The plugin never makes network requests. No API keys, no servers, no telemetry.
3. **Lightweight.** Total install size under 25 MB including all data. No GPU use. A Sound Tree round must respond in under 300 ms on a mid-range laptop. The synth itself should stay under ~3% CPU per voice at 48 kHz. No sample libraries: every sound is synthesized.
4. **Real-time safety.** Nothing on the audio thread allocates memory, locks, or runs analysis, tree or macro-selection code. Patch changes are handed to the audio thread and applied with parameter smoothing (no clicks).
5. **The low end is protected.** Regardless of any patch, the sub stays mono and phase-stable, there's no DC offset, and a transparent output limiter is always on.
6. **AI is a development tool only.** Claude may be used during development to generate and expand data (patches, macro recipes, descriptions, quality rules). Anything under `tools/` is dev-only and must never be shipped or imported by runtime code.

---

## How it works (overview)

```
        SEED (ballpark)                                  DIAL IN (precise)
 ┌────────────────────────────────────┐
 │ Sound Tree                         │        Macro selector
 │  4 options per round: 3 near the   │          family pool (8-12 recipes)
 │  lean + 1 wildcard; picks are      │──────▶   → render each at a few positions
 │  leans; "none of these"; "between  │          → keep the 4 with most audible impact
 │  these two"; breadcrumb            │          → tune each range to "still sounds good"
 │  generates NEW sounds toward the   │          → boost macros matching the user's leans
 │  user's leans                      │
 └────────────────────────────────────┘
          │ every candidate sound                      │ every knob position
          ▼                                            ▼
   Sound-design rules  ─▶  Quality critic  (reject anything that sounds cheap or unsafe)
          │
   Analysis: offline render → normalized features (the map everything navigates)
          │
   Patch library (~160 patches covering the bass directory, precomputed features, families)

 History tree: every tree step and macro change is a node (jump, branch, A/B, morph)
 Synth engine: plays the current patch in real time
```

The **measured feature space** (from the analysis code) is the map: the Sound Tree walks it, macros are judged by how far they move a sound through it, and the quality critic checks positions in it.

---

## Components

### 1. Synth engine
A monophonic-first bass synth (with optional legato/glide). Signal path:

- 2 main oscillators (sine, triangle, saw, pulse, wavetable with position), each with detune, unison (1–7 voices), spread, level
- Sub oscillator (sine/triangle, −1 or −2 octaves), always mono
- Noise source (low level, for grit)
- Pre-filter drive
- Filter: 4-pole low-pass, band-pass, formant (vowel morph); cutoff, resonance, key tracking, envelope amount
- Distortion stage: soft, hard, fold, tube; drive, mix, post-tone; optionally mids-only (clean below a split frequency) so the sub stays clean
- Amp, mod and pitch envelopes, 2 LFOs (tempo-syncable, multiple shapes, retrigger option)
- Small mod matrix (8 slots)
- Analog character: per-voice pitch drift, free unison phases, per-note filter variation
- Quality: band-limited oscillators; drive, filter and distortion run 2× oversampled with anti-aliased (ADAA) waveshapers. Expensive-sounding, never "chiptune" (unless the patch is a deliberate chiptune).
- FX, in a **fixed order** (no user re-ordering; the macro, tree and critic logic rely on a known chain):
  distortion → bitcrusher/downsampler → tape (saturation, wow/flutter, age) → amp → + sub → compressor (with tempo-synced pump) → multiband "OTT" → chorus → flanger → phaser → delay → reverb (these five only above the FX low cut) → EQ + high cut → subsonic/DC filter → mono below crossover → output limiter
- Mono-below-crossover processing (default 120 Hz)

**Additions planned for full directory coverage** (phase 3): multi-operator FM (2-4 operators with their own envelopes and feedback), an attack click/transient layer (short filtered noise/click burst with its own envelope), filter types (303-style 18 dB diode with accent, notch, comb, low-pass gate), a PWM-saw wave and an ensemble chorus (Hoover / Alpha Juno), a physical-model string oscillator, a Shepard-tone oscillator mode, a reverse envelope shape, and more random modulation sources.

The FX that are part of the bass sound itself live inside the plugin, because the Sound Tree and macros can only change what is inside. Big creative space effects, mastering and real kick sidechain are left to other plugins.

Around 115 parameters today, roughly 135 after the coverage additions (approved by the repo owner). Every parameter must be defined in the patch schema.

### 2. Patch schema — `data/schema.json`
The single source of truth shared by the engine, the analysis, the tree, the macros and the UI. For each parameter:

```json
{
  "id": "filter.cutoff",
  "label": "Filter cutoff",
  "type": "float",
  "min": 20, "max": 20000, "default": 2000,
  "curve": "log",
  "unit": "Hz",
  "group": "filter",
  "describes": "Lower is darker and rounder; below ~300 Hz becomes muffled."
}
```

Types: `float`, `int`, `enum`, `bool`. A patch is a flat JSON object `{ "<param id>": value, ... }` plus `meta` (name, tags, description). Any patch loaded from anywhere is validated and clamped against the schema.

### 3. Bass directory — `data/directory.json`
The coverage map for the library: every synth bass type across genres, cinema and history (about 50 types plus performance variations such as the laser pitch snap and the Reese-growl cross). Each entry has an id, name, group, one-line sonic identity, the family it belongs to, and its engine status: `native` (the engine can make it), `needs-addition` (waits for a phase-3 engine addition) or `approximation` (depends on recorded instruments or processes a synth can't do, e.g. real brass, cello samples, clocks, true resampling, granular; built as a clearly labelled synth version).

Some entries are partly about how they're played (Moroder octaves, psy offbeats, synthwave 16ths, hardstyle offbeats, dembow, amapiano, baile funk). Build only the sound; the playing pattern is the user's business. No special audition loops for them.

### 4. Patch library — `data/library/*.json`
Around 160 hand-designed patches: roughly 3 versions of each directory entry (e.g. clean / dirty / dark), each with:

- `name`, `description` (one sentence), `tags` (genre, character, era), `directory` (which directory entry it realizes), `family` (which macro pool it uses), `features` (precomputed by the analysis)

Quality bar: every patch sounds like a finished, release-quality patch from an expensive synth (think Diva / Serum), not a sketch and not a chiptune (unless deliberately). This includes dark, cinematic, heavily processed basses in the style of LORN (saturated, tape-worn, lo-fi, wide, with space). Every patch must pass the quality critic.

### 5. Sound-design rules — `src/quality/rules`
The "logic of good bass", written as code and data, applied to every hand-made patch, every generated Sound Tree option and every macro range:

- **Layering:** a clean mono sine/triangle sub, a mid layer that carries the character (what's audible on phones and laptops), a controlled top.
- **Clean low end:** distortion and stereo effects stay above the sub.
- **Coupled parameters:** settings that must move together do (more drive → darker post-tone; high resonance → tamed level; wide unison stays above the crossover; envelope times fit the family: an 808 decays, a Reese sustains).
- **Movement:** sustained patches have at least slow modulation so they never sound static (unless the type is deliberately static, e.g. pure sub).
- **Safe regions:** generated sounds only move parameters within ranges taken from library patches that sound good, per family.

### 6. Analysis + quality critic — `src/analysis`, `src/quality`
**Analysis** renders a sound offline (about 2 seconds of the audition loop, plus a low / mid / high note test) and measures:

- brightness (spectral centroid), high-frequency energy, sub energy (< 80 Hz), low-mid energy (80–300 Hz)
- attack time, release/decay length
- movement (modulation depth/rate in the spectrum over time)
- stereo width above the crossover, mono correlation below it
- peak level, DC offset

Features are normalized (a documented scale per feature) so distances are meaningful. They are precomputed for every library patch (stored in its `features`), and are what the Sound Tree uses to pick options and track leans and what the macro selector uses to judge impact.

**The quality critic** turns measurements into pass/fail with a plain reason ("fails: harsh 2–5 kHz, +6 dB over limit"). It rejects anything that sounds cheap or unsafe:

- digital fizz / aliasing (inharmonic energy)
- harshness in the 2–5 kHz band relative to the mids
- mud build-up in 200–400 Hz
- weak or missing fundamental
- whistling resonance
- level jumping between low and high notes
- smeared or stereo low end
- clipping, DC, limiter working hard

Thresholds are derived from library patches that sound good, per family (a deliberately harsh type like Industrial or Rage gets wider limits than a pure sub). Rejected generated sounds are silently replaced before the user hears them.

**Human feedback:** there are no scheduled listening checks; the rules and the critic decide. When the human volunteers that something sounds wrong, that sound becomes a new rule or a tightened threshold, so the same mistake can't return.

Must render four candidates in under 150 ms total. Keep renders short and use a reduced-quality offline mode if needed.

### 7. Sound Tree — `src/tree`
The only way to start a sound. It ballparks in 2-3 clicks; it never has to be finished.

- **Rounds of 4.** Each round plays 4 options: **3 near the current lean + 1 wildcard** from a nearby but different area. Picking the wildcard redirects the walk.
- **Picks are leans, not commitments.** A pick shifts the odds toward that region of the feature space; nothing is ruled out permanently.
- **Generates new sounds.** The library is the starting set, but each round creates new options by blending and shifting real parameters toward what the user has been picking, within the sound-design rules' safe regions. Every generated option passes the quality critic before it's played.
- **Chosen by measured features, never by genre labels alone.** Within a round, options are picked to sound as different from each other as possible (maximize feature distance between them), while staying in the leaned region.
- **"None of these"** gives 4 fresh options from parts of the sound space the user hasn't heard yet.
- **"Between these two"**: the user selects 2 options and gets blends of them (continuous params interpolated, enums/ints switch at the midpoint), measured and checked like any other option.
- **Breadcrumb trail** of picks at the top. Clicking any step jumps back to it so the user can choose differently.
- **Stop any time.** The current pick becomes the patch to dial in.
- **Instant audition.** Every option plays under the audition loop on hover/click, swapped in with smoothing.
- Picks feed the macro selector (a lean toward dirtier options raises dirt-related macros) and every step is saved to history.

A small internal **descriptor vocabulary** (`data/vocabulary.json`: words like dirtier, darker, wider, rounder, each tied to features) is used only to name macros and to interpret what a run of picks leans toward. There is no text input.

### 8. Macros — `src/macros`, `data/macros/`
The main dial-in tool: 4 knobs, precise and predictable. No variations at this stage.

- **Family pools.** Each family has its own pool of roughly 8-12 macro candidates. A macro is a recipe: name + a list of `{ param, from, to, curve }` mappings that move several real parameters at once. Examples:
  - Reese: Detune, Movement, Grit, Sub
  - 808: Decay, Punch, Saturation, Pitch drop
  - Acid: Cutoff, Resonance, Squelch, Accent
  - Growl: Talk (formant), Rate, Drive, Width

  Every family in the library gets a full pool.
- **Chosen by audible impact.** When a sound is picked, render each candidate at a few positions offline and measure how much the sound actually changes. Drop macros with little audible effect on this patch; show the 4 with the biggest impact. The knobs appear once the best 4 are ready (target: about half a second to a second; no placeholder knobs).
- **Leans raise priority.** The user's Sound Tree picks boost related macros.
- **Ranges tuned per patch.** Each knob starts at the current sound's position and sweeps only through territory that still sounds good: every position passes the quality critic and the safety guardrails. The whole knob travel must be usable.
- **Swappable.** Clicking a macro's name swaps it for another from the family pool.
- **Stable.** Once picked, a macro keeps its name and behavior. Turning it is instant and local. Macros are automatable from the DAW (host parameters in the plugin).

### 9. History — `src/history`
A tree of patch snapshots (not a list). Every Sound Tree step and macro change creates a node with a short label. Users can jump to any node, branch from it, A/B the current sound against any node, and morph between two nodes (interpolate continuous params; switch enums/ints at the midpoint).

---

## UI

Keeps the visual style of the approved mockup; the layout follows the seed → dial-in flow. No text input.

- **Header:** play/pause audition loop, loop selector (built-in riffs or host MIDI), current patch name, "sub mono · limiter on" indicator.
- **Seed area (main focus at the start):** the Sound Tree: breadcrumb trail of picks across the top; 4 option cards (mini waveform, short name, the wildcard clearly marked); "None of these" and "Between these two" buttons. Hover/click plays an option under the loop.
- **Dial-in area (main focus once a sound is picked):** 4 large macro knobs; click a knob's name to swap it from the family pool.
- **Secondary tools (visible, not the focus):** A/B against any history step, a spectrum view, and the full parameter view behind a button.
- **History strip:** clickable nodes with branches; Alt-drag between two nodes to morph.

---

## Tech stack

- **Phase A (prototype):** TypeScript + Vite, Web Audio with an AudioWorklet for the synth engine. Runs in the browser, no backend.
- **Phase B (plugin):** C++ with JUCE, VST3 + AU (and standalone app). The DSP is ported from the prototype; the schema, directory, library, macro pools, rules and vocabulary are reused.
- `data/` is plain JSON shared by both phases. Keep analysis, quality, tree, macro and history code free of browser APIs so it's easy to port (or compile the same logic into the plugin).

## Repository layout

```
/data
  schema.json
  directory.json  bass directory (coverage map)
  vocabulary.json internal descriptor words (naming macros, reading leans)
  /library        patch files
  /macros         macro pools, one file per family
  /loops          audition MIDI riffs
/src
  /engine         synth DSP + AudioWorklet
  /analysis       offline render + feature extraction
  /quality        sound-design rules + quality critic
  /tree           Sound Tree
  /macros         impact ranking, per-patch range tuning
  /history
  /ui
/plugin           JUCE project (Phase B)
/tools            DEV ONLY: data generation, validation, batch rendering
/tests
```

---

## Build phases

Finish each phase, with its tests passing, before starting the next. At the end of each phase, summarize what was built. Don't ask the human to review or listen to batches of sounds.

1. **Engine + schema.** Synth playable from computer keyboard and MIDI, all parameters in the schema, starter patches, default audition loops. *(Done.)*
2. **Analysis + quality critic.** Feature extraction with normalized features, the quality critic and the first sound-design rules, tests on known signals (a sine should have near-zero high-frequency energy; deliberately fizzy, muddy, harsh test sounds must be caught; the starter patches must pass), and `data/directory.json`.
3. **Engine additions for full coverage.** Multi-operator FM, click/transient layer, new filter types (303 diode with accent, notch, comb, LPG), PWM-saw + ensemble chorus, physical-model string, Shepard mode, reverse envelope, more random sources. *(Done.)*
4. **Patch library.** One production-ready patch for each of the 51 bass types is done (`tools/build-library.ts`); more versions per type (clean / dirty / dark, ~160 total) and the 2 performance variations follow. Every patch passes the critic; features precomputed.
5. **Macros.** A pool of 8-12 recipes per family, impact ranking, per-patch range tuning within critic and safety limits, lean-based priority, swapping.
6. **Sound Tree.** Rounds of 4 (3 near the lean + 1 wildcard), leans, generated options within safe regions, "none of these", "between these two" blends, breadcrumb, instant audition, critic on every option.
7. **UI.** The seed → dial-in interface described above, in the mockup's visual style.
8. **History + A/B + morphing.** Every tree step and macro change saved as a node.
9. **JUCE plugin port.** Same data, same behavior, host MIDI, the 4 macros as automatable host parameters, preset save/load.

## Testing rules

- **Safety tests:** random patches (fuzzing the full schema) must never produce clipping above the limiter ceiling, DC offset, or non-mono content below the crossover.
- **Critic tests:** known-bad signals (aliased, harsh, muddy, no fundamental, whistling, uneven across notes) are rejected with the right reason; every library patch passes; every sound the human flagged stays rejected.
- **Directory coverage:** every directory entry has at least one library patch (once phase 4 is done), and each patch's `directory` and `family` exist.
- **Sound Tree tests:** options in a round keep a minimum feature distance from each other; the wildcard comes from a different region than the other three; "none of these" returns only unheard regions; every generated option passes the critic; a simulated user who always picks the option nearest a hidden target lands within a set feature distance of it in 3 rounds for most targets.
- **Macro tests:** every macro shown has a measurable effect across its range on that patch; every position of the tuned range passes the critic and the safety rules; the same macro on the same patch always produces the same parameter values (stable and automatable).
- **Performance tests:** a Sound Tree round responds in under 300 ms; four offline renders under 150 ms.

## Working style for Claude Code

- Small, reviewable commits with clear messages, one concern each.
- Think like a world-class bass sound designer: every patch is a finished, release-quality sound. Encode what makes a sound good as rules and critic checks rather than relying on the human to catch problems.
- Work autonomously: solve problems the way established synths do, and don't stop to ask the human questions or to listen. Passing tests are necessary but not proof of quality, so encode sound-design knowledge in rules and the critic.
- Never add a dependency that pulls in an ML runtime, model weights, or network access.
- If the same problem fails 3 times, step back and rethink the approach (root cause, not symptoms) instead of retrying the same fix; note what happened in the commit message.
