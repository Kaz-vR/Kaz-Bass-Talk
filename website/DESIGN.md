# RUIN-1 website: DESIGN.md

The single source of truth for the website's look. Read this whole file before touching the site. A new
session should be able to rebuild the style from this file alone. When the owner changes the style, update
this file in the same commit.

The site lives in `website/` (`index.html`, `style.css`, `main.js`). Shared brand files live in `design/`.

---

## 1. The direction: "Siren", a red light in a dark room

Grew out of round 1's redesign #2 "Light from darkness" (references: Hasselblad, Teenage Engineering,
Apple MacBook Pro product pages), sharpened by the owner's notes into a siren: the red-orange of a red wall
alarm light. Supporting references for the single red accent on black: Bloober Team, Raycast. The reference
library is in `references/` (see `references/README.md`, tag `lorn`).

**Mood:** pure black. The only light in the page is a red-orange alarm or siren glow. It must feel
**dangerous and cinematic**, never cosy, warm-amber or friendly. It belongs with the synth's concept: dark,
worn, cinematic, alive (LORN, see the root `CLAUDE.md`).

**The one rule above all:** red is the only thing that glows on its own, and the only colour on Buy.

---

## 2. Colour

All colours are CSS variables at the top of `website/style.css`.

### The warm colours: exactly the synth's own four (owner's call)
Every warm colour on the site is **exactly** one of the synth's four warm colours, never a lighter, darker or less
saturated version and never a new hue: **sand `#c09b6d`, logo orange `#f25d07`, OSC B `#f23005`, OSC A `#f20000`** (the owner's tuner save of 13 Nov).
Glows use them with transparency over black (that is the only way they fade).

| Hex | Variable | Use |
|---|---|---|
| OSC B `#f23005` | `--buy` | Every Buy button (menu, header, Buy part), glow `rgba(242,48,5,.45)` (hover `.75`) |
| OSC A `#f20000` | `--red`, `--deep` | The play outline, active states, the carousel's active cue, arrow hover; the outer edge of glows |
| Logo `#f25d07` | `--logo`, `--hot` | The logo; small labels (Sound, Inside, Specs); keyboard focus ring |
| Sand `#c09b6d` | `--sand` | (reserved) |

**The fire's three colours (owner's pick):** `#f25d07` (hot orange), `#f23005` (red-orange), `#f20000` (red). They are
used for the fire and its light only: the header's smoke light, the Buy part's fire light and all sparks. The
brightest point of a rendered fire is exactly `#f25d07` (never clipped to yellow); sparks cool `#f25d07` → `#f23005` →
`#f20000` → fading into the black.

### Neutrals
| Hex | Use |
|---|---|
| `#000000` | The page. Always pure black, never a tinted near-black |
| `#f3eee8` | Headings, the RUIN-1 name (`--head`) |
| `#ece8e4` | Text (`--ink`) |
| `#9b958f` | Body text, ledes (`--soft`) |
| `#7a746f` | Muted text, spec labels (`--mute`) |
| `#4a4542` | Outlines of secondary buttons and arrows |
| `#55504c` | Footer (`--dim`) |

### Neon extras (approved earlier, not in use; would need the owner's OK now that the warm colours are the synth's)
"The other alarms": same voltage as the old alarm red, at the gamut edge, each with a glow and a deep version.
| Name | Neon | Deep | Character |
|---|---|---|---|
| Toxic green | `#17ff4d` | `#0b5e1a` | A radioactive exit sign. Very bright: small labels and status lights only |
| Electric blue | `#236dfe` | `#04338e` | A police strobe or arc welder |
| UV violet | `#9d2bfe` | `#510a89` | A blacklight tube at full burn |
| Neon pink | `#ff1089` | `#780946` | A motel sign at 3 a.m.; heat without alarm |

Visual sheet of the whole palette: ask Claude to render it (the owner keeps a PNG of it).

