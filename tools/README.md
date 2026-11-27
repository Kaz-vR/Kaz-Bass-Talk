# tools/ — DEV ONLY

Nothing in this folder is shipped, and runtime code under `src/` must never
import from it (a test enforces this). These scripts generate, check and
render data for human review.

| Script | What it does |
| --- | --- |
| `python3 -I tools/extract-acid.py` | Takes the Acid wave's 40 frames from the owner's Serum render (`tools/waves/acid.wav`) into `src/engine/core/acid-table.ts` and `plugin/engine/generated/AcidTable.h`. |
| `npm run validate:data` | Validates every library patch and loop against the schema. |
| `npm run level:patches` | Renders each library patch on the default loop and sets `output.gain` so they all sit at the same loudness. |
| `npm run render:previews` | Renders every library patch to WAV in `renders/` (gitignored) for listening, and prints a level/brightness table. |
| `python3 tools/trailer-analyze.py <name> <video> <out> [shots.json]` | Measures a reference trailer (cuts, camera, focus, grade, text cards, music) for `references/trailers/RULES.md`. Needs `pip install opencv-python-headless librosa numpy`. |
| `node tools/trailer-capture.mjs [out] [sound] [tab] [knob] [frames]` | Captures the synth for trailer shots: the instrument at 4x and one knob's box turning, one picture per frame (into `renders/`). |
| `node tools/trailer-render.mjs [out] [shots] [width]` | Renders the 3D trailer test shots (`tools/trailer/shots.js`: slab, depth of field, glow, grade) frame by frame, then MP4 + GIF. |
