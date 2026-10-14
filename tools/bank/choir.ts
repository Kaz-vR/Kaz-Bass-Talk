// DEV ONLY. Choir / vocal: ghostly voices, slowly shifting vowels, breath and
// a cathedral of dark reverb. The formant filter is the mouth; its vowel is
// what moves.
import { ALIVE, kit, type CategoryDef } from './common';

const base = {
  'voice.polyphony': 8,
  'osc1.wave': 'saw', 'osc1.unison_voices': 3, 'osc1.unison_detune': 10, 'osc1.unison_spread': 0.9,
  'osc2.wave': 'pulse', 'osc2.pulse_width': 0.3, 'osc2.level': 0.3, 'osc2.fine': 6,
  'filter.type': 'formant', 'filter.vowel': 0.1, 'filter.resonance': 0.45, 'filter.cutoff': 1800, 'filter.keytrack': 0.15, 'filter.env_amount': 0,
  'amp_env.attack': 500, 'amp_env.decay': 3000, 'amp_env.sustain': 0.9, 'amp_env.release': 1800,
  'vibrato.depth': 16, 'vibrato.rate': 5, 'vibrato.delay': 450, 'vibrato.fade': 700,
  'breath.level': 0.2, 'breath.tone': 0.55, 'breath.chiff': 0.1,
  'chorus.mix': 0.3, 'chorus.mode': 'ensemble',
  'reverb.mix': 0.45, 'reverb.size': 0.92, 'eq.highcut': 7000, 'eq.mid_freq': 350, 'eq.mid_gain': -3, 'fx.lowcut': 250,
};

/** The mouth moves: the kit's filter routings go to the vowel. */
const VOICE_KIT = kit(ALIVE, [], {
  'lfo1>filter_cutoff': ['lfo1', 'filter_vowel', 0.18],
  'lfo2>filter_cutoff': ['lfo2', 'filter_vowel', 0.04],
  'env2>filter_cutoff': ['env2', 'filter_vowel', 0.1],
  'random>filter_cutoff': ['random', 'filter_vowel', 0.06],
});

