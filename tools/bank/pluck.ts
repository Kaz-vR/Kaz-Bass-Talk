// DEV ONLY. Plucks: short, dark notes that leave space; every note a little
// different (per-note random on cutoff and drive), echoing into a small dark room.
import { ALIVE, kit, type CategoryDef, type Mod } from './common';

const base = {
  'voice.polyphony': 8,
  'osc1.wave': 'saw', 'osc1.unison_voices': 2, 'osc1.unison_detune': 8,
  'amp_env.attack': 1, 'amp_env.decay': 450, 'amp_env.sustain': 0, 'amp_env.release': 350,
  'filter.cutoff': 600, 'filter.keytrack': 0.5, 'filter.env_amount': 0.55,
  'mod_env.attack': 1, 'mod_env.decay': 220, 'mod_env.sustain': 0, 'mod_env.release': 200,
  'drive.amount': 0.5, 'dist.drive': 0.25, 'osc1.unison_spread': 0.5, 'lfo2.fade': 0,
  'delay.mix': 0.25, 'delay.time': '1/8D', 'delay.feedback': 0.45, 'reverb.mix': 0.25, 'reverb.size': 0.6, 'eq.highcut': 7000,
};

/** Plucks: per-note variety and a slow wander across the phrase. */
const PLUCK_KIT = kit(ALIVE, [['lfo1', 'filter_cutoff', 0.2], ['random', 'filter_cutoff', 0.15], ['velocity', 'filter_cutoff', 0.2], ['lfo2', 'filter_cutoff', 0.12], ['lfo4', 'width', 0.25]], {
  'env2>filter_cutoff': ['random', 'drive', 0.12],
});

/** Soft plucks (string, FM, triangle): tape wobble, per-note detune, level and drive instead of a filter. */
const SOFT_PLUCK_KIT: Mod[] = [
  ['lfo1', 'tape_wow', 0.35],
  ['lfo2', 'amp', -0.12],
  // Per-note detune: every note lands a few cents differently, like an old synth.
  ['random', 'pitch', 0.0025],
  ['drift_slow', 'drive', 0.2],
  ['lfo3', 'delay_mix', 0.1],
  ['lfo4', 'width', 0.25],
  ['drift', 'pitch', 0.0015],
  ['lfo1', 'delay_time', 0.04],
  ['drift_slow', 'reverb_mix', 0.2],
  ['lfo4', 'chorus_depth', 0.25],
  ['velocity', 'drive', 0.2],
  ['random', 'amp', -0.1],
];

