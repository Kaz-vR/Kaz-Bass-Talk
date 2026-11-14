# RUIN-1 trailer spec

The fixed spec for the RUIN-1 trailer (about one minute, 16:9). It is built in three layers:

1. **The base: `RULES.md`**, the measured rulebook of four Artistry Audio trailers. Everything in it applies
   unless this file removes or replaces it.
2. **Minus** what the owner decided against (section 2).
3. **Plus** what makes it RUIN-1's own (section 3).

When this file and `RULES.md` disagree, this file wins. `RULES.md` itself is never edited to fit RUIN-1: it stays a
record of what the references do.

Built with `tools/trailer/shots.js` (rendered by `tools/trailer-render.mjs`, the synth captured by
`tools/trailer-capture.mjs`). The current look is the shot option string in section 4.

---

## 1. Kept from `RULES.md`

- **Arc** (section 1): cold open on the logo, intro, drop on a riser and impact, fast UI montage, short break,
  biggest section, product logo close.
- **Shot lengths and cutting** (sections 2 and 3): shots in whole beats (1–2 beats in fast parts, 4–8 in the intro),
  cuts on the beat or 0–2 frames early, on strong transients; 2–4 UI shots between text cards; cards about a third of
  the runtime.
- **Camera** (section 4): every UI shot moves; slow, constant-speed slides and push-ins; no roll; the UI at a steep
  angle (lines tilted 10–38°); real depth (parallax).
- **Depth of field** (section 5): a thin sharp band through the middle of the frame, on one control or value.
- **Text cards** (section 7): 1–4 words per line, all caps, centred, cap height about 5.5 % of the frame, one accent
  word, typed in about one letter every two frames, always over a moving plate.
- **Transitions** (section 8): hard cuts in the main part, fades through black between parts.
- **Music shape** (section 10): minor key, dark mix with heavy low end, riser before the drop, a short silence mid-trailer, a
  hit on the logo; about −10 to −14 LUFS. The owner makes the track on RUIN-1.

## 2. Removed (the owner's call)

| From `RULES.md` | Why / instead |
|---|---|
| **Focus pulls inside a shot** (section 5: about 1 in 4 shots) | The focus stays fixed for the whole shot |
| **The evenly self-lit screen** (the UI glowing uniformly from within) | The synth is lit as an object (section 3) |
| **The coloured haze behind the UI** (the product colour as a glow in the dark) | Removed; black and only light that has a source |
| **Bloom halos, red halation, colour fringes at the frame edges** (section 6) | Removed |
| **The references' grade**: cool violet shadows, warm highlights, lifted blacks (section 6) | Replaced by the owner's grade (section 3) |
| **The stepped, doubled blur** (a property of our first renderer, not of the references) | A smooth depth of field |
| **Geometric-sans type close to Montserrat** (section 7) | Manrope, the website's type |
| **Their colours** (violet, teal, purple) | The house colours only |

Not used for now (tried and set aside): the dark "falls into black" vignette, ash and dust, burnt-film damage,
blown-out highlights and the cut flare. The layers exist as shot options (`dark`, `ash`, `film`, `burn`, `flare`) if
the owner wants them back.

## 3. Added (RUIN-1's own)

- **The house colours:** orange `#F25D07`, red-orange `#F23005`, red `#F20000`, the only warm colours in the trailer.
- **The synth as a lit object:** one soft-edged light pool falls across the panel, the rest falls into shadow, with a
  faint sheen on the glossy face; the UI's own glowing parts (waveforms, arcs, values) keep their light.
- **The owner's grade:** lift, gain and gamma per channel plus saturation, fitted to the owner's Photoshop of the
  slide shot (`tools/trailer/grade-owner.json`), then a wash of `#F25D07` (22 %) that keeps luminance and leaves black
  black.
- **Sparks:** real 3D particles drifting up through the shot like floating embers (half the speed of thrown sparks,
  a gentle sideways sway), short streaks from motion blur, in front of the synth. **Colour follows temperature**, in
  the house colours only (never blends, never darker shades): each spark is born at a random heat (hotter ones fly a
  little faster and are brighter) and cools over its life, `#F25D07` hot, then `#F23005`, then `#F20000`, then fades
  out by transparency. The glow round a spark is one step cooler than its core. **Focus like the synth:** sharp
  streaks in the focus band, soft discs of the same colour elsewhere (same thin-lens rule). Drawn after the grade so
  the colours stay exact (`#F25D07` measures `#F35E08`).
- **Smoke (rendered by us):** a GPU smoke simulation (`tools/trailer/fluid.js`) shown as a stack of seven thin layers
  parallel to the synth's face (two behind it, hidden by the synth and showing past its edges; five above it, the
  highest at 108 units for the slide shot's distance), so it follows the synth's angle, has depth and parallax.
  - **Lit by the scene:** the smoke takes its brightness and colour from the light around it (the UI's glow, the
    sparks), nearly vanishes in the dark, dims what is behind it a little; a faint own colour leaning to `#F25D07`.
  - **Ambient:** measured at about 2 % of the frame width a second (its clock runs at 0.08 during the shot, after a
    full-speed warm-up so it already hangs in the air when the shot opens). Two independent simulations (above, and
    low/behind) and each layer drifting at its own speed, so parts move differently.
  - **Reacts to the synth:** for the smoke behind it, the panel is a solid wall (it spills round the edges).
  - **Focus like the synth:** every spot blurred by its own distance.
  - **Sized per shot:** set on the shot's first frame from its camera: centred where it looks, 900 x 620 units and
    layers up to 108 high, scaled by its focus distance against the slide shot's 418.
  - The owner may still add real smoke footage in the edit, on top of or instead of this.
