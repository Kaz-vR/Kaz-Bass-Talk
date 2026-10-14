// DEV ONLY. Bass (bank collection): the short, punchy and sequenced basses the
// Terror basses (tools/build-terror.ts, all long and sustained) don't cover,
// including LORN versions of iconic synthwave / cyberpunk / Stranger Things
// basses. The iconic ones keep their identity (data/coverage.json); the LORN
// sauce (tape, dust, dark space, pump, small drift) goes around it.
import { kit, type CategoryDef, type Mod } from './common';

const base = {
  'voice.polyphony': 1, 'voice.legato': false, 'voice.velocity': 0.6,
  'osc1.wave': 'saw', 'osc1.unison_voices': 3, 'osc1.unison_detune': 12, 'osc1.unison_spread': 0.85, 'osc1.level': 0.65,
  'osc2.wave': 'saw', 'osc2.semi': -12, 'osc2.fine': -5, 'osc2.level': 0.3,
  'sub.level': 0.5, 'sub.wave': 'sine', 'sub.octave': -1,
  'drive.amount': 0.55,
  'filter.type': 'lowpass', 'filter.cutoff': 380, 'filter.resonance': 0.25, 'filter.keytrack': 0.5, 'filter.env_amount': 0.4,
  'mod_env.attack': 2, 'mod_env.decay': 220, 'mod_env.sustain': 0.1, 'mod_env.release': 150,
  'amp_env.attack': 2, 'amp_env.decay': 400, 'amp_env.sustain': 0.7, 'amp_env.release': 130,
  'dist.type': 'tube', 'dist.drive': 0.3, 'dist.mix': 0.6, 'dist.clean_below': 110, 'dist.post_tone': 0.35,
  'tape.drive': 0.45, 'tape.wow': 0.15, 'tape.age': 0.45,
  'comp.amount': 0.5, 'comp.pump': 0.2, 'ott.amount': 0.2,
  // Wide and wet above the low cut, like the rest of the bank; the sub stays mono and dry.
  'chorus.mix': 0.28, 'chorus.depth': 0.45, 'chorus.mode': 'classic',
  'delay.mix': 0.16, 'delay.time': '1/8D', 'delay.feedback': 0.45, 'delay.tone': 0.25,
  'reverb.mix': 0.3, 'reverb.size': 0.85, 'reverb.tone': 0.8,
  'fx.lowcut': 250, 'eq.mid_freq': 320, 'eq.mid_gain': -2, 'eq.high_gain': -2, 'eq.highcut': 5000,
  'lfo1.rate': 0.27, 'lfo2.rate': 2.3, 'lfo3.rate': 0.17, 'lfo4.rate': 0.5,
};

/** Short basses live on per-note variation and slow drift more than on long sweeps. */
const BASS_KIT: Mod[] = [
  ['lfo1', 'filter_cutoff', 0.1],
  ['random', 'filter_cutoff', 0.08],
  ['velocity', 'filter_cutoff', 0.15],
  ['drift_slow', 'drive', 0.15],
  ['drift', 'pitch', 0.0012],
  ['lfo4', 'width', 0.3],
  ['lfo3', 'tape_wow', 0.3],
  ['drift_slow', 'reverb_mix', 0.2],
  ['lfo1', 'delay_time', 0.04],
  ['lfo4', 'chorus_depth', 0.25],
  ['random', 'drive', 0.1],
  ['env2', 'filter_cutoff', 0.08],
];

