# Trailer rulebook (measured)

*(This file only measures the references. The RUIN-1 trailer itself is specified in `RUIN-1.md`, which builds on this one.)*

The style of four Artistry Audio trailers, written down as numbers so a RUIN-1 trailer can be built to it and
checked against it. Nothing here is copied into our trailer (no footage, music, branding or copy): we copy the
**grammar**, not the content.

| Trailer | Length | Shots | Picture | Tempo | Key |
|---|---|---|---|---|---|
| Staccato | 48.2 s | 20 | 16:9 full frame | 99 BPM | E minor |
| Origin X | 62.9 s | 39 | 2.39:1 letterbox (bars 12 % each side) | 143.5 BPM | E minor |
| Scorpio | 51.1 s | 43 | 2.37:1 letterbox (bars 12.5 %) on 36 of 42 shots | 89 BPM (half-time feel) | E minor |
| Monolith | 59.1 s | 53 | 16:9 full frame | 161 BPM (80.7 half-time) | D minor |

All four: 3840x2160, 25 fps. Source of every number: `tools/trailer-analyze.py`, run on the 4K files with the
hand-checked shot lists in `shots.json` (every candidate cut, about 300, viewed frame by frame). Raw data per shot is
in `data/<name>.json`; contact sheets (one still per shot, labelled) in `sheets/`; `sheets/audio.png` is the
music with every cut drawn on it. Ranges are written p10–p90 (median in brackets) unless noted.

**Two techniques under one look:**
- Monolith and Staccato are **3D renders**: the UI is a thin glossy slab in a dark space, with a coloured glow behind it,
  rendered depth of field and chromatic aberration (RGB fringes) at the frame edges. This is what we can make
  from our own 3D synth.
- Scorpio and Origin X are mostly a **real monitor filmed with a macro lens**: the screen's pixel grid shows in the text,
  with real lens bokeh and the DAW around the plugin blurred into colour bands. Origin X also cuts in live footage
  (hands on a pad controller, a microphone mesh, headphones).

---

## 1. Arc (the shape of the minute)

Every trailer has the same five parts. Section changes in the picture land exactly on section changes in the music.

| Part | Where (share of runtime) | Picture | Music |
|---|---|---|---|
| 1. Cold open | 0 → 6–15 % | company logo, centred, on a dark plate | ambience or soft pad; very quiet, then +7…+14 dB in the first second |
| 2. Intro | to 30–40 % (Monolith: skipped, drop at 7.5 %) | "INTRODUCING" plus a one-line claim, slow cards, a few slow UI shots; fades through black | sparse: a motif, pluck or arp, no full drums |
| 3. Main | to 60–65 % | fast UI montage, a feature card every 2–4 UI shots | full beat; enters on an impact after a 2–3 s riser |
| 4. Break and second peak | to 80–85 % | one card on a plate during the break, then the densest montage | 0.5–1.5 s drop-out (silence or filtered), then the biggest section |
| 5. Close | last 15–30 % | product logo card 3–5 s, then company or website card 3 s | ends on a hit, tail rings out 3–5 s and fades |

Measured section starts (s): Staccato 0 / 5.1 / **19.3** / 38.6 (outro) · Origin X 0 / 3.6 / 14 / **21** / break 37.4 / 39 / close 52.9 ·
Scorpio 0 / 3.9 / **16.4** / break 31.7 / build 38.2 / logo hit 43.0 · Monolith 0 / **4.4** / stop 29.3 / break 36.6 / 39.2 / close 52.6.
(The bold one is the drop.)

**Before the logo:** Scorpio accelerates into its logo with 6 shots of exactly 6 frames (0.24 s) each (41.60–42.96 s).
Monolith closes on text over the darkened UI before its logo.

## 2. Shot mix and length

| | Staccato | Origin X | Scorpio | Monolith |
|---|---|---|---|---|
| UI shots: count / share of runtime | 12 / 32 % | 22 / 38 % (+ live 4 / 11 %) | 29 / 38 % | 36 / 41 % (+ text over UI 8 %) |
| Text cards: count / share | 5 / 37 % | 9 / 29 % | 11 / 39 % | 9 / 35 % (+ flashes 2 %) |
| Logo cards: share | 30 % | 17 % (+ url 5 %) | 20 % | 13 % |
| UI shot length | 0.56–2.39 s (1.12) | 0.56–1.72 s (0.94) | 0.24–1.02 s (0.68) | 0.40–0.76 s (0.72) |
| Card length | 2.4–4.8 s (3.7) | 1.5–3.4 s (1.7) | 1.3–2.8 s (1.4) | 1.5–3.5 s (1.6) |
| Logo card length | 4.7–5.1 s | 3.4–3.6 s | 4–6 s | 3.4–4.3 s |

