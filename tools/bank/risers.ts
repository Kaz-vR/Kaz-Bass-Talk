// DEV ONLY. Risers & falls: tension that builds or collapses over bars. The
// slow envelope (env 2, up to 30 s) drives pitch, filter, noise, space and
// width together; small independent motions ride on top.
import { kit, type CategoryDef, type Mod } from './common';

const base = {
  'voice.polyphony': 2,
  'osc1.wave': 'saw', 'osc1.unison_voices': 4, 'osc1.unison_detune': 16,
  'amp_env.attack': 300, 'amp_env.decay': 10000, 'amp_env.sustain': 1, 'amp_env.release': 2500,
  'env2.attack': 8000, 'env2.decay': 20000, 'env2.sustain': 1, 'env2.release': 2000,
  'filter.cutoff': 300, 'filter.keytrack': 0.3, 'filter.env_amount': 0,
  'drive.amount': 0.55, 'dist.drive': 0.3,
  'reverb.mix': 0.4, 'reverb.size': 0.92, 'delay.mix': 0.15, 'delay.time': '1/4D',
  'eq.highcut': 7000, 'lfo2.fade': 0, 'lfo4.rate': 0.4, 'chorus.mix': 0.1,
};

/** The build: one slow envelope moving everything at once, with independent motion on top. */
const RISE_KIT: Mod[] = [
  ['env2', 'pitch', 0.5],
  ['env2', 'filter_cutoff', 0.45],
  ['env2', 'noise_level', 0.3],
  ['env2', 'reverb_mix', 0.25],
  ['env2', 'width', 0.15],
  ['lfo1', 'filter_cutoff', 0.12],
  ['lfo2', 'amp', -0.18],
  ['drift', 'pitch', 0.0015],
  ['lfo3', 'tape_wow', 0.3],
  ['lfo4', 'unison_detune', 0.08],
  ['drift_slow', 'drive', 0.2],
  ['velocity', 'filter_cutoff', 0.15],
];