- **A smooth depth of field** (112 samples, a different pattern per pixel, then smoothed).
- **Text cards:** Manrope, warm white `#F3EEE8` with the accent word in a house colour, backgrounds in the website's
  fire style (plates A–E made; the owner's pick still open).

## 4. The current look, as shot options

```
<shot>@ruin:fire=0.5,real=1,og=1,sparks=0.65,fine=1,tint=0.22,fluid=1
```

| Option | What it does |
|---|---|
| `fire=0.5` | the subtle warm cast and firelight spill in the house colours |
| `real=1` | lit object; no haze, bloom, halation or fringes |
| `og=1` | the owner's fitted grade |
| `sparks=0.65,fine=1` | sparks at 65 % density: temperature-coloured streaks with a glow, focus like the synth |
| `tint=0.22` | the `#F25D07` wash |
| `fluid=1` | the simulated smoke |
| (no `pull`) | fixed focus; `pull=1` would bring the knob shot's focus pull back |

Tools for checking (not for the final look): `fluid=2` shows the raw smoke (red), `still=1` freezes the camera (to
measure the smoke's own motion), `lightr=100000` lights the panel evenly (to see the light pool).
Export: GIF for review, MP4 for the edit; on request a sparks-only layer on transparent for compositing.

## 5. Checklist (on top of `RULES.md` section 11)

- [ ] No focus change inside any shot
- [ ] No coloured haze, bloom, halation or edge fringes
- [ ] Warm colours only `#F25D07`, `#F23005`, `#F20000`; sparks measure `#F25D07` (±3 per channel)
- [ ] Black stays black (the darkest 1 % at most 8/255)
- [ ] Cards in Manrope, accent word in a house colour
- [ ] Every shot rendered from the current synth (recapture after colour changes)
- [ ] No black holes or crackle in the smoke (look at a full-resolution frame before any long render)
- [ ] Smoke ambient: about 1–3 % of the frame width a second; sparks drift, never shoot

## 6. Making a shot (the recipe)

When the owner asks for a shot ("a shot of the LFO page", "the filter knob turning", "something on the RUIN page"),
make it like this without further questions. All tools are dev-only (`tools/`).

**1. Capture the synth** (whenever its look changed, or for another page or knob):

```bash
node tools/trailer-capture.mjs renders/trailer/capture <sound> <TAB> "<knob label>" 100
```

It builds the synth, opens the sound on that page, holds a note so displays move, and writes the whole instrument at
4x (`base.png`) plus the turning knob's whole box, one picture per frame (`knob/`). Default: `Cavern`, `OSC`,
`Cutoff`. One page per capture: a shot of another page needs its own capture (keep separate output folders if
shots of different pages are rendered together, and point `CAP` in `shots.js` at the right one). Check the
capture's colours are the current ones (`src/ui/style.css`, `--c-red` etc.).

**2. Write the shot** in `SHOTS` in `tools/trailer/shots.js`, like the three there (`slide`, `knob`, `env`):
- **What:** one control, value or display is the subject (`target`, in the instrument's css px through `P(x, y)`;
  find the spot in `base.png`).
- **Move:** a slow slide or push, constant speed, over the whole shot: the target moves 40–90 css px (slide) or the
  camera comes 10–15 % closer (push); no roll changes during the shot.
- **Angle:** the camera offset from the target is low and to one side, about 150–260 units sideways and below and
  105–250 above (`pos = target + (x, y, z)`); a fixed tilt of 4–12°. Closer = more macro.
- **Lens:** `fov` 24–26; aperture 105 (`draw(i, focusDist, 105)`); focus fixed on the target
  (`pos.distanceTo(target)`).
- **Light:** `LIT.lightAt` a little above and to one side of the target (the pool falls on the subject).
- **Length:** whole beats of the track when it exists; until then 75–100 frames (3–4 s).
- **A turning knob:** set `knobLayer.visible = true` and load its frames (see `knob`); it needs that knob captured.
- The smoke places itself from the camera; nothing to set.

**3. Check before rendering it whole** (stills, about 2 minutes):

```bash
PICK=0,40,79 node tools/trailer-render.mjs renders/trailer/check "<shot>@ruin:fire=0.5,real=1,og=1,sparks=0.65,fine=1,tint=0.22,fluid=1" 1920
PICK=0,40,79 node tools/trailer-render.mjs renders/trailer/check "<shot>@ruin:real=1,fluid=2" 1920
```

At the **final resolution** (problems in the smoke can be invisible at small sizes): framing (the subject sharp,
the rest falling off), sparks in all three colours, the raw smoke smooth with structure (no holes, streaks or empty
frame), colours per the checklist. Fix and re-check before going on.

**4. Render:** `node tools/trailer-render.mjs <out> "<shot>@<the look>" 1920` (about 4–5 s a frame), then the MP4:
`ffmpeg -framerate 25 -i <frames>/%04d.png -c:v libx264 -preset slow -crf 14 -pix_fmt yuv420p <name>.mp4`; several
shots back to back with ffmpeg's concat. For a review GIF render at 960 and scale to 720.

**5. Deliver** the GIF or MP4 and say in a line what the shot is. Commit the shot (not the renders: `renders/` is
not in git).

**Known issue (open):** the 1920 render of the knob and envelope shots showed dark crackled holes in the smoke
(invalid values in the simulation, spread by the smoke blur). Guards against it are committed but **not yet
verified**: check step 3 shows clean smoke before rendering those shots again.
