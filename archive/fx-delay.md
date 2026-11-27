# Archived: the FX page's DELAY (owner's call, 27 Nov)

Taken out of the synth completely (both engines, the schema, the page) to make room for the PITCH SHIFTER, kept here
so it can come back exactly as it was. Old presets that carry `delay.*` values load without them (unknown keys are
dropped). The matrix slots `delay_time` / `delay_mix` (D_DELAY_TIME, D_DELAY_MIX) stay only so the other destinations
keep their numbers, as FM's did.

To bring it back: put the parameters back into `data/schema.json` (below), their indices into `P` (params.ts:
`delayOn`, `delayMix`, `delayTime`, `delayFb`, `delayTone`; `fxLowcut[3]` = `delay.lowcut`) and `Params.h`, `DELAY_BEATS`
into both, the classes into `fx.ts` / `Fx.h`, the members, `reset()`, the `resolve` line
(`if (off(P.delayOn)) { zero(P.delayMix); block(K.D_DELAY_MIX, K.D_DELAY_TIME); }`), the `control` lines and the chain
block (below, after HYPER, before the reverb) into both engines, the box into `buildFxPage`, its dials as `p:` LFO
targets, then run `tools/gen-plugin-data.ts` and `tools/plugin-parity.ts`.

## Parameters (data/schema.json)

```json
[
  {
    "id": "delay.on",
    "label": "Delay on",
    "type": "bool",
    "default": true,
    "group": "fx",
    "describes": "Switches Delay on or off without losing its settings. Off also saves CPU."
  },
  {
    "id": "delay.mix",
    "label": "Delay mix",
    "type": "float",
    "min": 0,
    "max": 1,
    "default": 0,
    "curve": "linear",
    "unit": "",
    "group": "fx",
    "describes": "Tempo-synced ping-pong echoes on the upper range (the low end stays dry). Adds space, rhythm and width."
  },
  {
    "id": "delay.time",
    "label": "Delay time",
    "type": "enum",
    "options": [
      "1/32",
      "1/16T",
      "1/16",
      "1/16D",
      "1/8T",
      "1/8",
      "1/8D",
      "1/4T",
      "1/4",
      "1/4D",
      "1/2",
      "1/2D",
      "1/1"
    ],
    "default": "1/8D",
    "group": "fx",
    "describes": "Echo spacing as a note length. 1/8D (dotted eighth) is the classic rhythmic delay."
  },
  {
    "id": "delay.feedback",
    "label": "Delay feedback",
    "type": "float",
    "min": 0,
    "max": 0.9,
    "default": 0.35,
    "curve": "linear",
    "unit": "",
    "group": "fx",
    "describes": "How many repeats. Above 0.7 the echoes trail on for a long time."
  },
  {
    "id": "delay.tone",
    "label": "Delay tone",
    "type": "float",
    "min": 0,
    "max": 1,
    "default": 0.5,
    "curve": "linear",
    "unit": "",
    "group": "fx",
    "describes": "Brightness of the repeats. Low is dark, dubby and distant; high is bright and present."
  },
  {
    "id": "delay.lowcut",
    "label": "Delay low cut",
    "type": "float",
    "min": 20,
    "max": 1000,
    "default": 250,
    "curve": "log",
    "unit": "Hz",
    "group": "fx",
    "describes": "Delay only works on what is above this frequency, so the low end stays clean, centred and dry."
  }
]
```

`DELAY_BEATS = [0.125, 1 / 6, 0.25, 0.375, 1 / 3, 0.5, 0.75, 2 / 3, 1, 1.5, 2, 3, 4]` (beats per `delay.time` option).

## Control (synth.ts `control`, Synth.h the same)

```ts
    // Delay. Modulating the delay time glides the read head (tape-style pitch smear on the repeats).
    this.delaySeconds = Math.min(3, ((K.DELAY_BEATS[cur[P.delayTime]] * 60) / this.tempo) * Math.pow(2, clamp(dst[K.D_DELAY_TIME], -1, 1)));
    this.delayToneCoef = 1 - Math.exp((-TWO_PI * Math.min(800 * Math.pow(20, cur[P.delayTone]), fs * 0.45)) / fs);
    this.delayMix = clamp(cur[P.delayMix] + dst[K.D_DELAY_MIX], 0, 1);
```

## The chain (synth.ts, after HYPER, before the reverb; Synth.h the same)

```ts
      const dMix = this.delayMix;
      if (dMix > 1e-4) {
        this.delay.process(hpL[3].process(l), hpR[3].process(r), this.delaySeconds, cur[P.delayFb], this.delayToneCoef, out);
        l += out[0] * dMix;
        r += out[1] * dMix;
      }
```

## The class (src/engine/core/fx.ts)

