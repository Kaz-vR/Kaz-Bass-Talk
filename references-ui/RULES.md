# RUIN-1 synth UI: the rulebook

What the best interfaces in this library share, written as rules for RUIN-1. Every synth UI pitch is checked against
these, and names the references it uses. The website's look is in `website/DESIGN.md` (Siren: pure black, red-orange
alarm light, square buttons, no lines); the synth has to belong to the same family, while working like a
top-tier instrument.

## A. Layout

1. **A display above each module's controls, mapped one to one.** The display shows what that module is doing, and
   the controls under it are in the same order as what they change on it. *(Serum 2, Zebra, Elektron Syntakt / Digitone,
   Ableton Push 3, RC-20.)*
2. **One grid, one knob, one header style for every module.** Density looks premium only on a strict grid.
   Hundreds of controls stay calm when everything aligns. *(DaVinci Resolve, TE TX-6, Massive X, Diva.)*
3. **Size shows importance.** The control a module is about (cutoff, decay, drive) is bigger than its neighbours;
   no module needs more than one hero control. *(Valhalla, Decapitator, Saturn 2, Damage 2's "punish" knob.)*
4. **The biggest display gets the most room**, and the controls form a calm strip or column around it.
   *(FabFilter Pro-Q, Final Cut, Output Portal, Minimal Audio Current.)*
5. **Space separates, not boxes or lines.** Use gaps and a small header to group; boxes only when they carry material
   (a lit panel, a screen bezel). *(Hasselblad, Linear, Slate + Ash, Glitchmachines.)*

## B. Controls

6. **The value is readable without touching it.** A value arc or lit ticks round every knob, and the number
   under it. *(Serum 2, Pigments, Massive X, Bitwig.)*
7. **Show modulation on the target**, as a second, moving arc on the knob it changes, not only at the source.
   *(Bitwig, Serum 2, Phase Plant's visible connections.)*
8. **Colour by role, used the same way everywhere.** One colour per module family, the same on its display, its
   arcs and its labels. Keep it to the Siren palette and its neon extras. *(TE OP-1 / OP-Z, Buchla, Pigments, RC-20.)*

## C. Displays

9. **Displays are alive, not illustrations.** They move with the sound (scope, envelope playhead, LFO dot, filter
   curve under modulation). *(Pigments, Serum 2, Output Portal, Pro-Q.)*
10. **A display explains with three or four shapes.** One trace with a glow, a fill under it, a few points;
    never a busy chart. *(TE OP-1 / OP-XY guides, Elektron's big pixel pages, Hasselblad's camera screen.)*

## D. Material and light (skeuomorphism done right)

11. **Real materials, lit from one direction.** If the UI is physical, every part shares one light: the siren from
    the top right. Knobs cast shadows the same way, glass catches the same reflection. Mixed lighting looks fake.
    *(Repro, Mini V, TE OP-XY's raking light, Moog, Erica Synths.)*
12. **Wear goes under clean controls.** Rust, grain or burnt metal sit in the panel and at its edges; knobs, type
    and displays on top stay crisp and readable. *(Heavyocity Damage 2, the most LORN-like UI here; RC-20; MELLO-FI.)*
13. **A modern shell can frame a physical face.** Header, browser and tabs flat and quiet; the instrument face can
    be skeuomorphic. *(Arturia V Collection, Mini V, Logic Pro.)*

## E. The Siren family (how it belongs with the website)

14. **Black, then one light.** The shell is near-black; red-orange marks only what is active or most important,
    used once per area, like Leica's red or Eventide's one red knob. *(Leica FOTOS, Hasselblad, Eventide H90,
    Erica Synths.)*
15. **Precise small type, generous black.** Small uppercase labels in muted grey, values in bright white, very
    little else. *(Hasselblad, Linear, Logic, Resolve.)*

## What to avoid (seen in the weaker references)
- Everything on one flat page with no hierarchy (Surge XT): more boxes don't fix density; size and space do.
- Hidden depth behind many tabs (Massive X): keep the module, its display and its controls on screen together.
- Photoreal panels with no displays (Diva): beautiful, but you can't see what the sound is doing. We keep displays.
- A different palette per page or per product (Baby Audio, Goodhertz): RUIN-1 keeps one palette across all pages.
- Free-floating layouts (Max): everything snaps to the grid.

## How this applies to the current pitches
The six main-page redesigns and the 1A / 1B skeuomorphic takes followed rules 1, 5 and 8, but not 3 (no hero control
per module), 6 (values were text-only on some), 7 (no modulation on targets) or 9 (static displays), and their
materials (rule 11) were invented rather than taken from references. The next round starts from these rules.