**Rules**
- Text cards take a third of the runtime: **29–39 %**. Plain UI takes another third (**32–41 %**).
- Cards alternate with UI: **2 to 4 UI shots, then a card**; never two cards back to back, except logo cards at the end.
- **Shot lengths are whole beats.** Histogram in beats: Monolith mostly 2 (19×), 1.5 (10×), 1 (9×), 4 (6×);
  Origin X mostly 4 (12×), 2 (7×); Scorpio mostly 1 (13×), ½ (10×), 2 (7×); Staccato 1 (5×), 4 (5×).
  Fast sections use 1–2 beats per shot, intros 4–8 beats per shot.
- Cut speed follows the tempo: about 0.7 s per UI shot at 80–160 BPM (2 beats at 161, 1 beat at 89).

## 3. Cuts and the beat

- Cuts sit on the beat or half-beat: **74–79 %** of cuts within 0.12 beat (Staccato, Scorpio), 31–45 % (Monolith,
  Origin X, which also cut on off-beat accents).
- Cuts sit on a strong transient: median distance to the nearest strong onset is **3–65 ms** (under 2 frames).
- Cuts come **0–2 frames early**: median offset to the tracked beat is −15 to −70 ms (Monolith −70 ms, IQR −95…−37).
  The picture changes on, or just before, the hit.

## 4. Camera (UI shots)

| | Staccato | Origin X | Scorpio | Monolith |
|---|---|---|---|---|
| Move speed (% of frame width per s) | 1.6–6.2 (3.3) | 0.8–6.3 (1.6) | 0.6–4.9 (1.3) | 1.4–27 (3.9) |
| Push in / pull out (zoom % per s) | +2.2 median; 7 in, 1 out | ±1; 3 in, 4 out | ±1; 5 in, 5 out | +2.9 median; **24 in, 3 out** |
| Roll | under 0.6 °/s | under 0.6 °/s | under 0.5 °/s | under 0.5 °/s |
| UI line tilt in frame (dutch angle) | 15° (12–18) | 10° (4–23) | 2.5° (level) | **27.5° (22–38)** |
| Parallax (depth in the move) | 0.5 | 0.6 | 0.5 | 0.4 (up to 2.4) |

**Rules**
- **Every UI shot moves.** Always a slow slide or push, never a still frame, never a roll.
- **Constant speed within a shot**: the first and last third of a shot differ by about 0 (median −0.01 to +0.09).
  Easing happens across the cut, not inside the shot.
- **Oblique angles.** The UI is seen at a steep angle with its lines tilted 10–38° (3D-rendered trailers). Filmed-monitor
  shots keep lines near level but look along the screen at a grazing angle.
- Push in more than pull out, and pan left more than right (Monolith 27 left, 8 right; Scorpio 14 left, 9 right).
- Real depth: parallax 0.4–0.6 means near and far parts move at different speeds. It's a camera move through 3D,
  not a 2D pan over a picture.
- Speed spikes (Monolith up to 27 %/s, zoom 25–50 %/s) appear only as whip transitions into or out of a shot,
  4–8 frames long.

## 5. Focus (depth of field)

- **A thin sharp band.** Only **12–21 % of the frame is sharp** (median per trailer: Staccato 21 %, Origin X 16 %,
  Scorpio 12 %, Monolith 14 %); everything else is soft bokeh.
- The sharp band sits **in the middle**: rows 2–3 of 4 (Monolith 31 of 38 shots, Scorpio 27 of 29) and columns 4–5 of 8
  (just right of centre). The subject is a single control or label: one knob, one value, one word.
- The band follows the tilt of the UI: a diagonal stripe of sharpness across the frame, since the plane recedes.
- **Focus pulls**: most shots hold focus (shift index 0.04–0.06); about 1 in 4 pulls focus during the shot
  (shift 0.17–0.39), mostly in intros and slow parts.
- Out-of-focus areas carry colour: the product colour (purple, teal, orange) blooms as large soft shapes behind the UI.

## 6. Light and grade

