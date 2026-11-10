#!/usr/bin/env python3
"""DEV ONLY. Port test (owner's call): ten presets from the owner's Arturia V Collection and u-he
Diva banks, translated by hand into RUIN-1 from their files (Diva .h2p module settings; Arturia's
serialized parameter lists, values 0..1). Knob curves are read approximately (Diva envelope times as
~10 s x (v/100)^3, cutoff as a note number; Arturia times as ~10 s x v^3, cutoffs as 20 Hz x 1000^v),
so times and cutoffs are close, not exact. A straight port: no LORN treatment added. What RUIN-1
lacks for each one is in its description. Written to data/library/porttest-*.json (category
`porttest`, shelf Porttest); not rendered or checked.

    python3 tools/build-porttest.py
"""
import json
import os

LIB = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'data', 'library')

BASE = {
    'voice.polyphony': 1, 'voice.legato': False, 'voice.glide': 0, 'voice.octave': 0,
    'voice.velocity': 0.4, 'voice.analog': 0.25, 'wheel.move': 'preset default',
    'osc1.wave': 'saw', 'osc1.semi': 0, 'osc1.fine': 0, 'osc1.level': 0.8, 'osc1.unison_voices': 1,
    'osc1.highpass': 20, 'osc1.filter_type': 'high 24',
    'osc2.wave': 'saw', 'osc2.semi': 0, 'osc2.fine': 0, 'osc2.level': 0, 'osc2.unison_voices': 1,
    'osc2.highpass': 20, 'osc2.filter_type': 'high 24', 'osc2.sync': False,
    'sub.wave': 'sine', 'sub.octave': -1, 'sub.level': 0, 'sub.direct': True,
    'texture.level': 0, 'filter.on': True, 'filter.route_n': False, 'filter.type': 'lowpass',
    'filter.env_amount': 0, 'mod_env.on': False, 'drive.on': True, 'drive.amount': 0, 'drive.mixer': 0,
    'dist.drive': 0, 'dist.mix': 1, 'tape.drive': 0, 'tape.wow': 0, 'tape.age': 0,
    'chorus.mix': 0, 'phaser.mix': 0, 'flanger.mix': 0, 'crush.mix': 0, 'grind.on': False,
}
BASS = {'osc1.highpass': 130, 'osc2.highpass': 130, 'sub.level': 0.6}


def env(on, oct_, a, d, s, r):
    return {'mod_env.on': on, 'filter.env_amount': oct_ / 6, 'mod_env.attack': a, 'mod_env.decay': d, 'mod_env.sustain': s, 'mod_env.release': r}


def amp(a, d, s, r):
    return {'amp_env.attack': a, 'amp_env.decay': d, 'amp_env.sustain': s, 'amp_env.release': r}


