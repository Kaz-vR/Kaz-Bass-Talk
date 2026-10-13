# CLAUDE.md — Low Talk

Low Talk is a bass synth plugin built around one flow: **seed, then dial in**.

1. **Seed** (ballpark the sound fast). The default start is the **Sound Tree**: it plays 4 options, the user clicks the closest, hears 4 more around that choice, and after 2-3 clicks is in the right neighborhood. Two other seed doors are always visible: **drop a reference** audio file, or **type** ("dark reese", "more sub", "less buzzy").
2. **Dial in** (once it's close) with **4 generated macro knobs**: recipes that each move several real parameters, chosen for this patch by how much they audibly change it, with ranges tuned so the whole knob travel sounds good.

Text is a shortcut, not the main interface.

Read this whole file before starting any task. When something here conflicts with a request in a session, ask before deviating.

---

## Non-negotiables

1. **No AI at runtime.** The shipped plugin contains no language model, no embedding model and no neural network of any kind. All "understanding" comes from data files and plain code.
2. **Fully offline.** The plugin never makes network requests. No API keys, no servers, no telemetry.
3. **Lightweight.** Total install size under 25 MB including all data. No GPU use. A Sound Tree round, a reference drop or a text request must respond in under 300 ms on a mid-range laptop. The synth itself should stay under ~3% CPU per voice at 48 kHz.
4. **Real-time safety.** Nothing on the audio thread allocates memory, locks, or touches the language layer. Patch changes are handed to the audio thread and applied with parameter smoothing (no clicks).
5. **The low end is protected.** Regardless of any patch, the sub stays mono and phase-stable, there's no DC offset, and a transparent output limiter is always on.
6. **AI is a development tool only.** Claude may be used during development to generate and expand data (the sound dictionary, patch descriptions, test phrases). Anything under `tools/` is dev-only and must never be shipped or imported by runtime code.

---

## How it works (overview)

```
                SEED  (ballpark)                                DIAL IN  (precise)
 ┌──────────────────────────────────────────────┐
 │ Sound Tree (default)   4 options per round,  │
 │   picks are leans, wildcard, "none of these",│      Macro selector
 │   "between these two", breadcrumb            │──┐     family pool (8-12 recipes)
 │ Drop a reference       nearest patches by    │  │     → render each at a few positions
 │   features                                   │──┼──▶  → keep the 4 with most audible impact
 │ Type (shortcut)        parser + dictionary   │  │     → tune each range to "still sounds good"
 └──────────────────────────────────────────────┘  │     → boost macros matching the user's leans
          ▲ all three use measured features         │
          │                                         ▼
   Analysis / listening check ◀──────── renders, measures, verifies
          │
   Patch library (precomputed features, family tags)
                                                    │
 History tree: every tree step, macro change and text tweak is a node (jump, branch, A/B, morph)
                                                    │
 Synth engine: plays the current patch in real time ▼
```

The **measured feature space** (from the analysis code) is the map everything navigates: the Sound Tree walks it, reference drops land in it, macros are judged by how far they move a sound through it, and text edits are verified against it.

---

## Components

### 1. Synth engine
A monophonic-first bass synth (with optional legato/glide). Suggested signal path:

- 2 main oscillators (saw, square/pulse, wavetable with position), each with detune, unison (1–7 voices), spread, level
- Sub oscillator (sine/triangle, −1 or −2 octaves), always mono
- Noise source (low level, for grit)
- Pre-filter drive
- Filter: 4-pole low-pass, band-pass, formant (vowel morph); cutoff, resonance, key tracking, envelope amount
- Distortion stage: soft clip, hard clip, wavefold, bitcrush; drive, mix, post-tone
- 2 envelopes (amp, mod), 2 LFOs (tempo-syncable, multiple shapes, retrigger option)
- Small mod matrix (8 slots)
- Analog character: per-voice pitch drift, free unison phases, per-note filter variation
- Quality: band-limited oscillators; drive, filter and distortion run 2× oversampled with anti-aliased (ADAA) waveshapers. Expensive-sounding, never "chiptune".
- Distortion can be mids-only (clean below a split frequency) so the sub stays clean
- FX, in a **fixed order** (no user re-ordering; the language layer relies on a known chain):
  distortion → bitcrusher/downsampler → tape (saturation, wow/flutter, age) → amp → + sub → compressor (with tempo-synced pump) → multiband "OTT" → chorus → flanger → phaser → delay → reverb (these five only above the FX low cut) → EQ + high cut → subsonic/DC filter → mono below crossover → output limiter
- Mono-below-crossover processing (default 120 Hz)

The FX that are part of the bass sound itself live inside the plugin, because the language layer can only change what is inside. Big creative space effects, mastering and real kick sidechain are left to other plugins.

Around 115 parameters total (approved by the repo owner; grew from the original ~80 target to fit the FX). Every parameter must be defined in the patch schema.

### 2. Patch schema — `data/schema.json`
The single source of truth shared by the engine, the language layer, and the UI. For each parameter:

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

### 3. Patch library — `data/library/*.json`
150–300 hand-tuned patches, each with:

- `name`, `description` (one sentence), `tags` (genre, character, era), `family` (which macro pool it uses, e.g. reese, 808, acid, growl), `features` (precomputed by the listening check)

Coverage should span: Reese, sub-only, 808-style, acid, Moog-style, FM/metallic, neuro/growl, wobble, dub, pluck, synthwave, garage/organ, techno rumble, funk/slap-ish, distorted rock-style, and clean "utility" basses.

Quality bar: every patch must sound good on the default audition loop, and sound "expensive" (think Diva / Serum), not like a chiptune. Also cover dark, cinematic, heavily processed basses in the style of LORN (saturated, tape-worn, lo-fi, wide, with space), not only basic ones. The human (repo owner) is the final judge; generate candidates, render them, and ask for review in batches.

### 4. Sound dictionary — `data/dictionary/*.json`
The core of the "intelligence". It maps words and phrases to parameter moves.

```json
{
  "id": "buzzy",
  "phrases": ["buzzy", "fizzy", "harsh", "too much top", "raspy", "brittle"],
  "category": "brightness",
  "moves": [
    { "param": "filter.cutoff",     "op": "mul", "amount": 1.6 },
    { "param": "dist.post_tone",    "op": "add", "amount": 0.25 },
    { "param": "osc1.unison_voices","op": "add", "amount": 1 }
  ],
  "expect": { "brightness": "up", "high_energy": "up" },
  "opposite": "smooth"
}
```

- `op`: `add`, `mul`, `set`, `toward` (move toward a target value by a fraction).
- Applying a word negatively ("less buzzy") inverts the moves; if `opposite` exists, prefer applying the opposite entry.
- `expect` declares which measured features should change and in which direction. The listening check enforces this, and so do the tests.
- Category groups prevent contradictions (e.g. "darker and brighter" in one sentence triggers a clarification).

Aim for 150+ descriptor entries and 2,000+ phrases at launch, including common misspellings and producer slang. Expanding this file is the main way the plugin gets "smarter" over time.

Also in the dictionary folder:
- `amounts.json`: intensity words → multipliers ("a touch" 0.25, "a bit" 0.4, "more" 1.0, "way more"/"much more" 1.8, "max" → clamp to range end).
- `commands.json`: "like A/B/C/D", "back", "undo", "go back to the first one", "start over", "new idea", "keep the sub but…", "same but…".
- `genres.json`: genre/style words → library tags ("dnb", "dubstep", "techno", "house", "trap", "synthwave"...).

### 5. Parser — `src/language/parser`
Plain code, deterministic, no ML.

1. Normalize: lowercase, strip punctuation, fix common typos (small edit-distance match against dictionary phrases; max distance 1 for words ≤5 chars, 2 for longer).
2. Longest-match phrase lookup (so "too much top" wins over "top").
3. Attach amount words to the next or previous descriptor.
4. Detect negation ("less", "not so", "without", "no", "remove").
5. Detect commands and references to Sound Tree options ("like B") or history steps.
6. Output a structured intent:

```json
{
  "mode": "edit",
  "base": "option:B",
  "changes": [
    { "descriptor": "buzzy", "direction": -1, "amount": 0.4 },
    { "descriptor": "sub",   "direction": 1,  "amount": 1.8 }
  ],
  "unknown": []
}
```

`mode` is `fresh` (new sound from library), `edit` (modify current), or `command`.

### 6. Resolver — `src/language/resolver`
Text is a shortcut into the same flow, not a separate one:
- **Fresh** ("dark reese"): score library patches by tag and descriptor overlap, apply any descriptors in the request, and hand the result to the Sound Tree as its starting lean. The user sees an ordinary Sound Tree round (4 options that differ meaningfully, with a wildcard) and continues from there.
- **Edit** ("less buzzy", "more sub"): apply the descriptor moves to the current patch as one change, verified by the listening check (with its one correction pass), and saved as a history node. No batch of variations; the macros are the precise tool.
- **Unknown words:** never guess silently. Return them in `unknown`, and suggest the 3 nearest known phrases (by edit distance and by shared category in a small hand-written synonym map) as tappable chips.

### 7. Listening check — `src/analysis`
Renders each candidate offline (about 2 seconds of the audition loop) and measures:

- brightness (spectral centroid), high-frequency energy, sub energy (< 80 Hz), low-mid energy (80–300 Hz)
- attack time, release/decay length
- movement (modulation depth/rate in the spectrum over time)
- stereo width above the crossover, mono correlation below it
- peak level, DC offset

These features are the coordinate system for the whole product. They are:
- precomputed for every library patch (and stored in its `features`),
- the distance measure the Sound Tree uses to pick options and track leans,
- how a dropped reference clip is placed (the same features measured from the audio file),
- how macros are judged (how far a macro moves the sound) and how their ranges are limited (where the sound stops being good or safe),
- how text edits are verified: compare against the previous patch and check every `expect` from the applied descriptors. A change that moves in the wrong direction gets one automatic correction pass (scale the offending moves up, or apply the move list again); if it still fails, the user is told in one line.

Features must be normalized so distances are meaningful across features (a documented scale per feature). Must render four candidates in under 150 ms total. Keep renders short and use a reduced-quality offline mode if needed.

### 8. Sound Tree — `src/tree`
The default way to start. It ballparks a sound in 2-3 clicks; it never has to be finished.

- **Rounds of 4.** Each round plays 4 options: **3 near the current lean + 1 wildcard** from a nearby but different area. Picking the wildcard redirects the walk.
- **Picks are leans, not commitments.** A pick shifts the odds toward that region of the feature space; nothing is ruled out permanently.
- **Chosen by measured features, never by genre labels alone.** Within a round, options are picked to sound as different from each other as possible (maximize feature distance between them), while staying in the leaned region.
- **"None of these"** gives 4 fresh options from parts of the sound space the user hasn't heard yet.
- **"Between these two"**: the user selects 2 options and gets blends of them (morphs: continuous params interpolated, enums/ints switch at the midpoint), measured like any other option.
- **Breadcrumb trail** of picks at the top. Clicking any step jumps back to it so the user can choose differently.
- **Stop any time.** The current pick becomes the patch to dial in.
- **Instant audition.** Every option plays under the audition loop on hover/click, swapped in with smoothing.
- The candidate pool is the library (with precomputed features) plus blends between nearby library patches, so the space has no big holes.
- Picks feed the macro selector (a lean toward "dirtier" raises dirt-related macros) and every step is saved to history.

**Other seed doors** (always visible next to the tree):
- **Drop a reference:** measure the dropped audio file with the analysis code and seed from the nearest library patches by features (as a Sound Tree round leaning toward them).
- **Type:** the parser/dictionary shortcut (see Resolver).

### 9. Macros — `src/macros`
The main dial-in tool: 4 knobs, precise and predictable. No variations at this stage.

- **Family pools.** Each bass family in the library has its own pool of roughly 8-12 macro candidates. A macro is a recipe: name + a list of `{ param, from, to, curve }` mappings that move several real parameters at once. Examples:
  - Reese: Detune, Movement, Grit, Sub
  - 808: Decay, Punch, Saturation, Pitch drop
  - Acid: Cutoff, Resonance, Squelch, Accent
  - Growl: Talk (formant), Rate, Drive, Width

  Every family in the library gets a full pool.
- **Chosen by audible impact.** Before showing knobs, render each candidate at a few positions offline and measure how much the sound actually changes. Drop macros with little audible effect on this patch; show the 4 with the biggest impact.
- **Leans raise priority.** The user's Sound Tree picks (and text requests) boost related macros: a lean toward "dirtier" puts a dirt macro ahead.
- **Ranges tuned per patch.** Each knob starts at the current sound's position and sweeps only through territory that still sounds good, with limits set by the listening check and the safety guardrails. The whole knob travel must be usable.
- **Swappable.** Clicking a macro's name swaps it for another from the family pool.
- **Stable.** Once picked, a macro keeps its name and behavior. Turning it is instant and local (it never runs the language layer). Macros are automatable from the DAW (host parameters in the plugin).

### 10. History — `src/history`
A tree of patch snapshots (not a list). Every Sound Tree step, macro change, reference drop and text tweak creates a node with a short label. Users can jump to any node, branch from it, A/B the current sound against any node, and morph between two nodes (interpolate continuous params; switch enums/ints at the midpoint).

---

## UI

Keeps the visual style of the approved mockup; the layout follows the seed → dial-in flow.

- **Header:** play/pause audition loop, loop selector (built-in riffs or host MIDI), current patch name, "sub mono · limiter on" indicator.
- **Seed area (main focus at the start):**
  - Sound Tree: breadcrumb trail of picks across the top; 4 option cards (mini waveform, short name, the wildcard clearly marked); "None of these" and "Between these two" buttons. Hover/click plays an option under the loop.
  - The two other seed doors, always visible: a reference drop zone and a short text box with Send.
- **Dial-in area (main focus once a sound is picked):** 4 large macro knobs; click a knob's name to swap it from the family pool.
- **Secondary tools (visible, not the focus):** text tweaks via the dictionary ("less buzzy") with one-line replies, A/B against any history step, a listening-check panel (spectrum + one line per expectation, e.g. "'Less buzzy' → brightness −34% ✓"), and the full parameter view behind a button.
- **History strip:** clickable nodes with branches; Alt-drag between two nodes to morph.

The synth's own replies must be one short line. The sound is the answer.

---

## Tech stack

- **Phase A (prototype):** TypeScript + Vite, Web Audio with an AudioWorklet for the synth engine. Runs in the browser, no backend.
- **Phase B (plugin):** C++ with JUCE, VST3 + AU (and standalone app). The DSP is ported from the prototype; the language layer, schema, dictionary and library are reused.
- `data/` is plain JSON shared by both phases. Keep the language layer free of browser APIs so it's easy to port (or compile the same logic into the plugin).

## Repository layout

```
/data
  schema.json
  /library        patch files
  /macros         macro pools, one file per family
  /dictionary     descriptors, amounts.json, commands.json, genres.json
  /loops          audition MIDI riffs
/src
  /engine         synth DSP + AudioWorklet
  /language       parser, resolver
  /analysis       offline render + feature extraction
  /tree           Sound Tree (seed by listening) + reference-drop seeding
  /macros         family pools, impact ranking, per-patch range tuning
  /history
  /ui
/plugin           JUCE project (Phase B)
/tools            DEV ONLY: data generation, validation, batch rendering
/tests
```

---

## Build phases

Finish each phase, with its tests passing, before starting the next. At the end of each phase, summarize what was built and what the human should listen to or try.

1. **Engine + schema.** Synth playable from computer keyboard and MIDI, all parameters in the schema, ~10 hand-made patches, default audition loops. *Done when:* it sounds good with zero language features.
2. **Patch library.** Grow to 150+ patches with tags, `family` and descriptions; batch-render them for human review.
3. **Macro pools.** For every family in the library, a pool of roughly 8-12 macro recipes. Render each macro at several positions on the family's patches for human review. (Automatic impact ranking and per-patch range tuning come in phase 6, once features exist.)
4. **Analysis.** Offline render + feature extraction with normalized features, tests on known signals (a sine should have near-zero high-frequency energy, etc.), and precomputed features for every library patch.
5. **Sound Tree + reference drop.** Rounds of 4 (3 near the lean + 1 wildcard), leans, "none of these", "between these two" blends, breadcrumb, instant audition; reference-clip seeding from measured features.
6. **Dial-in macros.** Impact ranking (render each candidate at a few positions, keep the 4 biggest), per-patch range tuning within listening-check and safety limits, lean-based priority, swapping from the pool.
7. **UI.** The seed → dial-in interface described above, in the mockup's visual style.
8. **History + A/B + morphing.** Every tree step, macro change and tweak saved as a node.
9. **Dictionary + parser.** Descriptors, amounts, commands, genres, typo handling, unknown-word suggestions; text as a seed (into the Sound Tree) and as a verified tweak.
10. **JUCE plugin port.** Same data, same behavior, host MIDI, the 4 macros as automatable host parameters, preset save/load.
11. **Later:** user-taught words ("when I say gritty I mean this").

## Testing rules

- **Dictionary integrity test:** for every descriptor, apply it to a set of library patches, render, and check that every `expect` holds in the majority of cases. A descriptor that fails gets flagged for rework. This test is what keeps the dictionary honest as it grows.
- **Golden phrases:** `tests/phrases.json` holds 300+ realistic user messages with the expected parsed intent. Parser changes must keep these passing.
- **Safety tests:** random patches (fuzzing the full schema) must never produce clipping above the limiter ceiling, DC offset, or non-mono content below the crossover.
- **Sound Tree tests:** options in a round keep a minimum feature distance from each other; the wildcard comes from a different region than the other three; "none of these" returns only unheard regions; a simulated user who always picks the option nearest a hidden target patch lands within a set feature distance of it in 3 rounds for most targets.
- **Macro tests:** every macro shown has a measurable effect across its range on that patch; the whole tuned range passes the safety rules and the listening-check quality limits; the same macro on the same patch always produces the same parameter values (stable and automatable).
- **Performance tests:** a Sound Tree round, a reference drop or a text request responds in under 300 ms; four offline renders under 150 ms.

## Working style for Claude Code

- Small, reviewable commits with clear messages, one concern each.
- When generating data (patches, descriptors, phrases), work in batches and render audio previews for human review rather than generating everything at once.
- If a sound-design decision needs ears, stop and ask the human to listen. Don't treat passing tests as proof that something sounds good.
- Never add a dependency that pulls in an ML runtime, model weights, or network access.
- If the same problem fails 3 times, stop and explain instead of trying again.
