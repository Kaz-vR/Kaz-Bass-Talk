# CLAUDE.md — Low Talk

Low Talk is a dark, cinematic synth in the style of LORN: saturated, tape-worn, wide above a clean low end, sitting in a dark space, and always **alive** (many small, independent, non-repeating motions). It ships with a **preset bank** of hand-designed sounds across 14 categories, every one of them finished, complex and unmistakably in that style. There is no typing.

1. **Browse** the bank by category and play.
2. **Dial in** with every control on one page (no macro knobs: the repo owner prefers adjusting anything directly), plus the **mod wheel**: one connected move per preset (several real parameters moving together, like playing an instrument harder), switchable between 8 moves, every wheel position sounding right.
3. **Create** (the extra): a button that generates new presets in a category, built the same way the hand-made ones are and held to the same checks, different enough from everything in the bank to be worth having. The **Sound Tree** (explore around a sound in rounds of 4) is part of creating.

Every sound the user can hear (bank preset, generated preset, Sound Tree option, mod wheel position) must sound like a finished, expensive patch in the bank's style. Quality and style are enforced automatically (sound-design rules + quality critic + style checks), because nobody can listen to everything the system generates.

Read this whole file before starting any task. When something here conflicts with a request in a session, ask before deviating.

---

## Non-negotiables

1. **No AI at runtime.** The shipped plugin contains no language model, no embedding model and no neural network of any kind. All behavior comes from data files and plain code.
2. **Fully offline.** The plugin never makes network requests. No API keys, no servers, no telemetry.
3. **Lightweight.** Total install size under 25 MB including all data. No GPU use. The synth should stay under ~3% CPU per voice at 48 kHz (a full 8-voice pad under ~20%). Generating a preset must feel instant (a batch in a second or two). No sample libraries: every sound is synthesized. *(Planned, approved in principle by the repo owner, not built yet: a few short own/CC0 recordings for texture beds only, looped seamlessly with random start points.)*
4. **Real-time safety.** Nothing on the audio thread allocates memory, locks, or runs analysis, generator or tree code. Patch changes are handed to the audio thread and applied with parameter smoothing (no clicks).
5. **The low end is protected.** Regardless of any patch, the low end stays mono and phase-stable, there's no DC offset, and a transparent output limiter is always on.
6. **AI is a development tool only.** Claude may be used during development to generate and expand data (presets, mod wheel moves, descriptions, quality rules). Anything under `tools/` is dev-only and must never be shipped or imported by runtime code.

---

## How it works (overview)

```
  BROWSE                  DIAL IN                       CREATE (extra)
  Preset bank        ──▶  All controls on one     ◀──  Generator: recombine recipes from
  14 categories           page + mod wheel (8           the bank, re-roll movement, nudge in
  ~10-12 each             connected moves) + wobble     safe regions, reject near-duplicates
                                                        Sound Tree: explore around a sound
        │ every preset / generated sound / wheel position
        ▼
  Sound-design rules ─▶ Quality critic ─▶ Style checks (alive, earns its place,
                                          LORN fingerprint, bank consistency)
        │
  Analysis: offline render → normalized features (the map everything navigates)

  History tree: every change is a node (jump, branch, A/B, morph)
  Synth engine: up to 8 voices, plays the current patch in real time
```

The **measured feature space** is the map: the generator and Sound Tree walk it, the critic and style checks judge positions in it.

---

## The LORN recipe (every category, every preset)

What makes the bank sound like one instrument. Each category has its own version of each point.

1. **Layers:** a body + a character layer + texture, never a lone oscillator.
2. **Dirt that shapes tone:** saturation and tape wear; dirt mostly *in front of* the filter so its movement stays audible (heavy saturation after a moving filter masks the movement).
3. **Alive:** several independent, non-repeating motions on different time scales (smooth random LFOs at unrelated rates, drift, a slow bloom, per-note variation, LFO fade-in), mostly before the distortion so the tone changes, not just the level.
4. **Dark and worn:** a controlled top, tape age, some grain; texture beds (crackle, dust, rumble, air) where they belong.
5. **Space:** dark reverb and smeared delay the sound lives in, kept off the low end.
6. **Glue:** compression and pump so it breathes.

---

## Components

### 1. Synth engine
Up to 8 voices (`voice.polyphony`: 1 = monophonic with legato/glide, the bass default; 2-8 = polyphonic with voice stealing). Per voice:

- 2 main oscillators (sine, triangle, saw, pulse, wavetable with position, PWM-saw, physical-model string, Shepard), each with detune, unison (1–7 voices), spread, level; multi-operator FM (2 operators, punch envelope, feedback, stack/parallel)
- Sub oscillator (sine/triangle, −1 or −2 octaves), always mono; noise; attack transient layer (noise/click/knock/kick)
- Pre-filter drive → filter (4-pole low-pass, band-pass, formant, 303 diode with accent, notch, comb, low-pass gate) → distortion (soft, hard, fold, tube; optional mids-only split), 2× oversampled with ADAA waveshapers → bitcrusher → tape → amp
- Amp, mod and pitch envelopes, a slow bloom envelope (env 2); per-note random, analog drift, free unison phases
- Instrument additions (phase 5): delayed vibrato, breath/noise attack, richer formant vowels, inharmonic bell partials with separate decays, long riser/fall envelopes

Shared by all voices: 4 LFOs (tempo-sync, shapes incl. smooth random "wander", retrigger, fade-in), two drift sources, the 12-slot mod matrix (per-voice sources are evaluated per voice; FX targets follow the newest voice), the **mod wheel moves** (8 connected recipes, `WHEEL_MOVES` in `src/engine/core/params.ts`; each preset names its own in `wheel.preset`, by category in `data/categories.json`), the **wobble** (its own bar-locked clock: rate, depth, target filter / filter + drive / filter + drive + texture, shape, life = per-cycle variation; before the distortion; never uses LFOs or mod slots), the texture bed (crackle, dust, rumble, air; follows the notes with its own tail, silent between notes; before or after dynamics), and the FX in a **fixed order**: compressor (tempo pump at 1/1, 1/2, 1/4 or 1/8, locked to the bar) → multiband "OTT" → chorus → flanger → phaser → delay → reverb (these five only above the FX low cut) → EQ + high cut → subsonic/DC filter → mono below crossover → output limiter → mono below crossover again.

Quality: band-limited oscillators, oversampled anti-aliased nonlinear stages. Expensive-sounding, never "chiptune" unless deliberate. Every parameter is defined in the patch schema (~180 today).

### 2. Patch schema — `data/schema.json`
The single source of truth shared by the engine, analysis, generator, tree and UI. Each parameter has id, label, type (`float`, `int`, `enum`, `bool`), range/options, default, curve, unit, group and a plain `describes`. A patch is a flat JSON object `{ "<param id>": value, ... }` plus `meta`. Any patch loaded from anywhere is validated and clamped against the schema.

### 3. Categories — `data/categories.json`
The 14 categories of the bank: **Bass, Lead, Pad, Keys, Pluck, Arp / Sequence, Strings, Brass / Horns, Choir / Vocal, Bells / Mallets, Hits / Impacts, Risers & Falls, Drone / FX, Texture.** Each entry has the category's identity, its version of the LORN recipe, its default polyphony and audition loop, its critic limits and its style-fingerprint zone. Chords and Drums are not in the bank (Drums may become its own mode later).

The bass **directory** (`data/directory.json`, 51 bass types across genres and history) stays as the coverage map for the **Bass Atlas**, a secondary collection of one patch per bass type.

### 4. Preset bank — `data/library/*.json`
Hand-designed presets, about 10–12 per category (the 13 Terror basses count toward Bass), each with `name`, `description` (one sentence), `tags`, `category`, `family`, `collection`, `features` (precomputed). Built by dev tools under `tools/` (e.g. `build-terror.ts`, `build-bank.ts`). Quality bar: finished, release-quality, as good as the best factory presets of Diva / Serum / Phase Plant, and in the LORN style. Every preset passes every check below.

The Bass Atlas patches (`tools/build-library.ts`) are not held to the style checks.

### 5. Sound-design rules — `src/quality/rules`
The logic of good sound, as code and data, applied to every preset, generated sound and mod wheel move: layering; a clean low end (distortion and stereo effects stay above the sub); coupled parameters (more drive → darker tone; high resonance → tamed level; dirt before a moving filter; envelope times fit the category); movement (sustained sounds are never static unless deliberately); **safe regions** (generated sounds only move parameters within ranges taken from good presets, per category/family).