### The synth's colours (owner's paint-over)
- **Buy buttons: OSC B `#f23005`** (`--buy`, owner's call), see the warm colours above.
- **The synth's modules** (`src/ui/style.css`, "each box its own colour"): OSC A `#f20000`, OSC B `#f23005`,
  amp envelope `#129b82`, filter and filter envelope `#5f64c8`, sub `#6c3a9c`, noise `#c09b6d`; the routing LEDs
  A / B / S / N follow their module. These colours lead every page of the synth (see `docs/ui.md`, tied colours). The wooden cheeks a very dark brown `#1c120d` (the owner's own tuning, saved from the colour tuner).

---

## 3. Light (the glows)

Glows are layered and complex (the owner likes "the more complex gradient"), never one flat gradient, and
always fade to pure black.
- **Header** (owner's pick "E", in the trailer's style): smoke lit by a soft warm spotlight from the top right, darker
  round the logo and text so they stay legible. Rendered with the trailer engine (`bg` shot,
  `bg@ruin:real=1,og=1,tint=0.22,clear=1,fine=1,fluid=1.5,beams=2,sparks=0.65,hidesp=1` at **1600** wide: the smoke's
  brightness depends on the render width) as a seamless 8 s loop (frames 25-224, the last 25 crossfaded into the
  start) in `assets/header-smoke.mp4` (0.6 MB; a muted autoplaying video, since a GIF of it is 17 MB even at 800 wide),
  poster `header-smoke.jpg`, cover-fitted behind everything (`.hero-bg`).
- **Audio demo:** a soft red radial glow behind the video, `rgba(255,60,20,.14)` to `rgba(120,10,4,.08)`
  to transparent.
- **Buy part** (owner's pick of six fire pitches, 3 "Glow from below"): the header's kind of smoke lit by a band of
  fire light along the bottom, rendered with the trailer engine (`bg@ruin:real=1,clear=1,cleary=0.6,bot=1,beams=6,fluid=1.6`
  at 1600 wide, frames 20-124, a seamless loop of frames 40-124 with the last 20 crossfaded into 20-39), a dark area
  behind the content; `assets/buy-fire.gif` (owner's call: a GIF; 800 wide, 10 frames a second, a palette per frame
  with ordered dithering: a shared palette flattened the dark oranges into a patch that read as olive), cover-fitted
  behind everything (`.end-bg`), still `buy-fire.jpg` with reduced motion.
- **The synth image:** `drop-shadow(0 50px 60px rgba(0,0,0,.95))` plus a faint red glow
  `drop-shadow(0 0 40px rgba(255,40,20,.18))`.
- Every section with a glow has `overflow: hidden`, so glows never cause sideways scrolling.

---

## 4. Type

- **One typeface: Manrope**, self-hosted from `design/fonts/manrope-latin-var.woff2` (variable 200-600,
  SIL OFL, licence in `design/fonts/OFL-manrope.txt`). No Google Fonts link at runtime.
- Headings: weight 300, letter-spacing -0.02em. Desktop h2 54px, phone 34px.
- The RUIN-1 name: weight 300, very wide tracking (0.40em), 64px on desktop; "SYNTHESIZER" under it at
  13px, weight 400, tracking 0.86em, `#a49d97`.
- Labels (Sound, Inside, Specs): 11-12px, uppercase, tracking 0.3em, logo orange.
- Body: weight 300, 16-19px, line-height 1.6, `--soft`.
- Spec numbers: weight 200, 78px (phone 48px), with tiny uppercase labels.
- Buttons: 12px, weight 600, uppercase, tracking 0.22em.

---

## 5. Shapes and spacing

- **Buttons are square. Never rounded** (owner: rounded doesn't fit the synth). This includes the arrows.
  - Main: solid OSC B orange (`--buy`), black text, its glow. Height 48px, padding 0 28px.
  - Secondary: 1px `#4a4542` outline, light text. Same size.
  - Small (menu Buy): height 34px.
  - Arrows: 52 x 52px square outline, hover red outline and glow.
- **No divider lines** anywhere (owner: "I like the removal of the lines"). Separate parts with space.
- **No frames around the video.** It sits in the darkness and becomes part of the background.
- **One screen per part** (owner's call): every part (Header, Audio Demo, Features, Set up, Buy part with the
  footer) is exactly one screen tall, on phones and computers, its content centred under the menu. Each part's big
  visual (the synth, the video, the carousel) is sized from the screen's height, so the whole part always fits; checked
  at 1920x1080, 1440x900, 1366x768, 1280x720, 820x1180, 430x932, 390x844 and 375x667. The black space is the
  screen's own: no extra gaps between parts.
- **Optical centring** (owner's call): each part's content sits a little above the true middle (the empty space
  split about 44 above / 56 below, between the menu bar and the screen's bottom; the Header 34 / 66, since the tilted
  synth reads low), using two invisible spacers per part (`.sp-a`, `.sp-b`). Measured from the visible pixels at five
  sizes. The Audio Demo is the exception until the video exists: its empty 16:9 box is centred, so the play icon
  looks low; with the video in it, the part is balanced.
- Focus: 2px logo orange outline, 3px offset.

---

## 6. The parts (the owner's names for them)

**"The logo" (owner's word)** means the whole lockup: the triangle icon, the word **RUIN-1**, and the word
**SYNTHESIZER** under it, together. The triangle alone is "the icon". On the website the full logo is in the Header;
the menu, the play button and the Buy part show the icon only. Its rules: the icon's top meets the top of the letters
of RUIN-1 and its bottom the bottom of the letters of SYNTHESIZER; **SYNTHESIZER is exactly as wide as RUIN-1** (its
letter spacing is set from the font in `main.js`, first and last letters lined up with RUIN-1's at every size).

Use these names when talking about the site.

1. **Header** (`.hero`): the menu on top (icon left, Home / Sound / Features / Specs / Buy in the middle: Home takes you to the Header, Buy to the Buy part; small red Buy right); it
   stays fixed and shrinks into a black bar when the page scrolls. Below it, **one centred column** (owner's call,
   "for now"):
   - **the synth in 3D, in the middle** (`hero3d.js`, three.js self-hosted in `vendor/`, MIT): a box with the synth's
     picture on its face, deep wooden cheeks, the body running from wood to wood (no holes). **No lighting at all**:
     every surface shows the picture's own colours exactly (colours pass straight through; measured against the flat
     picture within half a level). At rest it faces you straight on, tipped back 3 degrees, turning round its exact
     middle; it follows the mouse a little (about 14 degrees), drag it to turn it all the way, let go and it springs
     back. The picture `<img>` underneath is the fallback (no WebGL, reduced motion);
   - under it, centred: the logo, the lede, the two buttons (Buy now, Hear it), the tiny "VST3 Standalone Fully
     offline" line;
   - the logo is aligned so the icon's top meets the top of the letters of RUIN-1 and its bottom the bottom of the
     letters of SYNTHESIZER (measured from the font in `main.js`, holds at every size).
2. **Audio Demo** (`#sound`): label "Sound", heading "Trailer" (owner's call; the video is the trailer shots so far, `assets/demo.mp4`), the video with no frame, always playing in a muted loop (no play button). Until the
   video plays, the glowing logo is the play button with a small "▷ Play" under it (no box around the
   logo). The video file goes in `website/assets/demo.mp4`.
3. **Features** (`#features`): label "Inside", heading "Every page lights up.", and the **carousel**. It
   must always stay a carousel (owner): the current page big in the middle, its neighbours faded at the
   sides (opacity .28, greyed), a **loop with no ends** (on page 1 the last page is already on the left),
   looping silent clips of the whole synth (wooden sides and keyboard included), only the current clip
   plays. Under it, the caption from 2.1: square arrow, the counter "01 / 06" and the title on the left, the
   description on the right, square arrow. Swipe on phones, drag with a mouse, click a side page, arrow
   keys. Clips are recorded by `node tools/site-pages.mjs` into `website/assets/pages/`.
4. **Set up** (`#setup`): label "Specs", heading "Light on the machine.", four large thin numbers (3% CPU
   per voice, 25 MB install size, 0 internet needed, 8 voices), one line about systems and formats.
5. **Buy part** (`#buy`): the logo, "Your sound. Its ruin.", one red "Buy RUIN-1", over the fire loop and its
   rising sparks, right above the footer.
6. **Footer**: "© 2026 RUIN-1" and the links, small and dim.

---

## 7. Phones (600px and under)

One centred column. The header stacks (the 3D synth edge to edge, then the logo, lede, buttons full width up
to 300px); on touch, a sideways drag turns the synth and vertical scrolling stays the page's. The menu keeps only the logo and the small Buy. The carousel's slides are 86vw; the
caption puts the arrows beside the title and the description below. Specs in two columns. The footer is
centred. No sideways scrolling at 375-390px; check it every time.

## 8. Motion

- **Scroll snapping** (owner's call): on phones it is firm (`scroll-snap-type: y mandatory`): every swipe lands on
  the next part, perfectly framed. On computers it is gentle (`proximity`): wheels and trackpads scroll freely, and
  the page only settles onto a part when you stop close to it. The footer shares the last screen with the Buy part.

Restrained (owner picked motions 1 and 3 from the motion pitches):
- Parts ease up into view once as they reach the screen (0.8s, `cubic-bezier(.2,.7,.2,1)`).
- The menu shrinks into a black bar on scroll and lights the link of the part you are in.
- The carousel slides with the same curve.
- **Header sparks** (`sparks.js`): the trailer's sparks, live over the smoke loop: few (as many as mockup E, about 20 on a
  laptop screen), born where they glow and drifting very slowly up (4-11 px a second), each at its own
  depth (sharp short streaks in the focus band, soft discs nearer the lens), cooling `#f25d07` → `#f23005` →
  `#f20000` → fading out, the glow one step cooler than the core. 30 frames a second, only while on screen; with
  reduced motion no sparks and the smoke is its still poster.
- **Buy sparks** (`sparks.js`, the same engine): the sparks of fire pitch 6, born along the bottom and rising out of the
  fire as fast as the fire rises (owner's call: the loop's smoke moves about 2 % of its picture's width a second, so
  0.6-1.4 x that, from the picture's cover-fitted width), a slight diagonal, dying on the way up (6-11 s); about 40
  on a laptop screen.
- Everything is off with `prefers-reduced-motion`.

---

## 9. The owner's taste (likes and dislikes)

Likes: the synth in 3D in the header, unlit (true colours), tipped back slightly; pure black; the siren red-orange; the pixel embers; complex layered glows; square buttons; no lines; the video
melting into the dark; the carousel; the synth angled; neon that looks truly neon (gamut edge plus glow);
dark, dangerous, cinematic; restraint.

Dislikes: rounded buttons; divider lines; soft amber or "cosy" warm gradients; text covering images;
everything centred on desktop; content hugging the screen edges; colours that are pulled back and tame
when they should be neon; obvious template looks; typical plugin-site clutter (sale banners, loud gradients).

## 10. The reference library (our own "UXKIN")

`references/` is our own hand-picked library of 60 top-tier websites, built for RUIN-1 instead of a paid
service like UXKIN (owner's call). Use it for every design decision, before relying on taste.

- **What each site has** (`references/<site>/`): desktop and phone screenshots of the first screen and
  the whole page (`desktop.webp`, `desktop-full.webp`, `phone.webp`, `phone-full.webp`); `tokens.json`
  with the design measured from the live page (fonts, type sizes and tracking, colour palette by area,
  accent, buttons, section spacing, whether the first screen is dark, measured from the pixels); and
  `DESIGN.md` with what makes it work, what it is a good reference for, and the lesson for RUIN-1.
- **Index:** `references/README.md`, grouped by tag. **`lorn`** (24 sites) = in line with RUIN-1's
  concept: dark, worn, cinematic, analog (Ninja Tune, Warp, A24, Hasselblad, Moog, Blumhouse, ECM ...).
  Other tags: `dark`, `hero`, `product`, `music`, `type-led`, `motion`, `software`, `studio`, `outlier` ...
  Native Instruments and Output are in only as the plugin-site norm to beat.
- **How to use it:** pick the tags that fit the task, read 5 to 8 of those `DESIGN.md` files and look at
  their screenshots, and use them as the brief; name the references used in each pitch. Study patterns,
  never copy a site's branding, images or copy.
- **Rebuild or extend it:** add sites to `references/sites.json` (slug, url, tags, why), run
  `node tools/references.mjs [slug,slug]` to capture them, add notes to `references/notes.json`, then
  `node tools/references-index.mjs` to rewrite the DESIGN.md files and the index. Capturing needs open
  internet access in the cloud environment (the owner set the Default environment to unrestricted);
  some sites block cloud servers (Balenciaga, Saint Laurent, Criterion ...) and were swapped out.

## 11. How we work on the site

- The owner usually asks for several **pitches as PNG images** first, picks one, then gives notes.
  Render pitches on the real site or real assets, desktop and phone, and label each one.
- Check against references in `references/` and measure (sizes, contrast, alignment) instead of eyeballing.
- After a change, check desktop (1440), tablet (820) and phone (390): no errors, no sideways scroll.
- Publish to the website artifact and always give both links (see the root `CLAUDE.md`). Rewrite `../design/` to
  `design/` in **both** `index.html` and `style.css` (the font is loaded from the stylesheet; once it was missed and the
  site fell back to a system font). The published `tuner.js` loads the owner's saved tuning and forces some colours
  over the stylesheet: check the live page with that saved tuning loaded before saying a colour change is done.
- **The tuner** (dev only, only in the published preview, never in `website/`; the ◐ button on the left turns it on):
  balls for colours; on the header a **square** for the smoke's **Curves**, an **orange square** for the sparks' Curves
  (applied to the sparks as they look over black, their transparency kept), and on the Buy part a **red square** for
  the fire's Curves (the GIF's frames are decoded with `ImageDecoder` and played under the curves, since scripts only
  ever see a GIF's first frame) and an **orange square** for its sparks' Curves, (RGB, Red, Green, Blue and Brightness, which changes the
  luminance only and keeps the colour; applied in that order) and a **diamond** for the **Vignette** (amount, size,
  roundness, feather). Both apply to the header smoke loop through a WebGL pass over the video. **Save** asks for a name (it
  can't save without one), then stores everything in `tuning/current` and adds a named, timestamped entry to
  `tuning/history/saves`. Hovering Save shows the **last 10 saves** by name and time (click one to go back to it). The
  last 10 are always kept: each save deletes only the ones older than the latest 10, and nothing else clears them
  (owner's call; Claude never clears the saves). When the owner says "apply my saved colours", apply the newest save
  (or the one they name) to the site for good: the smoke's curves baked into `assets/header-smoke.mp4` and its poster,
  the vignette as a gradient layer over the smoke redrawn to the header's shape (as tried on 15 Nov and then undone by
  the owner), the Buy fire's curves baked into `assets/buy-fire.gif`, the sparks' curves into `sparks.js`; then reset
  the grade in `tuning/current` so it isn't applied twice.
- **Never push to GitHub unless the owner says so.** Commit locally.
- Use the installed design skills (UI review, polish, frontend-design) for reviews and larger changes.
