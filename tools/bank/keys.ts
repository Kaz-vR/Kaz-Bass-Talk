// DEV ONLY. Keys: worn electric and toy keys, soft tines and felt hammers
// through tape and a dark room. Velocity is brightness (FM depth).
import { kit, type CategoryDef, type Mod } from './common';

const base = {
  'voice.polyphony': 8,
  // Three unison voices: two beat at one fixed rate (a clock); three beat irregularly.
  'osc1.wave': 'triangle', 'osc1.unison_voices': 3, 'osc1.unison_detune': 8,
  // A felt-hammer start (10 ms), not a click; a gentle bark; touch makes it louder and brighter.
  'fm.amount': 0.12, 'fm.ratio': 1, 'fm.punch': 0.2, 'fm.decay': 250,
  'amp_env.attack': 10, 'amp_env.decay': 3500, 'amp_env.sustain': 0.25, 'amp_env.release': 900,
  'filter.cutoff': 1700, 'filter.keytrack': 0.35, 'filter.env_amount': 0, 'voice.velocity': 0.75, 'ott.amount': 0.05,
  'lfo2.fade': 0, 'osc1.unison_spread': 0.5,
  // Wear comes from tape, dust and air; drive stays low so the attack doesn't crunch.
  'tape.wow': 0.25, 'tape.age': 0.45, 'drive.amount': 0.35, 'dist.drive': 0.15,
  'chorus.mix': 0.22, 'reverb.mix': 0.3, 'reverb.size': 0.7, 'delay.mix': 0.1, 'eq.highcut': 6500, 'fx.lowcut': 250,
};

/** The old, sharper recipe: keys whose identity is the bite keep it (Midnight Upright is kept exactly as it was). */
const BITE = {
  'fm.punch': 0.35, 'amp_env.attack': 3, 'filter.cutoff': 2400, 'filter.keytrack': 0.5, 'drive.amount': 0.5, 'dist.drive': 0.25, 'ott.amount': 0.15,
};

/** Keys move their FM (the tine's bark), level, saturation and tape, not a filter far above them. */
const KEYS_KIT: Mod[] = [
  ['lfo1', 'fm_amount', 0.1],
  ['lfo2', 'amp', -0.12],
  ['env2', 'drive', 0.2],
  ['drift_slow', 'drive', 0.2],
  ['lfo3', 'tape_wow', 0.3],
  ['lfo4', 'width', 0.25],
  ['drift', 'pitch', 0.0015],
  ['lfo1', 'delay_time', 0.04],
  ['drift_slow', 'reverb_mix', 0.2],
  ['lfo4', 'chorus_depth', 0.25],
  ['velocity', 'fm_amount', 0.2],
  ['random', 'fm_amount', 0.06],
];

/** For keys without FM: the same motion on the filter. */
const FILTER_KEYS_KIT = kit(KEYS_KIT, [], {
  'lfo1>fm_amount': ['lfo1', 'filter_cutoff', 0.2],
  'velocity>fm_amount': ['velocity', 'filter_cutoff', 0.2],
  'random>fm_amount': ['random', 'filter_cutoff', 0.1],
  'env2>drive': ['env2', 'filter_cutoff', 0.15],
  'drift_slow>drive': ['drift_slow', 'filter_cutoff', 0.12],
});

/** Soft keys (sine, triangle, felt): a filter or drive has little to grab, so move the octave layer, level and space. */
const SOFT_KEYS_KIT = kit(KEYS_KIT, [], {
  'lfo1>fm_amount': ['lfo1', 'osc2_level', 0.35],
  'env2>drive': ['env2', 'reverb_mix', 0.3],
  'drift_slow>drive': ['drift_slow', 'amp', -0.12],
  'velocity>fm_amount': ['velocity', 'amp', 0.25],
  'random>fm_amount': ['random', 'osc2_level', 0.12],
});