| | Staccato | Origin X | Scorpio | Monolith |
|---|---|---|---|---|
| Black floor (p1, 0–255) | 10 (5–18) | **33 (21–40)**, milky | **0**, crushed | 10 (8–13) |
| Midtone (p50) | 40 | 65 | 24 | 30 |
| Highlights (p99.9) | 221 | 231 | 235 | 214 |
| Clipped pixels | ~0 % | 0.01 % | 0.02 % | ~0 % |
| Colourfulness (Lab chroma) | 11 | 33 | 10 | 12 |
| Main hues | teal 172–187° + warm 7° | purple 247° + magenta 7° | orange 22–37° + red 7°, green 97° | violet 247° + red-magenta 7°, green 82° |
| Shadows (Lab a, b) | +7, −9 (blue-violet) | +19, −27 (strong violet) | +2, −3 (neutral) | +5, −6 (cool violet) |
| Highlights (Lab a, b) | −8, +4 (green-yellow) | +7, −11 | +8, +14 (warm) | −1, +11 (warm) |
| Vignette (corners ÷ centre) | 1.0 (0.5–1.5) | 1.0 | **0.38** | 0.64 |
| Grain (high-pass σ) | 0.4 | 0.4 | 1.1 (filmed) | 0.45 |

**Rules**
- **Low key.** Midtones at 24–40 of 255 (Origin X is the lifted, pastel exception at 65).
- **Nothing clips.** Highlights stop at 215–235; bright UI lines glow instead of burning out.
- **One product colour plus one accent**, both taken from the UI itself, carried into every card plate, bokeh and
  flash: Monolith violet + green, Staccato teal + warm, Origin X violet + magenta, Scorpio orange + red.
- **Split toning**: cool, coloured shadows (violet or blue) and warm highlights. Only Scorpio keeps its shadows neutral.
- Vignette is gentle (0.6–1.0) on renders and strong (0.4) on filmed shots.
- Glow and chromatic aberration (RGB fringes, 2–4 px at 1080) at the frame edges of rendered shots.

## 7. Text cards

**Words**
- 1 to 4 words per line, 1 or 2 lines, ALL CAPS, plainly descriptive: a feature name or a claim
  ("MOTION SEQUENCES", "INTUITIVE INTERFACE", "600+ PRESETS", "CHANGE THE WAY / YOU MAKE MUSIC").
- Order across a trailer: "INTRODUCING" → one-line claim → 4–9 feature cards → numbers or format card → closing claim → logo.
- In two-line cards, the keyword or second line is in the accent colour (Monolith: "BASS INSTRUMENT" in green,
  "ARPS" in violet).

**Type** (all four use a geometric sans, close to Montserrat)

| | Weight and tracking | Cap height (% of frame height) | Treatment |
|---|---|---|---|
| Staccato | medium, tracking +5 | 4.6–4.9 % | plain white, slow fade |
| Origin X | regular, **very wide tracking (+400 to +600)** | ~4.9 % (small words, wide spread) | plain white |
| Scorpio | medium, tracking +100 | 3.7–5.5 % | metallic texture fill with a thin gold edge on the main cards |
| Monolith | semibold, tracking +150 | 5.7–6.5 % | white with a soft white outer glow |

- **Position**: dead centre. Text block centre at x 50 %, y 48–52 % (Monolith 47.8 %, just above centre).
- **Size**: a card line is 15–84 % of the frame width; the 3-word line is about 45–58 %.
- **Text brightness**: 180–255, never pure white with no glow on a bright plate.

**Motion**
- Staccato: fade in over 26–56 frames (1–2 s), hold, fade or cut out. Slow and quiet.
- Origin X: hard cut in, hold, hard cut out. Wide tracking does the work.
- Scorpio: glitch in and out (2–4 frames of RGB split and horizontal slice displacement).
- Monolith: **typed in**, about 11–13 letters per second (1 letter every 2 frames) or word by word on the beat;
  out with a **letter scramble** (letters drop out and swap over 4–6 frames); sometimes a colour flash (white smoke,
  then violet, 0.44–0.48 s each) under the same text.

**Plates behind the text**: never plain black in the main part. Dark, slowly moving abstract footage in the
product colour, at midtone 10–60: ink or smoke in liquid (Staccato, Monolith), particles and bokeh dots (Origin X, Monolith),
light streaks (Scorpio), a blurred UI or the live footage of the next shot. The plate moves slowly (drift or push),
and sometimes leads into the next shot.

