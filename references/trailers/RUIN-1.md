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
- **Sparks:** real 3D particles rising through the shot, short streaks (motion blur), each a solid `#F25D07` core with
  a soft glow of the same colour; drawn after the grade so the colour stays exact (measured `#F35E08`).
- **A smooth depth of field** (112 samples, a different pattern per pixel, then smoothed).
- **Text cards:** Manrope, warm white `#F3EEE8` with the accent word in a house colour, backgrounds in the website's
  fire style (plates A–E made; the owner's pick still open).
- **Smoke:** added by the owner in the edit, from real smoke footage; not rendered by us.

## 4. The current look, as shot options

```
<shot>@ruin:fire=0.5,real=1,og=1,sparks=0.65,fine=1,tint=0.22
```

| Option | What it does |
|---|---|
| `fire=0.5` | the subtle warm cast and firelight spill in the house colours |
| `real=1` | lit object; no haze, bloom, halation or fringes |
| `og=1` | the owner's fitted grade |
| `sparks=0.65,fine=1` | sparks at 65 % density, as short `#F25D07` streaks with a glow |
| `tint=0.22` | the `#F25D07` wash |
| (no `pull`) | fixed focus; `pull=1` would bring the focus pull back |

Export: GIF for review, MP4 for the edit; on request a sparks-only layer on transparent for compositing.

## 5. Checklist (on top of `RULES.md` section 11)

- [ ] No focus change inside any shot
- [ ] No coloured haze, bloom, halation or edge fringes
- [ ] Warm colours only `#F25D07`, `#F23005`, `#F20000`; sparks measure `#F25D07` (±3 per channel)
- [ ] Black stays black (the darkest 1 % at most 8/255)
- [ ] Cards in Manrope, accent word in a house colour
- [ ] Every shot rendered from the current synth (recapture after colour changes)