const def: CategoryDef = {
  category: 'pluck',
  base,
  kit: PLUCK_KIT,
  presets: [
    {
      id: 'wet-stone', name: 'Wet Stone',
      description: 'A plucked string with a saw shadow, dark and damp, dripping into a short echo.',
      tags: ['pluck', 'string', 'dark', 'damp', 'echo', 'organic', 'lorn'],
      texture: ['dust', 0.3, 0.3, 600],
      set: { 'osc1.wave': 'string', 'string.tone': 0.4, 'string.decay': 0.4, 'osc2.wave': 'saw', 'osc2.level': 0.2, 'filter.cutoff': 1200, 'chorus.mix': 0.25 },
      mods: kit(SOFT_PLUCK_KIT, [], { 'random>amp': ['random', 'osc2_level', 0.12] }),
    },
    {
      id: 'rust-pluck', name: 'Rust Pluck',
      description: 'A biting saw pluck, folded and crushed: every note a little different shard of metal.',
      tags: ['pluck', 'saw', 'fold', 'crushed', 'aggressive', 'metallic', 'lorn'],
      texture: ['dust', 0.3, 0.4, 500],
      set: { 'dist.type': 'fold', 'dist.drive': 0.3, 'crush.mix': 0.25, 'crush.bits': 6, 'crush.rate': 7 },
    },
    {
      id: 'bone', name: 'Bone',
      description: 'A hollow, woody FM knock, like tapping on bone in a dark room.',
      tags: ['pluck', 'fm', 'woody', 'knock', 'hollow', 'percussive', 'lorn'],
      texture: ['dust', 0.3, 0.3, 600],
      set: {
        'osc1.wave': 'sine', 'osc1.unison_voices': 1, 'fm.amount': 0.3, 'fm.ratio': 1.5, 'fm.punch': 0.6, 'fm.decay': 60,
        'click.type': 'knock', 'click.level': 0.4, 'click.tone': 900, 'filter.cutoff': 3000, 'filter.env_amount': 0, 'drive.amount': 0.6,
        'chorus.mix': 0.25,
      },
      mods: kit(SOFT_PLUCK_KIT, [], { 'random>amp': ['random', 'fm_amount', 0.08], 'lfo3>delay_mix': ['lfo3', 'fm_amount', 0.1] }),
    },
    {
      id: 'glass-drop', name: 'Glass Drop',
      description: 'Tiny glassy FM drops, bright at the strike and gone a moment later.',
      tags: ['pluck', 'fm', 'glass', 'drop', 'bright', 'delicate', 'lorn'],
      texture: ['air', 0.3, 0.4, 800],
      set: {
        'osc1.wave': 'sine', 'osc1.unison_voices': 1, 'fm.amount': 0.15, 'fm.ratio': 2.5, 'fm.punch': 0.5, 'fm.decay': 80,
        'filter.cutoff': 4000, 'filter.env_amount': 0, 'drive.amount': 0.45, 'dist.drive': 0.1, 'chorus.mix': 0.25, 'eq.highcut': 6000,
      },
      mods: kit(SOFT_PLUCK_KIT, [], { 'random>amp': ['random', 'fm_amount', 0.08], 'lfo3>delay_mix': ['lfo3', 'fm_amount', 0.1] }),
    },
    {
      id: 'tape-harp', name: 'Tape Harp',
      description: 'A harp recorded to cassette and left in the sun: warped, warm and shimmering.',
      tags: ['pluck', 'harp', 'string', 'tape', 'warped', 'warm', 'lorn'],
      texture: ['crackle', 0.3, 0.3, 800],
      set: {
        'osc1.wave': 'string', 'string.tone': 0.55, 'string.decay': 0.6, 'osc2.wave': 'triangle', 'osc2.level': 0.25, 'filter.cutoff': 2500, 'filter.env_amount': 0,
        'tape.wow': 0.45, 'tape.age': 0.55, 'amp_env.decay': 1200, 'chorus.mix': 0.3,
      },
      mods: SOFT_PLUCK_KIT,
    },
    {
      id: 'ghost-pick', name: 'Ghost Pick',
      description: 'A thin, hollow pulse plucked through a resonant band, like a guitar heard through a wall.',
      tags: ['pluck', 'pulse', 'bandpass', 'thin', 'hollow', 'distant', 'lorn'],
      texture: ['dust', 0.3, 0.35, 600],
      set: { 'osc1.wave': 'pulse', 'osc1.pulse_width': 0.3, 'filter.type': 'bandpass', 'filter.cutoff': 500, 'filter.resonance': 0.3, 'sub.level': 0.12,
        'eq.highcut': 3500,
      },
    },
    {
      id: 'ember', name: 'Ember',
      description: 'A warm saw-and-square pluck glowing in a wide chorus and a bouncing echo.',
      tags: ['pluck', 'saw', 'square', 'warm', 'chorus', 'echo', 'lorn'],
      texture: ['dust', 0.3, 0.3, 600],
      set: { 'osc2.wave': 'pulse', 'osc2.level': 0.35, 'osc2.semi': -12, 'chorus.mix': 0.35, 'delay.mix': 0.3, 'filter.cutoff': 800 },
    },
    {
      id: 'needle', name: 'Needle',
      description: 'A very short, metallic comb pluck, like a needle dropped on a steel plate.',
      tags: ['pluck', 'comb', 'metallic', 'short', 'industrial', 'sharp', 'lorn'],
      texture: ['dust', 0.3, 0.4, 500],
      set: { 'filter.type': 'comb', 'filter.cutoff': 900, 'filter.resonance': 0.5, 'filter.keytrack': 1, 'amp_env.decay': 250, 'filter.env_amount': 0.2 },
    },
    {
      id: 'soft-bruise', name: 'Soft Bruise',
      description: 'A muted felt pluck, soft and sore, with a breathy edge.',
      tags: ['pluck', 'felt', 'soft', 'muted', 'breath', 'intimate', 'lorn'],
      texture: ['air', 0.3, 0.3, 800],
      set: {
        'osc1.wave': 'triangle', 'osc1.unison_voices': 2, 'breath.chiff': 0.35, 'breath.tone': 0.35, 'breath.decay': 50,
        'filter.cutoff': 1500, 'filter.env_amount': 0, 'drive.amount': 0.6, 'dist.drive': 0.3, 'amp_env.decay': 700, 'chorus.mix': 0.25,
      },
      mods: SOFT_PLUCK_KIT,
    },
    {
      id: 'blackwater', name: 'Blackwater',
      description: 'A deep, dark pluck that barely opens before it sinks into a murky room.',
      tags: ['pluck', 'dark', 'deep', 'murky', 'reverb', 'underwater', 'lorn'],
      texture: ['rumble', 0.3, 0.3, 800],
      set: { 'filter.cutoff': 300, 'filter.env_amount': 0.5, 'reverb.mix': 0.4, 'drive.amount': 0.6 },
    },
  ],
};

export default def;