const def: CategoryDef = {
  category: 'risers',
  base,
  kit: RISE_KIT,
  presets: [
    {
      id: 'rising-dread', name: 'Rising Dread',
      description: 'Detuned saws climbing an octave over bars while the filter, noise and room all open up.',
      tags: ['riser', 'build', 'tension', 'pitch', 'noise', 'cinematic', 'lorn'],
      texture: ['air', 0.45, 0.35, 3000],
      set: {},
    },
    {
      id: 'collapse-fall', name: 'Collapse Fall',
      description: 'The opposite of a build: a bright wall that sinks, closes and collapses into the floor.',
      tags: ['fall', 'downer', 'collapse', 'pitch', 'closing', 'cinematic', 'lorn'],
      texture: ['rumble', 0.45, 0.3, 3000],
      set: { 'filter.cutoff': 1500 },
      mods: kit(RISE_KIT, [['env2', 'pitch', -0.75], ['env2', 'filter_cutoff', -0.4], ['env2', 'noise_level', 0.2]]),
    },
    {
      id: 'static-climb', name: 'Static Climb',
      description: 'A noise riser: static rushing up through a resonant filter, getting louder and closer.',
      tags: ['riser', 'noise', 'static', 'sweep', 'build', 'transition', 'lorn'],
      texture: ['dust', 0.5, 0.45, 2500],
      set: { 'osc1.level': 0.4, 'noise.level': 0.06, 'filter.cutoff': 200, 'filter.resonance': 0.45, 'dist.drive': 0.45, 'eq.highcut': 3000 },
      mods: kit(RISE_KIT, [['env2', 'filter_cutoff', 0.2], ['env2', 'noise_level', 0.3], ['env2', 'pitch', 0.25]]),
    },
    {
      id: 'siren-rise', name: 'Siren Rise',
      description: 'A rising siren whose vibrato grows wilder and wider the longer it climbs.',
      tags: ['riser', 'siren', 'vibrato', 'alarm', 'tension', 'build', 'lorn'],
      texture: ['air', 0.45, 0.4, 2500],
      set: { 'vibrato.depth': 30, 'vibrato.delay': 0, 'vibrato.fade': 3000, 'osc1.unison_voices': 2, 'osc1.unison_spread': 0.5, 'chorus.mix': 0 },
      mods: kit(RISE_KIT, [], { 'lfo4>unison_detune': ['env2', 'vibrato_depth', 0.6] }),
    },
    {
      id: 'tape-stop-fall', name: 'Tape Stop Fall',
      description: 'A sound running out of power: the tape slows, the pitch sags two octaves and the level dies.',
      tags: ['fall', 'tape-stop', 'pitch', 'dying', 'slowdown', 'transition', 'lorn'],
      texture: ['crackle', 0.45, 0.3, 2000],
      set: { 'env2.attack': 3000, 'filter.cutoff': 1200, 'tape.wow': 0.4 },
      mods: kit(RISE_KIT, [['env2', 'pitch', -1], ['env2', 'filter_cutoff', -0.3]], { 'env2>noise_level': ['env2', 'amp', -0.6] }),
    },
    {
      id: 'pressure', name: 'Pressure',
      description: 'No pitch change, only pressure: the filter, saturation, space and width swelling until it hurts.',
      tags: ['riser', 'swell', 'pressure', 'filter', 'saturation', 'tension', 'lorn'],
      texture: ['rumble', 0.45, 0.35, 3000],
      set: { 'dist.drive': 0.25 },
      mods: kit(RISE_KIT, [], { 'env2>pitch': ['env2', 'drive', 0.4] }),
    },
    {
      id: 'sinking', name: 'Sinking',
      description: 'A slow descent: the pitch and the light drain away while a deep rumble rises underneath.',
      tags: ['fall', 'sinking', 'slow', 'descent', 'rumble', 'dark', 'lorn'],
      texture: ['rumble', 0.4, 0.3, 3000],
      set: { 'filter.cutoff': 900 },
      mods: kit(RISE_KIT, [['env2', 'pitch', -0.25], ['env2', 'filter_cutoff', -0.3]], { 'env2>noise_level': ['env2', 'texture_level', 0.4] }),
    },
    {
      id: 'engine-windup', name: 'Engine Wind-Up',
      description: 'A metallic machine spinning up: a comb resonance climbing with the pitch.',
      tags: ['riser', 'machine', 'comb', 'metallic', 'spin-up', 'industrial', 'lorn'],
      texture: ['rumble', 0.45, 0.4, 2500],
      set: { 'filter.type': 'comb', 'filter.cutoff': 120, 'filter.resonance': 0.45, 'filter.keytrack': 0 },
      mods: kit(RISE_KIT, [['env2', 'filter_cutoff', 0.6], ['env2', 'pitch', 0.25]]),
    },
    {
      id: 'breathless', name: 'Breathless',
      description: 'A rising breath: air rushing in faster and faster around a faint tone.',
      tags: ['riser', 'breath', 'air', 'gasp', 'tension', 'organic', 'lorn'],
      texture: ['air', 0.5, 0.4, 2500],
      set: { 'osc1.level': 0.4, 'breath.level': 0.1, 'breath.tone': 0.5, 'filter.cutoff': 600 },
      mods: kit(RISE_KIT, [], { 'env2>noise_level': ['env2', 'breath_level', 0.6] }),
      allow: { 'consistency:brightOct': { why: 'a noise-based sound: its brightness comes from noise, which has no note to be dark against' } },
    },
    {
      id: 'ascension', name: 'Ascension',
      description: 'Octave-stacked saws rising two octaves into a huge, bright-dark space.',
      tags: ['riser', 'octave', 'huge', 'build', 'epic', 'cinematic', 'lorn'],
      texture: ['air', 0.45, 0.35, 3000],
      set: { 'osc2.wave': 'saw', 'osc2.semi': 12, 'osc2.level': 0.3, 'chorus.mix': 0.3, 'chorus.mode': 'ensemble', 'reverb.mix': 0.5 },
      mods: kit(RISE_KIT, [['env2', 'pitch', 1]]),
      allow: { 'consistency:brightOct': { why: 'a noise-based sound: its brightness comes from noise, which has no note to be dark against' } },
    },
    // ------------------------------------------------ filling the gaps
    {
      id: 'signal-sweep', name: 'Signal Sweep',
      description: 'A wavetable riser morphing as it climbs, its filter ticking in sixteenths through a phaser and a flanger.',
      tags: ['riser', 'wavetable', 'morph', 'synced', 'phaser', 'flanger', 'lorn'],
      texture: ['air', 0.45, 0.35, 2500],
      set: {
        'osc1.wave': 'wavetable', 'osc1.wt_pos': 0.2, 'lfo2.sync': '1/16', 'lfo2.shape': 'triangle', 'phaser.mix': 0.25, 'phaser.rate': 0.3,
        'flanger.mix': 0.2, 'flanger.rate': 0.15,
      },
      mods: kit(RISE_KIT, [], { 'lfo4>unison_detune': ['env2', 'osc1_wt_pos', 0.5], 'lfo2>amp': ['lfo2', 'filter_cutoff', 0.1] }),
    },
    {
      id: 'broken-ascent', name: 'Broken Ascent',
      description: 'A crushed, metallic pulse riser climbing through a narrow band, as if a broken machine were straining upward.',
      tags: ['riser', 'pulse', 'fm', 'bandpass', 'crushed', 'machine', 'lorn'],
      texture: ['rumble', 0.45, 0.35, 2500],
      set: {
        // The band sits on the note itself (a band-pass above the fundamental reads far too bright) and climbs from there.
        'osc1.wave': 'pulse', 'osc1.pulse_width': 0.3, 'fm.amount': 0.15, 'fm.ratio': 2.76, 'filter.type': 'bandpass', 'filter.cutoff': 110,
        'filter.resonance': 0.35, 'filter.keytrack': 1, 'crush.mix': 0.2, 'crush.bits': 7, 'crush.rate': 5, 'eq.highcut': 5000,
      },
      allow: { 'consistency:brightOct': { why: 'its bright metal/noise top is the identity; the soft Iconic II sounds narrowed the bank spread' } },
    },
    // ------------------------------------------------ producer range: the roles this category was missing
    {
      id: 'noise-assault', name: 'Noise Assault',
      description: "A riser of pure aggression: noise and saws clipping harder and harder until the drop.",
      tags: ['risers', 'harsh', 'noise', 'distorted', 'aggressive', 'build', 'lorn', 'new'],
      texture: ['crackle', 0.55, 0.4, 2000],
      set: { 'noise.level': 0.5, 'drive.amount': 0.8, 'dist.type': 'hard', 'dist.drive': 0.5, 'dist.mix': 0.7, 'crush.mix': 0.2, 'crush.bits': 7, 'crush.rate': 6 },
    },
    {
      id: 'engine-scream', name: 'Engine Scream',
      description: "A folded pulse screaming upward like an engine past its limit.",
      tags: ['risers', 'scream', 'fold', 'pulse', 'aggressive', 'build', 'lorn', 'new'],
      texture: ['dust', 0.5, 0.4, 2000],
      set: { 'osc1.wave': 'pulse', 'osc1.pulse_width': 0.3, 'dist.type': 'fold', 'dist.drive': 0.45, 'dist.mix': 0.6, 'osc1.unison_spread': 0.45, 'chorus.mix': 0.08, 'dist.post_tone': 0.25, 'eq.highcut': 4500 },
      mods: kit(RISE_KIT, [['env2', 'pitch', 0.7]]),
    },
    {
      id: 'drop-fall', name: 'Drop Fall',
      description: "A fall that starts with a hit: a hard impact, then everything sinks away into the dark.",
      tags: ['risers', 'fall', 'impact', 'hard-start', 'downlifter', 'dark', 'lorn', 'new'],
      texture: ['crackle', 0.5, 0.35, 2000],
      set: { 'amp_env.attack': 2, 'env2.attack': 4000, 'click.type': 'kick', 'click.level': 0, 'filter.cutoff': 1500 },
      mods: kit(RISE_KIT, [['env2', 'pitch', -1], ['env2', 'filter_cutoff', -0.4], ['lfo1', 'filter_cutoff', 0.4], ['drift_slow', 'drive', 0.35]], { 'env2>noise_level': ['env2', 'amp', -0.5] }),
    },
    {
      id: 'glass-rise', name: 'Glass Rise',
      description: "A glassy FM tone climbing and brightening as its bell partials open up.",
      tags: ['risers', 'fm', 'glassy', 'bright', 'build', 'shimmer', 'lorn', 'new'],
      texture: ['air', 0.5, 0.35, 2000],
      set: { 'osc1.wave': 'sine', 'osc1.unison_voices': 1, 'fm.amount': 0.1, 'fm.ratio': 3.5, 'fm.punch': 0, 'filter.cutoff': 1200 },
      mods: kit(RISE_KIT, [], { 'env2>noise_level': ['env2', 'fm_amount', 0.3], 'lfo4>unison_detune': ['lfo4', 'fm_amount', 0.05], 'lfo1>filter_cutoff': ['lfo1', 'fm_amount', 0.1] }),
    },
  ],
};

export default def;