### 6. Analysis, quality critic and style checks — `src/analysis`, `src/quality`
**Analysis** renders a sound offline (the audition loop plus low / mid / high held notes, and a long held note when life is checked) and measures brightness, high-frequency energy, sub and low-mid energy, attack, decay, release, movement, life (slow / fast / repetition), stereo width, mono low end, texture level, peak, DC. Features are normalized (documented scale per feature) and precomputed for every preset.

**The quality critic** turns measurements into pass/fail with a plain reason ("fails: harsh 2–5 kHz, +6 dB over limit"). It rejects: aliasing, harshness (2–5 kHz), mud (200–400 Hz), weak fundamental, whistling resonance, level jumps across the keyboard, a texture bed that buries the sound, smeared or stereo low end, clipping, DC, a hard-working limiter. Limits live in `data/quality.json`, per family and per category.

**Style checks** (the bank's sound, by measurement):
- **Alive:** a long held note must move slowly and quickly, never like a clock, never seasick (limits per category).
- **Earns its place:** each ingredient (each mod slot, texture, tape, reverb, delay, chorus …) is switched off in turn; if the sound doesn't change measurably, it's fake complexity and the preset fails.
- **LORN fingerprint:** the vibe measurements (darkness, dirt, wear, width, space, life) must land inside the category's zone.
- **Bank consistency:** on the vibe measurements, every preset sits with the rest of the bank; outliers are flagged even when they pass everything else. Category traits (register, attack, length) are not compared.

These checks prove the ingredients are there, audible and in the right zone; they can't fully prove "this feels like LORN". **Human feedback:** no scheduled listening checks. When the human volunteers that a sound is (or isn't) it, that becomes a rule, a tightened threshold or a retuned zone.

### 7. Generator — `src/generator`
The "create presets" button. Not random settings: presets are built from recipes the way the bank is (body, dirt chain, filter, movement kit, texture, space), by recombining parts of bank presets in the category, re-rolling movement rates and amounts, and nudging parameters inside the safe regions, with the sound-design rules applied as code. Each request renders a batch of candidates offline, keeps only those that pass the critic and all style checks, rejects near-duplicates of the bank and of earlier generations (feature distance), favors unexplored parts of the category's zone, levels them, and names them from a word bank plus their measured character. Local taste learning: presets the user keeps or deletes shift future generations (plain code, stored locally).

### 8. Sound Tree — `src/tree`
Exploration around a sound: rounds of 4 (3 near the current lean + 1 wildcard), picks are leans, options generated by the same machinery as the generator, "none of these", "between these two" blends, breadcrumb, instant audition, critic and style checks on every option. Small descriptor vocabulary (`data/vocabulary.json`) used only to name generated presets and read leans; no text input.

### 9. Mod wheel and expression
*(Macros were dropped: all controls stay on one page.)* The mod wheel plays one **connected move** per preset: Pressure (louder, brighter, grittier, a little breath), Snarl (distortion, resonance, bite), Open (filter and top open), Choke (darker, tighter, drier, narrower), Vibrato, Unstable (wobble, detune, sag), Decay (wear, crush, grain), Bloom (reverb, delay, width, texture). Wheel at 0 = the preset exactly as designed. The preset's own move (by category) is the default; a dropdown switches it. A sample of presets is checked with every move fully up for quality and safety (the moves are shared recipes, so a sample catches what a full sweep would). Aftertouch is not used (rare on keyboards and easily triggered by accident); MPE comes with the plugin.

### 10. History — `src/history`
A tree of patch snapshots. Every preset load, generation, tree step and edit creates a node; jump, branch, A/B, morph (interpolate continuous params; switch enums/ints at the midpoint).

---

## UI

Keeps the visual style of the approved mockup. No text input.

- **Header:** play/pause audition loop, loop selector (built-in riffs or host MIDI), current preset name with ‹ › to step through its category, "low end mono · limiter on" indicator.
- **Browser (main focus at the start):** the 14 categories, the presets in the selected one (name, one-line description, tags), instant audition. Secondary collections (Bass Atlas) behind a toggle.
- **All controls on one page**, grouped in boxes: the first box after Voice is the **Mod wheel** (move dropdown + an always-visible wheel that follows the hardware wheel); every LFO / envelope box shows where it is routed ("→ cutoff +14%"), an "Other sources" box covers drift, drift slow, random, velocity, mod wheel, keytrack; LFOs have a Hz | Sync switch showing only the control in use; the **Wobble** box; the 12-slot mod matrix.
- **Create:** "Create presets" in the current category (and the Sound Tree for exploring around the current sound); generated presets can be kept or discarded.
- **Secondary tools:** A/B against any history step, spectrum view, history strip.

