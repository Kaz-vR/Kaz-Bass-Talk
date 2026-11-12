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

### The siren (core)
| Name | Hex | Variable | Use |
|---|---|---|---|
| Alarm red | `#ff2a14` | `--red` | (Buy now uses `--buy` `#ff4000`, see below) the play outline, active states, the carousel's active cue |
| Hot orange | `#ff6a1a` | `--hot` | Small labels (Sound, Inside, Specs), keyboard focus ring, the bright core of every glow |
| Deep red | `#8a0a04` | `--deep` | The outer edge of glows, where the light falls off into black |

The alarm red looks "neon" because it sits at the edge of the sRGB gamut (as saturated as a screen can
show) and has a glow: `box-shadow: 0 0 24px rgba(255,42,20,.45)` (hover `.75`). Any new accent colour must
match that: pushed to the gamut edge at its hue, with its own glow.

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

### Neon extras (approved, use sparingly, never on Buy, never as large areas)
"The other alarms": same voltage as the alarm red, at the gamut edge, each with a glow and a deep version.
| Name | Neon | Deep | Character |
|---|---|---|---|
| Toxic green | `#17ff4d` | `#0b5e1a` | A radioactive exit sign. Very bright: small labels and status lights only |
| Electric blue | `#236dfe` | `#04338e` | A police strobe or arc welder |
| UV violet | `#9d2bfe` | `#510a89` | A blacklight tube at full burn |
| Neon pink | `#ff1089` | `#780946` | A motel sign at 3 a.m.; heat without alarm |

Visual sheet of the whole palette: ask Claude to render it (the owner keeps a PNG of it).

### Logo colour
**Logo orange `#d66624`** (`--logo`; owner's pick, painted on a screenshot): the logo files in `design/`
(`logo.svg`, `logo-tight.svg`) and the synth's own logo use it.

### Buy and the synth's colours (owner's paint-over)
- **Buy buttons: `#ff3205`** (`--buy`), with a glow `rgba(255,50,5,.45)` (hover `.75`). Alarm red stays for the
  other active states.
- **The synth's modules** (`src/ui/style.css`, "each box its own colour"): OSC A `#ea1f1f`, OSC B `#e83911`,
  amp envelope `#129b82`, filter and filter envelope `#5f64c8`, sub `#6c3a9c`, noise `#c09b6d`; the routing LEDs
  A / B / S / N follow their module. The wooden cheeks a very dark brown `#1c120d` (the owner's own tuning, saved from the colour tuner).

---

## 3. Light (the glows)

Glows are layered and complex (the owner likes "the more complex gradient"), never one flat gradient, and
always fade to pure black.
- **Header:** two beams of a rotating warning light, frozen mid-turn, sweeping from the top right (a
  `conic-gradient` from about 200deg at 82% 18%, blurred 18px, masked to fade out at the bottom), plus a lamp
  glow (a 220px radial blob, hot orange core to red, at the top right).
- **Audio demo:** a soft red radial glow behind the video, `rgba(255,60,20,.14)` to `rgba(120,10,4,.08)`
  to transparent.
- **Buy part:** a glow rising from the bottom centre: hot orange `.32` to alarm red `.22` to deep red `.12`
  to transparent, 1500 x 700px, anchored below the section; plus the pixel embers (see below).
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
- Labels (Sound, Inside, Specs): 11-12px, uppercase, tracking 0.3em, hot orange.
- Body: weight 300, 16-19px, line-height 1.6, `--soft`.
- Spec numbers: weight 200, 78px (phone 48px), with tiny uppercase labels.
- Buttons: 12px, weight 600, uppercase, tracking 0.22em.

---

## 5. Shapes and spacing

- **Buttons are square. Never rounded** (owner: rounded doesn't fit the synth). This includes the arrows.
  - Main: solid alarm red, black text, the red glow. Height 48px, padding 0 28px.
  - Secondary: 1px `#4a4542` outline, light text. Same size.
  - Small (menu Buy): height 34px.
  - Arrows: 52 x 52px square outline, hover red outline and glow.
- **No divider lines** anywhere (owner: "I like the removal of the lines"). Separate parts with space.
- **No frames around the video.** It sits in the darkness and becomes part of the background.
- Lots of black space: 170px above each part on desktop (120px on phones), 230px above the Buy part.
- Focus: 2px hot orange outline, 3px offset.

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
2. **Audio Demo** (`#sound`): label "Sound", heading "Listen first.", the video with no frame. Until the
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
5. **Buy part** (`#buy`): the logo, "Your sound. Its ruin.", one red "Buy RUIN-1", the bottom glow, and the
   **pixel embers** along its bottom edge, right above the footer (owner's pick "Embers" of three fire looks).
6. **Footer**: "© 2026 RUIN-1" and the links, small and dim.

---

## 7. Phones (600px and under)

One centred column. The header stacks (the 3D synth edge to edge, then the logo, lede, buttons full width up
to 300px); on touch, a sideways drag turns the synth and vertical scrolling stays the page's. The menu keeps only the logo and the small Buy. The carousel's slides are 86vw; the
caption puts the arrows beside the title and the description below. Specs in two columns. The footer is
centred. No sideways scrolling at 375-390px; check it every time.

## 8. Motion

Restrained (owner picked motions 1 and 3 from the motion pitches):
- Parts ease up into view once as they reach the screen (0.8s, `cubic-bezier(.2,.7,.2,1)`).
- The menu shrinks into a black bar on scroll and lights the link of the part you are in.
- The carousel slides with the same curve.
- **Pixel embers** (owner's pick of three: Inferno, Embers, Dither): a low, smouldering pixel fire (6px blocks,
  deep red to alarm red to hot orange, no yellow) slowly breathing along the bottom of the Buy part, and single-pixel
  sparks drifting up out of it, cooling (pale orange, orange, red, deep red) as they rise. The same sparks drift behind
  the Header's content. Plain canvas in `main.js` (`embers()`), 24 frames a second, only while on screen; with
  reduced motion the fire is one still frame and the header has no sparks.
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
- Publish to the website artifact and always give both links (see the root `CLAUDE.md`).
- **Never push to GitHub unless the owner says so.** Commit locally.
- Use the installed design skills (UI review, polish, frontend-design) for reviews and larger changes.
