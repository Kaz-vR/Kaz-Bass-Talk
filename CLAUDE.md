# CLAUDE.md — Low Talk

Low Talk is a dark, cinematic synth in the style of LORN: saturated, tape-worn, wide above a clean low end, sitting in a dark space, and always **alive** (many small, independent, non-repeating motions). It ships with a **preset bank** of hand-designed sounds across 7 categories (6 shelves in the browser: Pluck and Arp / Sequence share one), every one of them finished, complex and unmistakably in that style, and together covering every role a sound can play in a track. There is no typing.

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
5. **No DC.** Regardless of any patch there's no DC offset. *(Owner's call: the forced mono low end and the output limiter were removed completely, as in Serum, Vital and BA-1: the preset and the producer decide; the sub stays mono on its own.)*
6. **AI is a development tool only.** Claude may be used during development to generate and expand data (presets, mod wheel moves, descriptions, quality rules). Anything under `tools/` is dev-only and must never be shipped or imported by runtime code.

---

## How it works (overview)

```
  BROWSE                  DIAL IN                       CREATE (extra)
  Preset bank        ──▶  All controls on one     ◀──  Generator: recombine recipes from
  7 categories            page + mod wheel (8           the bank, re-roll movement, nudge in
  up to 35 each           connected moves)              safe regions, reject near-duplicates
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

**The owner is the reference for what LORN is**: Claude's knowledge of LORN is partial (it knows the early, dark-cinematic work best); his later work also uses neuro bass (e.g. "Yesterday's Pain"), which is what RUIN is for. When this file and the owner's ear disagree, the owner wins.

What makes the bank sound like one instrument. Each category has its own version of each point.

1. **Layers:** a body + a character layer + texture, never a lone oscillator.
2. **Dirt that shapes tone:** saturation and tape wear; dirt mostly *in front of* the filter so its movement stays audible (heavy saturation after a moving filter masks the movement).
3. **Alive:** several independent, non-repeating motions on different time scales (smooth random LFOs at unrelated rates, drift, a slow bloom, per-note variation, LFO fade-in), mostly before the distortion so the tone changes, not just the level.
4. **Dark and worn:** a controlled top, tape age, some grain; texture beds (crackle, dust, rumble, air) where they belong.
5. **Space:** dark reverb and smeared delay the sound lives in, kept off the low end.
6. **Glue:** tape and saturation hold the sound together. There is no compressor, OTT or pump in the synth (owner's call: dynamics are a mix decision, made outside the synth), except GRIND's own OTT knob, part of the neuro chain.

---

## The producer range (every category)

A producer opens a category looking for a part for a specific moment, so every category covers the roles a sound plays in a track (bed, support, hook, rhythm, accent, texture, as far as they fit the category) and varies on what the mix can't change later:

- **softness:** attack (swell, felt, pluck, snap) and grit, from soft to harsh, roughly a third soft, a third in between, a third hard;
- **length** (short to ringing), **thickness** (thin to thick), **pitch stability** (steady to wobbly), **movement** (nearly still to moving), **touch** (playing harder is louder and brighter on playable categories), **tone colour** (pure, round, rich, vocal, metallic, breathy, not saw everywhere) and **mood** (tender to menacing).

LORN is the treatment (dark top, wear, slow life, dark space), not grit on everything: soft sounds get their wear from tape, dust and air; drive and distortion belong to the hard end. Width, reverb amount and EQ are mix decisions, not bank coverage. Every shelf holds at most 35 presets (Dark Basses 50 until the rebuild: **Classic Reese**, the textbook Reese the synth opens on, right after it **Destroyed Reese**, the owner's own patch of it through GRIND, then five conversions of Howard Scarr's Diva basses (HS Bass Nine, HS Black Fuzz, HS Bonebreaker, HS Boomer, HS Cable Bass; `tools/build-diva.py`, translated from the owner's .h2p files, not rendered or checked), then the owner's eight industrial basses from the owner's own specs (Cyberpunk Industrial Reese … Modular Feedback / Complex Shaper), approximated where the synth lacks a module, joined a full shelf, owner's call; Pads 60: Strings and Brass were merged into it, owner's call, until the rebuild; Lead 36: **Chainsaw Lead** (hard sync, no FM: the owner tried an FM version against it and dropped FM) opens the Lead shelf): near-duplicates go first; the original LORN presets, the staples (sounds iconic because they're everywhere) and any preset carrying a colour nothing else on its shelf has are kept. *(Midnight Upright is no longer protected, owner's call: it is changed like any other preset when needed.)*

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

The sub is a pure sine, mono, never through drive, filter, distortion, tape or effects (sub Direct Out on, S off: the defaults every dark bass keeps), and its pitch stays steady: the owner asked for no wow, flutter, vibrato or detune on it. Since the owner's call to drop the engine's protection (as in Serum, the preset chooses): the matrix's **Pitch** moves the whole note, sub included (used for a drop LFO → Pitch, the 808 drop), while **Osc A+B pitch**, vibrato and drift move only the two oscillators, so every dark bass sends its pitch wobble to Osc A+B pitch, and **Sub pitch** (`sub_pitch`, ±2 octaves at full amount) moves the sub alone (a drop or scoop on the sub while the oscillators stay; the steady-sub rule above still holds for the bank's dark basses). Oscillators 1 and 2 carry the tape wobble and are high-passed before the drive (120-150 Hz; D: osc 1 at 60 Hz, osc 2 at 200 Hz). Stereo only above 250 Hz (effects low cut at 250 Hz). A new dark bass picks one template; no other octave relationships. The template shows as a label next to the preset name in the browser (where the Iconic label sits). Tone source is a separate tag (e.g. `metallic-fm` for FM / wavefolded basses).

## Where the details live (read only what the task touches)

- `docs/engine.md`: the synth engine in full (oscillators, sub, noise types, RUIN / GRIND chain and its drives and filters, mixer drive, oct down, filters, DRIVE, analog modelling, envelopes, LFOs and their shapes, matrix, FX chain and reverb).
- `docs/systems.md`: patch schema, categories, preset bank and the rebuild rulebook notes, sound-design rules, analysis / critic / style checks, generator, Randomizer, Sound Tree, mod wheel, history.
- `docs/ui.md`: the whole UI (look, every tab's layout, RUIN page, OSC / LFO / FX / PRESETS pages, keyboard, All controls).
- `docs/project.md`: website, tech stack, repository layout, build phases (incl. the plugin port status and parity check), deletion list, testing rules.

When a change alters what one of these files says, update that file (not CLAUDE.md). Engine changes still go into both engines with the parity check (`docs/project.md`, phase 12).

## Working style for Claude Code

- Small, reviewable commits with clear messages, one concern each.
- **Links (owner's rule):** whenever a link to the prototype or the website is given, give both, on two lines: `RUIN-1: Prototype` (https://claude.ai/artifact/HecEYBtXViDmQL45fgpiEU) and under it `RUIN-1: Website` (https://claude.ai/artifact/KdQBdiKJ33WqbVgVQ4QUXR).
- Think like a world-class sound designer working in LORN's style: every preset is a finished, release-quality sound. Encode what makes a sound good, and what makes it fit the bank, as rules and checks rather than relying on the human to catch problems.
- Work autonomously: solve problems the way established synths do, and don't stop to ask the human questions or to listen. Passing tests are necessary but not proof of quality.
- Never add a dependency that pulls in an ML runtime, model weights, or network access.
- **Never re-check the whole bank after a change** (the owner's rule). Re-check only the presets a change is about (e.g. the ones you just built or edited), a few others when needed, nothing more. Stale check stamps on untouched presets are acceptable until the owner asks for a full check.
- If the same problem fails 3 times, step back and rethink the approach (root cause, not symptoms) instead of retrying the same fix; note what happened in the commit message.
