# tools/ — DEV ONLY

Nothing in this folder is shipped, and runtime code under `src/` must never
import from it (a test enforces this). These scripts generate, check and
render data for human review.

| Script | What it does |
| --- | --- |
| `npm run validate:data` | Validates every library patch and loop against the schema. |
| `npm run level:patches` | Renders each library patch on the default loop and sets `output.gain` so they all sit at the same loudness. |
| `npm run render:previews` | Renders every library patch to WAV in `renders/` (gitignored) for listening, and prints a level/brightness table. |
