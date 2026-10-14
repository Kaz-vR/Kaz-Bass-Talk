// DEV ONLY. Leads: singing, broken mono lines, saturated and tape-wobbled,
// sitting in a dark echo.
import { ALIVE, kit, type CategoryDef, type Mod } from './common';

const base = {
  'voice.polyphony': 1, 'voice.legato': true, 'voice.glide': 70,
  'osc1.wave': 'saw', 'osc1.unison_voices': 2, 'osc1.unison_detune': 9,
  'osc2.wave': 'pulse', 'osc2.pulse_width': 0.4, 'osc2.level': 0.3, 'osc2.fine': 5,
  'filter.cutoff': 1200, 'filter.keytrack': 0.3, 'filter.env_amount': 0.15,
  'mod_env.decay': 600, 'mod_env.sustain': 0.4,
  'amp_env.attack': 8, 'amp_env.decay': 1500, 'amp_env.sustain': 0.85, 'amp_env.release': 500,
  'vibrato.depth': 18, 'vibrato.rate': 5.5, 'vibrato.delay': 400, 'vibrato.fade': 500,
  'tape.wow': 0.3, 'drive.amount': 0.55, 'dist.drive': 0.3, 'osc1.unison_spread': 0.5, 'chorus.mix': 0.12,
  'delay.mix': 0.25, 'delay.time': '1/4D', 'delay.feedback': 0.5, 'reverb.mix': 0.32, 'eq.highcut': 7000,
};

/** Leads: deeper slow filter wander; the fast wander is the line's intensity (level). */
const LEAD_KIT = kit(ALIVE, [['lfo1', 'filter_cutoff', 0.22], ['random', 'filter_cutoff', 0.15], ['env2', 'filter_cutoff', 0.15]], {
  // Deep enough to survive the compressor evening it out.
  'lfo2>filter_cutoff': ['lfo2', 'amp', -0.16],
});

/** For soft bodies (sine, triangle, FM): move the octave layer, breath, saturation and tape, not a filter with little to cut. */
const SOFT_KIT: Mod[] = [
  ['lfo1', 'osc2_level', 0.25],
  ['lfo2', 'breath_level', 0.15],
  ['env2', 'drive', 0.25],
  ['drift_slow', 'drive', 0.2],
  ['lfo3', 'tape_wow', 0.3],
  ['lfo4', 'width', 0.35],
  ['drift', 'pitch', 0.0015],
  ['lfo1', 'delay_time', 0.04],
  ['drift_slow', 'reverb_mix', 0.2],
  ['lfo4', 'chorus_depth', 0.25],
  ['velocity', 'drive', 0.15],
  ['random', 'osc2_level', 0.1],
];

