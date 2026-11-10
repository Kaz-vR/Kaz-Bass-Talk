#!/usr/bin/env python3
"""DEV ONLY. RUIN-1 versions of five Howard Scarr basses from u-he Diva's factory bank
(HS Bass Nine, HS Black Fuzz, HS Bonebreaker, HS Boomer, HS Cable Bass), translated by hand
from the .h2p files' module settings (Diva's knobs are 0-100 positions, read on its own curves,
so times and cutoffs are approximate). Written to data/library/bass-diva-*.json; validatePatch
fills every parameter not named here with its default at load. Not rendered or checked.

    python3 tools/build-diva.py
"""
import json
import os

LIB = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'data', 'library')

# What every one of them starts from: the dark-bass rules (clean sine sub on Direct out, oscillators
# high-passed before the drive), everything else off until a preset names it.
BASE = {
    'voice.polyphony': 1, 'voice.legato': True, 'voice.glide': 0, 'voice.octave': 0,
    'voice.velocity': 0.4, 'voice.analog': 0.25, 'wheel.move': 'preset default',
    'osc1.wave': 'saw', 'osc1.semi': 0, 'osc1.fine': 0, 'osc1.level': 0.8, 'osc1.unison_voices': 1,
    'osc1.highpass': 130, 'osc1.filter_type': 'high 24',
    'osc2.wave': 'saw', 'osc2.semi': 0, 'osc2.fine': 0, 'osc2.level': 0, 'osc2.unison_voices': 1,
    'osc2.highpass': 130, 'osc2.filter_type': 'high 24', 'osc2.sync': False,
    'sub.wave': 'sine', 'sub.octave': -1, 'sub.level': 0.6, 'sub.direct': True,
    'texture.level': 0, 'filter.on': True, 'filter.route_n': False,
    'filter.env_amount': 0, 'mod_env.on': False, 'drive.amount': 0,
    'dist.drive': 0, 'dist.mix': 1, 'tape.drive': 0, 'tape.wow': 0, 'tape.age': 0,
    'chorus.mix': 0, 'phaser.mix': 0, 'flanger.mix': 0, 'crush.mix': 0, 'grind.on': False,
}

