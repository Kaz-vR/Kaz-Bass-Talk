// RUIN's starting recipes (owner's call): serial distortion done the way it works, warm first, harder in the
// middle, rounded off at the end, the sound shaped between the passes, the low end kept out, some dry blended
// back; ROLL with low weirdness lands near one of these (controlled random).
// Each recipe's Output is set so the chain plays about as loud as it does switched off (tools/level-ruin.ts).

export interface RuinStage {
  filter: 'notch' | 'peak' | 'band' | 'comb' | 'phaser' | null; // null = only the drive
  freq: number; // Hz
  width: number; // 0..1, the filter's width (narrow … wide)
  depth?: number; // 0..1, how deep the filter goes (absent = all the way)
  range: number; // octaves the filter swings
  move: 'wander' | 'note';
  rate: number; // 0..1 (0.3 ≈ 0.5 Hz, 0.5 ≈ 1.6 Hz, 0.6 ≈ 2.8 Hz)
  clock: 'hz' | 'random';
  type: string; // drive type
  drive: number; // 0..1 = 0 … +30 dB
  tone: number; // 0..1, 1 = open
  mix: number; // dry / wet
  band?: [number, number]; // the drive's band: centre Hz, width in octaves (absent = the whole sound)
}

export interface RuinRecipe {
  name: string;
  /** what it is, in a few words (the ROLL button's tooltip names the last one rolled) */
  idea: string;
  ott: number;
  lowcut: number; // Hz
  mix: number;
  output: number; // dB, levelled
  stages: (RuinStage | null)[]; // four, null = the stage off
}

const st = (s: Partial<RuinStage> & Pick<RuinStage, 'type' | 'drive'>): RuinStage => ({
  filter: null, freq: 900, width: 0.6, range: 1, move: 'wander', rate: 0.4, clock: 'random', tone: 1, mix: 1, ...s,
});

export const RUIN_RECIPES: RuinRecipe[] = [
  {
    name: 'WARM GRIT', idea: 'gentle thickening: tube into tape, a slow notch breathing between them',
    ott: 0.15, lowcut: 120, mix: 1, output: -4.5,
    stages: [
      st({ type: 'tube', drive: 0.3 }),
      st({ filter: 'notch', freq: 700, width: 0.55, range: 1.2, rate: 0.3, type: 'tape', drive: 0.25, tone: 0.75 }),
      null,
      null,
    ],
  },
  {
    name: 'SERIAL ROT', idea: 'the classic serial chain: warm, then bite, then metal, rounded off at the end',
    ott: 0.3, lowcut: 150, mix: 1, output: -8.4,
    stages: [
      st({ type: 'tube', drive: 0.3 }),
      st({ filter: 'peak', freq: 1000, width: 0.5, range: 0.3, rate: 0.25, type: 'hard clip', drive: 0.5 }),
      st({ filter: 'comb', freq: 420, width: 0.4, range: 1.4, rate: 0.35, type: 'wavefold', drive: 0.3, mix: 0.5 }),
      st({ type: 'soft clip', drive: 0.35, tone: 0.6 }),
    ],
  },
  {
    name: 'STARVED TUBE', idea: 'a dying valve: starved, sputtering on the tails, only the big swings get through',
    ott: 0, lowcut: 140, mix: 1, output: -6.1,
    stages: [
      st({ type: 'starved', drive: 0.45, tone: 0.7 }),
      st({ filter: 'notch', freq: 1300, width: 0.6, range: 1.5, rate: 0.28, type: 'tape', drive: 0.3, tone: 0.65 }),
      null,
      null,
    ],
  },
  {
    name: 'NEURO TALK', idea: 'mid-forward growl: a moving peak and band into the amp, evened out between stages',
    ott: 0.5, lowcut: 180, mix: 1, output: -5.6,
    stages: [
      st({ filter: 'peak', freq: 700, width: 0.3, range: 2.2, move: 'note', rate: 0.55, clock: 'hz', type: 'amp', drive: 0.55 }),
      st({ filter: 'band', freq: 1400, width: 0.5, range: 1.6, rate: 0.5, type: 'diode', drive: 0.45 }),
      st({ filter: 'notch', freq: 2400, width: 0.5, range: 1, rate: 0.6, type: 'hard clip', drive: 0.4 }),
      st({ type: 'soft clip', drive: 0.3, tone: 0.55 }),
    ],
  },
  {
    name: 'METAL COMB', idea: 'ringing metal: a resonant comb folded, clipped and squashed',
    ott: 0.4, lowcut: 160, mix: 0.85, output: -4.0,
    stages: [
      st({ filter: 'comb', freq: 300, width: 0.25, range: 1.8, rate: 0.3, type: 'wavefold', drive: 0.4 }),
      st({ filter: 'comb', freq: 610, width: 0.5, range: 1.2, rate: 0.42, type: 'hard clip', drive: 0.45 }),
      st({ type: 'tape', drive: 0.3, tone: 0.6 }),
      null,
    ],
  },
  {
    name: 'BROKEN SIGNAL', idea: 'digital decay: rectified, sample-starved, crackling through a slow phaser',
    ott: 0.2, lowcut: 200, mix: 0.8, output: 2.7,
    stages: [
      st({ filter: 'phaser', freq: 900, width: 0.5, range: 1.5, rate: 0.25, type: 'rectify', drive: 0.35, mix: 0.6 }),
      st({ type: 'downsample', drive: 0.3, mix: 0.5 }),
      st({ filter: 'notch', freq: 1800, width: 0.6, range: 1.2, rate: 0.3, type: 'starved', drive: 0.3, tone: 0.6 }),
      null,
    ],
  },
  {
    name: 'DARK FUZZ', idea: 'thick and dark: an amp and a diode with the top rolled off, a phaser slowly turning',
    ott: 0.25, lowcut: 130, mix: 1, output: -5.5,
    stages: [
      st({ filter: 'phaser', freq: 600, width: 0.45, range: 1.6, rate: 0.22, type: 'amp', drive: 0.5, tone: 0.55 }),
      st({ type: 'diode', drive: 0.4, tone: 0.45 }),
      null,
      null,
    ],
  },
  {
    name: 'REESE SNARL', idea: "a Reese chewed up: phaser and notch moving under tube and clip, Destroyed Reese's kind",
    ott: 0.4, lowcut: 150, mix: 1, output: -9.9,
    stages: [
      st({ filter: 'notch', freq: 900, width: 0.4, range: 2.4, rate: 0.6, type: 'tape', drive: 0.45 }),
      st({ filter: 'peak', freq: 1500, width: 0.45, range: 1.8, rate: 0.5, type: 'tube', drive: 0.4 }),
      st({ filter: 'phaser', freq: 700, width: 0.4, range: 1.5, rate: 0.35, type: 'amp', drive: 0.35 }),
      st({ filter: 'peak', freq: 2200, width: 0.6, range: 1, rate: 0.45, type: 'soft clip', drive: 0.3, tone: 0.65, mix: 0.75 }),
    ],
  },
];

