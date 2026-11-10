#!/usr/bin/env python3
"""DEV ONLY. Turn the text recipes in RUIN-1_Batch{1,2,3}_presets.txt into bank presets
(data/library/batch<n>-<category>-<name>.json). Each recipe line is read into the schema's
parameters; anything a line leaves out keeps the schema default (validatePatch fills it in at
load). The presets are not rendered or checked (owner's call: checked by ear).

    python3 tools/build-batches.py
"""
import json
import math
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LIB = os.path.join(ROOT, 'data', 'library')
BATCHES = [os.path.join(ROOT, f'RUIN-1_Batch{n}_presets.txt') for n in (1, 2, 3)]

CATEGORY = {'BassLong': 'bass', 'BassShort': 'bass-short', 'Lead': 'lead', 'Pads': 'pad',
            'Keys': 'keys', 'Plucks': 'pluck', 'Other': 'other'}
FAMILY = {'bass': 'bass', 'bass-short': 'bass'}
AUDITION = {'bass': 'groove', 'bass-short': 'groove', 'lead': 'lead-line', 'pad': 'chords',
            'keys': 'chords', 'pluck': 'arp-line', 'other': 'chords'}

DESTS = [('A+B Detune', 'unison_detune'), ('A+B Pitch', 'osc_pitch'), ('A+B Shape', 'osc12_shape'),
         ('Fil Cutoff', 'filter_cutoff'), ('Fil Drive', 'drive'), ('Fil Res', 'filter_resonance'),
         ('Dis Drive', 'dist_drive'), ('Dis Mix', 'dist_mix'), ('Dis Tone', 'dist_tone'),
         ('Noise Pitch', 'noise_pitch'), ('Noise Level', 'texture_level'), ('Sub Pitch', 'sub_pitch'),
         ('Sub Level', 'sub_level'), ('A Pitch', 'osc1_pitch'), ('B Pitch', 'osc2_pitch'),
         ('A Shape', 'osc1_pw'), ('B Shape', 'osc2_pw'), ('A Level', 'osc1_level'),
         ('B Level', 'osc2_level'), ('Vibrato', 'vibrato_depth'), ('Pitch', 'pitch'), ('Level', 'amp')]
SHAPES = ['slow drift', 'sample_hold', 'saw_down', 'saw_up', 'triangle', 'wander', 'bloom', 'drop',
          'random', 'drift', 'sine', 'square']
NOISE = ['white noise hit', 'tape hiss hit', 'crackle hit', 'rumble hit', 'static hit', 'dust hit',
         'air hit', 'white noise', 'tape hiss', 'crackle', 'rumble', 'static', 'dust', 'air']
SUBS = ['warm sine', 'sine', 'triangle', 'square', 'pulse', 'saw']


def num(rx, s, cast=float):
    m = re.search(rx, s)
    return cast(m.group(1)) if m else None


def hz(rx, s):
    """A frequency like '450 Hz' or '1.2 kHz' after the pattern."""
    m = re.search(rx + r'\s*([\d.]+)\s*(k?)Hz', s)
    return float(m.group(1)) * (1000 if m.group(2) else 1) if m else None


def pct(rx, s):
    v = num(rx + r'\s*([+-]?[\d.]+)\s*%', s)
    return None if v is None else v / 100


def clamp(v, lo, hi):
    return max(lo, min(hi, v))


def split_top(s, sep):
    """Split on sep outside parentheses."""
    out, depth, cur = [], 0, ''
    for ch in s:
        depth += ch == '('
        depth -= ch == ')'
        if ch == sep and depth == 0:
            out.append(cur)
            cur = ''
        else:
            cur += ch
    out.append(cur)
    return [x.strip() for x in out if x.strip()]


def read_batches():
    head = re.compile(r'^(' + '|'.join(CATEGORY) + r')\.Batch(\d)\.(\w+)\s*$')
    field = re.compile(r'^  ([A-Z][A-Za-z /]*?):\s+(.*)$')
    entries = []
    for path in BATCHES:
        cur, key = None, None
        for line in open(path, encoding='utf-8'):
            line = line.rstrip('\n')
            m = head.match(line)
            if m:
                cur = {'id': line.strip(), 'cat': m.group(1), 'batch': int(m.group(2)), 'short': m.group(3), 'f': {}}
                entries.append(cur)
                key = None
                continue
            if cur is None:
                continue
            if not line.strip() or line.startswith('=') or line.startswith('-'):
                if not line.strip():
                    key = None
                continue
            m = field.match(line)
            if m:
                key = m.group(1)
                cur['f'][key] = m.group(2).strip()
            elif key and line.startswith('   '):
                cur['f'][key] += ' ' + line.strip()
    return entries


