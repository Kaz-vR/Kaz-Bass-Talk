# CLAUDE.md — Low Talk

Low Talk is a dark, cinematic synth in the style of LORN: saturated, tape-worn, wide above a clean low end, sitting in a dark space, and always **alive** (many small, independent, non-repeating motions). It ships with a **preset bank** of hand-designed sounds across 14 categories (13 shelves in the browser: Pluck and Arp / Sequence share one), every one of them finished, complex and unmistakably in that style, and together covering every role a sound can play in a track. There is no typing.

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
  up to 35 each           connected moves) + wobble     safe regions, reject near-duplicates
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
6. **Glue:** tape and saturation hold the sound together. There is no compressor, OTT or pump in the synth (owner's call: dynamics are a mix decision, made outside the synth).

---

## The producer range (every category)

A producer opens a category looking for a part for a specific moment, so every category covers the roles a sound plays in a track (bed, support, hook, rhythm, accent, texture, as far as they fit the category) and varies on what the mix can't change later:

- **softness:** attack (swell, felt, pluck, snap) and grit, from soft to harsh, roughly a third soft, a third in between, a third hard;
- **length** (short to ringing), **thickness** (thin to thick), **pitch stability** (steady to wobbly), **movement** (nearly still to moving), **touch** (playing harder is louder and brighter on playable categories), **tone colour** (pure, round, rich, vocal, metallic, breathy, not saw everywhere) and **mood** (tender to menacing).

LORN is the treatment (dark top, wear, slow life, dark space), not grit on everything: soft sounds get their wear from tape, dust and air; drive and distortion belong to the hard end. Width, reverb amount and EQ are mix decisions, not bank coverage. Every shelf holds at most 35 presets: near-duplicates go first; the original LORN presets, the staples (sounds iconic because they're everywhere) and any preset carrying a colour nothing else on its shelf has are kept. *(Midnight Upright is no longer protected, owner's call: it is changed like any other preset when needed.)*

## Dark bass architecture (every dark bass)

To keep the low end free of phase clashes and mud, every dark bass uses exactly one **octave template** for oscillator 1, oscillator 2 and the sub (`tools/bank/bass-templates.ts`, applied by both bass builders, tagged on each preset, enforced by `tests/bass-architecture.test.ts`):

| Template | Sub | Osc 1 | Osc 2 |
|---|---|---|---|
| A Heavy Reese | -1 oct | root | root, slightly detuned (beating) |
| B Cinematic Screamer | -1 oct | root | +12, 3-6 dB under osc 1 |
| C Ominous Fifth | -1 oct | root | +7, dark filter, tape saturation |
| D Deep Rumble | -2 oct | -12 | root, high-passed at 200 Hz |
| E 808 / Thump | -1 oct, carries the note and its pitch drop | root, grit only | off |
| F Single Body | -1 oct | root | off |
| G Tritone Bass | -1 oct | root | +6 |

The sub is a pure sine, mono, never through drive, filter, distortion, tape or effects (sub Direct Out on, S off: the defaults every dark bass keeps), and its pitch follows only the played note (glide, bend, pitch envelope), never vibrato, drift or the mod matrix (an engine rule, every patch). Oscillators 1 and 2 carry the tape wobble and are high-passed before the drive (120-150 Hz; D: osc 1 at 60 Hz, osc 2 at 200 Hz). Stereo only above 250 Hz (mono crossover and effects low cut at 250 Hz). A new dark bass picks one template; no other octave relationships. The template shows as a label next to the preset name in the browser (where the Iconic label sits). Tone source is a separate tag (e.g. `metallic-fm` for FM / wavefolded basses).

## Components

### 1. Synth engine
Up to 8 voices (`voice.polyphony`: 1 = monophonic with legato/glide, the bass default; 2-8 = polyphonic with voice stealing). Per voice:

- 2 main oscillators (sine, triangle, saw, pulse, wavetable with position, PWM-saw, physical-model string, Shepard), each with detune, unison (1–7 voices), spread, level; multi-operator FM (2 operators, punch envelope, feedback, stack/parallel)
- Sub oscillator (sine/triangle, −1 or −2 octaves), always mono; noise. *(The click / attack transient layer was removed, owner's call. Breath is a Noise type: texture.type = breath plays per-note breath instead of a bed; N routes it through the filter.)*
- Pre-filter drive → filter (4-pole low-pass, band-pass, formant, 303 diode with accent, notch, comb, low-pass gate) → distortion (soft, hard, fold, tube; optional mids-only split), 2× oversampled with ADAA waveshapers → bitcrusher → tape → amp → **mid clip** (transparent soft clipper on osc 1 + 2, 0–12 dB drive, 0 = off)
- **Filter slots per source:** each oscillator has its own filter before the main filter (high/low 24 or 12 dB, band, keytrack; high 24 at 20 Hz = off, the default); the sub and the texture bed have one too (off by default). **Routing into the main filter:** A and B (on by default; off = that oscillator skips the drive and main filter), N (the texture bed through a copy of the main filter following the newest note) and S (the sub through the main filter and the rest of the voice). Main filter **Mix** (dry/filtered; only under "All controls"). *(Fat was removed, owner's call.)*
- **Sub:** sine, triangle or square (polyBLEP); **Direct Out** on (default) = its own clean path, off = through the effects.
- **Sub clip:** the sub's own transparent soft clipper (0–12 dB, 0 = off) on its clean path. Both clippers leave everything under the knee at its level (denser, not louder: the level matching is built in)
- Amp, mod and pitch envelopes, a slow bloom envelope (env 2); per-note random, analog drift, free unison phases
- Instrument additions (phase 5): delayed vibrato, breath/noise attack, richer formant vowels, inharmonic bell partials with separate decays, long riser/fall envelopes

Shared by all voices: 4 LFOs (tempo-sync, shapes incl. smooth random "wander", retrigger, fade-in), two drift sources, the 12-slot mod matrix (per-voice sources are evaluated per voice; FX targets follow the newest voice), the **mod wheel moves** (8 connected recipes, `WHEEL_MOVES` in `src/engine/core/params.ts`; each preset names its own in `wheel.preset`, by category in `data/categories.json`), the **wobble** (its own bar-locked clock: rate, depth, target filter / filter + drive / filter + drive + texture, shape, life = per-cycle variation; before the distortion; never uses LFOs or mod slots), the texture bed (crackle, dust, rumble, air; follows the notes with its own tail, silent between notes), and the FX in a **fixed order**: chorus → flanger → phaser → delay → reverb (each only above its own low cut, `<fx>.lowcut`) → EQ + high cut → **+ the clean sub** (its own path: it skips effects and EQ; only the Sub box shapes it) → subsonic/DC filter → mono below crossover → output limiter (ceiling -1 dB, true-peak: inter-sample peaks are detected by 4× interpolation) → mono below crossover again.

Quality: band-limited oscillators, oversampled anti-aliased nonlinear stages. Expensive-sounding, never "chiptune" unless deliberate. Every parameter is defined in the patch schema (~180 today).

### 2. Patch schema — `data/schema.json`
The single source of truth shared by the engine, analysis, generator, tree and UI. Each parameter has id, label, type (`float`, `int`, `enum`, `bool`), range/options, default, curve, unit, group and a plain `describes`. A patch is a flat JSON object `{ "<param id>": value, ... }` plus `meta`. Any patch loaded from anywhere is validated and clamped against the schema.

### 3. Categories — `data/categories.json`
The 14 categories of the bank: **Bass, Lead, Pad, Keys, Pluck, Arp / Sequence, Strings, Brass / Horns, Choir / Vocal, Bells / Mallets, Hits / Impacts, Risers & Falls, Drone / FX, Texture.** Each entry has the category's identity, its version of the LORN recipe, its default polyphony and audition loop, its critic limits and its style-fingerprint zone. Chords and Drums are not in the bank (Drums may become its own mode later).

The bass **directory** (`data/directory.json`, 51 bass types across genres and history) stays as the coverage map for the **Bass Atlas**, a secondary collection of one patch per bass type.

### 4. Preset bank — `data/library/*.json`
Hand-designed presets, at most 35 per shelf (Pluck and Arp count together; the 13 Terror basses count toward Bass), each with `name`, `description` (one sentence), `tags`, `category`, `family`, `collection`, `features` (precomputed). Built by dev tools under `tools/` (e.g. `build-terror.ts`, `build-bank.ts`). Quality bar: finished, release-quality, as good as the best factory presets of Diva / Serum / Phase Plant, and in the LORN style. Every preset passes every check below.

The Bass Atlas patches (`tools/build-library.ts`) are not held to the style checks.

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
A **🎲 Randomizer** tab after the categories: a Roll button, a **Weirdness** amount and **Based on** (a category or anything). A roll starts from a preset, swaps whole boxes in from other presets (same category when tame, any category as it gets weird: collisions), nudges values inside the range good presets use, and spends a weirdness budget on a few wild ideas (inharmonic FM, comb, fold, pitch drops, a wobble, shepard layer, odd routings…). A quick silent render rejects silence, clipping, harshness and mud; at higher weirdness the candidate farthest from every bank preset wins. Rolls are levelled, named, and get a hint of where they might fit. **🔒 on every box** keeps it while the rest rolls. Rolls appear as cards (click to go back to one, ✕ to throw one away, "Clear all rolls" to start fresh); ☆ stars a roll into the **★ User** tab (stored locally), where it stays even after clearing. The locks only show while the Randomizer tab is open. Rolls are held to quality and safety, not the LORN style zone (weird is allowed, broken isn't).

### 8. Sound Tree — `src/tree`
Exploration around a sound: rounds of 4 (3 near the current lean + 1 wildcard), picks are leans, options generated by the same machinery as the generator, "none of these", "between these two" blends, breadcrumb, instant audition, critic and style checks on every option. Small descriptor vocabulary (`data/vocabulary.json`) used only to name generated presets and read leans; no text input.

### 9. Mod wheel and expression
*(Macros were dropped: all controls stay on one page.)* The mod wheel plays one **connected move** per preset: Pressure (louder, brighter, grittier, a little breath), Snarl (distortion, resonance, bite), Open (filter and top open), Choke (darker, tighter, drier, narrower), Vibrato, Unstable (wobble, detune, sag), Decay (wear, crush, grain), Bloom (reverb, delay, width, chorus). Wheel at 0 = the preset exactly as designed. The preset's own move (by category) is the default; a dropdown switches it. A sample of presets is checked with every move fully up for quality and safety (the moves are shared recipes, so a sample catches what a full sweep would). Aftertouch is not used (rare on keyboards and easily triggered by accident); MPE comes with the plugin.

### 10. History — `src/history`
A tree of patch snapshots. Every preset load, generation, tree step and edit creates a node; jump, branch, A/B, morph (interpolate continuous params; switch enums/ints at the midpoint).

---

## UI

No text input, except typing a value into an envelope dial (double-click: owner's call). **Signal (the current look, the owner's pick with the owner's own edits):** one rule for the whole page: dark material, light only where something emits it, quiet type. One font everywhere (Space Grotesk, bundled in `src/ui/fonts`, OFL); the title glows white; the header is a plain black bar with only the title, ‹ preset name › and the tabs (no picture, no caption under the name); one film layer (grain + scanlines, multiply, so it only shows in the light) over the whole page; active tabs, MONO / POLY and glide are lit, not filled; the keys sit further back: smooth (no grain), with one smooth shadow over the whole keyboard cast from the panel above (dark at the back, lit at the front), so the boxes seem to stand out towards the viewer; a played key lights up; no red outside the boxes; the **oscilloscope** (white phosphor with persistence) fills the box where the wobble was, the box's own dark edge showing around it. The wobble is **LFO 5** on its own **LFO** tab (OSC / MOD / LFO / FX / PRESETS, owner's call): one cycle you can draw over the six left boxes, as in ShaperBox (points on a 16 × 8 grid: drag a point, Shift snaps it to the grid, click it for a soft or hard corner, double-click a point to remove it or empty space to add one, up to 12 points, the first and last fixed at the cycle's ends; editing makes the shape **custom**: `wobble.shape = custom` with `wobble.points` and `wobble.x/y/s1..12`, played by `wobShapeAt` in `src/engine/core/wobshape.ts`, shared by engine and page; between points a cubic Hermite: hard corners keep the straight line's slope, soft ones flatten it), a dot following the engine's real phase while a note sounds (a third channel on the worklet's control output; on/off before its title), under it a half-box-high **shape palette** three boxes wide (as in ShaperBox: one tile per shape, the chosen one lit, empty tiles kept for shapes still to come), and on the right SHAPE (shape, rate, one cycle up close, Depth, Life) above TARGET (filter → drive → texture lit as far as it reaches, three lamps to pick). Every dropdown opens the page's own menu (`src/ui/dropdown.ts` takes over every `<select>`; the preset menu is styled the same): a dark grainy panel, quiet uppercase ink that lights up under the pointer, the current choice lit with a dot in its box's colour, long lists in three columns. It builds on the worn look below. **Worn look (the owner's own mockup, on top of Gallery):** near-black worn panels (mottling, grain, dust specks, scratches, an uneven lit rim), every print's light photographed rather than vector (a white-hot core, a tight saturated glow, a tiny tremor, stray specks, and grain plus faint scanlines laid over it with multiply so they only show in the light), grimy off-white keys and glossy black keys, no red outside the boxes (grey wheels, Touch and move name; the "low end mono · limiter on" lamp was removed, owner's call), and a black-and-white header picture treated as a decaying signal (torn rows, smear streaks at the sides, scanlines, a bottom that dissolves). All textures are procedural (`src/ui/texture.ts`); the header picture itself will be the owner's photo. **Look before that (owner's pick, "Gallery", after reviewing many variants; Void + colour was tried and rejected):** flat graphite panels (#0f0f11) with hairline edges, 6 px apart, barely any dust (`dustTexture()`), minimal flat dials (`--knob-style: flat`; other dial looks remain in `drawKnobVariant`), each box's own neon colour, and one type system (Inter: titles 11 px wide-spaced, uppercase 9 px dial labels, small caps elsewhere). Earlier: black and neon: near-black worn-metal boxes, thin wide-spaced Inter lettering (bundled in `src/ui/fonts`, OFL), glowing lines in each box's own colour (OSC A red, OSC B orange, amp envelope teal, filter and filter envelope blue, sub purple, noise sand, scope phosphor), dark knobs with a lit rim, a value arc and a glowing pointer, a header scene (`src/ui/scene.ts`) behind the logo, a darker keyboard. Everything is drawn in code for now; the owner will send painted assets (header art, panel texture, knob, keys, wheels) that replace the drawn versions piece by piece. **OSC page layout:** two rows of four boxes: OSC A, OSC B, amp envelope, filter; sub, noise, oscilloscope, filter envelope; then the play strip and the keyboard. All eight boxes are 4:3 and one size (297 x 223), with the same three rows at the same heights: the title with its selector and value boxes to its right (wave + OCT/SEM/FIN/UNI; filter type + KEY) as plain text, no boxes (the wave name in white, values as small label + number), the on/off a thin glowing bar in the box colour before the title (owner's pick); the print full width in the middle (Sync / Direct / the filter envelope's amount in its top corner); the dials, one size (46 px), centred with equal spacing (the filter's four input lamps sit before its dials, no label, centred on them, each in its source's colour: A red, B orange, S purple, N sand; Sub and Noise show "Direct out" at the right of their title row; Direct out wins over S / N: switching one on switches the other off, and the engine never sends a direct-out source into the filter) (owner's call). (The darkroom description below is the older look; the layout rules in it still hold where they don't conflict.)

- **Synth page (top; the owner's own layout, in the darkroom look: deep red room with film grain, dark trays, round glowing lamps for every on/off light, every display a small photo print), designed at real size (1200 px wide, zoom 100 / 125 / 150 %, labels 11 px, values 12 px) with one dial size everywhere (40 px, the owner's call: same size, big enough to read):** the wordmark ("The Grimm", the working name since the owner renamed it: a nod to the Brothers Grimm; the code and docs still say Low Talk), the **preset selector** in the top middle (‹ name ▾ ›: the arrows step through the shelf, the name opens a dropdown with the shelves on the left and their presets on the right; the shelf · frame · template caption under it) and the OSC / MOD / FX / PRESETS tabs (MOD = the OSC page's look: on the left half two columns of three boxes (LFO 1–4, then Env 2 and one box shared by the pitch envelope and vibrato: the title's two words switch which one shows, both keep working, a dot before each glows while it is on; each LFO with shape, HZ / SYNC and retrig in its title row, its shape print with where it goes in the corner, Rate or the note value, Fade), the 12-slot matrix filling the right half (a lamp in front of each row switches it on/off without losing its settings (`mod<n>.on`), source → destination, amount dragged sideways, each source in its box colour; rows in reading order, set on every load by `sortModSlots` in `src/schema`: LFO 1–4, Env 2, velocity / wheel / keytrack, drift, slow drift, random, the same source's rows together in signal order of their destinations, empty slots last; the slots are summed, so the order never changes the sound); no "other sources" box (owner's call; drift, random, velocity, keytrack stay as matrix sources), and **Touch** replaces the VEL meter by the keyboard (a slider, with the last note's velocity as a tick); FX = the OSC page's eight 4:3 boxes in signal order, coloured by family (dirt warm, modulation cool, space deep, EQ neutral): distortion, crush, tape, chorus; flanger / phaser (one box, one at a time, switched in its title), delay, reverb, EQ; each with a neon print drawn from its settings and its own Lo cut dial on the modulation and space effects (owner's layout); PRESETS = the browsing page in three columns on the OSC page's grid (297 / 598 / 297 px, the same boxes and plain-text style; each shelf has its own colour, the page takes the open shelf's colour, the character shows as glowing dots between two words: dark/bright, clean/dirty, still/moving, snap/swell, short/long, narrow/wide; owner's pick): the shelves (Classic Basses under a divider) | the shelf's presets with their one-line description and template label, sortable by bank order, name, template, soft → hard, dark → bright, still → moving (click = load it, double-click = open in OSC) | the selected preset up close: its print, name, template, description, tags, character bars from its measured features and OPEN IN OSC); under the shelves, **Randomizer** (Roll, weirdness, based on, clear all, the rolls with ☆ and ✕) and **★ User** (the starred sounds) open in the same middle and right columns. Three columns in signal order: **1 Sources** as channel strips in fixed, aligned columns, top to bottom OSC A, OSC B, Sub, Noise (each: power + name with its dropdown under it | OCT / SEM / FIN boxes | wave print | dials in subtle groups: UNI + detune · shape + spread · lo cut + level; Sync and Direct out sit next to the name); a live **oscilloscope** above the **amp envelope**; **2 Filter** (type, a response print you drag: sideways = cutoff, up/down = resonance; what goes in, top to bottom like the sources: A, B, S, N; cutoff, res, drive, and a KEY lamp: key tracking on/off, on = the preset's amount) with the filter envelope. Drive lifts the response print as in Serum. While a note sounds, the print and a dot on Cutoff's ring follow the engine's real cutoff and resonance (envelope, LFOs, wobble, keytracking), read from a second worklet output by an analyser, so the audio thread never posts messages. The filter envelope's amount is a ring around Cutoff, as in Serum (Alt-drag the dial; Alt-double-click clears it), and shows as "→ CUTOFF +2.4 oct" in the filter envelope's header (drag it too). Distortion (with its transfer curve) and tape (with analog drift) live on the FX tab; the mid clip has no box (only under "All controls"). Every dial that is active visibly changes its box's print (owner's rule): pitch sets the cycles shown, unison draws detuned copies, every low cut is a strip along the bottom of its print, tone rounds the line, key tracking shows as a span under the cutoff, and so on. Dial values are hidden (they show over the name on hover or while dragging). While a note sounds, only the MOD page moves (owner's call: motion everywhere made it harder to read): a dot travels along each LFO, the pitch envelope and vibrato, a ball along Env 2, and each matrix row's amount bar moves with its source (one clock in SynthView.runDots, 30 fps, only the visible page). Elsewhere only the envelope balls and the live filter print move. The bitcrusher lives on the FX tab; the mod wheel's move is picked next to the keyboard. Envelope points are dragged on the prints too. **The keyboard** is attached right under the play bar (part of the page): on the left pitch and mod wheels (the mod wheel is the same as the Mod Wheel box), the octave (‹ › or Z / X), the wheel's move and the last velocity; then three octaves of keys, white #EAE3D7 and black #0C0B09 (flat colours; a played key gets the red safelight gradient). PRESETS lists only the preset names, in two columns top to bottom, so a whole shelf fits at once. A play bar: mono/poly, legato, glide, "low end mono · limiter on", "All controls" and master + meter. The plain white noise and the per-source filter slots stay in the engine and the full view (the page shows the slots as LO CUT knobs). **"All controls"** opens the full parameter view (the old UI) under the page; both edit the same patch and stay in sync. The old UI stays as the reference until the new pages cover everything.
- **No separate header or browser any more (owner's call):** the synth page is the top of the UI. No loop playback in the UI (owner's call: the AUDITION button and spacebar were removed; the audition loops stay for analysis and the Randomizer's checks); no loop selector, no MIDI status, no Iconic labels (the `iconic` tag stays in the data for the coverage checks). The Randomizer's box locks (in "All controls") show while the PRESETS page's Randomizer shelf is open.
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
7. **Preset bank.** Every category covering the producer range (below), at most 35 per shelf, all passing every check. *(Done; widened to the producer range afterwards.)*
8. **UI.** Category browser in the mockup's style, all controls on one page. *(Done; the create area follows its phase.)*
9. **Expression.** Mod wheel moves, wobble, pump rate, texture before/after dynamics. *(Done; the pump, compressor and OTT were removed later, owner's call.)*
10. **Generator + Sound Tree.** Create presets per category; exploration rounds; taste learning.
11. **History + A/B + morphing.**
12. **JUCE plugin port.** Same data, same behavior, host MIDI, every parameter and the mod wheel as automatable host parameters, preset save/load. Also at the port: the wobble locked to the host's transport (essential, or it wobbles off the beat); **MPE** (per-note bend, pressure, slide, drawable in Ableton/Bitwig); **loading your own texture recordings** (seamless loop, random start, kept off the low end, auto-levelled, stored with the preset) plus a few built-in CC0/own recordings. Port the engine once to C++ and compile it to WebAssembly for the browser prototype, so engine changes are made once.
    *(Started: a VST3 for Windows built by GitHub Actions (`.github/workflows/plugin.yml`, validated with pluginval) with the C++ engine in `plugin/engine` (matches the TypeScript engine on every preset: `tools/plugin-parity.ts`), all parameters as host parameters, the bank built in, the wobble on the host's tempo and bar, MPE (per-note bend, pressure, slide), and the web UI as its window (a WebView2 showing the same page as the prototype, served from memory, talking to the C++ engine; the Randomizer, presets page and "All controls" come with it). Not yet: texture recordings, AU, WebAssembly; the plugin engine still has the compressor, OTT, pump and one shared FX low cut until it is synced with the prototype. Until then an engine change goes into both engines and the parity check must pass (`tools/plugin-parity.ts --set=...` exercises features the bank leaves at their defaults). See `plugin/README.md`.)*

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
- **Never re-check the whole bank after a change** (the owner's rule). Re-check only the presets a change is about (e.g. the ones you just built or edited), a few others when needed, nothing more. Stale check stamps on untouched presets are acceptable until the owner asks for a full check.
- If the same problem fails 3 times, step back and rethink the approach (root cause, not symptoms) instead of retrying the same fix; note what happened in the commit message.