```ts
/** Tempo-synced stereo ping-pong delay with a darkening, mud-free feedback path. */
export class Delay {
  private bufL: Float32Array;
  private bufR: Float32Array;
  private mask: number;
  private w = 0;
  private time = -1; // smoothed delay in samples
  private lpL = 0;
  private lpR = 0;
  private hpL = 0;
  private hpR = 0;
  private readonly hpCoef: number;

  constructor(private fs: number) {
    const size = pow2Size(Math.ceil(3.1 * fs));
    this.bufL = new Float32Array(size);
    this.bufR = new Float32Array(size);
    this.mask = size - 1;
    this.hpCoef = 1 - Math.exp((-TWO_PI * 150) / fs);
  }

  reset(): void {
    this.bufL.fill(0);
    this.bufR.fill(0);
    this.lpL = this.lpR = this.hpL = this.hpR = 0;
  }

  /** `toneCoef` is a one-pole LP coefficient for the feedback path. Returns wet only. */
  process(l: number, r: number, seconds: number, feedback: number, toneCoef: number, out: Float64Array): void {
    const target = Math.min(seconds * this.fs, this.mask - 2);
    // Glide towards a new time (tape-style) instead of jumping (no clicks).
    this.time = this.time < 0 ? target : this.time + (target - this.time) * 0.0005;
    const yl = readFrac(this.bufL, this.mask, this.w, this.time);
    const yr = readFrac(this.bufR, this.mask, this.w, this.time);
    // Feedback filtering: low-pass for darkness, high-pass so repeats never build mud.
    this.lpL += (yl - this.lpL) * toneCoef;
    this.lpR += (yr - this.lpR) * toneCoef;
    this.hpL += (this.lpL - this.hpL) * this.hpCoef;
    this.hpR += (this.lpR - this.hpR) * this.hpCoef;
    const fl = this.lpL - this.hpL;
    const fr = this.lpR - this.hpR;
    // Ping-pong: the mono input enters on the left, repeats cross over.
    this.bufL[this.w] = 0.5 * (l + r) + feedback * fr;
    this.bufR[this.w] = feedback * fl;
    this.w = (this.w + 1) & this.mask;
    out[0] = yl;
    out[1] = yr;
  }
}
```

## The class (plugin/engine/Fx.h)

```cpp
class Delay {
 public:
  explicit Delay(double fs_) : fs(fs_) {
    const int size = pow2Size(std::ceil(3.1 * fs));
    bufL.assign(size, 0.f);
    bufR.assign(size, 0.f);
    mask = size - 1;
    hpCoef = 1 - std::exp((-TWO_PI * 150) / fs);
  }
  void reset() {
    std::fill(bufL.begin(), bufL.end(), 0.f);
    std::fill(bufR.begin(), bufR.end(), 0.f);
    lpL = lpR = hpL = hpR = 0;
  }
  void process(double l, double r, double seconds, double feedback, double toneCoef, double* out) {
    const double target = std::fmin(seconds * fs, mask - 2);
    time = time < 0 ? target : time + (target - time) * 0.0005;
    const double yl = readFrac(bufL, mask, w, time);
    const double yr = readFrac(bufR, mask, w, time);
    lpL += (yl - lpL) * toneCoef;
    lpR += (yr - lpR) * toneCoef;
    hpL += (lpL - hpL) * hpCoef;
    hpR += (lpR - hpR) * hpCoef;
    const double fl = lpL - hpL, fr = lpR - hpR;
    bufL[w] = (float)(0.5 * (l + r) + feedback * fr);
    bufR[w] = (float)(feedback * fl);
    w = (w + 1) & mask;
    out[0] = yl;
    out[1] = yr;
  }
 private:
  double fs;
  std::vector<float> bufL, bufR;
  int mask = 0, w = 0;
  double time = -1, lpL = 0, lpR = 0, hpL = 0, hpR = 0, hpCoef = 0;
};
```

## The box (src/ui/synth-view.ts, buildFxPage; it sat between hyper and reverb in the page's list)

```ts
    // DELAY (owner's call, 26 Nov: back, as it was): the time in its title, the repeats as spikes
    const delay = this.obox('DELAY', 'fx-box box-delay', {
      power: (el) => this.boolPower('delay.on', el),
      head: [this.selector('delay.time', { label: (o) => o })],
      print: this.fxSpikes(['delay.time', 'delay.feedback', 'delay.mix', 'delay.on', 'delay.tone'], lit('delay.on', 'delay.mix'), () => {
        const step = syncBeats(String(this.get('delay.time'))) / 4, fb = this.num('delay.feedback');
        const out: [number, number][] = [[0, 1]];
        const keep = Math.max(0.05, fb) * (0.55 + 0.45 * this.num('delay.tone'));
        for (let i = 1, a = 0.9 * Math.max(0.05, this.num('delay.mix') * 1.4); i < 32 && i * step < 1; i++, a *= keep) out.push([i * step, Math.min(1, a)]);
        return out;
      }, 'delay.lowcut'),
      dials: [lg('delay.mix', 'Mix'), lg('delay.feedback', 'Feedbk'), lg('delay.tone', 'Tone'), lowCut('delay')],
    });
```

## Its CSS (src/ui/style.css)

```css
.v2 .box-delay { --knob-accent: var(--c-phaser); }
```