/** The drive types in the menu's columns (a tame roll swaps within one, a wild one across). */
export const DRIVE_FAMILIES: string[][] = [['tape', 'tube', 'starved', 'amp'], ['soft clip', 'hard clip', 'diode'], ['wavefold', 'rectify'], ['downsample']];

/** A recipe as patch values (the strip and all four stages; a stage that is null is switched off). */
export function recipeParams(r: RuinRecipe): Record<string, number | string | boolean> {
  const out: Record<string, number | string | boolean> = {
    'grind.on': true, 'grind.ott': r.ott, 'grind.lowcut': r.lowcut, 'grind.mix': r.mix, 'grind.output': r.output,
  };
  // stages 1-8: the recipe's stages, the rest off
  for (let i = 0; i < 8; i++) {
    const s = r.stages[i], p = `grind${i + 1}`;
    out[`${p}.on`] = !!s;
    if (s) Object.assign(out, stageParams(p, s));
  }
  return out;
}

/** One stage as patch values. */
export function stageParams(p: string, s: RuinStage): Record<string, number | string | boolean> {
  return {
    [`${p}.on`]: true, [`${p}.filter_on`]: !!s.filter, [`${p}.filter`]: s.filter ?? 'notch', [`${p}.freq`]: s.freq, [`${p}.width`]: s.width, [`${p}.depth`]: s.depth ?? 1,
    [`${p}.range`]: s.range, [`${p}.move`]: s.move, [`${p}.rate`]: s.rate, [`${p}.clock`]: s.clock,
    [`${p}.drive_on`]: true, [`${p}.drive_type`]: s.type, [`${p}.drive`]: s.drive, [`${p}.drive_tone`]: s.tone, [`${p}.mix`]: s.mix,
    [`${p}.drive_freq`]: s.band ? s.band[0] : 1000, [`${p}.drive_width`]: s.band ? s.band[1] : 9, [`${p}.filter_level`]: 0, [`${p}.drive_level`]: 0, [`${p}.eq_on`]: false, [`${p}.eq_level`]: 0,
  };
}
