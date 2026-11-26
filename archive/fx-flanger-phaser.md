# Archived: the FX page's FLANGER and PHASER (owner's call, 26 Nov)

Taken off the FX page and out of the signal path ("not relevant enough"), kept here so they can come back exactly
as they were, like the delay was. **RUIN's phaser parts are a different thing and stay in RUIN.**

What is still in the code (unused, nothing of it is heard):
- the effect classes: `Flanger`, `Phaser` in `src/engine/core/fx.ts` and `plugin/engine/Fx.h`;
- their parameters in `data/schema.json` (`flanger.on/mix/rate/feedback/lowcut`, `phaser.on/mix/rate/lowcut`), so old
  presets load; `fxLowcut[1]` / `[2]` still point at their Lo cuts; the matrix's `phaser_mix` destination (D_PHASER_MIX).

To bring one back: put its box back into `buildFxPage` (below) and into the page's box list, put its block back into
the effects chain of both engines (below, between chorus and the rest), put back the `off(P.flangerOn)` /
`off(P.phaserOn)` lines in `resolve` and `phaserMix` in `control` (both engines), the `Flanger` / `Phaser` members and
their `reset()` calls, add their dials back as `p:` LFO targets, and run `tools/plugin-parity.ts`.

## The boxes (src/ui/synth-view.ts, buildFxPage)

```ts
    // Flanger and phaser, each its own box.
    const flanger = this.obox('FLANGER', 'fx-box box-mfx', {
      power: (el) => this.boolPower('flanger.on', el),
      print: this.fxLine(['flanger.on', 'flanger.mix', 'flanger.feedback', 'flanger.rate', 'flanger.lowcut'], lit('flanger.on', 'flanger.mix'), (x) => {
        // Feedback sharpens the teeth, rate sweeps their spacing across the print, mix their depth.
        const fb = this.num('flanger.feedback'), r = this.num('flanger.rate'), m = Math.min(1, 0.25 + this.num('flanger.mix'));
        const c = Math.abs(Math.cos(Math.PI * (x * 7 + 0.35 * r * Math.sin(2 * Math.PI * x))));
        return 0.8 - 1.6 * m * Math.pow(1 - c, 1 + 6 * fb);
      }, false, { lowcut: 'flanger.lowcut' }),
      dials: [lg('flanger.mix', 'Mix'), lg('flanger.rate', 'Rate'), lg('flanger.feedback', 'Feedbk'), lowCut('flanger')],
    });
    const phaser = this.obox('PHASER', 'fx-box box-phaser', {
      power: (el) => this.boolPower('phaser.on', el),
      print: this.fxLine(['phaser.on', 'phaser.mix', 'phaser.rate', 'phaser.lowcut'], lit('phaser.on', 'phaser.mix'), (x) => {
        // The notches drift further apart as the rate goes up; mix sets how deep they go.
        const m = this.num('phaser.mix'), sp = 0.06 * Math.log2(1 + this.num('phaser.rate'));
        const notch = (c: number) => Math.exp(-(((x - c) / 0.05) ** 2));
        return 0.75 - 1.6 * m * (notch(0.42 - sp) + notch(0.55 + sp * 0.3) + 0.6 * notch(0.7 + sp));
      }, false, { lowcut: 'phaser.lowcut' }),
      dials: [lg('phaser.mix', 'Mix'), lg('phaser.rate', 'Rate'), lowCut('phaser')],
    });

```

## The chain (src/engine/core/synth.ts, after the chorus)

```ts
      const fMix = cur[P.flangerMix];
      if (fMix > 1e-4) {
        const hl = hpL[1].process(l), hr = hpR[1].process(r);
        this.flanger.process(hl, hr, fMix, cur[P.flangerRate], cur[P.flangerFb], out);
        l += out[0] - hl;
        r += out[1] - hr;
      }
      const pMix = this.phaserMix;
      if (pMix > 1e-4) {
        const hl = hpL[2].process(l), hr = hpR[2].process(r);
        this.phaser.process(hl, hr, pMix, cur[P.phaserRate], out);
        l += out[0] - hl;
        r += out[1] - hr;
      }
```

## The chain (plugin/engine/Synth.h, after the chorus)

```cpp
      const double fMix = cur[P.flangerMix];
      if (fMix > 1e-4) {
        const double hl = hpL[1].process(l), hr = hpR[1].process(r);
        flanger.process(hl, hr, fMix, cur[P.flangerRate], cur[P.flangerFb], out);
        l += out[0] - hl;
        r += out[1] - hr;
      }
      const double pMix = phaserMix;
      if (pMix > 1e-4) {
        const double hl = hpL[2].process(l), hr = hpR[2].process(r);
        phaser.process(hl, hr, pMix, cur[P.phaserRate], out);
        l += out[0] - hl;
        r += out[1] - hr;
      }
```

Resolve / control lines (both engines):

```ts
if (off(P.flangerOn)) zero(P.flangerMix);
if (off(P.phaserOn)) { zero(P.phaserMix); block(K.D_PHASER_MIX); }
this.phaserMix = clamp(cur[P.phaserMix] + dst[K.D_PHASER_MIX], 0, 1);
```
