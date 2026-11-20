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

**The structure (order of shots and cards) is the owner's plan in `STRUCTURE.md`**, which replaces the arc below
(the trailer opens on the synth, not on a logo).


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
- **Sparks:** real 3D particles living in one fixed volume round the synth (denser near its face, some behind its
  plane past the edges, hidden by the synth), with real speeds and sizes: tuned so the slide shot (418 units away)
  looks as before, so a close shot sees fewer, bigger, faster sparks, as a lens would. A spark reaching the face
  glances off it, slowed, and cools fast; one meeting the body's edge bounces off and dies; sparks close to the
  face light a small warm patch on it. (The website's `bg` shots keep the old view-filling sparks.) They drift up through the shot like floating embers (half the speed of thrown sparks,
  a gentle sideways sway), short streaks from motion blur. **Colour follows temperature**, in
  the house colours only (never blends, never darker shades): each spark is born at a random heat (hotter ones fly a
  little faster and are brighter) and cools over its life, `#F25D07` hot, then `#F23005`, then `#F20000`, then fades
  out by transparency. The glow round a spark is one step cooler than its core. **Focus like the synth:** sharp
  streaks in the focus band, soft discs of the same colour elsewhere (same thin-lens rule). Drawn after the grade so
  the colours stay exact (`#F25D07` measures `#F35E08`). **They read as sparks, not dust** (owner's call): each
  flickers fast as it burns (beads along its streak), its streak runs from a hot head to a cooler tail, a bright
  small core; about 1 in 8 is a real spark thrown fast on a slight arc with a long streak; now and then a hot one
  crackles (splits into 2-3 small ones with a short flare); and all are carried by the smoke's own currents
  (read back from the simulation each frame).
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
  - **Never over the subject** (owner's rule): round the spot in focus the smoke thins to almost nothing, in a soft
    oval a little larger than the sharp area (300 px at 1920), and stays as it was elsewhere. Automatic in every
    trailer shot (not the website's `bg` shots).
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
- [ ] The smoke never covers the subject (the spot in focus stays clear)
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
  find the spot in `base.png`). A display can be the subject as a whole: the amp envelope shot looks up at the
  whole envelope line from straight below so all of it sits in the sharp band (owner's call), with the smoke's clear
  area shaped as a wide band along it (`fin.uniforms.subjR`). The smoke never covers the subject (automatic).
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
shots back to back with ffmpeg's concat. **Review GIFs:** render at 1920 (never smaller: the smoke changes with the
render width) and scale the GIF to 960; 2 s (50 frames, `PICK=0,...,49`) is enough to judge, about 5 min a shot. The
owner reviews **GIFs and PNGs only, never MP4s**.

**5. Deliver** the GIF or MP4 and say in a line what the shot is. Commit the shot (not the renders: `renders/` is
not in git).

**Fixed: the dark cracks in the smoke.** They were not invalid values: the smoke's focus blur sampled a spiral that
left a gap round each pixel, so smoke nearly in focus (a blur smaller than the gap) got no samples and turned black
along the line where the smoke crosses the focus distance; the gap grows with the render width, so it showed at 1920.
Trailer shots now fill that gap with a dense inner spiral (`fill`, off for the website's `bg` shots, which keep their
look). `fluid=3` shows the smoke before its blur (red) and its distance (green), for checking.

**Render width changes the smoke:** the same shot is about three times brighter at 960 wide than at 1600 (found
with the website header loop). Always check and render at the width that will be delivered.

**Hosting the engine on a page** (the website's live Buy fire, `website/fire.html`): set `window.TRAILER` before
importing `shots.js`: `cap` (the folder with `meta.json`), `smoke`, `font` (file paths), `noSynth: true` (no synth
picture to load, for `bg` shots), `live: true` (the canvas fills its page, cover-fitted, and frames never wait on the
GPU). An import map redirects `/website/vendor/three.module.min.js` when the files live elsewhere.

**`hidesp=1`** renders the sparks (so a shot keeps the same random numbers) but leaves them out of the picture: for a
background that gets live sparks on top (the website header).

## 7. Title cards (in progress)

Cards are made in our own engine only (owner's call: no footage, no Blender, no AI images), never with the synth
visible: the `title` shot in `shots.js` (no synth; text laid in after the grade so its colours stay exact; `txt=1..5` (the cards of 19 Nov; 11..15 the earlier ones)
picks the card from `STRUCTURE.md`). **Render each look in its own run** (several looks in one `trailer-render.mjs`
call broke the sparks: a known, unfixed bug).

**The current direction (owner's pick, 18 Nov, later the same day): the hall of glowing seams.** The `hall` shot
(`hall=2`): square concrete pillars in a loose grid, no floor or roof, lost in a dark fog, each with a thin red light
line set into its faces, made exactly like the slide shot (low camera looking up, fixed focus, aperture 105, the smoke
and the 3D sparks). `hall=1` (a light pool) and `hall=3` (a fire deep in the hall) were the other two options. Card 5:

```
hall@ruin:real=1,og=1,tint=0.22,fine=1,sparks=1.5,fluid=0.2,hall=2,txt=15,tglow=0.5
```

**The seams fill up** (owner's call): slowly, an ambient movement (9-18 s to climb the frame), every line already in
the frame when the shot opens and never stopping, its tip a little hotter, while the title is already there. **A seam never reaches the title:** a box round the words (their glow plus
room for a soft line's blur) is kept clear; a seam whose line would reach it at any moment of the shot (the camera
moves) climbs just slow enough to end the shot short of it (`planSeams`); the others climb normally. The words' glow is
subtle (owner's call; `tglow=0.5`); the seams keep their glow.

**Before that (owner's pick, 18 Nov):** a dark hall of giant concrete pillars rising out of foggy depths and
vanishing upwards, look 5's smoke lit only by the sparks in front, glowing sparks and glowing words, a dark background.
Built after the owner's own Photoshop edit of the first pillar render. The current settings:

```
title@ruin:real=1,og=1,tint=0.22,fine=1,txt=15,city=2,pnear=2700,pmid=5500,tilt=9,hazek=0.6,ptone=0.4,fluid=2.2,sparks=1.5,ap=16,sglow=3,tglow=1.6
```

| Option | What it does |
|---|---|
| `city=1` / `city=2` | the first engine city (the owner's "city6" look) / the hall of pillars |
| `pnear`, `pmid` | distance of the nearest pillar row and of the lone middle pillar (the owner first found them too close at 2700 in a lit version, then chose that layout again darker; 7000 = far back, veiled) |
| `tilt` | the camera looks up this many degrees (the pillars converge upwards) |
| `hazek`, `ptone`, `pfog` | the haze's brightness, the pillars' darkness, the fog's thickness |
| `pool` | a warm light pool on a few pillars (the UI shots' way of lighting; used in one version, not in the current one) |
| `sglow`, `tglow` | the glow round each spark; the words' glow (white halo, stronger on the accent word) |
| `fluid`, `sparks`, `ap` | look 5's spark-lit smoke amount; spark density; aperture (big soft spark discs near the lens) |

Still open: the warm glow the owner painted low on the left (a big spark lighting the smoke) is weaker than in the
edit; text typing-in and motion; the other four cards.

**Tried and set aside** (the code stays as options; the history is in git): nebula noise smoke (`neb=1`), ink, light
streams, macro bokeh looks; a brutalist city in Blender (the weak point was the modelling, not the renderer; Blender
is gone from the repo); a street city rebuilt from the owner's reference picture, with haze sheets, light shafts and a
volumetric fog pass (commits 3453e25 to 919245a). The owner found these worse than the first city and the pillars.

**Lessons from the title cards:**
- Judge how a shot *reads*, not only the numbers: moving the pillars back while lighting them strongly made them read
  closer.
- Matching a reference: look at it properly first (angles, shapes, values), lay renders over it, measure colours
  (g/r, b/r) and brightness percentiles.
- The yellow guard must only act on saturated warm colours (an early version turned every grey orange); a tilted
  camera can push the backdrop past the far clip (keep the backdrop within it).
- Never put a `//` comment in the middle of a line of code: it swallowed code again (in `setup`).

## 8. The whole trailer: timeline, ROUGH and FINAL

The edit lives in **`tools/trailer/timeline.json`**: every shot or card in order, its length in beats, its options, its
fades through black and its part of the music. **The current cut (v3, 20 Nov): the story plan**, on the owner's cards
(`STRUCTURE.md`, card 2 now BUILD A SOUND. / THEN RUIN IT.), 60.0 s at 90 BPM (the references' felt tempo):
1. **The mystery** (0.7-8.7 s): fragments in the dark, very close (the scope, a peak of the saw, the DETUNE dial's
   edge, the keys); the music a heartbeat, air and a few cold metallic notes.
2. **EVERYTHING YOU HEAR IS RUIN-1**: the heartbeat speeds up under a riser.
3. **The proof** (12-20 s): every shot is the sound you hear (the saw riff, the envelope's swell, the LFO's wobble,
   the scope's pluck), then **the wide reveal** of the whole instrument with everything together.
4. **BUILD A SOUND. / THEN RUIN IT.**: one bass riff introduced alone, clean.
5. **The transformation** (22.7-32 s): the riff clean (the sub, the filter), then a match cut to the whole RUIN page
   and the same riff **ruined** (Destroyed Reese, Grinder, neuro stabs, horns, full drums), cut every beat: the peak.
6-7. **250+ SOUNDS. READY TO PLAY.** and **abundance**: a new preset on every one-beat cut.
8-9. **NEW SOUNDS IN ONE CLICK.** and **cause and effect**: every ROLL a dice click and a new sound out of it,
   closer and faster each time, a snare roll rising.
10. **ARE YOU READY?**: the held breath, the quietest moment, a slow push in (`hcam=4`), one beat of silence.
11. **The logo**: a braam (horns, tubas, warhorn and the ruined bass on F) on the biggest hit, ringing out.
The cards use different cameras in the hall (`hcam=1..5`) so they don't repeat one shot. Cards type in at a letter
every two frames, faster on long lines in short cards (`typ=2`).

Two modes read the same timeline, shots, moves and text (`node tools/trailer-cut.mjs rough|final`):
- **ROUGH** (`rough=1`): the previs, to judge pacing, cuts, framing, moves and text timing. 640 x 360, 15 fps, the
  scene drawn flat and unlit (the synth's captured screen as its one picture, the pillars a flat grey per face), no
  smoke, sparks, depth of field, fog, glow or grade. The whole minute renders in about 45 s, as an MP4 (with the guide
  track when it exists).
- **FINAL**: the full look per shot (`looks` in the timeline), 1920 x 1080, 25 fps (hours).
Every shot runs on its own 25 fps clock, so it moves the same in both modes. Pages other than OSC are their own
captures (`renders/trailer/cap-<PAGE>`, `trailer-capture.mjs ... <PAGE> - 1`; RUIN on Destroyed Reese, which has a
chain; CREATE is the Presets page with the Randomizer open and five rolls, `SHELF=Randomizer ROLLS=5`); their shots are
blocked in (`UISHOTS` in `shots.js`, the slide shot's recipe).

**The guide track** (`npx tsx tools/trailer-music.ts`, about 10 min): a sketch for timing played on RUIN-1's own
presets through the engine, offline (no samples, so card 1 is true), in F minor at the timeline's tempo, its sections on
the timeline's parts and its hits on the cuts. Written to `renders/trailer/track.wav`; the cut picks it up.