def osc(p, n, s):
    o = f'osc{n}.'
    lead = s.lower()
    if lead.startswith('off') or re.match(r'^level 0\b', lead):
        p[o + 'level'] = 0
        return
    wave = None
    for w in ['wavetable', 'pwm_saw', 'triangle', 'string', 'square', 'pulse', 'sine', 'saw']:
        if lead.startswith(w):
            wave = w
            break
    if wave == 'square':
        p[o + 'wave'] = 'pulse'
        p[o + 'pulse_width'] = 0.5
    elif wave:
        p[o + 'wave'] = wave
    semi = (num(r'OCT ([+-]?\d+)', s, int) or 0) * 12 + (num(r'SEM ([+-]?\d+)', s, int) or 0)
    p[o + 'semi'] = clamp(semi, -24, 24)
    if (v := num(r'FIN ([+-]?[\d.]+)', s)) is not None:
        p[o + 'fine'] = clamp(v, -100, 100)
    p[o + 'unison_voices'] = clamp(num(r'UNI (\d)', s, int) or 1, 1, 7)
    if (v := num(r'detune ([\d.]+) ct', s)) is not None:
        p[o + 'unison_detune'] = clamp(v, 0, 100)
    if (v := pct(r'spread', s)) is not None:
        p[o + 'unison_spread'] = clamp(v, 0, 1)
    if (v := pct(r'Shape(?: \(position\))?', s)) is not None:
        if (wave or p.get(o + 'wave')) == 'wavetable':
            p[o + 'wt_pos'] = clamp(v, 0, 1)
        else:
            p[o + 'pulse_width'] = clamp(v, 0.05, 0.95)
    if (v := pct(r'level', s)) is not None:
        p[o + 'level'] = clamp(v, 0, 1)
    elif n == 1:
        p[o + 'level'] = 0.8
    else:
        p[o + 'level'] = 0.6
    if (v := hz(r'Lo cut', s)) is not None:
        p[o + 'highpass'] = clamp(v, 20, 20000)
        p[o + 'filter_type'] = 'high 24'
    if n == 2 and re.search(r'Sync on', s):
        p['osc2.sync'] = True
    if (v := pct(r'string tone', s)) is not None:
        p['string.tone'] = v
    if 'string tone' in s and (v := pct(r'decay', s.split('string tone', 1)[1])) is not None:
        p['string.decay'] = v


def sub(p, s):
    low = s.lower()
    if low.startswith('off') or re.match(r'^level 0\b', low):
        p['sub.level'] = 0
        return
    for w in SUBS:
        if low.startswith(w):
            p['sub.wave'] = w
            break
    if (v := num(r'OCT ([+-]?\d+)', s, int)) is not None:
        p['sub.octave'] = clamp(v, -4, 4)
    p['sub.level'] = clamp(pct(r'level', s) or 0.5, 0, 1)
    if (v := num(r'Clip ([\d.]+) dB', s)) is not None:
        p['sub.clip'] = clamp(v, 0, 12)
    if re.search(r'Direct out off', s):
        p['sub.direct'] = False


def noise(p, s):
    low = s.lower()
    for t in NOISE:
        if low.startswith(t):
            p['texture.type'] = t
            break
    p['texture.level'] = clamp(pct(r'level', s) or 0.2, 0, 1)
    if (v := pct(r'tone', s)) is not None:
        p['texture.tone'] = v
    if (v := pct(r'density', s)) is not None:
        p['texture.density'] = v
    if (v := num(r'tail ([\d.]+) ms', s)) is not None:
        p['texture.tail'] = clamp(v, 20, 6000)
    if (v := num(r'OCT ([+-]?\d+)', s, int)) is not None:
        p['texture.octave'] = clamp(v, -6, 2)
    if re.search(r'KEY on', s):
        p['texture.key'] = True
    if (v := hz(r'Lo cut', s)) is not None:
        p['texture.filter_type'] = 'high 24'
        p['texture.filter_cutoff'] = clamp(v, 20, 20000)
    if re.search(r'route N on', s):
        p['filter.route_n'] = True


