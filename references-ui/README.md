# Software UI reference library

Our own hand-picked library of 60 software and instrument interfaces, the software twin of the website library in
`references/` (owner's call). Use it for every synth UI decision, before relying on taste. **Read `RULES.md` first**:
it sums up what the best of these share and how RUIN-1 should use it.

Dev-only: never shipped with the plugin, never imported by runtime code. Images come from each maker's official product
page and belong to the maker; they are here for study. Study the patterns; never copy a maker's art, branding or layout one to one.

## How to use it
Pick the groups and tags that fit the task, open 5 to 8 of the `DESIGN.md` files with their shots, and name the
references used in every pitch. The **Siren family** decides the style (it matches the website); **Synths and plugins**
decide how controls work.

## Rebuild or extend it
Add apps to `apps.json`, run `node tools/ui-references.mjs slug,slug` (captures the page and its biggest images into
`<slug>/raw/`), look at every candidate and list the ones that show the interface in `picks.json`, add notes to
`notes.json`, then `node tools/ui-references-index.mjs`. Capturing needs open internet access in the cloud environment.

## The Siren family
Software and devices from the brands behind the website's look (Hasselblad, Teenage Engineering, Apple, Leica): calm, premium, few colours. The most weight when choosing a style.

- [Hasselblad Phocus](hasselblad-phocus/DESIGN.md) (3 shots): Hasselblad's own pro software: the brand behind our site's calm, expensive restraint, applied to a dense pro tool
- [Hasselblad X2D camera UI](hasselblad-x2d/DESIGN.md) (3 shots): A camera menu and touch screen with very few colours and big calm type: premium hardware UI
- [Hasselblad X2D II](hasselblad-x2d-ii/DESIGN.md) (3 shots): The newest Hasselblad camera and its touch UI: the brand's current restraint
- [Teenage Engineering OP-1 field](te-op1/DESIGN.md) (4 shots): The OP-1 screen: every synth engine drawn as a playful, readable picture instead of a knob wall
- [Teenage Engineering OP-XY](te-opxy/DESIGN.md) (4 shots): TE's newest sequencer: a small display explaining a huge feature set with graphics
- [Teenage Engineering EP-133 K.O. II](te-ep133/DESIGN.md) (5 shots): Hardware graphics, segment display and printed labels as the whole UI
- [Teenage Engineering EP sample tool](te-ep-sample-tool/DESIGN.md) (1 shots): TE's desktop software: how the brand looks on a computer screen
- [Teenage Engineering OP-Z](te-opz/DESIGN.md) (4 shots): A device with an app as its screen: colour coding per track, very little text
- [Teenage Engineering TX-6](te-tx6/DESIGN.md) (3 shots): A tiny, dense machined mixer: many controls, perfect order
- [Apple Logic Pro](apple-logic-pro/DESIGN.md) (4 shots): Apple's pro music app: plugin UIs (Alchemy, Sample Alchemy, ChromaGlow), dark mode, precision
- [Teenage Engineering OP-1 field guide](te-op1-guide/DESIGN.md) (3 shots): The OP-1 manual: every screen of the device drawn flat, one engine per picture
- [Apple Final Cut Pro](apple-final-cut/DESIGN.md) (2 shots): A dark, dense pro app that still feels calm: panels, inspector, colour wheels
- [Teenage Engineering OP-XY guide](te-opxy-guide/DESIGN.md) (2 shots): The OP-XY manual: screen graphics for engines, envelopes and filters
- [Leica FOTOS](leica-fotos/DESIGN.md) (2 shots): Leica's app: luxury restraint, red as the only accent (like our siren)

## Synths and plugins
The genre: knobs, displays, dense panels, modulation. The most weight on how controls work.

- [u-he Diva](uhe-diva/DESIGN.md) (4 shots): The reference for analog-modelled synth faces: module panels, real knobs, readable at a glance
- [u-he Zebra](uhe-zebra/DESIGN.md) (4 shots): Huge modular synth on one page with grids and lit panels
- [u-he Repro](uhe-repro/DESIGN.md) (4 shots): Photoreal skeuomorphic hardware (Pro-One, Prophet-5) done tastefully
- [Xfer Serum 2](serum-2/DESIGN.md) (4 shots): The modern synth standard: big animated displays above each module, drag-to-modulate
- [Surge XT](surge-xt/DESIGN.md) (3 shots): A free, deep synth with skinnable flat panels: one page, many modules
- [Kilohearts Phase Plant](phase-plant/DESIGN.md) (3 shots): Modular generators in tidy stacked cards; very clear modulation
- [Arturia Pigments](pigments/DESIGN.md) (2 shots): Rich colour-coded modulation and animated displays; polished
- [Arturia V Collection](arturia-v-collection/DESIGN.md) (2 shots): Faithful vintage hardware recreations with a clean modern toolbar
- [FabFilter Pro-Q 4](fabfilter-pro-q/DESIGN.md) (4 shots): The gold standard of a big interactive display as the whole interface
- [FabFilter Saturn 2](fabfilter-saturn/DESIGN.md) (3 shots): Distortion UI: bands, drive and modulation readable in one display
- [Soundtoys Decapitator](soundtoys-decapitator/DESIGN.md) (3 shots): Hardware-style saturation box: few big knobs, strong character
- [Baby Audio](baby-audio/DESIGN.md) (2 shots): Modern, playful, art-directed plugin faces
- [Valhalla VintageVerb](valhalla/DESIGN.md) (4 shots): Plain flat sliders that are completely clear: function first
- [Minimal Audio Current](minimal-audio-current/DESIGN.md) (3 shots): A new-generation synth with very clean, premium flat design
- [Output Arcade](output-arcade/DESIGN.md) (2 shots): Consumer-friendly, art-directed instrument; big imagery
- [Native Instruments Massive X](massive-x/DESIGN.md) (4 shots): Dense, dark, modular routing with a big tab structure
- [Spectrasonics Omnisphere](omnisphere/DESIGN.md) (4 shots): A deep cinematic synth with layered pages and hardware-like panels
- [Arturia Mini V](arturia-mini-v/DESIGN.md) (3 shots): A Minimoog recreation: wood, metal and real knobs on screen

## Hardware that feels expensive
Materials, real skeuomorphism, light on dark objects.

- [Moog One](moog-one/DESIGN.md) (2 shots): A flagship synth panel: modules, a central display, premium materials
- [Elektron Digitone II](elektron-digitone/DESIGN.md) (4 shots): Dark, industrial, tight grid of encoders around one screen
- [Buchla](buchla/DESIGN.md) (3 shots): Colour-coded modular panels: iconic, strange, precise
- [Make Noise 0-Coast](make-noise/DESIGN.md) (2 shots): Hand-drawn panel graphics and strong character
- [Eventide H90](eventide-h90/DESIGN.md) (3 shots): A pedal with a dense screen UI that stays readable
- [Elektron Syntakt](elektron-syntakt/DESIGN.md) (4 shots): Elektron's drum/synth machine: dark panel, coloured trig keys, one small screen
- [Polyend Tracker+](polyend-tracker/DESIGN.md) (4 shots): A screen-first instrument with bold, minimal graphics
- [Dirtywave M8](dirtywave-m8/DESIGN.md) (3 shots): A tiny tracker: dense pixel UI that people love
- [Erica Synths](erica-synths/DESIGN.md) (3 shots): Dark, industrial, Eastern-European hardware: close to LORN's mood
- [Ableton Push 3](ableton-push/DESIGN.md) (2 shots): Lit pads and a display bar: hardware glow as UI

## Dark, cinematic, LORN-fit
Mood: worn, dark, dangerous, cinematic.

- [Output Portal](output-portal/DESIGN.md) (2 shots): A granular effect with a dark, cinematic, animated face
- [Heavyocity Damage 2](heavyocity-damage/DESIGN.md) (4 shots): Industrial cinematic percussion: dark, gritty, worn UI
- [Native Instruments Straylight](ni-straylight/DESIGN.md) (4 shots): A cinematic pad instrument: dark, atmospheric, a big central display
- [Slate + Ash](slate-ash/DESIGN.md) (2 shots): Dark cinematic instruments with art-directed faces
- [Goodhertz](goodhertz/DESIGN.md) (4 shots): Tape wear, wobble and lo-fi plugins: worn, warm, typographic
- [Glitchmachines Hysteresis](glitchmachines/DESIGN.md) (2 shots): Glitchy, dark, sci-fi panels
- [Arturia Tape MELLO-FI](arturia-mello-fi/DESIGN.md) (2 shots): Tape wear and degradation made visible and physical
- [XLN Audio RC-20 Retro Color](xln-rc20/DESIGN.md) (3 shots): The wear/texture plugin: noise, wobble, distortion, space, as modules

## Pro software with dense, clear controls
How many controls stay calm on one page.

- [DaVinci Resolve](davinci-resolve/DESIGN.md) (4 shots): Dark, very dense pro UI where hundreds of controls stay calm
- [Ableton Live](ableton-live/DESIGN.md) (2 shots): Flat, functional music software: clarity over decoration
- [Bitwig Studio](bitwig/DESIGN.md) (2 shots): Modern DAW with modulators everywhere; very clear modulation display
- [Resolume](resolume/DESIGN.md) (2 shots): Live visuals software: dark, dense, performance-first
- [Pixelmator Pro](pixelmator-pro/DESIGN.md) (2 shots): An Apple-like pro editor: dark, calm, beautiful adjustment panels
- [Steinberg Cubase](cubase/DESIGN.md) (1 shots): A big DAW with dense mixers and channel strips
- [Linear](linear/DESIGN.md) (2 shots): Premium dark software: tight type, subtle depth, almost no colour
- [Capture One](capture-one/DESIGN.md) (1 shots): Pro photo editing: dark, dense tool panels and colour tools
- [Cycling '74 Max](max/DESIGN.md) (3 shots): Patchable audio software: dark, modular, technical
- [SideFX Houdini](houdini/DESIGN.md) (2 shots): Deep technical software with clear parameter panels

## By tag
- `dark` (25): hasselblad-phocus, apple-final-cut, serum-2, fabfilter-pro-q, minimal-audio-current, massive-x, omnisphere, elektron-digitone, eventide-h90, elektron-syntakt, erica-synths, output-portal, heavyocity-damage, ni-straylight, slate-ash, glitchmachines, davinci-resolve, bitwig, resolume, pixelmator-pro, cubase, linear, capture-one, max, houdini
- `synth` (25): te-op1, te-opxy, apple-logic-pro, te-op1-guide, te-opxy-guide, uhe-diva, uhe-zebra, uhe-repro, serum-2, surge-xt, phase-plant, pigments, arturia-v-collection, minimal-audio-current, output-arcade, massive-x, omnisphere, arturia-mini-v, moog-one, elektron-digitone, buchla, make-noise, elektron-syntakt, erica-synths, ni-straylight
- `hardware` (17): hasselblad-x2d, hasselblad-x2d-ii, te-op1, te-opxy, te-ep133, te-opz, te-tx6, moog-one, elektron-digitone, buchla, make-noise, eventide-h90, elektron-syntakt, polyend-tracker, dirtywave-m8, erica-synths, ableton-push
- `siren` (15): hasselblad-phocus, hasselblad-x2d, hasselblad-x2d-ii, te-op1, te-opxy, te-ep133, te-ep-sample-tool, te-opz, te-tx6, apple-logic-pro, te-op1-guide, apple-final-cut, te-opxy-guide, leica-fotos, pixelmator-pro
- `dense` (15): hasselblad-phocus, te-tx6, apple-logic-pro, apple-final-cut, uhe-zebra, surge-xt, massive-x, omnisphere, dirtywave-m8, davinci-resolve, ableton-live, resolume, cubase, capture-one, houdini
- `displays` (14): te-op1, te-opxy, te-op1-guide, te-opxy-guide, serum-2, pigments, fabfilter-pro-q, fabfilter-saturn, elektron-digitone, eventide-h90, elektron-syntakt, polyend-tracker, dirtywave-m8, ableton-push
- `plugin` (10): fabfilter-pro-q, fabfilter-saturn, soundtoys-decapitator, baby-audio, valhalla, output-portal, goodhertz, glitchmachines, arturia-mello-fi, xln-rc20
- `pro` (10): davinci-resolve, ableton-live, bitwig, resolume, pixelmator-pro, cubase, linear, capture-one, max, houdini
- `software` (9): hasselblad-phocus, te-ep-sample-tool, te-opz, apple-logic-pro, apple-final-cut, leica-fotos, davinci-resolve, pixelmator-pro, linear
- `lorn` (9): erica-synths, output-portal, heavyocity-damage, ni-straylight, slate-ash, goodhertz, glitchmachines, arturia-mello-fi, xln-rc20
- `modulation` (8): uhe-zebra, serum-2, surge-xt, phase-plant, pigments, minimal-audio-current, massive-x, bitwig
- `minimal` (7): hasselblad-x2d, hasselblad-x2d-ii, te-ep-sample-tool, leica-fotos, valhalla, polyend-tracker, linear
- `modules` (7): uhe-diva, uhe-zebra, phase-plant, moog-one, buchla, xln-rc20, max
- `skeuo` (6): uhe-diva, uhe-repro, arturia-v-collection, soundtoys-decapitator, arturia-mini-v, arturia-mello-fi
- `flat` (6): surge-xt, phase-plant, fabfilter-pro-q, valhalla, minimal-audio-current, ableton-live
- `materials` (5): te-tx6, uhe-repro, arturia-v-collection, arturia-mini-v, moog-one
- `music` (5): apple-logic-pro, ableton-live, bitwig, cubase, max
- `cinematic` (5): omnisphere, output-portal, heavyocity-damage, ni-straylight, slate-ash
- `art-directed` (4): baby-audio, output-arcade, make-noise, slate-ash
- `worn` (4): heavyocity-damage, goodhertz, arturia-mello-fi, xln-rc20
- `colour-coding` (3): te-opz, pigments, buchla
- `manual` (2): te-op1-guide, te-opxy-guide
- `distortion` (2): fabfilter-saturn, soundtoys-decapitator
- `tape` (2): goodhertz, arturia-mello-fi
- `sampler` (1): te-ep133
- `red-accent` (1): leica-fotos
- `lighting` (1): ableton-push
- `performance` (1): resolume
