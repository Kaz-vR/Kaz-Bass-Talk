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
| Alarm red | `#ff2a14` | `--red` | Buy buttons and their glow, the play outline, active states, the carousel's active cue |
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
**Undecided.** Options pitched: alarm red `#ff2a14`, hot orange `#ff6a1a`, white-hot `#f6efe6` with a
red glow. The current file (`design/logo.svg`, `design/logo-tight.svg`) is the old orange-gold `#f0a040`,
which no longer fits the siren. Update this section when the owner picks.

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

Use these names when talking about the site.

1. **Header** (`.hero`): the menu on top (logo left, Sound / Features / Specs in the middle, small red
   Buy right); it stays fixed and shrinks into a black bar when the page scrolls. Below it:
   - left: the triangle logo plus "RUIN-1 / SYNTHESIZER" (no headline; the owner removed "Sound, out of
     the dark."), the lede, the two buttons (Buy now, Hear it), a tiny "VST3 Standalone Fully offline" line;
   - right: the synth screenshot, **angled in 3D** (`rotateY(-14deg) rotateX(3deg)`, perspective 1600px);
   - the two halves are held in a 1300px column, toward the middle but not centred (the owner disliked
     both "hugging the screen edges" and "too much in the middle");
   - the logo is aligned so its top meets the top of the letters of RUIN-1 and its bottom the bottom of
     the letters of SYNTHESIZER (measured from the font in `main.js`, holds at every size).
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

One centred column. The header stacks (lockup, lede, buttons full width up to 300px, the synth full width
and flat, not angled). The menu keeps only the logo and the small Buy. The carousel's slides are 86vw; the
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

Likes: pure black; the siren red-orange; the pixel embers; complex layered glows; square buttons; no lines; the video
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