def filt(p, s):
    low = s.lower()
    if low.startswith('off'):
        p['filter.on'] = False
        return
    for k, v in [('low-pass gate', 'lpg'), ('low-pass', 'lowpass'), ('band-pass', 'bandpass'),
                 ('high-pass', 'highpass'), ('diode', 'diode'), ('comb', 'comb'), ('notch', 'notch'), ('lpg', 'lpg')]:
        if low.startswith(k):
            p['filter.type'] = v
            break
    if (v := hz(r'cutoff', s)) is not None:
        p['filter.cutoff'] = clamp(v, 20, 20000)
    if (v := pct(r'res', s)) is not None:
        p['filter.resonance'] = clamp(v, 0, 1)
    if (v := pct(r'ACCENT', s)) is not None:
        p['filter.accent'] = v
    if (v := pct(r'Drive', s)) is not None:
        p['drive.amount'] = clamp(v, 0, 1)
    if (v := pct(r'KEY', s)) is not None:
        p['filter.keytrack'] = clamp(v, 0, 1)


def adsr(p, pre, s, maxa):
    if (v := num(r'\bA ([\d.]+)', s)) is not None:
        p[pre + 'attack'] = clamp(v, 0.5, maxa)
    if (v := num(r'\bD ([\d.]+)', s)) is not None:
        p[pre + 'decay'] = clamp(v, 1, 20000 if pre == 'amp_env.' else 10000)
    if (v := pct(r'\bS', s)) is not None:
        p[pre + 'sustain'] = clamp(v, 0, 1)
    if (v := num(r'\bR ([\d.]+)', s)) is not None:
        p[pre + 'release'] = clamp(v, 1, 15000 if pre == 'amp_env.' else 10000)
    if re.search(r'bent down|slow start|a swell', s):
        p[pre + 'attack_bend'] = -0.6


def fenv(p, s):
    if s.lower().startswith('off'):
        p['filter.env_amount'] = 0
        p['mod_env.on'] = False
        return
    p['mod_env.on'] = True
    if (v := num(r'ENV ([+-]?[\d.]+) oct', s)) is not None:
        p['filter.env_amount'] = clamp(v / 6, -1.661, 1.661)
    adsr(p, 'mod_env.', s.split('),', 1)[-1] if '),' in s else s, 5000)


def sync_value(t):
    t = t.strip()
    m = re.match(r'(\d+) bars?', t)
    if m:
        b = int(m.group(1))
        return '1/1' if b <= 1 else '2/1' if b <= 2 else '4/1'
    m = re.match(r'(1/\d+[DT]?)', t)
    return m.group(1) if m else None


def mods(p, s):
    if s.lower().startswith('none'):
        return
    slot, lfos = 0, {}
    parts = []
    for part in split_top(s, ';'):
        part = part.strip()
        if part.startswith('(') and part.endswith(')'):
            part = part[1:-1]
        part = re.sub(r'^[a-z ]+:\s*', '', part)
        parts.append(part)
    for part in parts:
        if '→' not in part:
            continue
        src_t, dst_t = [x.strip() for x in part.split('→', 1)]
        dest = next((d for name, d in DESTS if dst_t.startswith(name)), None)
        amt = pct('', dst_t[len(next(name for name, d in DESTS if d == dest)):]) if dest else None
        if dest is None or amt is None:
            continue
        m = re.match(r'LFO (\d)\s*(.*)', src_t)
        if m:
            n = int(m.group(1))
            src = f'lfo{n}'
            spec = m.group(2)
            if spec and n not in lfos:
                lo = spec.lower()
                shape = next((x for x in SHAPES if lo.startswith(x)), None)
                if shape:
                    p[f'lfo{n}.shape'] = shape
                if (v := num(r'([\d.]+) Hz', spec)) is not None:
                    p[f'lfo{n}.rate'] = clamp(v, 0.01, 30)
                    p[f'lfo{n}.sync'] = 'free'
                elif shape == 'drift':
                    p[f'lfo{n}.rate'] = 1
                elif shape == 'slow drift':
                    p[f'lfo{n}.rate'] = 0.25
                ms = re.search(r'Sync ([\w/ ]+?)(?:,|\(|$)', spec)
                if ms and (sv := sync_value(ms.group(1))):
                    p[f'lfo{n}.sync'] = sv
                if (v := num(r'fade ([\d.]+) ms', spec)) is not None:
                    p[f'lfo{n}.fade'] = clamp(v, 0, 8000)
                if 'retrig off' in spec:
                    p[f'lfo{n}.retrigger'] = False
                elif 'retrig on' in spec:
                    p[f'lfo{n}.retrigger'] = True
                lfos[n] = True
            p[f'lfo{n}.on'] = True
        elif src_t.startswith('Velocity'):
            src = 'velocity'
        elif src_t.startswith('Mod wheel'):
            src = 'modwheel'
        elif src_t.startswith('Filter env'):
            src = 'mod_env'
            p['mod_env.on'] = True
        elif src_t.startswith('Amp env'):
            src = 'amp_env'
        elif src_t.startswith('Keytrack'):
            src = 'keytrack'
        else:
            continue
        slot += 1
        if slot > 12:
            break
        p[f'mod{slot}.source'] = src
        p[f'mod{slot}.dest'] = dest
        p[f'mod{slot}.amount'] = clamp(amt, -1, 1)
        p[f'mod{slot}.on'] = True


