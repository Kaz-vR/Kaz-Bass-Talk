// DEV ONLY. Plucks: short, dark notes that leave space; every note a little
// different (per-note random on cutoff and drive), echoing into a small dark room.
import { ALIVE, kit, type CategoryDef, type Mod } from './common';

const base = {
  // Touch: playing harder is clearly louder.
  'voice.velocity': 0.75,
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
      id: 'blackwater', name: 'Blackwater',
      description: 'A deep, dark pluck that barely opens before it sinks into a murky room.',
      tags: ['pluck', 'dark', 'deep', 'murky', 'reverb', 'underwater', 'lorn'],
      texture: ['rumble', 0.3, 0.3, 800],
      set: { 'filter.cutoff': 300, 'filter.env_amount': 0.5, 'reverb.mix': 0.4, 'drive.amount': 0.6 },
    },
    // ------------------------------------------------ iconic (LORN versions)
    {
      id: 'wet-neon', name: 'Wet Neon', iconic: true,
      description: 'A short neon pluck whose dotted-eighth echo becomes the rhythm, softly overdriven and dissolving in a huge room.',
      tags: ['pluck', 'dotted-delay', 'synthwave', 'echo', 'rhythmic', 'neon', 'lorn'],
      texture: ['dust', 0.3, 0.35, 700],
      set: {
        'delay.time': '1/8D', 'delay.mix': 0.38, 'delay.feedback': 0.55, 'filter.cutoff': 700, 'filter.env_amount': 0.5,
        'voice.velocity': 0.8, 'reverb.size': 0.92, 'reverb.mix': 0.3, 'dist.type': 'soft', 'dist.drive': 0.3,
      },
    },
    // ------------------------------------------------ filling the gaps
    // ------------------------------------------------ iconic II (LORN versions)
    {
      id: 'neon-snap', name: 'Neon Snap', iconic: 2,
      description: "The classic eighties analog pluck: a warm saw snapping open and shut, chorused, now worn and dusty.",
      tags: ['pluck', 'analog', 'eighties', 'snappy', 'chorus', 'classic', 'lorn'],
      texture: ['dust', 0.3, 0.35, 700],
      set: { 'osc1.unison_detune': 6, 'filter.cutoff': 500, 'filter.env_amount': 0.6, 'filter.resonance': 0.3, 'mod_env.decay': 200, 'chorus.mix': 0.3, 'chorus.mode': 'classic' },
    },
    {
      id: 'hollow-euphoria', name: 'Hollow Euphoria', iconic: 2,
      description: "A huge stack of detuned saws plucked short and thrown into a big echo: euphoria, seen through dirty glass.",
      tags: ['pluck', 'supersaw', 'trance', 'huge', 'euphoric', 'echo', 'lorn'],
      texture: ['dust', 0.35, 0.4, 900],
      set: { 'osc1.unison_voices': 7, 'osc1.unison_detune': 25, 'osc1.unison_spread': 1, 'filter.cutoff': 1500, 'filter.env_amount': 0.4, 'mod_env.decay': 250, 'amp_env.decay': 350, 'delay.mix': 0.35, 'delay.feedback': 0.5, 'reverb.size': 0.9, 'reverb.mix': 0.35 },
    },
    {
      id: 'palm-glass', name: 'Palm Glass', iconic: 2,
      description: "A soft, round marimba pluck with a little glassy shimmer, warm wood under a cold night sky.",
      tags: ['pluck', 'marimba', 'soft', 'wooden', 'tropical', 'round', 'lorn'],
      texture: ['dust', 0.3, 0.3, 800],
      set: { 'osc1.wave': 'sine', 'osc1.unison_voices': 1, 'fm.amount': 0.15, 'fm.ratio': 4, 'fm.punch': 0.5, 'fm.decay': 100, 'amp_env.decay': 450, 'filter.cutoff': 1800, 'filter.env_amount': 0.05, 'eq.highcut': 5000 },
      mods: SOFT_PLUCK_KIT,
    },
    {
      id: 'dead-strings', name: 'Dead Strings', iconic: 2,
      description: "A palm-muted guitar string: tight, woody and dead short, picked in an empty room.",
      tags: ['pluck', 'guitar', 'muted', 'string', 'tight', 'woody', 'lorn'],
      texture: ['dust', 0.3, 0.35, 600],
      set: { 'osc1.wave': 'string', 'string.tone': 0.3, 'string.decay': 0.25, 'osc1.unison_voices': 1, 'filter.cutoff': 1500, 'filter.env_amount': 0.15, 'amp_env.decay': 300, 'osc2.wave': 'sine', 'osc2.level': 0.45 },
      mods: SOFT_PLUCK_KIT,
    },
    {
      id: 'pizz-dust', name: 'Pizz Dust', iconic: 2,
      description: "A string section playing pizzicato: short, dry plucks of many strings at once, crackling with dust.",
      tags: ['pluck', 'pizzicato', 'strings', 'short', 'dry', 'section', 'lorn'],
      texture: ['crackle', 0.3, 0.35, 600],
      set: { 'osc1.unison_voices': 3, 'osc1.unison_detune': 12, 'osc2.wave': 'saw', 'osc2.fine': 7, 'osc2.level': 0.3, 'amp_env.decay': 250, 'filter.env_amount': 0.5, 'mod_env.decay': 120, 'reverb.mix': 0.3 },
    },
    {
      id: 'dub-echo', name: 'Dub Echo', iconic: 2,
      description: "A short pluck thrown into a tape echo turned up until it swirls, smears and nearly runs away.",
      tags: ['pluck', 'dub', 'tape-echo', 'feedback', 'swirling', 'space', 'lorn'],
      texture: ['dust', 0.3, 0.35, 1200],
      set: { 'delay.time': '1/4D', 'delay.mix': 0.45, 'delay.feedback': 0.7, 'delay.tone': 0.2 },
      mods: kit(PLUCK_KIT, [['lfo1', 'delay_time', 0.08]]),
    },
    {
      id: 'soft-harp', name: 'Soft Harp', iconic: 2,
      description: "A gentle harp, plucked softly and left to float in a big, quiet room.",
      tags: ['pluck', 'harp', 'soft', 'string', 'dreamy', 'floating', 'lorn'],
      texture: ['air', 0.25, 0.35, 1200],
      set: { 'osc1.wave': 'string', 'string.tone': 0.6, 'string.decay': 0.7, 'osc1.unison_voices': 1, 'filter.cutoff': 1800, 'filter.env_amount': 0.05, 'chorus.mix': 0.3, 'reverb.size': 0.9, 'reverb.mix': 0.4, 'osc2.wave': 'sine', 'osc2.level': 0.35 },
      mods: SOFT_PLUCK_KIT,
    },
    // ------------------------------------------------ iconic II: missing keys and soft sounds
    {
      id: 'paper-pluck', name: 'Paper Pluck', iconic: 2,
      description: "A muted, papery string pluck: barely there, dry and gentle.",
      tags: ['pluck', 'muted', 'string', 'soft', 'papery', 'dry', 'lorn'],
      texture: ['dust', 0.35, 0.3, 500],
      set: { 'drive.amount': 0.3, 'dist.drive': 0.12, 'amp_env.attack': 8, 'mod_env.attack': 5, 'osc1.wave': 'string', 'string.tone': 0.25, 'string.decay': 0.3, 'osc1.unison_voices': 1, 'filter.cutoff': 1500, 'filter.env_amount': 0, 'delay.mix': 0.15, 'reverb.mix': 0.18, 'osc2.wave': 'sine', 'osc2.level': 0.35, 'eq.mid_freq': 300, 'eq.mid_gain': -4.5 },
      mods: SOFT_PLUCK_KIT,
    },
    {
      id: 'velvet-pick', name: 'Velvet Pick', iconic: 2,
      description: "A soft triangle pluck with an octave shadow and a slow chorus, velvet-smooth.",
      tags: ['pluck', 'soft', 'velvet', 'octave', 'chorus', 'smooth', 'lorn'],
      texture: ['dust', 0.45, 0.3, 800],
      set: { 'drive.amount': 0.3, 'dist.drive': 0.12, 'amp_env.attack': 8, 'mod_env.attack': 5, 'osc1.wave': 'triangle', 'osc2.wave': 'sine', 'osc2.semi': 12, 'osc2.level': 0.2, 'filter.cutoff': 1200, 'filter.env_amount': 0.2, 'chorus.mix': 0.35, 'chorus.mode': 'classic', 'tape.age': 0.6 },
      mods: SOFT_PLUCK_KIT,
    },
    {
      id: 'wood-hush', name: 'Wood Hush', iconic: 2,
      description: "A soft wooden mallet on a marimba bar: a warm knock that fades fast.",
      tags: ['pluck', 'marimba', 'wood', 'mallet', 'soft', 'warm', 'lorn'],
      texture: ['dust', 0.3, 0.3, 600],
      set: { 'drive.amount': 0.3, 'dist.drive': 0.12, 'amp_env.attack': 8, 'mod_env.attack': 5, 'osc1.wave': 'sine', 'osc1.unison_voices': 1, 'fm.amount': 0.15, 'fm.ratio': 4, 'fm.punch': 0.5, 'fm.decay': 60, 'filter.cutoff': 1600, 'filter.env_amount': 0, 'amp_env.decay': 400, 'eq.highcut': 4500 },
      mods: SOFT_PLUCK_KIT,
    },
    // ------------------------------------------------ producer range: the roles this category was missing
    {
      id: 'ringing-wire', name: 'Ringing Wire',
      description: "A plucked wire that rings on and on, the note hanging in the dark long after the pick.",
      tags: ['pluck', 'ringing', 'string', 'long', 'sustain', 'dark', 'lorn', 'new'],
      texture: ['dust', 0.45, 0.3, 2000],
      set: { 'osc1.wave': 'string', 'string.tone': 0.45, 'string.decay': 0.9, 'osc1.unison_voices': 1, 'osc2.wave': 'sine', 'osc2.level': 0.35, 'amp_env.decay': 3000, 'amp_env.release': 1500, 'filter.cutoff': 1800, 'filter.env_amount': 0, 'drive.amount': 0.35, 'dist.drive': 0.12, 'eq.mid_freq': 300, 'eq.mid_gain': -4 },
      mods: SOFT_PLUCK_KIT,
    },
    {
      id: 'thick-pluck', name: 'Thick Pluck',
      description: "A big, thick pluck: five detuned saws and an octave below, filling the whole middle of the track.",
      tags: ['pluck', 'thick', 'supersaw', 'big', 'wide', 'detuned', 'lorn', 'new'],
      texture: ['dust', 0.45, 0.35, 800],
      set: { 'osc1.unison_voices': 5, 'osc1.unison_detune': 16, 'osc2.wave': 'saw', 'osc2.semi': -12, 'osc2.level': 0.4, 'filter.cutoff': 500, 'filter.env_amount': 0.5, 'eq.mid_freq': 300, 'eq.mid_gain': -4 },
    },
  ],
};

export default def;