PRESETS = [
    ('bass-diva-bass-nine', 'HS Bass Nine', 'heavy-reese',
     "After Howard Scarr's Diva classic: a fat, vintage Minimoog-style bass, two saws a hair apart over a round sub, the filter snapping open on every note and harder the harder you play.",
     ['bass', 'analog', 'vintage', 'phat', 'diva'], 'vibrato', {
         'voice.glide': 35, 'voice.velocity': 0.6, 'voice.analog': 0.3,
         'osc1.level': 0.45,
         'osc2.wave': 'pwm_saw', 'osc2.pulse_width': 0.5, 'osc2.fine': 9, 'osc2.level': 0.8,
         'sub.level': 0.55,
         'filter.type': 'lowpass', 'filter.cutoff': 480, 'filter.resonance': 0.18, 'drive.amount': 0.2, 'filter.keytrack': 0.42,
         'mod_env.on': True, 'filter.env_amount': 2.5 / 6, 'mod_env.attack': 12, 'mod_env.decay': 260, 'mod_env.sustain': 0.37, 'mod_env.release': 300,
         'amp_env.attack': 4, 'amp_env.decay': 60, 'amp_env.sustain': 0.7, 'amp_env.release': 90,
         'lfo1.shape': 'slow drift', 'lfo1.rate': 0.25, 'lfo1.sync': 'free',
         'mod1.source': 'velocity', 'mod1.dest': 'filter_cutoff', 'mod1.amount': 0.3,
         'mod2.source': 'lfo1', 'mod2.dest': 'osc_pitch', 'mod2.amount': 0.004,
         'tape.drive': 0.2, 'tape.age': 0.25,
     }),
    ('bass-diva-black-fuzz', 'HS Black Fuzz', 'single-body',
     "After Howard Scarr's Diva preset: a dirty digital sync bass, a pulse torn by hard sync and slowly shifting, fuzzed and bright on top of a clean sub.",
     ['bass', 'digital', 'sync', 'dirty', 'diva'], 'vibrato', {
         'voice.velocity': 0.5, 'voice.analog': 0.4,
         'osc1.wave': 'pulse', 'osc1.pulse_width': 0.5, 'osc1.level': 0.6,
         'osc2.wave': 'pulse', 'osc2.pulse_width': 0.5, 'osc2.semi': 4, 'osc2.fine': -40, 'osc2.sync': True, 'osc2.level': 0.65,
         'sub.level': 0.6,
         'texture.type': 'white noise', 'texture.level': 0.12, 'texture.tone': 0.6, 'texture.tail': 150, 'filter.route_n': True,
         'filter.type': 'lowpass', 'filter.cutoff': 420, 'filter.resonance': 0.25, 'drive.amount': 0.55, 'filter.keytrack': 0.42,
         'mod_env.on': True, 'filter.env_amount': 2.5 / 6, 'mod_env.attack': 3, 'mod_env.decay': 320, 'mod_env.sustain': 0, 'mod_env.release': 150,
         'amp_env.attack': 1, 'amp_env.decay': 90, 'amp_env.sustain': 0.7, 'amp_env.release': 110,
         'lfo2.shape': 'triangle', 'lfo2.rate': 0.35, 'lfo2.sync': 'free',
         'mod1.source': 'mod_env', 'mod1.dest': 'filter_resonance', 'mod1.amount': 0.2,
         'mod2.source': 'lfo2', 'mod2.dest': 'osc2_pitch', 'mod2.amount': 0.07,
         'mod3.source': 'lfo2', 'mod3.dest': 'osc2_pw', 'mod3.amount': 0.12,
         'mod4.source': 'velocity', 'mod4.dest': 'filter_cutoff', 'mod4.amount': 0.4,
         'dist.type': 'fuzz', 'dist.drive': 0.4, 'dist.mix': 0.6, 'dist.clean_below': 150,
     }),
    ('bass-diva-bonebreaker', 'HS Bonebreaker', 'heavy-reese',
     "After Howard Scarr's Diva preset: two synced saws gliding legato, a tempo-locked saw LFO chewing the filter as the note builds, noise pulsing with it, phased and driven.",
     ['bass', 'rhythmic', 'moving', 'phat', 'diva'], 'open', {
         'voice.glide': 120,
         'osc1.level': 0.75,
         'osc2.wave': 'pwm_saw', 'osc2.pulse_width': 0.5, 'osc2.fine': 6, 'osc2.level': 0.75,
         'sub.level': 0.55,
         'texture.type': 'white noise', 'texture.level': 0.15, 'texture.tone': 0.5, 'texture.tail': 200, 'filter.route_n': True,
         'filter.type': 'lowpass', 'filter.cutoff': 650, 'filter.resonance': 0.12, 'drive.amount': 0.35, 'filter.keytrack': 0.5,
         'mod_env.on': True, 'filter.env_amount': 1.5 / 6, 'mod_env.attack': 350, 'mod_env.decay': 450, 'mod_env.sustain': 0, 'mod_env.release': 300,
         'amp_env.attack': 1, 'amp_env.decay': 300, 'amp_env.sustain': 1, 'amp_env.release': 60,
         'lfo1.shape': 'saw_down', 'lfo1.sync': '1/8', 'lfo1.retrigger': True, 'lfo1.fade': 600,
         'mod1.source': 'lfo1', 'mod1.dest': 'filter_cutoff', 'mod1.amount': 0.25,
         'mod2.source': 'lfo1', 'mod2.dest': 'texture_level', 'mod2.amount': -0.35,
         'mod3.source': 'keytrack', 'mod3.dest': 'amp', 'mod3.amount': -0.3,
         'dist.type': 'soft', 'dist.drive': 0.3, 'dist.mix': 0.5, 'dist.clean_below': 150,
         'phaser.mix': 0.5, 'phaser.lowcut': 250,
     }),
    ('bass-diva-boomer', 'HS Boomer', 'single-body',
     "After Howard Scarr's Diva preset: a clean, dark, phat sub with a quick thump into every note and a long glide, made to sit under everything.",
     ['bass', 'sub', 'clean', 'dark', 'diva'], 'unstable', {
         'voice.glide': 150, 'voice.velocity': 0,
         'osc1.wave': 'triangle', 'osc1.level': 0.35, 'osc1.highpass': 120,
         'sub.level': 0.85, 'sub.clip': 2,
         'filter.type': 'lowpass', 'filter.cutoff': 300, 'filter.resonance': 0.3, 'filter.keytrack': 1,
         'mod_env.on': True, 'filter.env_amount': 1 / 6, 'mod_env.attack': 1, 'mod_env.decay': 120, 'mod_env.sustain': 0, 'mod_env.release': 100,
         'amp_env.attack': 6, 'amp_env.decay': 250, 'amp_env.sustain': 0.6, 'amp_env.release': 60,
         'lfo1.shape': 'drop', 'lfo1.rate': 12, 'lfo1.sync': 'free',
         'mod1.source': 'lfo1', 'mod1.dest': 'pitch', 'mod1.amount': 0.1,
     }),
    ('bass-diva-cable-bass', 'HS Cable Bass', 'single-body',
     "After Howard Scarr's Diva preset: a bright, aggressive poly pluck bass, a saw and a synced pulse snapping open, every note a little different, high notes damped.",
     ['bass', 'digital', 'pluck', 'aggressive', 'diva'], 'choke', {
         'voice.polyphony': 6, 'voice.legato': False, 'voice.velocity': 0.5, 'voice.analog': 0.45,
         'osc1.level': 0.75,
         'osc2.wave': 'pulse', 'osc2.pulse_width': 0.49, 'osc2.semi': 11, 'osc2.fine': 20, 'osc2.sync': True, 'osc2.level': 0.6,
         'sub.level': 0.4,
         'filter.type': 'lowpass', 'filter.cutoff': 600, 'filter.resonance': 0.1, 'drive.amount': 0.35, 'filter.keytrack': 0,
         'mod_env.on': True, 'filter.env_amount': 3 / 6, 'mod_env.attack': 1, 'mod_env.decay': 250, 'mod_env.sustain': 0.4, 'mod_env.release': 300,
         'amp_env.attack': 1, 'amp_env.decay': 400, 'amp_env.sustain': 0, 'amp_env.release': 120,
         'lfo1.shape': 'random', 'lfo1.sync': 'free',
         'mod1.source': 'mod_env', 'mod1.dest': 'osc2_pitch', 'mod1.amount': 0.2,
         'mod2.source': 'lfo1', 'mod2.dest': 'osc2_pitch', 'mod2.amount': 0.03,
         'mod3.source': 'keytrack', 'mod3.dest': 'amp', 'mod3.amount': -0.4,
         'mod4.source': 'modwheel', 'mod4.dest': 'filter_cutoff', 'mod4.amount': -0.4,
         'eq.b2_type': 'bell', 'eq.b2_freq': 400, 'eq.b2_gain': 4, 'eq.b2_q': 3,
         'dist.type': 'tube', 'dist.drive': 0.3, 'dist.mix': 0.5, 'dist.clean_below': 150,
         'chorus.mode': 'classic', 'chorus.mix': 0.2, 'chorus.lowcut': 250,
     }),
]


def main():
    for file, name, template, desc, tags, wheel, params in PRESETS:
        p = {'meta': {'name': name, 'description': desc, 'tags': tags + [template], 'category': 'bass',
                      'family': 'bass', 'collection': 'bank', 'audition': 'groove'}}
        p.update(BASE)
        p.update(params)
        p['wheel.preset'] = wheel
        with open(os.path.join(LIB, file + '.json'), 'w', encoding='utf-8') as fh:
            json.dump(p, fh, indent=2, ensure_ascii=False)
            fh.write('\n')
    print(f'{len(PRESETS)} presets written')


if __name__ == '__main__':
    main()