---

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
4. **Bass library.** The 51-type Bass Atlas and the 13 Terror basses, with movement additions (4 LFOs, wander, env 2, 12 slots, FX mod targets), the alive check and texture beds. *(Done.)*
5. **Polyphony + instrument additions.** 8 voices with voice stealing (mono mode unchanged), delayed vibrato, breath attack, richer vowels, bell partials, long riser/fall envelopes; CPU within budget. *(Done.)*
6. **Style checks.** `data/categories.json`, per-category critic limits, earns-its-place, LORN fingerprint, bank consistency. *(Done.)*
7. **Preset bank.** ~10-12 presets in each of the 14 categories, all passing every check. *(Done.)*
8. **UI.** Category browser in the mockup's style, all controls on one page. *(Done; the create area follows its phase.)*
9. **Expression.** Mod wheel moves, wobble, pump rate, texture before/after dynamics. *(Done.)*
10. **Generator + Sound Tree.** Create presets per category; exploration rounds; taste learning.
11. **History + A/B + morphing.**
12. **JUCE plugin port.** Same data, same behavior, host MIDI, every parameter and the mod wheel as automatable host parameters, preset save/load. Also at the port: the pump and wobble locked to the host's transport (essential, or they pump off the beat); **MPE** (per-note bend, pressure, slide, drawable in Ableton/Bitwig); **loading your own texture recordings** (seamless loop, random start, kept off the low end, auto-levelled, stored with the preset) plus a few built-in CC0/own recordings. Port the engine once to C++ and compile it to WebAssembly for the browser prototype, so engine changes are made once.

**Later experiments (agreed in principle, not scheduled):** a "performer" layer (a few hidden slowly-wandering states such as effort, breath supply and an unsteady hand, each driving several parameters together the way a player does), tried on ~2 presets in a few categories first; a LORN-style rhythmic wobble bass; trying "varied sound first, then lornify" on one category, with the "never like a clock" rule relaxed to allow deliberate rhythm with irregular life on top.

## Testing rules

- **Safety:** random patches (fuzzing the full schema, mono and poly) never clip above the limiter ceiling, never carry DC, never put stereo content below the crossover.
- **Critic:** known-bad signals are rejected with the right reason; every preset passes; every sound the human flagged stays rejected.
- **Style:** every bank preset passes alive, earns-its-place, fingerprint and consistency; deliberately static, flat, bright-clean or fake-complex test presets are caught.
- **Coverage:** every category has its presets; every Bass Atlas type has a patch; every preset's category/family exists.
- **Polyphony:** chords render each note at the right pitch; voice stealing never clicks; mono mode behaves as before; 8 voices stay within the CPU budget.
- **Generator / Sound Tree:** every generated sound passes all checks; generated presets keep a minimum feature distance from the bank and from each other; a simulated user who always picks the option nearest a hidden target lands near it in 3 rounds for most targets.
- **Mod wheel / wobble:** at rest they change nothing; every move and the wobble change the sound measurably; a sample of presets keeps quality and safety with every move fully up; the wobble repeats with the tempo and its life varies each cycle.
- **Stamps:** each preset's check results carry an audio fingerprint and the judge hash (`src/quality/stamp.ts`, `tools/lib/codehash.ts`). While both match, results are kept without re-analysis, so code changes that don't change a sound don't trigger a full re-check.
- **Performance:** a generation batch and a Sound Tree round respond fast enough to feel instant (target < 300 ms per round); the engine stays within the CPU budget.

## Working style for Claude Code

- Small, reviewable commits with clear messages, one concern each.
- Think like a world-class sound designer working in LORN's style: every preset is a finished, release-quality sound. Encode what makes a sound good, and what makes it fit the bank, as rules and checks rather than relying on the human to catch problems.
- Work autonomously: solve problems the way established synths do, and don't stop to ask the human questions or to listen. Passing tests are necessary but not proof of quality.
- Never add a dependency that pulls in an ML runtime, model weights, or network access.
- If the same problem fails 3 times, step back and rethink the approach (root cause, not symptoms) instead of retrying the same fix; note what happened in the commit message.