def fx(p, s):
    for part in split_top(s, ';'):
        low = part.lower()
        if low.startswith('distortion'):
            m = re.match(r'distortion (soft|hard|fold|tube|fuzz)', low)
            if m:
                p['dist.type'] = m.group(1)
            p['dist.drive'] = pct(r'drive', part) or 0.3
            p['dist.mix'] = pct(r'mix', part) or 1
            if (v := pct(r'tone', part)) is not None:
                p['dist.post_tone'] = v
            if (v := hz(r'clean below', part)) is not None:
                p['dist.clean_below'] = clamp(v, 20, 500)
        elif low.startswith('crush'):
            if (v := num(r'bits (\d+)', part)) is not None:
                p['crush.bits'] = clamp(v, 2, 16)
            if (v := pct(r'rate', part)) is not None:
                p['crush.rate'] = clamp(1 + v * 15, 1, 40)
            p['crush.mix'] = pct(r'mix', part) or 0.3
        elif low.startswith('tape'):
            for k in ('drive', 'wow', 'age'):
                if (v := pct(k, part)) is not None:
                    p['tape.' + k] = clamp(v, 0, 1)
        elif low.startswith('chorus'):
            m = re.match(r'chorus (classic|ensemble|hyper)', low)
            if m:
                p['chorus.mode'] = m.group(1)
            p['chorus.mix'] = pct(r'mix', part) or 0.25
            if (v := hz(r'Lo cut', part)) is not None:
                p['chorus.lowcut'] = clamp(v, 20, 1000)
        elif low.startswith('flanger'):
            p['flanger.mix'] = pct(r'mix', part) or 0.2
        elif low.startswith('phaser'):
            p['phaser.mix'] = pct(r'mix', part) or 0.25
            if (v := hz(r'Lo cut', part)) is not None:
                p['phaser.lowcut'] = clamp(v, 20, 1000)
        elif low.startswith('ott'):
            p['ott.on'] = True
            p['ott.depth'] = pct(r'mix', part) or 0.25
            if (v := hz(r'Lo cut', part)) is not None:
                p['ott.lowcut'] = clamp(v, 20, 1000)
        elif low.startswith('eq') or low.startswith('band'):
            eq(p, part)


def eq(p, s):
    for m in re.finditer(r'band (\d) ([a-z -]+?)\s*(?:([+-]?[\d.]+) dB at )?([\d.]+)\s*(k?)Hz', s):
        b, kind, gain, f, k = int(m.group(1)), m.group(2).strip(), m.group(3), float(m.group(4)), m.group(5)
        f *= 1000 if k else 1
        pre = f'eq.b{b}_'
        if kind.startswith('high-pass') and b == 1:
            p[pre + 'type'] = 'high pass'
        elif kind.startswith('low-pass') and b == 4:
            p[pre + 'type'] = 'low pass'
        elif kind.startswith('notch') and b in (2, 3):
            p[pre + 'type'] = 'notch'
        elif kind.startswith('high shelf') and b == 4:
            p[pre + 'type'] = 'high shelf'
        if gain:
            p[pre + 'gain'] = clamp(float(gain), -18, 18)
        p[pre + 'freq'] = clamp(f, 20, 20000)