const def: CategoryDef = {
  category: 'bass',
  base,
  kit: BASS_KIT,
  presets: [
    {
      id: 'neon-octave', name: 'Neon Octave', iconic: true, audition: 'funk-octaves',
      description: 'The driving octave bass of night-drive synthwave: every note a short, snappy bop, worn on tape.',
      tags: ['bass', 'octave', 'synthwave', 'driving', 'snappy', 'sequenced', 'lorn'],
      texture: ['dust', 0.3, 0.35, 400],
      set: { 'filter.cutoff': 330, 'filter.env_amount': 0.45, 'mod_env.decay': 180, 'filter.resonance': 0.3, 'amp_env.decay': 300, 'amp_env.sustain': 0.6, 'amp_env.release': 110 },
    },
    {
      id: 'chrome-teeth', name: 'Chrome Teeth', iconic: true, audition: 'groove',
      description: 'An aggressive, hard-clipped saw bass that snarls and pumps: dark synthwave at full throttle.',
      tags: ['bass', 'distorted', 'aggressive', 'darksynth', 'saw', 'pumping', 'lorn'],
      texture: ['crackle', 0.3, 0.4, 500],
      set: {
        'osc1.unison_voices': 3, 'osc1.unison_detune': 18, 'osc1.unison_spread': 0.6, 'dist.type': 'hard', 'dist.drive': 0.45, 'dist.mix': 0.7,
        'dist.clean_below': 120, 'filter.cutoff': 600, 'filter.env_amount': 0.35, 'mod_env.decay': 260, 'amp_env.sustain': 0.85, 'comp.pump': 0.45,
      },
      mods: kit(BASS_KIT, [], { 'lfo3>tape_wow': ['lfo3', 'unison_detune', 0.06] }),
    },
    {
      id: 'rebar', name: 'Rebar', iconic: true, audition: 'groove',
      description: 'A grinding industrial bass: FM and folding make it clank like metal under a diode filter.',
      tags: ['bass', 'industrial', 'fm', 'metallic', 'fold', 'cyberpunk', 'lorn'],
      texture: ['crackle', 0.35, 0.35, 500],
      set: {
        'osc2.level': 0.2, 'fm.amount': 0.32, 'fm.ratio': 1.41, 'fm.punch': 0.5, 'fm.decay': 140, 'dist.type': 'fold', 'dist.drive': 0.4, 'dist.mix': 0.55,
        'crush.mix': 0.3, 'crush.bits': 6, 'crush.rate': 6, 'filter.type': 'diode', 'filter.cutoff': 700, 'filter.resonance': 0.35, 'sub.wave': 'triangle',
      },
      mods: kit(BASS_KIT, [], { 'random>drive': ['random', 'fm_amount', 0.1] }),
    },
    {
      id: 'basement-pulse', name: 'Basement Pulse', iconic: true, audition: 'groove',
      description: 'A steady pulsing bass line whose filter slowly opens over the bars: warm, uneasy, 80s small-town dread.',
      tags: ['bass', 'pulse', 'sequenced', 'analog', 'eighties', 'slow-open', 'lorn'],
      texture: ['dust', 0.3, 0.3, 500],
      set: {
        'osc2.wave': 'pulse', 'osc2.pulse_width': 0.4, 'filter.cutoff': 260, 'filter.env_amount': 0.25, 'mod_env.decay': 300, 'amp_env.sustain': 0.7,
        'amp_env.release': 150, 'env2.attack': 6000, 'env2.sustain': 1, 'dist.drive': 0.35,
      },
      mods: kit(BASS_KIT, [['env2', 'filter_cutoff', 0.35]]),
    },
    {
      id: 'rubber-night', name: 'Rubber Night', iconic: true, audition: 'funk-octaves',
      description: 'A short, rubbery pluck bass: a resonant snap on every note, each one bouncing a little differently.',
      tags: ['bass', 'pluck', 'short', 'snappy', 'resonant', 'wavetable', 'lorn'],
      texture: ['dust', 0.3, 0.35, 300],
      set: {
        'osc1.wave': 'wavetable', 'osc1.wt_pos': 0.35, 'filter.cutoff': 280, 'filter.env_amount': 0.5, 'filter.resonance': 0.42, 'mod_env.decay': 160,
        'amp_env.decay': 420, 'amp_env.sustain': 0.1, 'amp_env.release': 120, 'lfo2.retrigger': true, 'lfo2.rate': 6, 'lfo2.shape': 'sine',
      },
      mods: kit(BASS_KIT, [], { 'random>drive': ['velocity', 'osc1_wt_pos', 0.25], 'env2>filter_cutoff': ['lfo2', 'filter_cutoff', 0.06] }),
    },
    {
      id: 'square-shadow', name: 'Square Shadow', iconic: true, audition: 'funk-octaves',
      description: 'A hollow, staccato square bass that slides between notes, its pulse width shifting in the dark.',
      tags: ['bass', 'square', 'pulse', 'staccato', 'glide', 'hollow', 'lorn'],
      texture: ['dust', 0.3, 0.3, 400],
      set: {
        'osc1.wave': 'pulse', 'osc1.pulse_width': 0.5, 'osc2.wave': 'pulse', 'osc2.pulse_width': 0.3, 'voice.legato': true, 'voice.glide': 45, 'osc1.unison_spread': 0.45, 'chorus.mix': 0.2,
        'filter.cutoff': 420, 'filter.env_amount': 0.3, 'amp_env.sustain': 0.65, 'amp_env.release': 100, 'drive.amount': 0.7, 'dist.drive': 0.4,
      },
      mods: kit(BASS_KIT, [], { 'lfo1>delay_time': ['lfo1', 'osc2_pw', 0.2] }),
    },
    {
      id: 'hammer-stab', name: 'Hammer Stab', iconic: true, audition: 'groove',
      description: 'A short, hard, folded bass stab with a grain that ticks in time: cyberpunk in a single hit.',
      tags: ['bass', 'stab', 'short', 'distorted', 'fold', 'synced', 'lorn'],
      texture: ['crackle', 0.3, 0.4, 300],
      set: {
        'dist.type': 'fold', 'dist.drive': 0.42, 'dist.mix': 0.65, 'filter.keytrack': 0.3, 'comp.pump': 0, 'filter.cutoff': 520, 'filter.env_amount': 0.4, 'amp_env.decay': 350, 'amp_env.sustain': 0.1,
        'amp_env.release': 100, 'lfo1.sync': '1/16', 'lfo1.shape': 'triangle',
      },
      mods: kit(BASS_KIT, [['lfo1', 'filter_cutoff', 0.12]], { 'lfo1>delay_time': null }),
    },
    {
      id: 'kick-below', name: 'Kick Below', iconic: true, audition: 'groove',
      description: 'A short, deep thump: the pitch drops into the sub with a kick on top, felt more than heard.',
      tags: ['bass', 'sub', 'kick', 'thump', 'short', 'deep', 'lorn'],
      texture: ['rumble', 0.25, 0.3, 300],
      set: {
        'osc1.wave': 'sine', 'osc2.level': 0.15, 'osc2.wave': 'triangle', 'pitch_env.amount': 24, 'pitch_env.decay': 70, 'amp_env.decay': 600,
        'amp_env.sustain': 0.15, 'click.type': 'kick', 'click.level': 0.5, 'click.tone': 180, 'click.decay': 50, 'reverb.size': 0.6, 'reverb.mix': 0.32, 'delay.mix': 0.26, 'delay.feedback': 0.5, 'drive.amount': 0.75, 'dist.drive': 0.4,
        'filter.cutoff': 900, 'filter.env_amount': 0.2,
      },
      // A sine thump: the filter barely touches it, so the life is in the drive, the pitch and the level.
      mods: kit(BASS_KIT, [], {
        'lfo1>filter_cutoff': ['lfo1', 'drive', 0.15],
        'random>filter_cutoff': ['random', 'pitch', 0.003],
        'velocity>filter_cutoff': ['velocity', 'amp', 0.2],
        'env2>filter_cutoff': null,
      }),
    },
    // ------------------------------------------------ filling the gaps
    {
      id: 'iron-wobble', name: 'Iron Wobble', audition: 'groove',
      description: 'A LORN wobble bass: the filter and grit swing on the eighths, every swing a little different, over a sub two octaves down.',
      tags: ['bass', 'wobble', 'rhythmic', 'growl', 'dark', 'sub', 'lorn'],
      texture: ['dust', 0.3, 0.35, 500],
      set: {
        'voice.octave': 1, 'sub.octave': -2, 'sub.level': 0.55, 'filter.cutoff': 300, 'filter.env_amount': 0.15, 'amp_env.sustain': 0.9,
        'wobble.depth': 0.6, 'wobble.rate': '1/8', 'wobble.target': 'filter + drive', 'wobble.life': 0.5,
      },
    },
  ],
};

export default def;