const def: CategoryDef = {
  category: 'keys',
  base,
  kit: KEYS_KIT,
  presets: [
    {
      id: 'burnt-rhodes', name: 'Burnt Rhodes',
      description: 'A worn electric piano: soft tines that bark when hit hard, wobbling on old tape.',
      tags: ['keys', 'electric-piano', 'rhodes', 'fm', 'tape', 'warm', 'lorn'],
      texture: ['dust', 0.45, 0.3, 1200],
      set: { 'fm.amount': 0.15, 'fm.punch': 0.5 },
    },
    {
      id: 'toy-box', name: 'Toy Box',
      description: 'A child\'s toy piano left in an attic for decades: thin, bell-like, warped and crackling.',
      tags: ['keys', 'toy-piano', 'bell', 'warped', 'creepy', 'crackle', 'lorn'],
      texture: ['crackle', 0.55, 0.4, 1000],
      set: { ...BITE,  'voice.octave': 1, 'fm.ratio': 3.5, 'fm.amount': 0.2, 'fm.punch': 0.4, 'tape.wow': 0.5, 'amp_env.decay': 2000 },
    },
    {
      id: 'felt-piano', name: 'Felt Piano',
      description: 'A muted upright with felt on the hammers: soft, intimate and slightly out of tune.',
      tags: ['keys', 'piano', 'felt', 'soft', 'intimate', 'muted', 'lorn'],
      texture: ['dust', 0.45, 0.25, 1500],
      set: {
        'fm.amount': 0, 'fm.punch': 0, 'breath.chiff': 0.3, 'breath.tone': 0.3, 'breath.decay': 60, 'filter.cutoff': 1200,
        'amp_env.decay': 4000, 'osc2.wave': 'saw', 'osc2.level': 0.15,
      },
      mods: kit(FILTER_KEYS_KIT, [['drift_slow', 'filter_cutoff', 0.2], ['random', 'filter_cutoff', 0.2]]),
    },
    {
      id: 'wurly-rot', name: 'Wurly Rot',
      description: 'A reedy, overdriven electric piano with a wandering tremolo, rotting in a damp room.',
      tags: ['keys', 'wurlitzer', 'reedy', 'overdriven', 'tremolo', 'vintage', 'lorn'],
      texture: ['dust', 0.45, 0.35, 1000],
      set: { ...BITE, 
        'osc1.wave': 'pulse', 'osc1.pulse_width': 0.45, 'fm.amount': 0, 'fm.punch': 0, 'filter.cutoff': 1500, 'filter.env_amount': 0.3,
        'mod_env.decay': 600, 'mod_env.sustain': 0.1, 'drive.amount': 0.6, 'chorus.mix': 0.12,
      },
      mods: kit(FILTER_KEYS_KIT, [['lfo2', 'amp', -0.22], ['drift_slow', 'filter_cutoff', 0.2]]),
    },
    {
      id: 'clav-ghost', name: 'Clav Ghost',
      description: 'A short, snappy clavinet played through broken digital speakers.',
      tags: ['keys', 'clavinet', 'funky', 'snappy', 'crushed', 'dark', 'lorn'],
      texture: ['dust', 0.45, 0.4, 600],
      set: { ...BITE, 
        'osc1.wave': 'pulse', 'osc1.pulse_width': 0.2, 'fm.amount': 0, 'fm.punch': 0, 'filter.cutoff': 600, 'filter.env_amount': 0.6,
        'mod_env.decay': 200, 'mod_env.sustain': 0, 'amp_env.decay': 900, 'amp_env.sustain': 0.1,
        'crush.mix': 0.2, 'crush.bits': 6, 'crush.rate': 7,
      },
      mods: FILTER_KEYS_KIT,
    },
    {
      id: 'midnight-upright', name: 'Midnight Upright',
      description: 'A plucked-string piano in an empty bar after closing: woody, ringing and a little sour.',
      tags: ['keys', 'piano', 'string', 'woody', 'ringing', 'late-night', 'lorn'],
      texture: ['crackle', 0.45, 0.3, 1200],
      set: { ...BITE, 'voice.velocity': 0.5, 
        'osc1.wave': 'string', 'string.tone': 0.45, 'string.decay': 0.75, 'osc2.wave': 'triangle', 'osc2.level': 0.2,
        'fm.amount': 0, 'fm.punch': 0, 'filter.cutoff': 3000, 'chorus.mix': 0.45, 'delay.mix': 0.2,
        'osc2.unison_voices': 3, 'osc2.unison_detune': 8, 'osc2.unison_spread': 1,
      },
      mods: kit(KEYS_KIT, [], {
        'lfo1>fm_amount': ['lfo1', 'osc2_level', 0.2],
        'velocity>fm_amount': ['velocity', 'drive', 0.2],
        'random>fm_amount': ['random', 'osc2_level', 0.1],
      }),
    },
    {
      id: 'shiver-keys', name: 'Shiver Keys',
      description: 'Hollow pulse keys with a fast, shivering tremolo and a soft overdrive, like an old organ in a cold church.',
      tags: ['keys', 'tremolo', 'pulse', 'pwm', 'organ', 'cold', 'lorn'],
      texture: ['dust', 0.35, 0.35, 900],
      set: { ...BITE, 
        'osc1.wave': 'pulse', 'osc1.pulse_width': 0.4, 'lfo2.rate': 5.5, 'lfo2.shape': 'sine', 'dist.type': 'soft', 'dist.drive': 0.35,
        'amp_env.sustain': 0.6,
      },
      mods: KEYS_KIT.map((m) => (m[0] === 'lfo1' && m[1] === 'fm_amount' ? (['lfo1', 'osc1_pw', 0.15] as Mod) : m[0] === 'lfo2' ? (['lfo2', 'amp', -0.3] as Mod) : m)),
    },
    {
      id: 'glass-harp', name: 'Glass Harp',
      description: 'Bright, glassy FM keys like wet fingers on crystal, ringing into a cold room.',
      tags: ['keys', 'fm', 'glass', 'crystal', 'bright', 'cold', 'lorn'],
      texture: ['air', 0.45, 0.4, 1500],
      set: { 'osc1.wave': 'sine', 'fm.ratio': 2, 'fm.amount': 0.25, 'fm.punch': 0.3, 'reverb.mix': 0.38 },
    },
    {
      id: 'lofi-grand', name: 'Lo-Fi Grand',
      description: 'A grand piano sampled from a cassette: soft, wide, warbling and dull.',
      tags: ['keys', 'piano', 'lo-fi', 'cassette', 'warble', 'soft', 'lorn'],
      texture: ['crackle', 0.5, 0.3, 1500],
      set: {
        'osc2.wave': 'saw', 'osc2.level': 0.25, 'fm.amount': 0.08, 'amp_env.decay': 4500, 'tape.wow': 0.45, 'tape.age': 0.65, 'eq.highcut': 5000,
      },
    },
    {
      id: 'moth-keys', name: 'Moth Keys',
      description: 'Soft FM keys that flutter into each note and hang in the air like dust in lamplight.',
      tags: ['keys', 'fm', 'soft', 'airy', 'dreamy', 'ambient', 'lorn'],
      texture: ['air', 0.45, 0.3, 2000],
      set: { 'amp_env.attack': 30, 'fm.amount': 0.1, 'fm.punch': 0.2, 'chorus.mix': 0.45, 'reverb.mix': 0.4 },
    },
    // ------------------------------------------------ iconic (LORN versions)
    {
      id: 'glass-tine', name: 'Glass Tine', iconic: true,
      description: 'The eighties FM electric piano: a glassy tine over a soft round body, chorused and phased, now on a worn tape in a dark room.',
      tags: ['keys', 'fm', 'electric-piano', 'eighties', 'glassy', 'chorus', 'lorn'],
      texture: ['crackle', 0.3, 0.35, 900],
      set: { ...BITE, 
        'osc1.wave': 'sine', 'fm.amount': 0.3, 'fm.ratio': 1, 'fm.punch': 0.7, 'fm.decay': 300, 'fm2.amount': 0.15, 'fm2.ratio': 14,
        'voice.velocity': 0.85, 'amp_env.decay': 2500, 'amp_env.sustain': 0.2, 'amp_env.release': 600,
        'chorus.mix': 0.3, 'chorus.mode': 'ensemble', 'phaser.mix': 0.12, 'phaser.rate': 0.3,
      },
    },
    // ------------------------------------------------ filling the gaps
    {
      id: 'dust-organ', name: 'Dust Organ',
      description: 'An old drawbar organ with a key click, slowly spinning speaker and dust in its pipes.',
      tags: ['keys', 'organ', 'drawbar', 'click', 'vintage', 'dust', 'lorn'],
      texture: ['dust', 0.5, 0.35, 800],
      set: { ...BITE, 
        'osc1.wave': 'sine', 'osc2.wave': 'sine', 'osc2.semi': 12, 'osc2.level': 0.4, 'fm.amount': 0, 'fm.punch': 0,
        'amp_env.sustain': 0.9, 'amp_env.release': 300, 'click.type': 'click', 'click.level': 0.8, 'click.tone': 2000, 'click.decay': 12,
        'chorus.mix': 0.45, 'drive.amount': 0.6, 'dist.drive': 0.3,
      },
      mods: kit(KEYS_KIT, [], {
        'lfo1>fm_amount': ['lfo1', 'osc2_level', 0.2],
        'velocity>fm_amount': ['velocity', 'osc2_level', 0.2],
        'random>fm_amount': ['random', 'osc2_level', 0.1],
        'drift_slow>drive': ['drift_slow', 'osc2_level', 0.15],
      }),
    },
    {
      id: 'tin-clock', name: 'Tin Clock',
      description: 'Wavetable keys through a low-pass gate, their tone ticking along in time like a tin clock in an empty house.',
      tags: ['keys', 'wavetable', 'lpg', 'ticking', 'synced', 'percussive', 'lorn'],
      texture: ['crackle', 0.35, 0.35, 900],
      set: { ...BITE, 
        'osc1.wave': 'wavetable', 'osc1.wt_pos': 0.4, 'filter.type': 'lpg', 'filter.cutoff': 1200, 'lfo3.sync': '1/4', 'lfo3.shape': 'triangle',
        'amp_env.decay': 1500,
      },
      mods: KEYS_KIT.map((m) => (m[0] === 'lfo3' ? (['lfo3', 'osc1_wt_pos', 0.15] as Mod) : m)),
    },
    // ------------------------------------------------ iconic II (LORN versions)
    {
      id: 'vox-dust', name: 'Vox Dust', iconic: 2,
      description: "A sixties transistor combo organ, bright and buzzy with its own wobbling vibrato, coated in dust.",
      tags: ['keys', 'organ', 'combo', 'sixties', 'psychedelic', 'vibrato', 'lorn'],
      texture: ['dust', 0.6, 0.35, 600],
      set: { 'osc1.wave': 'pulse', 'osc1.pulse_width': 0.5, 'osc2.wave': 'saw', 'osc2.semi': 12, 'osc2.level': 0.3, 'fm.amount': 0, 'fm.punch': 0, 'amp_env.attack': 5, 'amp_env.decay': 100, 'amp_env.sustain': 1, 'amp_env.release': 80, 'vibrato.depth': 10, 'vibrato.rate': 6.5, 'vibrato.delay': 0, 'vibrato.fade': 1, 'filter.cutoff': 2200 },
      mods: kit(FILTER_KEYS_KIT, [['drift_slow', 'filter_cutoff', 0.25]]),
    },
    {
      id: 'pump-breath', name: 'Pump Breath', iconic: 2,
      description: "A pump organ in a cold chapel: reedy, wheezing, the bellows breathing under every chord.",
      tags: ['keys', 'harmonium', 'reed', 'bellows', 'breath', 'eerie', 'lorn'],
      texture: ['air', 0.35, 0.35, 1200],
      set: { 'osc1.wave': 'pulse', 'osc1.pulse_width': 0.2, 'osc2.wave': 'saw', 'osc2.level': 0.25, 'fm.amount': 0, 'fm.punch': 0, 'breath.level': 0.25, 'breath.tone': 0.4, 'amp_env.attack': 80, 'amp_env.sustain': 1, 'amp_env.release': 300, 'filter.cutoff': 1800 },
      mods: kit(FILTER_KEYS_KIT, [], { 'lfo2>amp': ['lfo2', 'breath_level', 0.15] }),
    },
    {
      id: 'saloon-rot', name: 'Saloon Rot', iconic: 2,
      description: "A honky-tonk upright with every string pair out of tune, beating and jangling in an empty saloon.",
      tags: ['keys', 'honky-tonk', 'piano', 'detuned', 'saloon', 'jangly', 'lorn'],
      texture: ['crackle', 0.35, 0.35, 900],
      set: { 'osc2.wave': 'triangle', 'osc2.fine': 18, 'osc2.level': 0.5, 'amp_env.decay': 2500, 'amp_env.sustain': 0.15 },
    },
    {
      id: 'bell-piano', name: 'Bell Piano', iconic: 2,
      description: "The eighties layered piano: a soft FM piano with a glassy bell ringing above it, faded on old tape.",
      tags: ['keys', 'piano', 'bell', 'fm', 'eighties', 'layered', 'lorn'],
      texture: ['dust', 0.35, 0.35, 900],
      set: { 'fm.amount': 0.25, 'fm2.amount': 0.12, 'fm2.ratio': 14, 'osc2.wave': 'sine', 'osc2.semi': 24, 'osc2.level': 0.15 },
    },
    {
      id: 'stage-phase', name: 'Stage Phase', iconic: 2,
      description: "A stage electric piano swirling through a phaser, seventies-soft and slightly seasick.",
      tags: ['keys', 'electric-piano', 'phaser', 'seventies', 'swirling', 'tine', 'lorn'],
      texture: ['dust', 0.35, 0.35, 900],
      set: { 'fm.amount': 0.22, 'fm.punch': 0.5, 'phaser.mix': 0.35, 'phaser.rate': 0.4 },
    },
    {
      id: 'small-hours', name: 'Small Hours', iconic: 2,
      description: "A celesta in the small hours: tiny, sweet, glassy bells, a little out of reach.",
      tags: ['keys', 'celesta', 'bells', 'sweet', 'fragile', 'glassy', 'lorn'],
      texture: ['dust', 0.3, 0.35, 1200],
      set: { 'osc1.wave': 'sine', 'osc1.unison_voices': 1, 'voice.octave': 1, 'fm.amount': 0.15, 'fm.ratio': 4, 'fm.punch': 0.5, 'fm.decay': 120, 'amp_env.decay': 1500, 'amp_env.sustain': 0, 'drive.amount': 0.7, 'osc2.wave': 'sine', 'osc2.semi': 12, 'osc2.level': 0.12 },
      mods: SOFT_KEYS_KIT,
    },
    {
      id: 'dream-organ', name: 'Dream Organ', iconic: 2,
      description: "A soft combo organ, warm and chorused, floating in a vast room: dream pop at three in the morning.",
      tags: ['keys', 'organ', 'dreamy', 'soft', 'dream-pop', 'warm', 'lorn'],
      texture: ['air', 0.35, 0.35, 1500],
      set: { 'osc1.wave': 'triangle', 'osc2.wave': 'pulse', 'osc2.pulse_width': 0.4, 'osc2.level': 0.25, 'fm.amount': 0, 'fm.punch': 0, 'amp_env.attack': 10, 'amp_env.sustain': 1, 'amp_env.release': 180, 'filter.cutoff': 1200, 'chorus.mix': 0.4, 'reverb.size': 0.93, 'reverb.mix': 0.45 },
      mods: kit(FILTER_KEYS_KIT, [['drift_slow', 'filter_cutoff', 0.25]]),
    },
    // ------------------------------------------------ iconic II: missing keys and soft sounds
    {
      id: 'reed-tears', name: 'Reed Tears', iconic: 2,
      description: "A melodica played in an empty stairwell: breathy, reedy, wobbling and sad.",
      tags: ['keys', 'melodica', 'reed', 'breathy', 'sad', 'wobbly', 'lorn'],
      texture: ['air', 0.35, 0.35, 900],
      set: { 'osc1.wave': 'pulse', 'osc1.pulse_width': 0.3, 'osc2.wave': 'saw', 'osc2.level': 0.2, 'fm.amount': 0, 'fm.punch': 0, 'breath.level': 0.3, 'breath.tone': 0.45, 'breath.chiff': 0.25, 'amp_env.attack': 40, 'amp_env.decay': 800, 'amp_env.sustain': 0.9, 'amp_env.release': 150, 'vibrato.depth': 14, 'vibrato.rate': 4.8, 'vibrato.delay': 300, 'vibrato.fade': 500, 'filter.cutoff': 1700, 'voice.polyphony': 4 },
      mods: kit(FILTER_KEYS_KIT, [], { 'lfo2>amp': ['lfo2', 'breath_level', 0.15], 'drift>pitch': ['drift', 'pitch', 0.004] }),
    },
    {
      id: 'harbour-reed', name: 'Harbour Reed', iconic: 2, audition: 'chords',
      description: "A bandoneon by a cold harbour: two reeds beating against each other, the bellows swelling under a slow, melancholic chord.",
      tags: ['keys', 'accordion', 'bandoneon', 'reed', 'detuned', 'melancholic', 'lorn'],
      texture: ['dust', 0.35, 0.35, 900],
      set: { 'osc1.wave': 'saw', 'osc1.unison_voices': 1, 'osc2.wave': 'pulse', 'osc2.pulse_width': 0.35, 'osc2.fine': 10, 'osc2.level': 0.5, 'fm.amount': 0, 'fm.punch': 0, 'breath.level': 0.15, 'breath.tone': 0.35, 'amp_env.attack': 60, 'amp_env.decay': 800, 'amp_env.sustain': 1, 'amp_env.release': 220, 'filter.cutoff': 1500, 'chorus.mix': 0.4, 'chorus.mode': 'ensemble' },
      mods: kit(FILTER_KEYS_KIT, [], { 'lfo2>amp': ['lfo2', 'amp', -0.15], 'drift>pitch': ['lfo2', 'osc2_pitch', 0.004] }),
    },
    {
      id: 'backwards-room', name: 'Backwards Room', iconic: 2, audition: 'chords',
      description: "Keys played backwards: each note swells in out of nothing, opens up and is cut off, leaving only the room.",
      tags: ['keys', 'reversed', 'swell', 'backwards', 'eerie', 'tape', 'lorn'],
      texture: ['dust', 0.35, 0.35, 900],
      set: { 'fm.amount': 0, 'fm.punch': 0, 'osc1.wave': 'triangle', 'osc2.wave': 'saw', 'osc2.level': 0.2, 'amp_env.attack': 700, 'amp_env.decay': 4000, 'amp_env.sustain': 1, 'amp_env.release': 40, 'filter.cutoff': 700, 'filter.env_amount': 0.35, 'mod_env.attack': 800, 'mod_env.decay': 2000, 'mod_env.sustain': 1, 'mod_env.release': 40, 'reverb.mix': 0.4, 'reverb.size': 0.85 },
      mods: SOFT_KEYS_KIT,
    },
    {
      id: 'glass-decade', name: 'Glass Decade', iconic: 2, audition: 'chords',
      description: "Late-eighties digital keys: a glassy bell strikes on top while a soft pad body sustains underneath, chorused and faded.",
      tags: ['keys', 'digital', 'bell', 'fm', 'pad', 'eighties', 'lorn'],
      texture: ['dust', 0.55, 0.35, 1200],
      set: { 'osc1.wave': 'sine', 'osc1.unison_voices': 1, 'fm.amount': 0.3, 'fm.ratio': 3.5, 'fm.punch': 0.7, 'fm.decay': 300, 'fm2.amount': 0.08, 'fm2.ratio': 7, 'osc2.wave': 'saw', 'osc2.level': 0.3, 'osc2.unison_voices': 3, 'osc2.unison_detune': 12, 'amp_env.decay': 3000, 'amp_env.sustain': 0.6, 'amp_env.release': 1200, 'filter.cutoff': 1600, 'chorus.mix': 0.4, 'chorus.mode': 'classic', 'eq.highcut': 4500 },
    },
    {
      id: 'night-stab', name: 'Night Stab', iconic: 2, audition: 'chords',
      description: "Short, punchy saw chord stabs that snap open and vanish into a dark echo.",
      tags: ['keys', 'stab', 'chord', 'punchy', 'short', 'saw', 'lorn'],
      texture: ['crackle', 0.3, 0.35, 500],
      set: { ...BITE,  'osc1.wave': 'saw', 'osc1.unison_voices': 5, 'osc1.unison_detune': 18, 'osc1.unison_spread': 0.7, 'fm.amount': 0, 'fm.punch': 0, 'amp_env.attack': 2, 'amp_env.decay': 320, 'amp_env.sustain': 0, 'amp_env.release': 150, 'filter.cutoff': 700, 'filter.env_amount': 0.45, 'mod_env.attack': 1, 'mod_env.decay': 180, 'mod_env.sustain': 0, 'comp.pump': 0.3, 'delay.mix': 0.2, 'delay.time': '1/8D' },
      mods: kit(FILTER_KEYS_KIT, [['lfo1', 'filter_cutoff', 0.32], ['drift_slow', 'filter_cutoff', 0.25]]),
    },
    {
      id: 'pedal-wash', name: 'Pedal Wash', iconic: 2,
      description: "A soft piano with the sustain pedal held down forever: every note rings on into a warm, blurred wash.",
      tags: ['keys', 'piano', 'sustain-pedal', 'ambient', 'wash', 'soft', 'lorn'],
      texture: ['air', 0.3, 0.35, 3000],
      set: { 'fm.amount': 0.06, 'fm.punch': 0.2, 'breath.chiff': 0.15, 'breath.tone': 0.3, 'breath.decay': 60, 'amp_env.attack': 6, 'amp_env.decay': 7000, 'amp_env.sustain': 0.2, 'amp_env.release': 3500, 'filter.cutoff': 1300, 'reverb.size': 0.95, 'reverb.mix': 0.32, 'delay.mix': 0.18, 'delay.time': '1/4D', 'drive.amount': 0.3, 'dist.drive': 0.12 },
    },
    {
      id: 'cotton-tines', name: 'Cotton Tines', iconic: 2,
      description: "A soft electric piano played at a whisper: round tines with no bark, warm and close.",
      tags: ['keys', 'electric-piano', 'soft', 'round', 'warm', 'intimate', 'lorn'],
      texture: ['dust', 0.5, 0.3, 1200],
      set: { 'drive.amount': 0.3, 'dist.drive': 0.12, 'amp_env.attack': 12, 'fm.amount': 0.07, 'fm.punch': 0.2, 'tape.age': 0.6 },
    },
    {
      id: 'hush-vibes', name: 'Hush Vibes', iconic: 2,
      description: "A soft vibraphone with a slow tremolo, hit with yarn mallets in a dim room.",
      tags: ['keys', 'vibraphone', 'mallet', 'tremolo', 'soft', 'warm', 'lorn'],
      texture: ['air', 0.3, 0.35, 1500],
      set: { 'drive.amount': 0.3, 'dist.drive': 0.12, 'amp_env.attack': 12, 'osc1.wave': 'sine', 'osc1.unison_voices': 1, 'fm.amount': 0.1, 'fm.ratio': 4, 'fm.punch': 0.4, 'fm.decay': 150, 'amp_env.decay': 3000, 'amp_env.sustain': 0.1, 'lfo2.rate': 4.2, 'lfo2.shape': 'sine', 'filter.cutoff': 1600, 'eq.highcut': 4500, 'chorus.mix': 0.4},
      mods: KEYS_KIT.map((m) => (m[0] === 'lfo2' ? (['lfo2', 'amp', -0.25] as Mod) : m)),
    },
    {
      id: 'sleep-organ', name: 'Sleep Organ', iconic: 2,
      description: "A soft sine organ, two drawbars and nothing else, breathing slowly in the dark.",
      tags: ['keys', 'organ', 'sine', 'soft', 'gentle', 'calm', 'lorn'],
      texture: ['air', 0.55, 0.35, 1200],
      set: { 'drive.amount': 0.3, 'dist.drive': 0.12, 'amp_env.attack': 30, 'osc1.wave': 'sine', 'osc2.wave': 'sine', 'osc2.semi': 12, 'osc2.level': 0.35, 'fm.amount': 0, 'fm.punch': 0, 'amp_env.sustain': 1, 'amp_env.release': 300, 'filter.cutoff': 1500, 'tape.age': 0.65, 'breath.level': 0.08, 'breath.tone': 0.4 },
      mods: SOFT_KEYS_KIT,
    },
    {
      id: 'quiet-reed', name: 'Quiet Reed', iconic: 2,
      description: "A reedy electric piano turned all the way down: soft, round, with a lazy tremolo.",
      tags: ['keys', 'wurlitzer', 'reedy', 'soft', 'tremolo', 'warm', 'lorn'],
      texture: ['dust', 0.4, 0.3, 1000],
      set: { 'drive.amount': 0.3, 'dist.drive': 0.12, 'amp_env.attack': 12, 'osc1.wave': 'pulse', 'osc1.pulse_width': 0.45, 'fm.amount': 0, 'fm.punch': 0, 'filter.cutoff': 850, 'filter.env_amount': 0.15, 'mod_env.decay': 500, 'mod_env.sustain': 0.1, 'chorus.mix': 0.15 },
      mods: FILTER_KEYS_KIT,
    },
    {
      id: 'breath-keys', name: 'Breath Keys', iconic: 2,
      description: "Soft triangle keys with a little air in every note, like a sigh between chords.",
      tags: ['keys', 'soft', 'breathy', 'airy', 'gentle', 'triangle', 'lorn'],
      texture: ['air', 0.35, 0.35, 1200],
      set: { 'drive.amount': 0.3, 'dist.drive': 0.12, 'amp_env.attack': 25, 'fm.amount': 0, 'fm.punch': 0, 'breath.level': 0.2, 'breath.tone': 0.35, 'amp_env.decay': 2500, 'amp_env.sustain': 0.45, 'filter.cutoff': 1300, 'osc2.wave': 'sine', 'osc2.semi': 12, 'osc2.level': 0.15 },
      mods: kit(SOFT_KEYS_KIT, [], { 'lfo2>amp': ['lfo2', 'breath_level', 0.25] }),
    },
  ],
};

export default def;
