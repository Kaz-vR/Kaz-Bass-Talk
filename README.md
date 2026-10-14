# Low Talk

A dark, cinematic synth in the style of LORN, with a hand-designed preset
bank. See [CLAUDE.md](CLAUDE.md) for the full design and the non-negotiables
(no AI at runtime, fully offline, real-time safe, the low end is protected).

**Status: Phase A browser prototype — a polyphonic engine (up to 8 voices), analysis + quality critic + style checks, and a preset bank of ~140 presets in 14 categories (bass, lead, pad, keys, pluck, arp, strings, brass, choir, bells, hits, risers & falls, drone/FX, texture), plus the Bass Atlas (51 bass types across genres).**

## Run it

```sh
npm install
npm run dev        # open the printed URL, click "Click to start audio"
```

- Play with the computer keyboard (`A`–`;` white keys, `W E T Y U O P` black,
  `Z`/`X` octave), a MIDI keyboard (Web MIDI), or the audition loops (`Space`).
- Browse the bank by category; each category plays its own audition loop.
- Every parameter in `data/schema.json` is editable; edited controls turn
  orange. "Copy patch JSON" copies the current patch for `data/library/`.

## Check it

```sh
npm test                  # schema, library, engine, safety fuzzing, performance, architecture rules
npm run typecheck
npm run validate:data     # dev tool: every patch/loop valid
npm run render:previews   # dev tool: WAVs of every library patch → renders/
npm run level:patches     # dev tool: loudness-match the library
npm run build:library     # dev tool: regenerate the 51 patches from tools/build-library.ts
npm run build:terror      # dev tool: regenerate the Terror basses (the bank's Bass category)
npm run build:bank        # dev tool: regenerate the bank from tools/bank/<category>.ts
npx tsx tools/analyze-parallel.ts <filter> --level   # dev tool: level, then rules + critic + style checks on all cores; stamps the results
```

## Layout

```
data/schema.json      172 parameters: the single source of truth
data/categories.json  the 14 bank categories: identity, LORN recipe, register, critic limits, fingerprint zone
data/directory.json   53 bass types (coverage map for the Bass Atlas)
data/quality.json     quality-critic limits
data/library/         the bank (<category>-*.json, terror-*.json) and the Bass Atlas (<bass type>.json); complete, loudness-matched, checked
data/loops/           audition loops (JSON note lists, beats)
src/schema/           validation/clamping, knob curves, flattening for the engine
src/engine/core/      pure-TS DSP: runs in the AudioWorklet, Node tests and offline renders
src/engine/worklet.ts AudioWorklet shell (no allocation in process())
src/engine/host.ts    main-thread side: validates patches, compiles loops
src/quality/          rules, critic, style checks (earns its place, fingerprint, consistency)
src/ui/               prototype UI: category browser + full parameter view
tools/                DEV ONLY, never shipped or imported by src/
tests/                vitest suites
```

## Signal path

```
per voice (up to 8):
  osc1 (+FM) + osc2 + noise + breath
  → [2× oversampled: drive → filter → distortion (optionally mids only)]
  → bitcrusher → tape → amp   + transient   + sub (mono, phase-stable; poly: lowest note only)
shared:
  + texture bed (crackle / dust / rumble / air)
  → compressor (tempo pump) → multiband OTT
  → chorus → flanger → phaser → delay → reverb (only above fx.lowcut)
  → EQ → high cut → 15 Hz subsonic/DC filter → mono below crossover
  → output gain → look-ahead limiter (−1 dBFS, always on) → mono below crossover again
```

