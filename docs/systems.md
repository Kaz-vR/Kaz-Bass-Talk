# Schema, categories, bank, quality, generator, tree, wheel, history (Components 2-10)

*(Moved out of CLAUDE.md word for word to keep every session's context small; CLAUDE.md is the index. Read this file when a task touches it.)*

### 2. Patch schema — `data/schema.json`
The single source of truth shared by the engine, analysis, generator, tree and UI. Each parameter has id, label, type (`float`, `int`, `enum`, `bool`), range/options, default, curve, unit, group and a plain `describes`. A patch is a flat JSON object `{ "<param id>": value, ... }` plus `meta`. Any patch loaded from anywhere is validated and clamped against the schema.

### 3. Categories — `data/categories.json`
The categories of the bank: **Bass, Lead, Pad, Strings, Brass & Winds, Choir, Keys & Organs, Pluck, Arp / Sequence, Noise.** (Owner's calls: Bells / Mallets, Hits / Impacts, Risers & Falls, Drone / FX and Texture were removed with their presets; Strings and Brass / Horns were merged into Pad and later split out again as empty shelves (Strings, Brass & Winds), with Choir back (empty, for the formant filter) and Keys renamed Keys & Organs, all waiting for the bank rebuild; the strings and brass presets stay on Pads until then. Every category shows as a shelf, even an empty one.) Each entry has the category's identity, its version of the LORN recipe, its default polyphony and audition loop, its critic limits and its style-fingerprint zone. Chords and Drums are not in the bank (Drums may become its own mode later). **Noise** (owner's call): sounds where the noise strip is the instrument, not a bed under it: no oscillators and no sub, the rhythm left to the producer's own tools after the synth (ShaperBox and the like; the Wobbler was removed), effects allowed (filter via N, tape, distortion, crush, chorus); some are playable with KEY and glide, the hit types as a kit across the keys. Built by `tools/bank/noise.ts` (its 22 presets were built around the Wobbler and now play as held noise until the Noise shelf is rebuilt).

The bass **directory** (`data/directory.json`, 48 bass types across genres and history) stays as the coverage map for the **Bass Atlas**, a secondary collection of one patch per bass type.

### 4. Preset bank — `data/library/*.json`
Hand-designed presets, at most 35 per shelf (Pluck and Arp count together; the 13 Terror basses count toward Bass), each with `name`, `description` (one sentence), `tags`, `category`, `family`, `collection`, `features` (precomputed). Built by dev tools under `tools/` (e.g. `build-terror.ts`, `build-bank.ts`). Quality bar: finished, release-quality, as good as the best factory presets of Diva / Serum / Phase Plant, and in the LORN style. Every preset passes every check below.

The Bass Atlas patches (`tools/build-library.ts`) are not held to the style checks.

**The bank will be rebuilt from scratch once the synth is done (owner's call).** Until then, existing presets are not adjusted to engine or UI changes beyond what keeps them loading (migrations in `validatePatch`); no re-checks. Before the rebuild, a **rulebook** for creating presets gets written (not yet: it waits until the synth is settled, so it isn't redone). Notes for it so far:
- No rhythm inside the synth: gates, chops and tempo wobbles are the producer's (ShaperBox and the like, after the synth; the Wobbler was removed, owner's call: the synth is about the sound itself). LFOs are for life: wander, drift, slow motion.
- LFO destinations in presets (owner's call): only the matrix menu's COMMON column. For the LORN bank: **A+B Pitch** (the tape wobble), **Fil Cutoff** (the breathing, the bloom, the pluck), **Fil Drive** (grit moving before the filter), **Dis Drive** (rawer grit after it, for the hard end) and **A+B / A / B Shape**, **Level** rarely; **Pitch** is in COMMON for the Classic Basses' 808, log drum and donk drops, not for the LORN bank. No 808 drop (the owner doesn't want it), no A / B Pitch on their own (a Reese's beating comes from detune, and its life from the Analog drift), no Fil Res (resonance is set once per sound), nothing else. The rest of the menu is for users' own sounds and the mod wheel (Vibrato). The Noise shelf decides its own (e.g. Noise Pitch) when it is rebuilt.
- Signature move (owner's discovery): playable noise (Noise KEY, glide, bend); the rebuilt bank gets a few presets built around it (a noise lead, a glide tape-stop layer, a crackle-hit kit).

**No hidden octave (owner's rule):** every preset's register shows where the user sees it, on oscillator 1 and 2 and the sub. `voice.octave` stays 0 (the builders fold it in: `tools/lib/octave.ts`; the click layer's pitch follows the sub's octave), the old UI doesn't show it, and `tests/library.test.ts` enforces it.

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

### 7b. Randomizer — `src/generator/randomizer.ts` *(built; the first piece of the generator)*
A **🎲 Randomizer** tab after the categories: a Roll button, a **Weirdness** amount and **Based on** (a category or anything). A roll starts from a preset, swaps whole boxes in from other presets (same category when tame, any category as it gets weird: collisions), nudges values inside the range good presets use, and spends a weirdness budget on a few wild ideas (comb, fold, pitch drops, a wobble, odd routings…). A quick silent render rejects silence, clipping, harshness and mud; at higher weirdness the candidate farthest from every bank preset wins. Rolls are levelled, named, and get a hint of where they might fit. **🔒 on every box** keeps it while the rest rolls. Rolls appear as cards (click to go back to one, ✕ to throw one away, "Clear all rolls" to start fresh); ☆ stars a roll into the **★ User** tab (stored locally), where it stays even after clearing. **Built-in User sounds** (owner's call, for now): `data/user-sounds.json` ships with the synth and fills ★ User after the browser's own (each name once); **Export all** in ★ User downloads the browser's User sounds as that file. The locks only show while the Randomizer tab is open. Rolls are held to quality and safety, not the LORN style zone (weird is allowed, broken isn't).

### 8. Sound Tree — `src/tree`
Exploration around a sound: rounds of 4 (3 near the current lean + 1 wildcard), picks are leans, options generated by the same machinery as the generator, "none of these", "between these two" blends, breadcrumb, instant audition, critic and style checks on every option. Small descriptor vocabulary (`data/vocabulary.json`) used only to name generated presets and read leans; no text input.

### 9. Mod wheel and expression
*(Macros were dropped: all controls stay on one page.)* The mod wheel plays one **connected move** per preset: Pressure (louder, brighter, grittier, a little breath), Snarl (distortion, resonance, bite), Open (filter and top open), Choke (darker, tighter, drier, narrower), Vibrato, Unstable (wobble, detune, sag), Decay (wear, crush, grain), Bloom (reverb, delay, width, chorus). Wheel at 0 = the preset exactly as designed. The preset's own move (by category) is the default; a dropdown switches it. A sample of presets is checked with every move fully up for quality and safety (the moves are shared recipes, so a sample catches what a full sweep would). Aftertouch is not used (rare on keyboards and easily triggered by accident); MPE comes with the plugin.

### 10. History — `src/history`
A tree of patch snapshots. Every preset load, generation, tree step and edit creates a node; jump, branch, A/B, morph (interpolate continuous params; switch enums/ints at the midpoint).

---