const def: CategoryDef = {
  category: 'lead',
  base,
  kit: LEAD_KIT,
  presets: [
    {
      id: 'broken-signal', name: 'Broken Signal',
      description: 'A detuned saw lead on a sick tape, gliding between notes and repeating into a dark echo.',
      tags: ['lead', 'saw', 'detuned', 'tape', 'glide', 'echo', 'lorn'],
      texture: ['dust', 0.45, 0.3, 1200],
      set: { 'tape.wow': 0.45 },
    },
    {
      id: 'ghost-whistle', name: 'Ghost Whistle',
      description: 'A soft, breathy whistle with a slow vibrato, floating far away in the dark.',
      tags: ['lead', 'whistle', 'breath', 'soft', 'eerie', 'reverb', 'lorn'],
      texture: ['air', 0.45, 0.4, 1500],
      set: {
        'osc1.wave': 'triangle', 'osc1.unison_voices': 1, 'osc2.wave': 'sine', 'osc2.semi': 12, 'osc2.level': 0.2,
        'breath.level': 0.3, 'breath.tone': 0.6, 'filter.cutoff': 3000, 'filter.env_amount': 0, 'reverb.mix': 0.45, 'drive.amount': 0.6,
        'chorus.mix': 0.2,
      },
      mods: SOFT_KIT,
    },
    {
      id: 'rust-saw', name: 'Rust Saw',
      description: 'A rough, folded saw that bites on every note and grinds as it sustains.',
      tags: ['lead', 'saw', 'fold', 'aggressive', 'crushed', 'distorted', 'lorn'],
      texture: ['dust', 0.45, 0.35, 1000],
      set: {
        'dist.type': 'fold', 'dist.drive': 0.3, 'filter.env_amount': 0.3, 'mod_env.decay': 300, 'osc1.unison_spread': 0.3, 'chorus.mix': 0.06,
        'crush.mix': 0.2, 'crush.bits': 6, 'crush.rate': 8,
      },
    },
    {
      id: 'siren-call', name: 'Siren Call',
      description: 'A hollow pulse lead that scoops up into each note, its width wandering like a voice.',
      tags: ['lead', 'pulse', 'pwm', 'scoop', 'vocal', 'haunting', 'lorn'],
      texture: ['air', 0.45, 0.35, 1200],
      set: { 'osc1.wave': 'pulse', 'osc1.pulse_width': 0.3, 'osc1.unison_voices': 1, 'pitch_env.amount': -2, 'pitch_env.decay': 150 },
      mods: kit(LEAD_KIT, [], { 'lfo3>unison_detune': ['lfo3', 'osc1_pw', 0.2] }),
    },
    {
      id: 'dying-radio', name: 'Dying Radio',
      description: 'A melody squeezed through a broken radio: band-limited, crushed and fading in and out of dust.',
      tags: ['lead', 'radio', 'lo-fi', 'crushed', 'band-limited', 'dust', 'lorn'],
      texture: ['dust', 0.55, 0.4, 1200],
      set: {
        'filter.cutoff': 1400, 'filter.resonance': 0.35, 'eq.low_gain': -10, 'eq.highcut': 3500,
        'crush.mix': 0.3, 'crush.bits': 6, 'crush.rate': 9,
      },
    },
    {
      id: 'howl', name: 'Howl',
      description: 'A lead with a throat: a formant filter slowly changing its vowel as it howls.',
      tags: ['lead', 'formant', 'vowel', 'howl', 'vocal', 'growl', 'lorn'],
      texture: ['air', 0.45, 0.35, 1200],
      set: { 'filter.type': 'formant', 'filter.vowel': 0.3, 'filter.resonance': 0.45, 'filter.cutoff': 2000, 'filter.keytrack': 0.2, 'drive.amount': 0.6, 'sub.level': 0.12 },
      mods: kit(LEAD_KIT, [], {
        'lfo1>filter_cutoff': ['lfo1', 'filter_vowel', 0.25],
        'env2>filter_cutoff': ['env2', 'filter_vowel', 0.12],
      }),
    },
    {
      id: 'glass-throat', name: 'Glass Throat',
      description: 'A glassy FM lead whose edge thickens and thins as it sings.',
      tags: ['lead', 'fm', 'glass', 'bell-like', 'clean', 'eerie', 'lorn'],
      texture: ['air', 0.45, 0.4, 1200],
      set: { 'osc1.wave': 'sine', 'osc1.unison_voices': 2, 'fm.amount': 0.3, 'fm.ratio': 2, 'osc2.level': 0, 'drive.amount': 0.6, 'dist.drive': 0.3 },
      mods: kit(LEAD_KIT, [], {
        'lfo1>filter_cutoff': ['lfo1', 'fm_amount', 0.15],
        'env2>filter_cutoff': ['env2', 'fm_amount', 0.12],
        'random>filter_cutoff': ['random', 'fm_amount', 0.06],
        'velocity>filter_cutoff': ['velocity', 'fm_amount', 0.15],
        'drift_slow>drive': ['drift_slow', 'fm_amount', 0.1],
      }),
    },
    {
      id: 'mourning-horn', name: 'Mourning Horn',
      description: 'A lone horn-like lead that swells into each note with breath and a wide, sad vibrato.',
      tags: ['lead', 'horn', 'swell', 'breath', 'vibrato', 'melancholic', 'lorn'],
      texture: ['air', 0.45, 0.3, 1500],
      set: {
        'filter.cutoff': 900, 'filter.env_amount': 0.35, 'mod_env.attack': 150, 'mod_env.decay': 900,
        'breath.chiff': 0.3, 'breath.decay': 100, 'vibrato.depth': 20,
      },
      mods: kit(LEAD_KIT, [['lfo1', 'filter_cutoff', 0.3]]),
    },
    {
      id: 'black-sun', name: 'Black Sun',
      description: 'Stacked saws an octave apart, driven hard into a dark filter and a long smeared echo.',
      tags: ['lead', 'saw', 'octave', 'driven', 'heavy', 'echo', 'lorn'],
      texture: ['dust', 0.45, 0.3, 1200],
      set: { 'osc2.wave': 'saw', 'osc2.semi': 12, 'osc2.level': 0.35, 'drive.amount': 0.65, 'filter.cutoff': 1300, 'delay.mix': 0.3 },
    },
    {
      id: 'last-light', name: 'Last Light',
      description: 'A soft FM lead with a long, slow glide, almost swallowed by reverb and air.',
      tags: ['lead', 'fm', 'soft', 'glide', 'reverb', 'ambient', 'lorn'],
      texture: ['air', 0.45, 0.3, 2000],
      set: {
        'osc1.wave': 'sine', 'osc1.unison_voices': 1, 'osc2.wave': 'triangle', 'osc2.level': 0.3, 'fm.amount': 0.18, 'fm.ratio': 1,
        'voice.glide': 250, 'reverb.mix': 0.5, 'drive.amount': 0.6, 'dist.drive': 0.3, 'filter.env_amount': 0, 'chorus.mix': 0.2,
      },
      mods: kit(SOFT_KIT, [], {
        'random>osc2_level': ['random', 'fm_amount', 0.08],
        'drift_slow>drive': ['drift_slow', 'fm_amount', 0.1],
        'lfo1>osc2_level': ['lfo1', 'fm_amount', 0.15],
        'env2>drive': ['env2', 'fm_amount', 0.12],
        'velocity>drive': ['velocity', 'fm_amount', 0.12],
      }),
    },
    // ------------------------------------------------ iconic (LORN versions)
    {
      id: 'highway-glide', name: 'Highway Glide', iconic: true,
      description: 'The night-drive portamento saw lead, gliding between notes over a triplet echo in a huge dark room.',
      tags: ['lead', 'saw', 'portamento', 'synthwave', 'glide', 'eighties', 'lorn'],
      texture: ['dust', 0.45, 0.35, 1200],
      set: {
        'osc1.unison_voices': 3, 'osc1.unison_detune': 12, 'osc1.unison_spread': 0.6, 'osc2.wave': 'saw', 'osc2.semi': 12, 'osc2.level': 0.22,
        'voice.glide': 120, 'vibrato.depth': 14, 'vibrato.delay': 500, 'filter.cutoff': 1400, 'filter.resonance': 0.25, 'filter.env_amount': 0.2,
        'drive.amount': 0.7, 'dist.drive': 0.36, 'dist.clean_below': 120,
        'delay.time': '1/8T', 'delay.mix': 0.24, 'reverb.size': 0.93, 'reverb.mix': 0.34,
      },
    },
    {
      id: 'torn-signal', name: 'Torn Signal', iconic: true,
      description: 'A hard-synced lead that tears open on every note, then settles into a phased, broken shimmer.',
      tags: ['lead', 'sync', 'tearing', 'synthwave', 'aggressive', 'phaser', 'lorn'],
      texture: ['crackle', 0.5, 0.4, 900],
      set: {
        'osc1.level': 0.35, 'osc1.unison_voices': 1, 'osc2.wave': 'saw', 'osc2.sync': true, 'osc2.semi': 7, 'osc2.fine': 0, 'osc2.level': 0.55,
        'mod_env.attack': 1, 'mod_env.decay': 450, 'mod_env.sustain': 0.2, 'filter.cutoff': 2400, 'filter.env_amount': 0.15,
        'dist.type': 'hard', 'dist.drive': 0.32, 'phaser.mix': 0.22, 'phaser.rate': 0.4,
      },
      // The sync sweep: the mod envelope drags oscillator 2 down on every note; a slow wander keeps it moving after.
      mods: kit(LEAD_KIT, [], {
        'lfo3>unison_detune': ['mod_env', 'osc2_pitch', 0.25],
        'random>filter_cutoff': ['lfo1', 'osc2_pitch', 0.03],
        // The tear is in the sync, not the filter: a slow filter wander adds nothing audible here.
        'lfo1>filter_cutoff': null,
      }),
    },
    {
      id: 'rain-flute', name: 'Rain Flute', iconic: true,
      description: 'An airy synth flute: breath first, then a soft tone that brightens and sings with a late vibrato.',
      tags: ['lead', 'flute', 'breath', 'airy', 'soft', 'cinematic', 'lorn'],
      texture: ['air', 0.35, 0.4, 1500],
      set: {
        'osc1.wave': 'sine', 'osc1.unison_voices': 1, 'osc2.wave': 'triangle', 'osc2.semi': 12, 'osc2.fine': 0, 'osc2.level': 0.15,
        'breath.level': 0.35, 'breath.chiff': 0.3, 'breath.tone': 0.6, 'vibrato.depth': 15, 'vibrato.delay': 450, 'vibrato.fade': 600,
        'filter.cutoff': 3500, 'filter.env_amount': 0.2, 'mod_env.attack': 400, 'mod_env.sustain': 0.8, 'reverb.size': 0.9, 'reverb.mix': 0.36,
      },
      // The breath itself drifts slowly, like a player's air.
      mods: SOFT_KIT.map((m) => (m[0] === 'random' ? (['drift_slow', 'breath_level', 0.22] as Mod) : m[0] === 'lfo1' && m[1] === 'osc2_level' ? (['lfo1', 'osc2_level', 0.35] as Mod) : m)),
    },
    {
      id: 'other-side', name: 'Other Side', iconic: true,
      description: 'An eerie, detuned lead that glides and howls from somewhere it should not be, its tone slowly morphing.',
      tags: ['lead', 'eerie', 'detuned', 'glide', 'wavetable', 'unstable', 'lorn'],
      texture: ['air', 0.35, 0.35, 1500],
      set: {
        'osc1.wave': 'wavetable', 'osc1.wt_pos': 0.55, 'osc1.unison_voices': 1, 'osc2.wave': 'saw', 'osc2.fine': 14, 'osc2.level': 0.3,
        'voice.glide': 150, 'vibrato.depth': 25, 'vibrato.rate': 4.5, 'tape.wow': 0.45, 'tape.age': 0.6, 'filter.cutoff': 1100,
      },
      mods: kit(LEAD_KIT, [['lfo1', 'filter_cutoff', 0.3]], {
        'lfo3>unison_detune': ['lfo3', 'osc1_wt_pos', 0.2],
        'drift_slow>drive': ['drift_slow', 'osc1_wt_pos', 0.2],
      }),
    },
  ],
};

export default def;
