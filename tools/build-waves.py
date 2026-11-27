"""Dev only: the processed waves (owner's call, 27 Nov: made the way Serum's tables are, not as formulas).

Every wave here is a real source run through real processing (glottal pulses through formant filters, FM, hard sync,
folders, tape and amp chains, sample-rate and bit crushing), computed one cycle at a time at 16x the table's
resolution (so nothing folds back inside the cycle), then cut to the table's 1023 harmonics: full band, many frames
(32-64), each a little different from its neighbours (small seeded jitter per frame, as in Serum's tables), the
frames keeping their natural level differences (only half evened out). Written as int16 WAVs into tools/waves/,
which tools/extract-waves.py turns into the engines' data with the owner's Serum renders.

  python3 -I tools/build-waves.py && python3 -I tools/extract-waves.py
"""
import os, struct
import numpy as np

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
N = 2048
OS = 16
L = N * OS
T = np.arange(L) / L
K = np.arange(L // 2 + 1)  # harmonic index of each rfft bin (one cycle per L samples)


# ---------------------------------------------------------------- helpers

def fr(x): return x - np.floor(x)
def sine(x): return np.sin(2 * np.pi * x)
def saw(x): return 2 * fr(x) - 1  # rising, naive at 16x (what folds back is under -80 dB)
def pulse(x, w): return np.where(fr(x) < w, 1.0, -1.0)
def tri(x): return 1 - 4 * np.abs(fr(x + 0.25) - 0.5)
def lerp(a, b, t): return a + (b - a) * t
def logl(a, b, t): return a * (b / a) ** t


def filt(x, H):
    """Filter one cycle by H(harmonic index) (complex), periodic, exact."""
    X = np.fft.rfft(x)
    return np.fft.irfft(X * H(K.astype(float)), L)


def reson(f0, F, B):
    """Klatt resonator at F Hz, bandwidth B, as a function of harmonic index (at fundamental f0), 0 dB at DC."""
    def H(k):
        f = k * f0
        return F * F / (F * F - f * f + 1j * f * B)
    return H


def formants(f0, Fs, Bs, gains=None):
    def H(k):
        h = np.ones_like(k, dtype=complex)
        for i, (F, B) in enumerate(zip(Fs, Bs)):
            h = h * reson(f0, F, B)(k) ** (gains[i] if gains else 1)
        return h
    return H


def lowpass(f0, fc, order=2):
    def H(k):
        s = 1j * k * f0 / fc
        h = 1 / (1 + 1.4142 * s + s * s)
        return h ** (order // 2)
    return H


def highpass(f0, fc):
    def H(k):
        s = 1j * k * f0 / fc
        return s * s / (1 + 1.4142 * s + s * s)
    return H


def bell(f0, fc, gain_db, q):
    """A peaking EQ by magnitude (zero phase: a mix-style tone stack)."""
    g = 10 ** (gain_db / 20)
    def H(k):
        f = np.maximum(k * f0, 1e-9)
        x = np.log2(f / fc) * q * 2
        return 1 + (g - 1) * np.exp(-x * x)
    return H


def glottal(open_q=0.45, close_q=0.15, phase=0.0):
    """Rosenberg glottal flow derivative over one cycle: the voice's source, full band by nature."""
    t = fr(T + phase)
    tp, tn = open_q, close_q
    g = np.where(t < tp, 0.5 * (1 - np.cos(np.pi * t / tp)),
                 np.where(t < tp + tn, np.cos(np.pi * (t - tp) / (2 * tn)), 0.0))
    d = np.gradient(g)
    return d / np.abs(d).max()


def smear(x, amount, rng):
    """Tape / cassette phase smear: a small random phase per harmonic, growing with the harmonic."""
    X = np.fft.rfft(x)
    ph = rng.standard_normal(len(X)) * amount * np.sqrt(K / 64.0)
    ph[0] = 0
    return np.fft.irfft(X * np.exp(1j * ph), L)


def stair(x, steps):
    """Sample and hold at `steps` samples a cycle (a periodic staircase)."""
    idx = np.floor(T * steps) / steps
    return np.interp(idx, T, x, period=1.0)


def quant(x, bits):
    q = 2 ** (max(1.0, bits) - 1)
    return np.round(x * q) / q


def table(frames):
    """Cycles at 16x -> 2048-sample frames with 1023 harmonics, DC out, levels half evened, peak to full scale."""
    out = []
    for x in frames:
        X = np.fft.rfft(x)[:N // 2 + 1].copy()
        X[0] = 0
        X[N // 2] = 0
        out.append(np.fft.irfft(X, N) * N / L)
    out = np.array(out)
    rms = np.sqrt((out ** 2).mean(axis=1))
    out *= (np.median(rms) / np.maximum(rms, 1e-9))[:, None] ** 0.5
    return out / np.abs(out).max()


def frames(n, make, seed):
    rng = np.random.default_rng(seed)
    return table([make(i / (n - 1), rng) for i in range(n)])


def jit(rng, amt):
    return 1 + amt * rng.standard_normal()


# ---------------------------------------------------------------- the waves

VOWELS = {  # F1..F5 (Hz)
    'a': [730, 1090, 2440, 3400, 4500], 'e': [530, 1840, 2480, 3500, 4500], 'i': [270, 2290, 3010, 3500, 4500],
    'o': [570, 840, 2410, 3400, 4500], 'u': [300, 870, 2240, 3400, 4500], 'ae': [660, 1720, 2410, 3400, 4500],
    'oh': [490, 1350, 2400, 3400, 4500], 'uh': [640, 1190, 2390, 3400, 4500], 'er': [490, 1350, 1690, 3300, 4500],
}
BW = [80, 90, 120, 150, 200]
V0 = 110.0  # the voices' reference pitch: their formants sit right at A2


def path(names, t):
    """Formants along a path of vowels (log-interpolated), t 0..1."""
    p = t * (len(names) - 1)
    i = min(len(names) - 2, int(p))
    f = p - i
    a, b = VOWELS[names[i]], VOWELS[names[i + 1]]
    return [logl(x, y, f) for x, y in zip(a, b)]


def bandpass(f0, F, B):
    def H(k):
        f = k * f0
        return 1j * f * B / (F * F - f * f + 1j * f * B)
    return H


FA = [0, -5, -10, -15, -19, -23, -27, -30]  # each formant's level (dB), the higher ones above F5 for the air
FX = [5600, 6900, 8300]


def voice(Fs, bw=1.0, oq=0.45, cq=0.15, drive=1.2, rng=None, extra=None):
    """A glottal pulse through a parallel formant bank (as Klatt's parallel synthesiser: the source's own slope stays
    between and above the formants, so the voice keeps its edge and air), then a little drive."""
    src = glottal(oq, cq)
    Fs = [F * (jit(rng, 0.012) if rng is not None else 1) for F in list(Fs) + FX]
    Bs = [b * bw for b in BW] + [400 * bw, 500 * bw, 600 * bw]
    def H(k):
        h = 0.03 + 0j
        for F, B, a in zip(Fs, Bs, FA):
            h = h + 10 ** (a / 20) * bandpass(V0, F, B)(k)
        return h
    y = filt(src, H)
    y = y / np.abs(y).max()
    return np.tanh(drive * y) / np.tanh(drive)


def w_vowel(t, r):  # A E I O U, a held voice moving its mouth
    return voice(path(['a', 'e', 'i', 'o', 'u'], t), 1.0, 0.45, 0.06, 1.5, r)


def w_choir(t, r):  # oo oh ah, three breathy singers a little apart, the singer's formant on top
    Fs = path(['u', 'oh', 'a'], t)
    y = 0
    for s in range(3):
        y = y + voice([F * (1 + 0.035 * (s - 1)) for F in Fs], 1.7, 0.55, 0.12, 1.0, r)
    sing = filt(glottal(0.55, 0.12), bandpass(V0, 2900, 350))
    return y / 3 + 0.25 * sing / np.abs(sing).max()


def w_talk(t, r):  # o u o a e i: a pressed, close voice, talking
    return voice(path(['o', 'u', 'o', 'a', 'e', 'i'], t), 0.7, 0.35, 0.03, 2.4, r)


def w_formant(t, r):  # the long scan through nine vowels, from breathy to pressed and back
    names = ['a', 'ae', 'e', 'i', 'er', 'oh', 'o', 'u', 'uh', 'a']
    oq = lerp(0.55, 0.33, np.sin(np.pi * t))
    return voice(path(names, t), 0.9, oq, 0.03 + 0.06 * (1 - np.sin(np.pi * t)), 1.8, r)


def w_growl(t, r):  # a neuro yoi: phase-modulated saw through moving narrow formants, driven hard
    idx = 0.4 + 2.6 * (0.5 - 0.5 * np.cos(2 * np.pi * t * 1.5))
    src = saw(T + idx * jit(r, 0.03) * sine(T) / (2 * np.pi)) + 0.5 * pulse(T, 0.5)
    Fs = path(['o', 'u', 'o', 'a', 'e', 'i', 'e', 'a', 'o'], t)
    y = filt(src, lambda k: 0.05 + bandpass(V0, Fs[0], 60)(k) + 0.7 * bandpass(V0, Fs[1], 70)(k) + 0.5 * bandpass(V0, Fs[2], 100)(k))
    y = y / np.abs(y).max()
    y = np.tanh(4.5 * y)
    return filt(y, lowpass(V0, 9000, 2))


def w_double_saw(t, r):  # a saw and its octave, the octave coming in and sliding against it, saturated together
    a = lerp(0.0, 1.0, t)
    ph = 0.25 * t * jit(r, 0.3)
    y = saw(T) + a * saw(2 * T + ph)
    return np.tanh(1.6 * y / 2) * 2


def w_bell(t, r):  # two FM pairs at harmonic ratios (1:4 and 3:11), the index swept up, a little feedback fold
    i1 = (0.2 + 7 * t ** 1.3) * jit(r, 0.06)
    i2 = 0.1 + 4 * t ** 2
    y = sine(T + i1 * jit(r, 0.04) * sine(4 * T) / (2 * np.pi)) + 0.5 * sine(3 * T + i2 * sine(11 * T) / (2 * np.pi))
    return np.sin(1.2 * y)


def w_digital(t, r):  # bit operations on an 8-bit phase (XOR, shifts, multiplies), the operation changing up the Shape
    p = np.floor(T * 256).astype(np.int64)
    def op(j):
        return (((p * (1 + j)) ^ (p >> (1 + j % 4))) & 255) / 127.5 - 1
    q = t * 11
    j = min(10, int(q))
    y = lerp(op(j), op(j + 1), q - j)
    y = 0.6 * y + 0.4 * saw(T)
    return quant(y, lerp(8, 3, t) * jit(r, 0.05))


def w_glass(t, r):  # a sine synced to the note and faded out each cycle (the windowed-sync glass), plus its 12th
    ratio = logl(2, 22, t) * jit(r, 0.01)
    w = (1 - T) ** lerp(1.5, 3.5, t)
    y = sine(ratio * T) * w + 0.35 * sine(ratio * 1.5 * T) * w ** 2
    return y + 0.4 * sine(T)


def w_bowed(t, r):  # Helmholtz motion of a bowed string (bow position comb), bow pressure -> brightness, a wooden body
    beta = lerp(0.07, 0.16, t) * jit(r, 0.08)
    kc = logl(18, 220, t) * jit(r, 0.1)
    def src(k):
        k = np.maximum(k, 1)
        return np.where(K > 0, np.sin(np.pi * k * beta) / k * np.exp(-k / kc), 0)
    X = src(K.astype(float)) * -1j
    y = np.fft.irfft(X, L)
    body = formants(V0, [275, 460, 1000, 2700], [60, 90, 220, 700])
    y = filt(y, lambda k: 0.4 + body(k))
    y = y / np.abs(y).max()
    return np.tanh(lerp(1.0, 2.5, t) * y)


def w_reed(t, r):  # a clarinet reed: a soft-clipped tone (odd harmonics), blowing harder up the Shape, the bore and bell
    g = logl(0.8, 14, t) * jit(r, 0.1)
    y = np.tanh(g * (sine(T) + 0.25 * sine(3 * T) + 0.02)) / np.tanh(g)
    y = filt(y, lambda k: 1 + 0.6 * reson(V0, 1500, 600)(k))
    return filt(y, lowpass(V0, logl(4000, 16000, t), 2))


def w_breath(t, r):  # a flute: the jet's soft nonlinearity, overblowing up the Shape (more of the upper harmonics)
    g = logl(0.5, 5, t) * jit(r, 0.1)
    y = np.tanh(g * (sine(T) + 0.18 * sine(2 * T + 0.1) + 0.05 * sine(3 * T)))
    return filt(y, lambda k: 1 + 0.3 * reson(V0, 3000, 900)(k))


def w_eguitar(t, r):  # a string plucked near the bridge, the pickup's comb, then a tube preamp, a scooped tone stack, the cab
    def src(k):
        k = np.maximum(k, 1)
        return np.where(K > 0, np.sin(np.pi * k * 0.13) * np.sin(np.pi * k * 0.22) / k ** 1.05 * np.exp(-k / 90), 0)
    y = np.fft.irfft(src(K.astype(float)) * -1j, L)
    y = y / np.abs(y).max()
    G = logl(1.2, 80, t) * jit(r, 0.12)
    y = np.tanh(G * y + 0.25) - np.tanh(0.25)
    y = np.tanh(2 * y / np.abs(y).max())
    y = filt(y, bell(V0, 500, -6, 1.2))
    return filt(y, lambda k: lowpass(V0, 5200, 4)(k) * (1 + 0.5 * reson(V0, 110, 40)(k)))


def tape(y, drive, wear, r):
    y = filt(y, bell(55, 3000, 3, 0.8))  # pre-emphasis
    y = np.tanh(drive * (y + 0.08)) - np.tanh(drive * 0.08)  # the tape's asymmetric saturation
    y = filt(y, bell(55, 3000, -3, 0.8))  # de-emphasis
    y = filt(y, lambda k: lowpass(55, logl(16000, 6000, wear), 2)(k) * (1 + 0.3 * reson(55, 70, 30)(k)))  # head loss, head bump
    return smear(y, 0.15 + 0.5 * wear, r)


def w_tape_saw(t, r):  # a saw through tape: saturation, head bump, the top worn away and smeared up the Shape
    return tape(saw(T), logl(1.2, 6, t) * jit(r, 0.1), t, r)


def w_cassette(t, r):  # a sagging pulse through a worn cassette
    w = lerp(0.5, 0.42, t)
    dr = logl(0.3, 3.5, t)
    tt = fr(T)
    y = np.where(tt < w, np.exp(-dr * tt), -np.exp(-dr * (tt - w)))
    return tape(y, logl(1.5, 5, t) * jit(r, 0.1), 0.3 + 0.7 * t, r)


def w_lofi(t, r):  # a sample (a saw and an "ah") through a sampler, its rate and bits dropping up the Shape
    v = voice(VOWELS['a'], 1.0, 0.45, 0.06, 1.0)
    src = 0.55 * saw(T) + 0.45 * v
    steps = int(round(logl(256, 10, t)))
    bits = logl(12, 3, t)
    return quant(stair(src, steps) * 0.9, max(2, int(round(bits))))


def w_broken_sine(t, r):  # a sine through an asymmetric wavefolder, some rectifying, folded further up the Shape
    g = logl(0.6, 8, t) * jit(r, 0.06)
    y = np.sin(g * sine(T) + lerp(0, 0.7, t))
    y = (1 - 0.4 * t) * y + 0.4 * t * np.abs(y)
    return np.tanh(1.5 * y)


def w_fold(t, r):  # a triangle through three folding stages, the gain and bias rising
    g = logl(0.3, 9, t) * jit(r, 0.05)
    x = g * tri(T) + 0.3 * t
    y = np.sin(0.5 * np.pi * x)
    y = 0.7 * y + 0.3 * np.sin(0.5 * np.pi * 1.7 * y)
    return y


def w_sync(t, r):  # a hard-synced saw, the slave swept from the note up four octaves, continuously
    ratio = logl(1, 16, t) * jit(r, 0.004)
    return saw(fr(T) * ratio)


def w_crush(t, r):  # a driven saw and square through a crusher, rate and bits together, clean to destroyed
    src = np.tanh(1.5 * (0.6 * saw(T) + 0.5 * pulse(T, 0.5)))
    steps = int(round(logl(512, 4, t)))
    bits = int(round(logl(14, 2, t)))
    return quant(stair(src, steps), max(1, bits))


def w_spectral(t, r):  # a moving comb over a rich spectrum, the teeth narrowing and sliding, fixed random phases
    rr = np.random.default_rng(7)
    phase = rr.uniform(0, 2 * np.pi, len(K))
    P = logl(9, 3, t)
    c = (0.5 + 0.5 * np.cos(2 * np.pi * K / P + 2 * np.pi * t * 2)) ** 3
    a = np.where(K > 0, np.maximum(K, 1) ** -0.7, 0) * c * np.exp(-K / 600)
    return np.fft.irfft(a * np.exp(1j * (phase + t * np.sqrt(K))), L)


def w_morph_vocal(t, r):  # the MORPH table's last keyframe: an "ah" (its harmonics only, as the morph table's spectra)
    return voice(VOWELS['a'], 1.0, 0.45, 0.06, 1.3)


WAVES = [  # name, frames, maker, seed
    # (double saw, bell, digital and glass: the owner kept their formulas, 27 Nov; their makers stay here unused)
    ('vowel', 32, w_vowel, 2), ('choir', 32, w_choir, 3), ('talk', 48, w_talk, 4),
    ('bowed', 32, w_bowed, 8),
    ('reed', 32, w_reed, 9), ('breath', 32, w_breath, 10), ('electric guitar', 32, w_eguitar, 11),
    ('tape saw', 32, w_tape_saw, 12), ('cassette pulse', 32, w_cassette, 13), ('lofi sample', 32, w_lofi, 14),
    ('broken sine', 32, w_broken_sine, 15), ('growl', 48, w_growl, 16), ('fold', 64, w_fold, 17),
    ('sync saw', 128, w_sync, 18), ('crush', 32, w_crush, 19), ('spectral', 32, w_spectral, 20),
    ('formant scan', 64, w_formant, 21), ('morph vocal', 2, w_morph_vocal, 22),
]


def write_wav(path, x):
    q = np.round(np.clip(x, -1, 1) * 32767).astype('<i2').tobytes()
    hdr = b'RIFF' + struct.pack('<I', 36 + len(q)) + b'WAVEfmt ' + struct.pack('<IHHIIHH', 16, 1, 1, 44100, 88200, 2, 16)
    open(path, 'wb').write(hdr + b'data' + struct.pack('<I', len(q)) + q)


if __name__ == '__main__':
    for name, n, make, seed in WAVES:
        f = frames(n, make, seed)
        S = np.abs(np.fft.rfft(f, axis=1))
        top = [int(np.max(np.nonzero(s > s.max() * 1e-3)[0])) for s in S]
        adj = [np.corrcoef(f[i], f[i + 1])[0, 1] for i in range(len(f) - 1)]
        lv = np.sqrt((f ** 2).mean(axis=1))
        print(f'{name:16s} {n:3d} frames  top harmonic >-60 dB {min(top):4d}..{max(top):4d}  '
              f'neighbours {np.median(adj):.2f} (min {min(adj):.2f})  level {20 * np.log10(lv.min() / lv.max()):5.1f} dB')
        write_wav(os.path.join(ROOT, 'tools/waves', name.replace(' ', '-') + '.wav'), f.reshape(-1))
