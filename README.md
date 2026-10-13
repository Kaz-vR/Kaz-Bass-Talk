# Low Talk

A bass synth you talk to. See [CLAUDE.md](CLAUDE.md) for the full design and
the non-negotiables (no AI at runtime, fully offline, real-time safe, the low
end is protected).

**Status: Phase 1 (engine + schema) — Phase A browser prototype.**

## Run it

```sh
npm install
npm run dev        # open the printed URL, click "Click to start audio"
```

- Play with the computer keyboard (`A`–`;` white keys, `W E T Y U O P` black,
  `Z`/`X` octave), a MIDI keyboard (Web MIDI), or the audition loops (`Space`).
- Every parameter in `data/schema.json` is editable; edited controls turn
  orange. "Copy patch JSON" copies the current patch for `data/library/`.

## Check it

```sh
npm test                  # schema, library, engine, safety fuzzing, performance, architecture rules
npm run typecheck
npm run validate:data     # dev tool: every patch/loop valid
npm run render:previews   # dev tool: WAVs of every library patch → renders/
npm run level:patches     # dev tool: loudness-match the library
```

## Layout

```
data/schema.json      94 parameters: the single source of truth
data/library/         hand-made patches (complete, loudness-matched)
data/loops/           audition loops (JSON note lists, beats)
src/schema/           validation/clamping, knob curves, flattening for the engine
src/engine/core/      pure-TS DSP: runs in the AudioWorklet, Node tests and offline renders
src/engine/worklet.ts AudioWorklet shell (no allocation in process())
src/engine/host.ts    main-thread side: validates patches, compiles loops
src/ui/               Phase 1 dev UI (the conversational UI is Phase 6)
tools/                DEV ONLY, never shipped or imported by src/
tests/                vitest suites
```

## Signal path

```
osc1 (+FM) ─┐
osc2 ───────┼─ drive ─ filter (4-pole ladder / band-pass / formant) ─ distortion ─ amp ─┐
noise ──────┘                                                                            │
sub (sine/tri, −1/−2 oct, mono, phase-stable, bypasses filter & distortion) ─────────────┤
                                                                                         ▼
      chorus → phaser → reverb (only above fx.lowcut)  →  EQ  →  12 Hz subsonic/DC filter
      →  mono below crossover (side high-pass, 48 dB/oct)  →  output gain  →  look-ahead limiter (−1 dBFS, always on)
```