const def: CategoryDef = {
  category: 'choir',
  base,
  kit: VOICE_KIT,
  presets: [
    {
      id: 'hollow-choir', name: 'Hollow Choir',
      description: 'A ghost choir singing "ah" that slowly drifts toward other vowels, deep in a dark cathedral.',
      tags: ['choir', 'vocal', 'ah', 'cathedral', 'ghostly', 'dark', 'lorn'],
      texture: ['air', 0.45, 0.35, 2500],
      set: { 'sub.level': 0.1 },
    },
    {
      id: 'ooh-below', name: 'Ooh Below',
      description: 'Low, closed "ooh" voices humming from somewhere beneath the floor.',
      tags: ['choir', 'vocal', 'ooh', 'low', 'hum', 'dark', 'lorn'],
      texture: ['rumble', 0.5, 0.3, 2500],
      set: { 'filter.vowel': 0.85, 'filter.cutoff': 2400, 'eq.mid_freq': 300, 'eq.mid_gain': -6, 'drive.amount': 0.6 },
    },
    {
      id: 'ghost-voices', name: 'Ghost Voices',
      description: 'More breath than voice: whispering singers half-dissolved into air.',
      tags: ['choir', 'vocal', 'breath', 'whisper', 'ghost', 'air', 'lorn'],
      texture: ['air', 0.55, 0.4, 3000],
      set: { 'breath.level': 0.35, 'vibrato.depth': 22, 'osc2.level': 0.15, 'sub.level': 0.12 },
    },
    {
      id: 'monks-underground', name: 'Monks Underground',
      description: 'Deep male voices chanting "oh" in a crypt, rough and saturated.',
      tags: ['choir', 'vocal', 'male', 'low', 'chant', 'crypt', 'lorn'],
      texture: ['rumble', 0.5, 0.3, 2500],
      set: { 'voice.octave': -1, 'filter.vowel': 0.7, 'filter.cutoff': 900, 'drive.amount': 0.55, 'eq.mid_gain': -5, 'eq.highcut': 5000 },
    },
    {
      id: 'wraith', name: 'Wraith',
      description: 'A thin, high voice singing "ee" from very far away: cold and unsettling.',
      tags: ['choir', 'vocal', 'high', 'thin', 'ee', 'eerie', 'lorn'],
      texture: ['air', 0.5, 0.45, 2500],
      set: { 'voice.octave': 1, 'filter.vowel': 0.45, 'filter.cutoff': 2600, 'eq.highcut': 8000, 'osc1.unison_voices': 2, 'osc1.unison_spread': 0.6, 'chorus.mix': 0.16 },
      mods: kit(VOICE_KIT, [['lfo1', 'filter_vowel', 0.09]]),
    },
    {
      id: 'dead-radio-choir', name: 'Dead Radio Choir',
      description: 'A choir caught on a dying radio: crushed, band-limited and buried in dust.',
      tags: ['choir', 'vocal', 'radio', 'crushed', 'lo-fi', 'dust', 'lorn'],
      texture: ['dust', 0.55, 0.4, 2000],
      set: { 'crush.mix': 0.3, 'crush.bits': 5, 'crush.rate': 9, 'eq.highcut': 4500, 'tape.wow': 0.3, 'drive.amount': 0.6 },
    },
    {
      id: 'lament', name: 'Lament',
      description: 'Voices that rise slowly out of silence and open their mouths as the note is held.',
      tags: ['choir', 'vocal', 'slow', 'swell', 'lament', 'cinematic', 'lorn'],
      texture: ['air', 0.45, 0.3, 3000],
      set: { 'amp_env.attack': 1500, 'env2.attack': 4000, 'env2.sustain': 1, 'reverb.mix': 0.5, 'filter.vowel': 0.85 },
      mods: kit(VOICE_KIT, [['env2', 'filter_vowel', -0.18]]),
    },
    {
      id: 'breathing-chorus', name: 'Breathing Chorus',
      description: 'A choir that breathes with the beat: heavy breath and a slow sidechain pump.',
      tags: ['choir', 'vocal', 'breath', 'pump', 'rhythmic', 'dark', 'lorn'],
      texture: ['air', 0.45, 0.4, 1500],
      set: { 'breath.level': 0.45, 'comp.amount': 0.5, 'comp.pump': 0.45, 'reverb.mix': 0.35 },
    },
    {
      id: 'glass-angels', name: 'Glass Angels',
      description: 'High voices with a glassy FM shimmer: beautiful, but something is off.',
      tags: ['choir', 'vocal', 'fm', 'glass', 'angelic', 'eerie', 'lorn'],
      texture: ['air', 0.45, 0.45, 2500],
      set: { 'fm.amount': 0.15, 'fm.ratio': 2, 'filter.vowel': 0.3, 'filter.cutoff': 2600 },
    },
    {
      id: 'requiem-fog', name: 'Requiem Fog',
      description: 'A requiem dissolving into fog: voices smeared by echo and an endless dark room.',
      tags: ['choir', 'vocal', 'requiem', 'reverb', 'fog', 'ambient', 'lorn'],
      texture: ['dust', 0.45, 0.3, 3000],
      set: { 'reverb.mix': 0.55, 'reverb.size': 0.97, 'delay.mix': 0.2, 'filter.cutoff': 1500, 'drive.amount': 0.58 },
      mods: kit(VOICE_KIT, [['lfo1', 'filter_vowel', 0.12]]),
    },
    // ------------------------------------------------ iconic (LORN versions)
    {
      id: 'neon-hymn', name: 'Neon Hymn', iconic: true,
      description: 'A floating, ghostly choir singing from inside a machine city: soft vowels, phased, in an endless space.',
      tags: ['choir', 'ethereal', 'ghostly', 'cyberpunk', 'vowel', 'vast', 'lorn'],
      texture: ['air', 0.45, 0.4, 3000],
      set: {
        'osc1.wave': 'triangle', 'osc2.wave': 'sine', 'osc2.semi': 12, 'osc2.fine': 0, 'osc2.level': 0.2, 'filter.vowel': 0.7,
        'reverb.mix': 0.55, 'reverb.size': 0.97, 'phaser.mix': 0.15, 'phaser.rate': 0.1, 'amp_env.attack': 900, 'breath.level': 0.32,
      },
    },
    // ------------------------------------------------ filling the gaps
    {
      id: 'tape-choir', name: 'Tape Choir',
      description: 'A choir played back from an old tape machine: warbling, dulled and haunted, the voices smeared into one.',
      tags: ['choir', 'tape', 'warble', 'vintage', 'haunted', 'lo-fi', 'lorn'],
      texture: ['crackle', 0.6, 0.35, 2000],
      set: { 'filter.type': 'lowpass', 'filter.cutoff': 1500, 'filter.resonance': 0.15, 'tape.wow': 0.45, 'tape.age': 0.65, 'breath.level': 0.2 },
      mods: kit(VOICE_KIT, [], { 'lfo1>filter_vowel': ['lfo1', 'filter_cutoff', 0.15], 'lfo2>filter_vowel': ['lfo2', 'filter_cutoff', 0.1], 'random>filter_vowel': ['random', 'filter_cutoff', 0.1], 'env2>filter_vowel': ['env2', 'filter_cutoff', 0.1] }),
    },
    // ------------------------------------------------ producer range: the roles this category was missing
    {
      id: 'choir-stab', name: 'Choir Stab',
      description: "A choir hit: every voice on one short syllable, cut off and left to ring in a dark church.",
      tags: ['choir', 'stab', 'short', 'hit', 'vocal', 'cinematic', 'lorn', 'new'],
      texture: ['dust', 0.3, 0.35, 1500],
      set: { 'amp_env.attack': 3, 'amp_env.decay': 450, 'amp_env.sustain': 0, 'amp_env.release': 300, 'filter.vowel': 0.5, 'vibrato.depth': 0, 'breath.chiff': 0.3, 'comp.amount': 0.5, 'filter.resonance': 0.3, 'eq.highcut': 4500 },
    },
    {
      id: 'vox-chop', name: 'Vox Chop', audition: 'arp-line',
      description: "A chopped vocal syllable, short and rhythmic: the vowel snaps open on each note like a sliced sample.",
      tags: ['choir', 'chop', 'vocal', 'short', 'rhythmic', 'sliced', 'lorn', 'new'],
      texture: ['dust', 0.5, 0.35, 800],
      set: { 'amp_env.attack': 2, 'amp_env.decay': 200, 'amp_env.sustain': 0.4, 'amp_env.release': 80, 'vibrato.depth': 0, 'filter.vowel': 0.35, 'reverb.mix': 0.3, 'delay.mix': 0.2, 'delay.time': '1/8D', 'eq.mid_freq': 300, 'eq.mid_gain': -6 },
      mods: kit(VOICE_KIT, [['lfo1', 'filter_vowel', 0.12]]),
    },
    {
      id: 'broken-hymn', name: 'Broken Hymn',
      description: "A hymn sung through a blown speaker: voices clipped, crushed and torn, still trying to sing.",
      tags: ['choir', 'distorted', 'broken', 'dirty', 'harsh', 'menacing', 'lorn', 'new'],
      texture: ['crackle', 0.65, 0.4, 2000],
      set: { 'drive.amount': 0.75, 'dist.type': 'hard', 'dist.drive': 0.4, 'dist.mix': 0.6, 'crush.mix': 0.2, 'crush.bits': 7, 'crush.rate': 6, 'tape.age': 0.7, 'texture.position': 'after dynamics' },
    },
    {
      id: 'still-voices', name: 'Still Voices',
      description: "Voices held perfectly still, no vibrato and no wobble, only the vowel slowly turning: calm and clean.",
      tags: ['choir', 'steady', 'still', 'clean', 'calm', 'sustained', 'lorn', 'new'],
      texture: ['air', 0.5, 0.3, 2000],
      set: { 'vibrato.depth': 0, 'tape.wow': 0.05, 'drive.amount': 0.35, 'dist.drive': 0.12 },
      mods: kit(VOICE_KIT, [['lfo1', 'filter_vowel', 0.2], ['drift', 'pitch', 0.0005]]),
    },
    {
      id: 'dark-mass-stab', name: 'Dark Mass Stab',
      description: "Low voices hitting an 'oh' together: a heavy, dark choral stab that falls into a long room.",
      tags: ['choir', 'stab', 'low', 'dark', 'heavy', 'cinematic', 'lorn', 'new'],
      texture: ['dust', 0.5, 0.35, 2000],
      set: { 'voice.octave': -1, 'amp_env.attack': 5, 'amp_env.decay': 700, 'amp_env.sustain': 0.2, 'amp_env.release': 400, 'filter.vowel': 0.6, 'drive.amount': 0.6, 'vibrato.depth': 0, 'filter.resonance': 0.3, 'sub.level': 0.15 },
    },
    {
      id: 'hum-choir', name: 'Hum Choir',
      description: "A choir humming with closed mouths: soft, quick to speak, warm, close and intimate.",
      tags: ['choir', 'hum', 'soft', 'warm', 'intimate', 'quick', 'lorn', 'new'],
      texture: ['air', 0.5, 0.3, 1500],
      set: { 'amp_env.attack': 40, 'filter.type': 'lowpass', 'filter.cutoff': 900, 'filter.resonance': 0.1, 'breath.level': 0.1, 'drive.amount': 0.35, 'dist.drive': 0.12 },
      mods: kit(VOICE_KIT, [], { 'lfo1>filter_vowel': ['lfo1', 'filter_cutoff', 0.2], 'lfo2>filter_vowel': ['lfo2', 'filter_cutoff', 0.08], 'random>filter_vowel': ['random', 'filter_cutoff', 0.1], 'env2>filter_vowel': ['env2', 'filter_cutoff', 0.12] }),
    },
  ],
};

export default def;
