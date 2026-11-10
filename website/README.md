# RUIN-1 website

The product site: plain HTML, CSS and a few lines of JS, no build step. Open `index.html` in a browser, or serve the
repository root and visit `/website/` (the page reads the shared design files from `../design/`).

## Connected to the synth

- **`../design/tokens.css`**: the brand's colours, fonts and glow, shared with the synth. Change the brand here.
- **`../design/logo.svg`**: the mark.
- **`assets/shots/osc.jpg`, `ruin.jpg`**: the product images, taken from the synth itself. After changing the
  synth's look, run `node tools/site-shots.mjs` from the repository root to retake them.

## Still to add

- **Photos**: each section has a photo slot (`data-photo` in `index.html`); drop the files in `assets/photos/`
  (`hero.jpg`, `panel.jpg`, `features.jpg`, `cta.jpg`) and they appear. Until then the solid colours show.
- **Demo video**: `assets/demo.mp4` (the player shows the RUIN screenshot as its poster until then).
- **Buy and social links**: the buttons point to `#buy` / `#` for now.

To deploy, upload `website/` and `design/` side by side (or the whole repository to a static host).