def ruin(p, s):
    if not s.lower().startswith('on'):
        return
    p['grind.on'] = True
    p['grind.sat'] = 0.3
    p['grind.preott'] = 0
    stages = num(r'(\d)(?:-\d)? stages?', s, int) or 1
    types = re.findall(r'\b(notch|peak|band|comb|phaser)\b', s.split('drive')[0])
    drives = re.findall(r'\b(soft|hard|fold|tube|fuzz)\b', s.split('drive', 1)[1] if 'drive' in s else '')
    wander = 'wander' in s
    rate = num(r'Rate ([\d.]+)', s) or num(r'wander ([\d.]+)', s)
    clock = 'hz' if '(HZ)' in s else 'random'
    dpct = pct(r'drives? (?:soft|hard|fold|tube|fuzz)', s)
    for n in range(1, 5):
        g = f'grind{n}.'
        p[g + 'on'] = n <= stages
        if n > stages:
            continue
        if types:
            p[g + 'filter'] = types[(n - 1) % len(types)]
        p[g + 'move'] = 'wander' if wander else 'note'
        p[g + 'clock'] = clock
        if rate is not None and 'ms sweep' not in s:
            p[g + 'rate'] = clamp(math.log2(max(rate, 0.1) / 0.1) / 8, 0, 1)
        if drives:
            p[g + 'drive_type'] = drives[(n - 1) % len(drives)]
        p[g + 'drive'] = dpct if dpct is not None else 0.6
        if (v := pct(r'V Range', s)) is not None:
            p[g + 'vrange'] = v
    if (v := pct(r'(?:chain )?Mix', s)) is not None:
        p['grind.mix'] = v
    if (v := hz(r'Lo cut', s)) is not None:
        p['grind.lowcut'] = clamp(v, 20, 2000)
    if (v := pct(r'OTT', s)) is not None:
        p['grind.ott'] = v
    else:
        p['grind.ott'] = 0
    p['grind.oneshot'] = bool(re.search(r'ONE SHOT on', s))
    p['grind.key'] = bool(re.search(r'KEY on', s))
    p['grind.noise_thru'] = bool(re.search(r'NOISE THRU on', s))


def voice(p, s):
    p['voice.polyphony'] = clamp(num(r'Poly (\d)', s, int) or 1, 1, 8)
    p['voice.legato'] = bool(re.search(r'\blegato\b(?! off)', s))
    if (v := num(r'glide ([\d.]+) ms', s)) is not None:
        p['voice.glide'] = clamp(v, 0, 2000)
    if (v := pct(r'Analog', s)) is not None:
        p['voice.analog'] = v
    if (v := pct(r'Velocity', s)) is not None:
        p['voice.velocity'] = v


def first_sentence(t):
    m = re.match(r'(.+?[.!?])(\s|$)', t)
    return (m.group(1) if m else t).strip()


def build(e):
    f = e['f']
    cat = CATEGORY[e['cat']]
    p = {
        # quiet defaults the recipes assume: only what a line names sounds
        'sub.level': 0, 'osc2.level': 0, 'texture.level': 0, 'filter.env_amount': 0,
        'mod_env.on': False, 'lfo1.on': False,
    }
    voice(p, f.get('Voice', 'Mono'))
    if 'OSC A / OSC B' in f:
        p['osc1.level'] = 0
        p['osc2.level'] = 0
    if 'OSC A' in f:
        osc(p, 1, f['OSC A'])
    if 'OSC B' in f:
        osc(p, 2, f['OSC B'])
    if 'Sub' in f:
        sub(p, f['Sub'])
    if 'Noise' in f:
        noise(p, f['Noise'])
    if 'Filter' in f:
        filt(p, f['Filter'])
    if 'Filter env' in f:
        fenv(p, f['Filter env'])
    if 'Amp' in f:
        adsr(p, 'amp_env.', f['Amp'], 20000)
    if 'LFO / Mod' in f:
        mods(p, f['LFO / Mod'])
    if 'FX' in f:
        fx(p, f['FX'])
    if 'RUIN' in f:
        ruin(p, f['RUIN'])
    w = re.match(r'(\w+)', f.get('Wheel', ''))
    p['wheel.move'] = 'preset default'
    p['wheel.preset'] = w.group(1) if w else 'open'
    tags = [f'batch{e["batch"]}', cat]
    if 'Aprox' in e['short']:
        tags.append('aprox')
    p['meta'] = {
        'name': e['id'],
        'description': first_sentence(f.get('Sound', '')),
        'tags': tags,
        'category': cat,
        'family': FAMILY.get(cat, cat),
        'collection': 'bank',
        'audition': AUDITION[cat],
        'recipe': {k: v for k, v in f.items()},
    }
    return p


def slug(s):
    return re.sub(r'(?<!^)(?=[A-Z])', '-', s).lower()


def main():
    entries = read_batches()
    for old in os.listdir(LIB):
        if old.startswith('batch') and old.endswith('.json'):
            os.remove(os.path.join(LIB, old))
    for e in entries:
        p = build(e)
        name = f'batch{e["batch"]}-{CATEGORY[e["cat"]]}-{slug(e["short"])}.json'
        with open(os.path.join(LIB, name), 'w', encoding='utf-8') as fh:
            json.dump(p, fh, indent=2, ensure_ascii=False)
            fh.write('\n')
    print(f'{len(entries)} presets written', file=sys.stderr)


if __name__ == '__main__':
    main()