## 8. Transitions

- **Hard cuts** in the main part (over 85 % of cuts there).
- **Fade through black** at part changes and in the intro and close: fade out 12–27 frames, black 0–8 frames,
  fade in 17–56 frames.
- **Glitch** (Scorpio, Monolith): 2–4 frames of RGB split, horizontal slice offset and scrambled letters on cards
  and logos, on a hit.
- **Colour flash** (Monolith): full-frame light plates of 11–12 frames on a downbeat (white, then the product colour).
- **Light streak whip** (Monolith): 7 frames of motion-blurred UI streaks between a UI shot and a card.
- **Dissolve** (Origin X): card into live footage over about 20 frames, the text staying on.
- **Letterbox open** (Origin X): the bars open from a thin line to 2.39:1 in the first 0.5 s.

## 9. Logo open and close

- **Open**: company mark centred, logo text cap height 2–3 % of frame height (small), on a dark moving plate, fade in
  10–31 frames, hold 2.5–3 s, fade out 21–29 frames. Monolith adds a thin ring that draws itself around the logo.
- **Close**: product name large (cap height ~6.9 % for Staccato) with a small tagline underneath in wide tracking
  ("SYNTHS IN MOTION", "INFINITE BASS ENGINE", "SYNTH MOTION ENGINE"), built with the trailer's own effect
  (particles, glow, glitch), held 3–5 s; then the company name or website 3 s, and fade to black.

## 10. Music and sound design

*(From measurements: loudness, spectrum, beats, onsets. To be confirmed by ear.)*

- **Tempo** 89–161 BPM; the fast ones feel half-time (80–90). **Minor key** (E minor ×3, D minor).
- **Loudness**: −10 to −14 LUFS integrated. Range 5 LU (Monolith, flat and driven) to 14 LU (Staccato, Scorpio: quiet intro, loud main).
- **Dark mix**: spectral centroid median 730–1360 Hz; sub (20–60 Hz) and bass (60–250 Hz) are the loudest bands;
  the band above 8 kHz is 30–55 dB below the bass. Lots of low end, little air.
- **Intro**: soft and sparse (a pad, a pluck or arp motif), +7…+14 dB swell in the first second.
- **Risers**: before each drop the brightness climbs 2–3× over 3 s (Scorpio 1.5 → 4.2 kHz; Monolith 1.5 → 3.0 kHz;
  Staccato 0.8 → 1.2 kHz), then an **impact** on the downbeat where the main part starts.
- **Breaks**: 0.5–1.5 s of near-silence or a filtered drop-out mid-trailer (Monolith 29.3 s: −8 dB; Scorpio 31.7 s),
  next to a text card (Scorpio: under the card; Monolith: right after one).
- **Hits on cards**: cards and logo builds sit on strong onsets; glitch transitions sit on hits.
- **Ending**: a final hit on the product logo, then a tail ringing out 3–5 s to silence.
- **Section changes are where the cuts change**: every slow → fast change in the picture is a loudness step of +5…+12 dB in the music.

## 11. Checklist (to measure our trailer against)

Run `tools/trailer-analyze.py` on our render with a shot list, then check:

- [ ] 45–65 s, 3840x2160 (or 1920x1080), 25 fps, 16:9 (letterbox optional)
- [ ] Five parts; the drop at 8–40 %; a break at 60–65 %; the close in the last 15–30 %
- [ ] Cards 29–39 % of runtime, UI 32–45 %; 2–4 UI shots between cards
- [ ] UI shots 0.4–1.1 s in the main part, whole beats; cuts on the beat or half-beat, 0–2 frames early
- [ ] Every UI shot moves at 1–6 % width/s, constant speed, no roll; UI lines tilted 10–38°
- [ ] Sharp area 10–22 % of the frame, in the middle rows; about 1 in 4 shots pulls focus
- [ ] Black floor 5–15, midtone 24–45, highlights at most 235, no clipping; product colour + one accent; cool shadows, warm highlights
- [ ] Cards: centred, ALL CAPS geometric sans, cap height 4.5–6.5 %, 1–4 words per line, an accent word, plate never plain black
- [ ] Transitions: hard cuts in the main part; fades through black at part changes; glitch, flash or whip only on hits
- [ ] Music: minor key, −10 to −14 LUFS, riser before the drop, break mid-trailer, hit on the logo
