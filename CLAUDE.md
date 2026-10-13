# CLAUDE.md — Low Talk

Low Talk is a bass synth plugin you talk to. The user types what they want ("dark reese for dnb", "B but a bit less buzzy and way more sub") and the plugin turns that into a sound, offers a few takes, and exposes custom knobs for fine-tuning.

Read this whole file before starting any task. When something here conflicts with a request in a session, ask before deviating.

---

## Non-negotiables

1. **No AI at runtime.** The shipped plugin contains no language model, no embedding model and no neural network of any kind. All "understanding" comes from data files and plain code.
2. **Fully offline.** The plugin never makes network requests. No API keys, no servers, no telemetry.
3. **Lightweight.** Total install size under 25 MB including all data. No GPU use. A text request must produce takes in under 300 ms on a mid-range laptop. The synth itself should stay under ~3% CPU per voice at 48 kHz.
4. **Real-time safety.** Nothing on the audio thread allocates memory, locks, or touches the language layer. Patch changes are handed to the audio thread and applied with parameter smoothing (no clicks).
5. **The low end is protected.** Regardless of any patch, the sub stays mono and phase-stable, there's no DC offset, and a transparent output limiter is always on.
6. **AI is a development tool only.** Claude may be used during development to generate and expand data (the sound dictionary, patch descriptions, test phrases). Anything under `tools/` is dev-only and must never be shipped or imported by runtime code.

---

## How it works (overview)

```
user text
   │
   ▼
Parser ── tokenizes, finds sound words, amounts, commands
   │
   ▼
Resolver ── looks up the Sound Dictionary + Patch Library
   │         → fresh request: pick nearest library patches
   │         → edit request: apply descriptor moves to current patch
   ▼
Take generator ── builds 4 candidate patches (variations)
   │
   ▼
Listening check ── renders each candidate offline, measures features,
   │               verifies the change went the right direction, ranks
   ▼
UI ── shows takes, generated macros, check results, history
   │
   ▼
Synth engine ── plays the chosen patch in real time
```

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
- FX: chorus, phaser, short reverb, EQ (with low-cut on FX returns), output limiter
- Mono-below-crossover processing (default 120 Hz)

Target around 80 parameters total. Every parameter must be defined in the patch schema.

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

- `name`, `description` (one sentence), `tags` (genre, character, era), `features` (precomputed by the listening check)

Coverage should span: Reese, sub-only, 808-style, acid, Moog-style, FM/metallic, neuro/growl, wobble, dub, pluck, synthwave, garage/organ, techno rumble, funk/slap-ish, distorted rock-style, and clean "utility" basses.

Quality bar: every patch must sound good on the default audition loop. The human (repo owner) is the final judge; generate candidates, render them, and ask for review in batches.

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
5. Detect commands and references to takes or history steps.
6. Output a structured intent:

```json
{
  "mode": "edit",
  "base": "take:B",
  "changes": [
    { "descriptor": "buzzy", "direction": -1, "amount": 0.4 },
    { "descriptor": "sub",   "direction": 1,  "amount": 1.8 }
  ],
  "unknown": []
}
```

`mode` is `fresh` (new sound from library), `edit` (modify current), or `command`.

### 6. Resolver and take generator — `src/language/resolver`
- **Fresh:** score library patches by tag and descriptor overlap, pick the top matches, apply any descriptors in the request, and produce 4 takes that differ meaningfully (not 4 near-identical patches; enforce a minimum feature distance between takes).
- **Edit:** apply moves to the current patch to make take 1, then make 3 variations by scaling the amount (e.g. 0.6×, 1.0×, 1.5×) and/or applying one adjacent descriptor from the same category.
- **Unknown words:** never guess silently. Return them in `unknown`, and suggest the 3 nearest known phrases (by edit distance and by shared category in a small hand-written synonym map) as tappable chips.

### 7. Listening check — `src/analysis`
Renders each candidate offline (about 2 seconds of the audition loop) and measures:

- brightness (spectral centroid), high-frequency energy, sub energy (< 80 Hz), low-mid energy (80–300 Hz)
- attack time, release/decay length
- movement (modulation depth/rate in the spectrum over time)
- stereo width above the crossover, mono correlation below it
- peak level, DC offset

For edits, compare against the previous patch and check every `expect` from the applied descriptors. Candidates that move in the wrong direction get one automatic correction pass (scale the offending moves up, or apply the move list again); if they still fail, they're dropped. Rank survivors by how well they satisfy expectations; this produces the "match" score shown on take cards.

Must render four candidates in under 150 ms total. Keep renders short and use a reduced-quality offline mode if needed.

### 8. Macros — `src/macros`
Every patch gets 4 generated macro knobs. Macros are built from the descriptors relevant to that patch (the ones applied in this conversation, plus the library patch's top tags):

- A macro = name + a list of `{ param, from, to, curve }` mappings.
- Default macros if nothing better fits: Growl/Character, Movement, Sub weight, Dirt.
- Turning a macro is instant and local; it never runs the language layer.

### 9. History — `src/history`
A tree of patch snapshots (not a list). Every applied request creates a node with its message text. Users can jump to any node, branch from it, and morph between two nodes (interpolate continuous params; switch enums/ints at the midpoint).

---

## UI (matches the approved mockup)

- **Header:** play/pause audition loop, loop selector (built-in riffs or host MIDI), current patch name, "sub mono · limiter on" indicator.
- **Left column:** conversation (terse replies, one line each), descriptor chips (warmer, brighter, rounder, nastier, tighter, plus context-aware ones), text input with Send, reference-clip drop zone (later phase).
- **Takes row:** 4 cards with letter, mini waveform, name, one-line description, match score. Clicking a card swaps it in under the loop instantly.
- **Macros panel:** 4 generated knobs + link to the full parameter view.
- **Listening check panel:** spectrum view, plus one line per expectation (e.g. "'Less buzzy' → brightness −34% ✓").
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
  /dictionary     descriptors, amounts.json, commands.json, genres.json
  /loops          audition MIDI riffs
/src
  /engine         synth DSP + AudioWorklet
  /language       parser, resolver, take generator
  /analysis       offline render + feature extraction
  /macros
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
2. **Patch library.** Grow to 150+ patches with tags and descriptions; batch-render them for human review. Precompute features.
3. **Analysis.** Offline render + feature extraction, with tests on known signals (a sine should have near-zero high-frequency energy, etc.).
4. **Dictionary + parser.** Descriptors, amounts, commands, genres. Typo handling. Unknown-word suggestions.
5. **Resolver + takes + listening check.** End-to-end: text in, 4 ranked, verified takes out.
6. **UI.** The full interface from the mockup.
7. **Macros + history + morphing.**
8. **JUCE plugin port.** Same data, same behavior, host MIDI and automation for the macros, preset save/load.
9. **Later:** reference-clip matching (measure a dropped audio file's features and find the nearest library patches), user-taught words ("when I say gritty I mean this").

## Testing rules

- **Dictionary integrity test:** for every descriptor, apply it to a set of library patches, render, and check that every `expect` holds in the majority of cases. A descriptor that fails gets flagged for rework. This test is what keeps the dictionary honest as it grows.
- **Golden phrases:** `tests/phrases.json` holds 300+ realistic user messages with the expected parsed intent. Parser changes must keep these passing.
- **Safety tests:** random patches (fuzzing the full schema) must never produce clipping above the limiter ceiling, DC offset, or non-mono content below the crossover.
- **Performance tests:** text → takes under 300 ms; four offline renders under 150 ms.

## Working style for Claude Code

- Small, reviewable commits with clear messages, one concern each.
- When generating data (patches, descriptors, phrases), work in batches and render audio previews for human review rather than generating everything at once.
- If a sound-design decision needs ears, stop and ask the human to listen. Don't treat passing tests as proof that something sounds good.
- Never add a dependency that pulls in an ML runtime, model weights, or network access.
