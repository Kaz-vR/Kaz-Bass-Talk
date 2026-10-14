// DEV ONLY. Pads: huge, slow, dark chords that bloom and drift.
import { ALIVE, kit, type CategoryDef } from './common';

const base = {
  'voice.polyphony': 8,
  'amp_env.attack': 900, 'amp_env.decay': 3000, 'amp_env.sustain': 0.85, 'amp_env.release': 2200,
  'osc1.unison_voices': 4, 'osc1.unison_detune': 18, 'osc1.unison_spread': 1,
  'filter.cutoff': 900, 'filter.keytrack': 0.5, 'filter.env_amount': 0,
  'env2.attack': 3000,
  'reverb.mix': 0.35, 'reverb.size': 0.9, 'delay.mix': 0.12, 'chorus.mix': 0.25,
  'eq.highcut': 6500, 'fx.lowcut': 250, 'eq.low_gain': -2,
};

const def: CategoryDef = {
  category: 'pad',
  base,
  kit: ALIVE,
  presets: [
    {
      id: 'ash-cloud', name: 'Ash Cloud',
      description: 'Wide detuned saws drifting under a slowly wandering filter, with fine dust settling over the chords.',
      tags: ['pad', 'dark', 'wide', 'detuned', 'dust', 'cinematic', 'lorn'],
      texture: ['dust', 0.45, 0.3, 2500],
      set: {},
    },
    {
      id: 'cathedral-rot', name: 'Cathedral Rot',
      description: 'A decayed string-machine choir of PWM saws in a vast dark nave, blooming open over seconds.',
      tags: ['pad', 'pwm', 'ensemble', 'cathedral', 'reverb', 'slow', 'lorn'],
      texture: ['air', 0.4, 0.3, 3000],
      set: {
        'osc1.wave': 'pwm_saw', 'osc1.unison_voices': 3, 'osc1.pulse_width': 0.4, 'chorus.mix': 0.35, 'chorus.mode': 'ensemble',
        'env2.attack': 4000, 'reverb.mix': 0.42, 'reverb.size': 0.95,
      },
      mods: kit(ALIVE, [['env2', 'filter_cutoff', 0.18]], { 'lfo2>filter_cutoff': ['lfo2', 'osc1_pw', 0.12] }),
    },
    {
      id: 'cold-breath', name: 'Cold Breath',
      description: 'Soft triangles wrapped in breath and air: a frozen exhale that never quite settles.',
      tags: ['pad', 'breath', 'air', 'soft', 'cold', 'ambient', 'lorn'],
      texture: ['air', 0.5, 0.35, 2500],
      set: {
        'osc1.wave': 'triangle', 'osc1.unison_voices': 3, 'osc1.unison_detune': 12, 'drive.amount': 0.55,
        'breath.level': 0.35, 'breath.tone': 0.45, 'filter.cutoff': 2000,
      },
      // A soft triangle body: move its drive and breath rather than a filter with little to cut.
      mods: kit(ALIVE, [], {
        'lfo2>filter_cutoff': ['lfo2', 'breath_level', 0.15],
        'lfo1>filter_cutoff': ['lfo1', 'drive', 0.2],
        'random>filter_cutoff': ['random', 'drive', 0.1],
      }),
    },
    {
      id: 'iron-fog', name: 'Iron Fog',
      description: 'Chords through a drifting comb filter: metallic, hollow and groaning, over a low rumble.',
      tags: ['pad', 'comb', 'metallic', 'industrial', 'horror', 'dark', 'lorn'],
      texture: ['rumble', 0.6, 0.4, 2500],
      set: { 'filter.type': 'comb', 'filter.cutoff': 300, 'filter.resonance': 0.45, 'filter.keytrack': 0.5 },
      mods: kit(ALIVE, [['lfo1', 'filter_cutoff', 0.08], ['lfo2', 'filter_cutoff', 0.02], ['env2', 'filter_cutoff', 0.06]]),
    },
    {
      id: 'tape-ghosts', name: 'Tape Ghosts',
      description: 'Chords played back from a stretched, dying tape: seasick wow, dull top and crackle.',
      tags: ['pad', 'tape', 'wow', 'lo-fi', 'worn', 'crackle', 'lorn'],
      texture: ['crackle', 0.65, 0.35, 2500],
      set: { 'tape.wow': 0.5, 'tape.age': 0.65, 'tape.drive': 0.5, 'eq.highcut': 5500 },
    },
    {
      id: 'sunken', name: 'Sunken',
      description: 'Starts buried and muffled, then slowly rises toward the surface as you hold it, over a deep hum.',
      tags: ['pad', 'bloom', 'dark', 'underwater', 'slow', 'cinematic', 'lorn'],
      texture: ['rumble', 0.65, 0.3, 3000],
      set: { 'filter.cutoff': 380, 'env2.attack': 4500, 'env2.sustain': 1, 'drive.amount': 0.65, 'dist.drive': 0.32 },
      mods: kit(ALIVE, [['env2', 'filter_cutoff', 0.28]]),
    },
    {
      id: 'static-heaven', name: 'Static Heaven',
      description: 'A shimmering wavetable pad seen through broken digital glass: crushed grain over a wandering timbre.',
      tags: ['pad', 'wavetable', 'crushed', 'digital', 'grain', 'shimmer', 'lorn'],
      texture: ['dust', 0.55, 0.4, 2000],
      set: {
        'osc1.wave': 'wavetable', 'osc1.wt_pos': 0.55, 'filter.cutoff': 1600, 'crush.mix': 0.2, 'crush.bits': 7, 'crush.rate': 9,
      },
      mods: kit(ALIVE, [], { 'lfo2>filter_cutoff': ['lfo2', 'osc1_wt_pos', 0.15] }),
    },
    {
      id: 'long-night', name: 'Long Night',
      description: 'A hollow, vowel-shaped pad that slowly mouths "oo" and "oh" in the dark.',
      tags: ['pad', 'formant', 'vowel', 'vocal', 'hollow', 'night', 'lorn'],
      texture: ['air', 0.35, 0.3, 2500],
      set: {
        'filter.type': 'formant', 'filter.vowel': 0.78, 'filter.resonance': 0.4, 'filter.cutoff': 2400, 'filter.keytrack': 0.2, 'sub.level': 0.12,
        'eq.mid_freq': 300, 'eq.mid_gain': -7, 'drive.amount': 0.62, 'dist.drive': 0.3,
      },
      mods: kit(ALIVE, [], {
        'lfo1>filter_cutoff': ['lfo1', 'filter_vowel', 0.25],
        'lfo2>filter_cutoff': ['lfo2', 'filter_vowel', 0.05],
        'env2>filter_cutoff': ['env2', 'filter_vowel', -0.12],
      }),
    },
    {
      id: 'breathing-walls', name: 'Breathing Walls',
      description: 'A very wide wall of saws inhaling and exhaling with the beat, as if the room were alive.',
      tags: ['pad', 'pump', 'sidechain', 'wide', 'breathing', 'wall', 'lorn'],
      texture: ['air', 0.3, 0.4, 1500],
      set: { 'osc1.unison_voices': 5, 'osc1.unison_detune': 22, 'comp.amount': 0.5, 'comp.pump': 0.55, 'filter.cutoff': 1100, 'amp_env.release': 1400, 'reverb.mix': 0.28 },
    },
    {
      id: 'rift', name: 'Rift',
      description: 'Dark chords with a quiet tritone ghost beating against them: something is wrong in the harmony.',
      tags: ['pad', 'dissonant', 'tritone', 'dread', 'horror', 'dark', 'lorn'],
      texture: ['dust', 0.35, 0.3, 2500],
      set: { 'osc2.wave': 'triangle', 'osc2.semi': 6, 'osc2.fine': 6, 'osc2.level': 0.16, 'filter.cutoff': 800 },
      mods: kit(ALIVE, [], { 'drift>pitch': ['drift', 'osc2_pitch', 0.003] }),
    },
    {
      id: 'velvet-smoke', name: 'Velvet Smoke',
      description: 'Soft FM sines that thicken and thin as the modulation drifts, smoky and warm.',
      tags: ['pad', 'fm', 'soft', 'warm', 'smoke', 'evolving', 'lorn'],
      texture: ['dust', 0.55, 0.25, 2500],
      set: {
        'osc1.wave': 'sine', 'osc1.unison_voices': 3, 'osc1.unison_detune': 10, 'osc1.unison_spread': 0.6, 'fm.amount': 0.3, 'fm.ratio': 2,
        'filter.cutoff': 2500, 'drive.amount': 0.6, 'dist.type': 'fold', 'dist.drive': 0.28, 'dist.mix': 0.5, 'chorus.mix': 0.15,
        'breath.level': 0.15, 'breath.tone': 0.5, 'tape.drive': 0.55,
      },
      // An FM sine body: move the modulation, not a filter it barely reaches.
      mods: kit(ALIVE, [], {
        'lfo1>filter_cutoff': ['lfo1', 'fm_amount', 0.15],
        'lfo2>filter_cutoff': ['lfo2', 'fm_amount', 0.05],
        'env2>filter_cutoff': ['env2', 'fm_amount', 0.12],
        'velocity>filter_cutoff': ['velocity', 'fm_amount', 0.15],
        'random>filter_cutoff': ['random', 'fm_amount', 0.06],
        'drift_slow>drive': ['drift_slow', 'dist_drive', 0.12],
      }),
    },
    // ------------------------------------------------ iconic (LORN versions)
    {
      id: 'velvet-neon', name: 'Velvet Neon', iconic: true,
      description: 'The classic PWM pad under a lush stereo chorus, swelling in soft and wide, now worn on tape and lost in the dark.',
      tags: ['pad', 'pwm', 'chorus', 'synthwave', 'eighties', 'lush', 'lorn'],
      texture: ['dust', 0.55, 0.35, 2000],
      set: {
        'osc1.wave': 'pulse', 'osc1.pulse_width': 0.45, 'osc1.unison_voices': 3, 'osc1.unison_detune': 10, 'osc1.unison_spread': 0.9,
        'osc2.wave': 'pulse', 'osc2.semi': -12, 'osc2.pulse_width': 0.5, 'osc2.level': 0.2, 'noise.level': 0.04,
        'amp_env.attack': 500, 'amp_env.release': 1800, 'filter.cutoff': 1600, 'filter.resonance': 0.15,
        'chorus.mix': 0.45, 'chorus.depth': 0.6, 'chorus.mode': 'classic', 'phaser.mix': 0.12, 'phaser.rate': 0.15,
      },
      // The pulse width breathes slowly (the identity); the rest of the kit wanders as usual.
      mods: kit(ALIVE, [], { 'lfo2>filter_cutoff': ['lfo2', 'osc1_pw', 0.2] }),
    },
    {
      id: 'warm-dread', name: 'Warm Dread', iconic: true,
      description: 'A thick two-oscillator analog pad that swells and slowly opens, dreamy on top and uneasy underneath.',
      tags: ['pad', 'analog', 'swell', 'warm', 'eighties', 'uneasy', 'lorn'],
      texture: ['air', 0.35, 0.35, 2500],
      set: {
        'osc1.unison_voices': 4, 'osc1.unison_detune': 15, 'osc2.wave': 'saw', 'osc2.semi': -12, 'osc2.fine': -6, 'osc2.level': 0.35,
        'filter.cutoff': 500, 'filter.env_amount': 0.3, 'mod_env.attack': 2500, 'mod_env.decay': 3000, 'mod_env.sustain': 0.7, 'mod_env.release': 2000,
        'amp_env.attack': 1800, 'flanger.mix': 0.15, 'flanger.rate': 0.1, 'flanger.feedback': 0.3,
      },
    },
    // ------------------------------------------------ filling the gaps
    {
      id: 'tidal-fog', name: 'Tidal Fog',
      description: 'A pad whose filter rises and falls in time over two bars, like a slow tide under the drifting fog.',
      tags: ['pad', 'tempo', 'tidal', 'slow', 'synced', 'fog', 'lorn'],
      texture: ['air', 0.4, 0.3, 2500],
      set: { 'lfo3.sync': '2/1', 'lfo3.shape': 'triangle' },
      mods: kit(ALIVE, [], { 'lfo3>unison_detune': ['lfo3', 'filter_cutoff', 0.18] }),
    },
    // ------------------------------------------------ producer range: the roles this category was missing
    {
      id: 'burnt-cloud', name: 'Burnt Cloud',
      description: "A pad pushed through a hard clipper until it burns: wide saws, scorched edges, crackle in the smoke.",
      tags: ['pad', 'distorted', 'harsh', 'gritty', 'burnt', 'aggressive', 'lorn', 'new'],
      texture: ['crackle', 0.65, 0.4, 2000],
      set: { 'drive.amount': 0.75, 'dist.type': 'hard', 'dist.drive': 0.5, 'dist.mix': 0.7, 'dist.clean_below': 150, 'filter.cutoff': 1100, 'crush.mix': 0.15, 'crush.bits': 8, 'crush.rate': 6, 'texture.position': 'after dynamics' },
    },
    {
      id: 'rust-wall', name: 'Rust Wall',
      description: "A folded, metallic pad that breathes with the beat: a wall of rust that heaves in and out.",
      tags: ['pad', 'fold', 'metallic', 'pumping', 'harsh', 'industrial', 'lorn', 'new'],
      texture: ['dust', 0.55, 0.4, 2500],
      set: { 'dist.type': 'fold', 'dist.drive': 0.45, 'dist.mix': 0.6, 'dist.clean_below': 150, 'filter.cutoff': 900, 'comp.amount': 0.55, 'comp.pump': 0.45, 'osc1.unison_spread': 0.45, 'chorus.mix': 0.08 },
      mods: kit(ALIVE, [], { 'lfo4>chorus_depth': ['lfo4', 'tape_wow', 0.3] }),
    },
    {
      id: 'instant-fog', name: 'Instant Fog',
      description: "A pad that is there the moment you play: no swell, just warm chords appearing out of the fog.",
      tags: ['pad', 'quick', 'warm', 'immediate', 'chords', 'soft', 'lorn', 'new'],
      texture: ['dust', 0.5, 0.3, 2000],
      set: { 'amp_env.attack': 15, 'amp_env.sustain': 0.8, 'amp_env.release': 2000, 'filter.cutoff': 800, 'osc1.unison_voices': 3, 'osc1.unison_detune': 14 },
    },
    {
      id: 'pulse-pad', name: 'Pulse Pad',
      description: "A pad that pumps in quarter notes against the kick: chords that breathe on the beat.",
      tags: ['pad', 'pumping', 'rhythmic', 'sidechain', 'quick', 'driving', 'lorn', 'new'],
      texture: ['dust', 0.5, 0.35, 1500],
      set: { 'amp_env.attack': 20, 'comp.amount': 0.6, 'comp.pump': 0.65, 'comp.pump_rate': '1/4', 'filter.cutoff': 1000 },
    },
    {
      id: 'seasick', name: 'Seasick',
      description: "A pad on a warped tape that won't stay in tune: every chord leans and slides, nauseous and beautiful.",
      tags: ['pad', 'wobbly', 'detuned', 'warped', 'tape', 'uneasy', 'lorn', 'new'],
      texture: ['crackle', 0.65, 0.4, 2000],
      set: { 'tape.wow': 0.6, 'tape.age': 0.65, 'filter.cutoff': 900, 'texture.position': 'after dynamics' },
      mods: kit(ALIVE, [['drift', 'pitch', 0.006]]),
    },
    {
      id: 'glass-sheet', name: 'Glass Sheet',
      description: "A thin, steady sheet of glassy FM tone: no thickness, just a pale, still shimmer above the mix.",
      tags: ['pad', 'thin', 'glassy', 'fm', 'steady', 'still', 'lorn', 'new'],
      texture: ['air', 0.55, 0.35, 2500],
      set: { 'osc1.wave': 'sine', 'osc1.unison_voices': 1, 'fm.amount': 0.12, 'fm.ratio': 2, 'fm.punch': 0, 'filter.cutoff': 2500, 'chorus.mix': 0.45, 'chorus.depth': 0.6, 'tape.wow': 0.05, 'eq.highcut': 5000 },
      mods: kit(ALIVE, [], { 'lfo1>filter_cutoff': ['lfo1', 'fm_amount', 0.25], 'lfo2>filter_cutoff': ['lfo2', 'amp', -0.3], 'env2>filter_cutoff': ['env2', 'fm_amount', 0.12], 'random>filter_cutoff': ['random', 'fm_amount', 0.12], 'velocity>filter_cutoff': ['velocity', 'amp', 0.2] }),
      allow: { vibeWidth: { min: -20, why: 'a thin, single sheet of tone by design' } },
    },
    {
      id: 'held-breath', name: 'Held Breath',
      description: "A tense pad with a rub in the middle of it: two voices a semitone apart, waiting for something to happen.",
      tags: ['pad', 'tense', 'dissonant', 'dark', 'uneasy', 'cinematic', 'lorn', 'new'],
      texture: ['dust', 0.5, 0.35, 2500],
      set: { 'osc2.wave': 'saw', 'osc2.semi': 1, 'osc2.level': 0.3, 'filter.cutoff': 700, 'dist.drive': 0.3 },
    },
  ],
};

export default def;