PRESETS = [
    # (file, name, family, audition, wheel, template tag or None, description, params)
    ('porttest-sg-ms-101', 'SG MS-101', 'bass', 'groove', 'open', 'ominous-fifth',
     "Port of Sjoerd van Geffen's Diva SG MS-101: a dark, aggressive mono bass, a saw and a fifth-up PWM saw "
     "through a resonant filter swept hard by a velocity-fed envelope. Missing: Diva's resonant high-pass before the filter.",
     {**BASS, 'voice.glide': 60, 'voice.legato': True, 'voice.velocity': 0.7, 'voice.analog': 0.4,
      'osc1.level': 0.6, 'osc2.wave': 'pwm_saw', 'osc2.semi': 7, 'osc2.pulse_width': 0.9, 'osc2.level': 0.55,
      'filter.cutoff': 170, 'filter.resonance': 0.65, 'filter.keytrack': 1, 'drive.amount': 0.35,
      **env(True, 4.8, 360, 850, 0.2, 360), **amp(1, 900, 0.75, 550),
      'mod1.source': 'velocity', 'mod1.dest': 'filter_cutoff', 'mod1.amount': 0.4,
      'chorus.mode': 'classic', 'chorus.mix': 0.25, 'chorus.lowcut': 250, 'phaser.mix': 0.25, 'phaser.lowcut': 250}),
    ('porttest-xs-modwheel-reese', 'XS Modwheel Reese', 'bass', 'groove', 'open', 'heavy-reese',
     "Port of Xenos Soundworks' Diva XS Modwheel Reese: the standard drum & bass Reese, three saws spread "
     "±35 cents with noise through a resonant filter; the mod wheel opens it. Missing: Diva's Bite filter.",
     {**BASS, 'voice.glide': 60, 'voice.legato': True, 'voice.analog': 0.35,
      'osc1.unison_voices': 3, 'osc1.unison_detune': 70, 'osc1.unison_spread': 0.3, 'osc1.level': 0.8,
      'texture.type': 'white noise', 'texture.level': 0.25, 'texture.tone': 0.6, 'texture.tail': 150, 'filter.route_n': True,
      'filter.cutoff': 430, 'filter.resonance': 0.55, 'filter.keytrack': 0, 'drive.amount': 0.3,
      **amp(1, 300, 1, 120),
      'lfo1.shape': 'triangle', 'lfo1.sync': '1/4', 'lfo1.retrigger': False,
      'mod1.source': 'lfo1', 'mod1.dest': 'filter_resonance', 'mod1.amount': 0.15,
      'mod2.source': 'modwheel', 'mod2.dest': 'filter_cutoff', 'mod2.amount': 0.5,
      'phaser.mix': 0.3, 'phaser.lowcut': 250}),
    ('porttest-bt-crushed-sines', 'BT crushed sines', 'bass', 'groove', 'decay', 'single-body',
     "Port of BigTone's Diva BT crushed sines: an ambient sine with a zapping attack, crushed and dark, harder "
     "notes zapping further. Missing: Diva's self-oscillating filter (the sine is an oscillator here) and its reverb and delay.",
     {**BASS, 'voice.polyphony': 4, 'voice.velocity': 0.85, 'voice.analog': 0,
      'osc1.wave': 'sine', 'osc1.level': 0.85, 'osc1.highpass': 20, 'sub.level': 0.35,
      'filter.cutoff': 300, 'filter.resonance': 0.6, 'filter.keytrack': 1,
      **env(True, 4, 1, 15, 0, 10), **amp(5, 10000, 1, 900),
      'lfo1.shape': 'drop', 'lfo1.rate': 25, 'lfo1.sync': 'free',
      'mod1.source': 'lfo1', 'mod1.dest': 'pitch', 'mod1.amount': 0.15,
      'mod2.source': 'velocity', 'mod2.dest': 'filter_cutoff', 'mod2.amount': 0.35,
      'crush.bits': 6, 'crush.rate': 3, 'crush.mix': 0.4}),
    ('porttest-th-rough-rider', 'TH Rough Rider', 'bass-short', 'groove', 'choke', 'ominous-fifth',
     "Port of Thomas Helzle's Diva TH Rough Rider: a dirty, aggressive plucked mono bass, a saw and a fifth-up "
     "PWM saw, fed back hard into a bright filter that the mod wheel closes. Missing: the moving resonant high-pass.",
     {**BASS, 'voice.glide': 40, 'voice.legato': True, 'voice.velocity': 0.85, 'voice.analog': 0.3,
      'osc1.level': 0.35, 'osc2.wave': 'pwm_saw', 'osc2.semi': 7, 'osc2.pulse_width': 0.375, 'osc2.level': 0.85,
      'filter.cutoff': 2500, 'filter.resonance': 0.2, 'filter.keytrack': 0.5, 'drive.amount': 0.6,
      **env(True, 3, 1, 1000, 0, 1000), **amp(1, 25, 1, 1000),
      'lfo1.shape': 'wander', 'lfo1.rate': 1.3, 'lfo1.sync': 'free',
      'mod1.source': 'lfo1', 'mod1.dest': 'osc1_pitch', 'mod1.amount': 0.002,
      'mod2.source': 'velocity', 'mod2.dest': 'filter_cutoff', 'mod2.amount': 0.3,
      'mod3.source': 'modwheel', 'mod3.dest': 'filter_cutoff', 'mod3.amount': -0.6,
      'dist.type': 'soft', 'dist.drive': 0.3, 'dist.mix': 0.5, 'dist.clean_below': 150,
      'phaser.mix': 0.25, 'phaser.lowcut': 250}),
    ('porttest-from-the-deep', 'From The Deep', 'bass', 'groove', 'pressure', 'single-body',
     "Port of Arturia SEM V's From The Deep: an atmospheric, deep pulse bass through the SEM filter, overdriven, "
     "playing harder opens and drives it.",
     {**BASS, 'voice.velocity': 0.7, 'voice.analog': 0.35,
      'osc1.wave': 'pulse', 'osc1.pulse_width': 0.5, 'osc1.level': 0.8,
      'filter.type': 'sem', 'filter.cutoff': 460, 'filter.resonance': 0, 'filter.keytrack': 0, 'drive.amount': 0.52,
      **env(True, 0.7, 1, 60, 0, 60), **amp(1, 290, 0.45, 130),
      'mod1.source': 'velocity', 'mod1.dest': 'filter_cutoff', 'mod1.amount': 0.34,
      'mod2.source': 'velocity', 'mod2.dest': 'drive', 'mod2.amount': 0.6}),
    ('porttest-velo-sem', 'Velo SEM', 'bass-short', 'groove', 'open', 'heavy-reese',
     "Port of Arturia SEM V's Velo SEM: two unison saws through a resonant, key-tracked SEM filter that plucks "
     "with every note, the velocity setting how far.",
     {**BASS, 'voice.velocity': 0.8, 'voice.analog': 0.25,
      'osc1.unison_voices': 3, 'osc1.unison_detune': 18, 'osc1.unison_spread': 0.75, 'osc1.level': 0.7,
      'osc2.fine': 3, 'osc2.level': 0.7,
      'filter.type': 'sem', 'filter.cutoff': 460, 'filter.resonance': 0.63, 'filter.keytrack': 0.81, 'drive.amount': 0.14,
      **env(True, 1.9, 1, 210, 0, 100), **amp(1, 500, 1, 130),
      'mod1.source': 'velocity', 'mod1.dest': 'filter_cutoff', 'mod1.amount': 0.55}),
    ('porttest-rita', 'Rita', 'lead', 'lead-line', 'vibrato', None,
     "Port of Arturia SEM V's Rita: a two-saw mono lead an octave up through a resonant SEM filter, softly "
     "swelling in; the mod wheel brings in the vibrato.",
     {'voice.velocity': 0.8, 'voice.analog': 0.25,
      'osc1.semi': 12, 'osc1.level': 0.7, 'osc2.semi': 12, 'osc2.fine': 2, 'osc2.level': 0.7,
      'filter.type': 'sem', 'filter.cutoff': 460, 'filter.resonance': 0.64, 'filter.keytrack': 0.81, 'drive.amount': 0.14,
      **amp(120, 550, 1, 130),
      'mod1.source': 'velocity', 'mod1.dest': 'filter_cutoff', 'mod1.amount': 0.55}),
    ('porttest-razor-hoover', 'Razor Hoover', 'lead', 'lead-line', 'open', None,
     "Port of Arturia Mini V's Razor Hoover: three saws stacked in unison and detuned into a hoover, with noise, "
     "through an almost open ladder filter. The Mini's third oscillator, two octaves down, is the sub here.",
     {'voice.legato': True, 'voice.analog': 0.3,
      'osc1.unison_voices': 5, 'osc1.unison_detune': 35, 'osc1.unison_spread': 0.4, 'osc1.level': 0.75,
      'osc2.unison_voices': 3, 'osc2.unison_detune': 25, 'osc2.fine': 6, 'osc2.level': 0.7,
      'sub.wave': 'saw', 'sub.octave': -2, 'sub.level': 0.45,
      'texture.type': 'white noise', 'texture.level': 0.2, 'texture.tone': 0.6, 'texture.tail': 150, 'filter.route_n': True,
      'filter.cutoff': 8000, 'filter.resonance': 0.35, 'filter.keytrack': 0, 'drive.amount': 0.2,
      **env(True, 0.9, 1, 60, 1, 100), **amp(1, 250, 0.54, 150)}),
    ('porttest-down-not-out', 'Down Not Out', 'bass', 'groove', 'bloom', 'deep-rumble',
     "Port of Arturia Jup-8 V's Down Not Out: a long, evolving Jupiter bass, a pulse an octave down under a saw, "
     "the filter opening slowly as the note holds and drifting with a slow LFO. Missing: the Jupiter's cross-mod.",
     {'voice.velocity': 0.55, 'voice.analog': 0.3,
      'osc1.wave': 'pulse', 'osc1.pulse_width': 0.5, 'osc1.semi': -12, 'osc1.level': 0.6, 'osc1.highpass': 60,
      'osc2.level': 0.6, 'osc2.highpass': 200, 'sub.octave': -2, 'sub.level': 0.6,
      'filter.cutoff': 1050, 'filter.resonance': 0.25, 'filter.keytrack': 1, 'drive.amount': 0.2,
      **env(True, 1.5, 2700, 10000, 0.62, 700), **amp(1, 1650, 1, 5600),
      'lfo1.shape': 'sine', 'lfo1.rate': 0.15, 'lfo1.sync': 'free', 'lfo1.retrigger': False,
      'mod1.source': 'lfo1', 'mod1.dest': 'filter_cutoff', 'mod1.amount': 0.06,
      'mod2.source': 'velocity', 'mod2.dest': 'filter_cutoff', 'mod2.amount': 0.08,
      'dist.type': 'fold', 'dist.drive': 0.15, 'dist.mix': 0.3, 'dist.clean_below': 150}),
    ('porttest-brutish', 'Brutish', 'pad', 'chords', 'bloom', None,
     "Port of Arturia Jup-8 V's Brutish: a slow Jupiter pad, a pulse an octave down and a saw, the resonant filter "
     "swelling open over seconds, gently vibrating, through the Juno / Jupiter chorus. Missing: the cross-mod.",
     {'voice.polyphony': 8, 'voice.velocity': 0.4, 'voice.analog': 0.4,
      'osc1.wave': 'pulse', 'osc1.pulse_width': 0.5, 'osc1.semi': -12, 'osc1.level': 0.6,
      'osc2.fine': 7, 'osc2.level': 0.6,
      'filter.cutoff': 490, 'filter.resonance': 0.45, 'filter.keytrack': 0.5, 'drive.amount': 0.15,
      **env(True, 3, 5000, 2600, 0, 2400), **amp(2800, 60, 0.47, 1100),
      'lfo1.shape': 'sine', 'lfo1.rate': 5, 'lfo1.sync': 'free',
      'mod1.source': 'lfo1', 'mod1.dest': 'osc_pitch', 'mod1.amount': 0.003,
      'chorus.mode': 'bbd', 'chorus.mix': 0.45, 'chorus.lowcut': 250}),
]


def main():
    for old in os.listdir(LIB):
        if old.startswith('porttest-'):
            os.remove(os.path.join(LIB, old))
    for file, name, family, audition, wheel, tpl, desc, params in PRESETS:
        tags = ['porttest', 'port']
        if tpl:
            tags.append(tpl)
        p = {'meta': {'name': name, 'description': desc, 'tags': tags, 'category': 'porttest',
                      'family': 'bass' if family.startswith('bass') else family, 'collection': 'bank', 'audition': audition}}
        p.update(BASE)
        p.update(params)
        p['wheel.preset'] = wheel
        with open(os.path.join(LIB, file + '.json'), 'w', encoding='utf-8') as fh:
            json.dump(p, fh, indent=2, ensure_ascii=False)
            fh.write('\n')
    print(f'{len(PRESETS)} presets written')


if __name__ == '__main__':
    main()
