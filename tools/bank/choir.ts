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
  ],
};

export default def;
