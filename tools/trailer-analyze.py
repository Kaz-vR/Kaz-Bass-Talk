#!/usr/bin/env python3
# DEV ONLY: measures a reference trailer so its style can be written down as numbers (references/trailers/RULES.md).
#   python3 tools/trailer-analyze.py <name> <video.mkv> <out_dir>
# Needs ffmpeg, opencv-python-headless, scenedetect, librosa, numpy (pip; never shipped).
# Writes <out_dir>/<name>.json (shots, camera, focus, grade, light, transitions, audio) and per-shot stills.
import json, subprocess, sys, os, math
import numpy as np, cv2

name, src, out = sys.argv[1], sys.argv[2], sys.argv[3]
os.makedirs(f'{out}/stills', exist_ok=True)
AW = 480                                                      # analysis width (motion, focus); grade at 960

def probe(path):
    p = json.loads(subprocess.check_output(['ffprobe', '-v', 'error', '-show_entries', 'stream=width,height,r_frame_rate,codec_type',
                                            '-show_entries', 'format=duration', '-of', 'json', path]))
    v = next(s for s in p['streams'] if s['codec_type'] == 'video'); n, d = v['r_frame_rate'].split('/')
    return v['width'], v['height'], float(n) / float(d), float(p['format']['duration'])

W, H, FPS, DUR = probe(src)

def frames(width):
    h = round(H * width / W / 2) * 2
    p = subprocess.Popen(['ffmpeg', '-v', 'error', '-i', src, '-vf', f'scale={width}:{h}:flags=area', '-f', 'rawvideo', '-pix_fmt', 'bgr24', '-'],
                         stdout=subprocess.PIPE)
    n = width * h * 3
    while True:
        b = p.stdout.read(n)
        if len(b) < n: break
        yield np.frombuffer(b, np.uint8).reshape(h, width, 3)

# ---------- pass 1 (960 wide): per-frame luma, colour, focus grid, motion ----------
lum, sat, hist_cut, sharp_grid, motion, lbox_rows = [], [], [], [], [], None
prev_g, prev_h = None, None
for i, f in enumerate(frames(960)):
    g = cv2.cvtColor(f, cv2.COLOR_BGR2GRAY)
    rowmax = g.max(axis=1)
    lbox_rows = rowmax if lbox_rows is None else np.maximum(lbox_rows, rowmax)
    lum.append(float(g.mean()))
    hsv = cv2.cvtColor(f, cv2.COLOR_BGR2HSV)
    sat.append(float(hsv[..., 1].mean()))
    h = cv2.calcHist([hsv], [0, 1], None, [16, 8], [0, 180, 0, 256]); h = h / (h.sum() + 1e-9)
    hist_cut.append(0.0 if prev_h is None else float(np.abs(h - prev_h).sum())); prev_h = h
    # focus: Laplacian energy on a 8x4 grid (half res to ignore compression noise)
    small = cv2.resize(g, (AW, g.shape[0] * AW // 960), interpolation=cv2.INTER_AREA)
    lap = np.abs(cv2.Laplacian(small.astype(np.float32), cv2.CV_32F))
    gh, gw = small.shape[0] // 4, AW // 8
    sharp_grid.append([[float(lap[r * gh:(r + 1) * gh, c * gw:(c + 1) * gw].mean()) for c in range(8)] for r in range(4)])
    # motion: tracked features -> similarity transform (pan x/y in % of width, zoom, roll)
    m = None
    if prev_g is not None:
        pts = cv2.goodFeaturesToTrack(prev_g, 300, 0.01, 6)
        if pts is not None and len(pts) >= 12:
            nxt, st, _ = cv2.calcOpticalFlowPyrLK(prev_g, small, pts, None, winSize=(21, 21), maxLevel=3)
            a, b = pts[st[:, 0] == 1], nxt[st[:, 0] == 1]
            if len(a) >= 12:
                M, inl = cv2.estimateAffinePartial2D(a, b, method=cv2.RANSAC, ransacReprojThreshold=1.5)
                if M is not None and inl is not None and inl.sum() >= 10:
                    s = math.hypot(M[0, 0], M[1, 0]); rot = math.degrees(math.atan2(M[1, 0], M[0, 0]))
                    flow = (b - a)[inl[:, 0] == 1]; res = flow - flow.mean(0)
                    m = dict(dx=float(M[0, 2] / AW * 100), dy=float(M[1, 2] / AW * 100), zoom=float((s - 1) * 100), rot=float(rot),
                             spread=float(np.linalg.norm(res, axis=1).std() / AW * 100), inliers=int(inl.sum()))
    motion.append(m); prev_g = small
N = len(lum)
lum, sat, hist_cut = np.array(lum), np.array(sat), np.array(hist_cut)

# letterbox: rows that never light up
rows = np.where(lbox_rows > 18)[0]
lb_top, lb_bot = int(rows[0]), int(len(lbox_rows) - 1 - rows[-1])
active_h = len(lbox_rows) - lb_top - lb_bot

# ---------- cuts: hard cuts (colour histogram jump + motion break) and dissolves/fades (via black dips) ----------
thr = max(0.55, float(np.percentile(hist_cut, 97)))
cuts = [0]
for i in range(1, N):
    if hist_cut[i] > thr and hist_cut[i] >= hist_cut[max(0, i - 2):i + 3].max() and i - cuts[-1] >= 5: cuts.append(i)
# fades through black: luma minimum below 4 that separates two lit parts
for i in range(2, N - 2):
    if lum[i] < 3.5 and lum[i] <= lum[i - 2:i + 3].min() and all(abs(i - c) >= 6 for c in cuts) and lum[max(0, i - 15):i].max() > 8 and lum[i:i + 15].max() > 8:
        cuts.append(i)
cuts = sorted(set(cuts)) + [N]
labels = None
if len(sys.argv) > 4:                                       # hand-checked shot list overrides the detector
    hand = json.load(open(sys.argv[4]))[name]
    cuts = [int(round(t * FPS)) for t, *_ in hand] + [N]; labels = [(ty, note) for _, ty, note in hand]

# ---------- audio ----------
import librosa
sr = 22050
try: y = np.frombuffer(subprocess.check_output(['ffmpeg', '-v', 'error', '-i', src, '-vn', '-ac', '1', '-ar', str(sr), '-f', 'f32le', '-']), np.float32).copy()
except subprocess.CalledProcessError: y = np.zeros(0, np.float32)
if len(y) < sr: y = np.random.default_rng(0).normal(0, 1e-4, int(DUR * sr) + sr).astype(np.float32)   # a silent clip (our test shots)
onset_env = librosa.onset.onset_strength(y=y, sr=sr); o_t = librosa.times_like(onset_env, sr=sr)
tempo = float(np.atleast_1d(librosa.feature.tempo(onset_envelope=onset_env, sr=sr))[0])
def track_beats(o, period, tight=100.0):                      # Ellis dynamic-programming beat tracker in plain numpy
    o = o / (o.std() + 1e-9); n = len(o); score = o.copy(); back = -np.ones(n, int)
    lo, hi = int(round(period / 2)), int(round(period * 2))
    for t in range(lo, n):
        prev = np.arange(max(0, t - hi), t - lo + 1)
        if not len(prev): continue
        pen = -tight * np.log((t - prev) / period) ** 2
        j = int(np.argmax(score[prev] + pen)); score[t] = o[t] + score[prev[j]] + pen[j]; back[t] = prev[j]
    t = int(np.argmax(score[-hi:])) + n - hi; out = []
    while t >= 0: out.append(t); t = back[t]
    return np.array(out[::-1])
beats = o_t[track_beats(onset_env, 60.0 / tempo * sr / 512)]
rms = librosa.feature.rms(y=y, frame_length=2048, hop_length=512)[0]; r_t = librosa.times_like(rms, sr=sr, hop_length=512)
cent = librosa.feature.spectral_centroid(y=y, sr=sr)[0]
S = np.abs(librosa.stft(y, n_fft=4096, hop_length=1024)); fr = librosa.fft_frequencies(sr=sr, n_fft=4096); s_t = librosa.times_like(S[0], sr=sr, hop_length=1024)
band = lambda lo, hi: 10 * np.log10((S[(fr >= lo) & (fr < hi)] ** 2).sum(0) + 1e-9)
bands = {'sub_20_60': band(20, 60), 'bass_60_250': band(60, 250), 'mid_250_2k': band(250, 2000), 'high_2k_8k': band(2000, 8000), 'air_8k_11k': band(8000, 11025)}
def at(t, xs, ts): return float(xs[min(len(xs) - 1, int(np.searchsorted(ts, t)))])
strong = o_t[onset_env > np.percentile(onset_env, 90)]
rms_db = 20 * np.log10(rms + 1e-9)
def every(step, xs, ts): return [round(at(t, xs, ts), 1) for t in np.arange(0, DUR, step)]

# ---------- per shot ----------
stills = subprocess.Popen  # noqa
shots = []
for k in range(len(cuts) - 1):
    a, b = cuts[k], cuts[k + 1]
    t0, t1 = a / FPS, b / FPS
    ms = [m for m in motion[a + 1:b] if m]
    def med(key): return float(np.median([m[key] for m in ms])) if ms else 0.0
    # speed per second (sign kept) and its ease: speed in first, middle, last third
    spd = np.array([math.hypot(m['dx'], m['dy']) for m in ms]) * FPS if ms else np.zeros(1)
    thirds = [float(np.median(x)) if len(x) else 0.0 for x in np.array_split(spd, 3)] if len(spd) >= 3 else [float(spd.mean())] * 3
    grid = np.array(sharp_grid[a:b])                                  # frames x 4 x 8
    g0 = grid.mean(0); gmax = g0.max() + 1e-9
    sharp_frac = float((g0 > 0.5 * gmax).mean())                       # share of the frame in focus
    gl = np.array(sharp_grid[a:b]).reshape(b - a, -1)
    focus_shift = float(np.abs(gl[: max(1, (b - a) // 4)].mean(0) / (gl[: max(1, (b - a) // 4)].mean(0).max() + 1e-9)
                               - gl[-max(1, (b - a) // 4):].mean(0) / (gl[-max(1, (b - a) // 4):].mean(0).max() + 1e-9)).mean())
    ys, xs = np.unravel_index(int(np.argmax(g0)), g0.shape)
    near_cut_beat = float(min(abs(t0 - x) for x in beats)) * 1000 if len(beats) else None
    near_cut_onset = float(min(abs(t0 - x) for x in strong)) * 1000 if len(strong) else None
    shots.append(dict(i=k, type=labels[k][0] if labels else None, note=labels[k][1] if labels else None, start=round(t0, 3), end=round(t1, 3), dur=round(t1 - t0, 3),
                      luma_mean=round(float(lum[a:b].mean()), 1), luma_min=round(float(lum[a:b].min()), 1), luma_max=round(float(lum[a:b].max()), 1),
                      fade_in_frames=int(np.argmax(lum[a:b] > 0.8 * lum[a:b].max())) if lum[a:b].max() > 5 else 0,
                      fade_out_frames=int(np.argmax(lum[a:b][::-1] > 0.8 * lum[a:b].max())) if lum[a:b].max() > 5 else 0,
                      saturation=round(float(sat[a:b].mean()), 1),
                      cam=dict(pan_x_pct_s=round(med('dx') * FPS, 2), pan_y_pct_s=round(med('dy') * FPS, 2), zoom_pct_s=round(med('zoom') * FPS, 2),
                               roll_deg_s=round(med('rot') * FPS, 3), speed_pct_s_thirds=[round(x, 2) for x in thirds],
                               parallax=round(med('spread') * FPS, 3), tracked=len(ms) / max(1, b - a - 1)),
                      focus=dict(sharp_frac=round(sharp_frac, 2), sharp_cell=[int(ys), int(xs)], shift=round(focus_shift, 3),
                                 sharpness=round(float(gmax), 2)),
                      cut_to_beat_ms=round(near_cut_beat, 0) if near_cut_beat is not None else None,
                      cut_to_strong_onset_ms=round(near_cut_onset, 0) if near_cut_onset is not None else None,
                      audio_rms_db=round(float(rms_db[(r_t >= t0) & (r_t < t1)].mean()), 1) if ((r_t >= t0) & (r_t < t1)).any() else None))

# ---------- grade, light, grain on the 4K source at each shot's middle ----------
def grab(t, width=None):
    vf = ['-vf', f'scale={width}:-2:flags=area'] if width else []
    b = subprocess.check_output(['ffmpeg', '-v', 'error', '-ss', f'{t:.3f}', '-i', src, '-frames:v', '1', *vf, '-f', 'image2pipe', '-vcodec', 'png', '-'])
    return cv2.imdecode(np.frombuffer(b, np.uint8), cv2.IMREAD_COLOR)
for s in shots:
    tm = (s['start'] + s['end']) / 2
    full = grab(tm)
    sc = full.shape[0] / len(lbox_rows)
    f = full[int(lb_top * sc): full.shape[0] - int(lb_bot * sc)]
    lab = cv2.cvtColor(f, cv2.COLOR_BGR2LAB).astype(np.float32); L = lab[..., 0] * 100 / 255; A = lab[..., 1] - 128; B = lab[..., 2] - 128
    g = cv2.cvtColor(f, cv2.COLOR_BGR2GRAY).astype(np.float32)
    pct = np.percentile(g, [1, 5, 25, 50, 75, 95, 99, 99.9])
    sh, hi = L < 20, L > 65
    hh, ww = g.shape; cy, cx = hh // 2, ww // 2
    centre = g[cy - hh // 6:cy + hh // 6, cx - ww // 6:cx + ww // 6].mean()
    corners = np.mean([g[:hh // 6, :ww // 8].mean(), g[:hh // 6, -ww // 8:].mean(), g[-hh // 6:, :ww // 8].mean(), g[-hh // 6:, -ww // 8:].mean()])
    hsv = cv2.cvtColor(f, cv2.COLOR_BGR2HSV); wgt = (hsv[..., 1].astype(np.float32) / 255) * (hsv[..., 2].astype(np.float32) / 255)
    hh_ = np.histogram(hsv[..., 0].ravel() * 2, bins=24, range=(0, 360), weights=wgt.ravel())[0]
    top_hues = [int(i * 15 + 7) for i in np.argsort(hh_)[::-1][:3] if hh_[i] > 0.05 * hh_.sum()]
    # grain: high-pass std in flat dark-to-mid areas (local std small at a larger scale)
    hp = g - cv2.GaussianBlur(g, (0, 0), 1.2); lo = cv2.GaussianBlur(g, (0, 0), 6)
    flat = (np.abs(cv2.GaussianBlur(g, (0, 0), 3) - lo) < 1.5) & (lo > 12) & (lo < 140)
    grain = float(hp[flat].std()) if flat.sum() > 5000 else None
    bloom = float((g > 245).mean() * 100)
    s['grade'] = dict(luma_pct={k: round(float(v), 1) for k, v in zip(['p1', 'p5', 'p25', 'p50', 'p75', 'p95', 'p99', 'p999'], pct)},
                      shadow_ab=[round(float(A[sh].mean()), 1), round(float(B[sh].mean()), 1)] if sh.sum() > 1000 else None,
                      highlight_ab=[round(float(A[hi].mean()), 1), round(float(B[hi].mean()), 1)] if hi.sum() > 1000 else None,
                      chroma_mean=round(float(np.hypot(A, B).mean()), 1), top_hues_deg=top_hues,
                      vignette_corner_over_centre=round(float(corners / (centre + 1e-6)), 2),
                      grain_hp_std=round(grain, 2) if grain else None, clipped_pct=round(bloom, 3))
    if s.get('type') in ('card', 'logo', 'ui+text', 'url', 'flash'):
        lum_ = g; thr_ = max(140.0, float(np.percentile(lum_, 99.6)))
        if s.get('type') == 'flash' and lum_.mean() > 150: thr_ = None
        if thr_:
            mask = (lum_ >= thr_).astype(np.uint8)
            n_, lab_, st_, cen_ = cv2.connectedComponentsWithStats(mask, 8)
            hh2, ww2 = mask.shape
            comps = [st_[j] for j in range(1, n_) if st_[j][4] > 6 and st_[j][3] < hh2 * 0.15 and st_[j][2] < ww2 * 0.3
                     and hh2 * 0.15 < st_[j][1] + st_[j][3] / 2 < hh2 * 0.85]
            if len(comps) >= 3:
                hs = np.array([c[3] for c in comps]); big = [c for c in comps if c[3] >= 0.6 * np.median(hs)]
                x0 = min(c[0] for c in big); y0 = min(c[1] for c in big); x1 = max(c[0] + c[2] for c in big); y1 = max(c[1] + c[3] for c in big)
                s['text'] = dict(cap_height_pct_h=round(float(np.percentile([c[3] for c in big], 75)) / hh2 * 100, 2),
                                 block_w_pct=round((x1 - x0) / ww2 * 100, 1), block_h_pct=round((y1 - y0) / hh2 * 100, 1),
                                 centre_x_pct=round((x0 + x1) / 2 / ww2 * 100, 1), centre_y_pct=round((y0 + y1) / 2 / hh2 * 100, 1),
                                 glyphs=len(big), text_luma=round(float(lum_[mask > 0].mean()), 1))
    still = cv2.resize(f, (640, round(f.shape[0] * 640 / f.shape[1])), interpolation=cv2.INTER_AREA)
    cv2.imwrite(f'{out}/stills/{name}_{s["i"]:02d}.jpg', still, [cv2.IMWRITE_JPEG_QUALITY, 82])

res = dict(name=name, source=os.path.basename(src), width=W, height=H, fps=FPS, duration=round(DUR, 3),
           letterbox=dict(top_px_at_540=lb_top, bottom_px_at_540=lb_bot, active_aspect=round(960 / active_h, 3)),
           shots=shots,
           audio=dict(tempo_bpm=round(tempo, 1), beats=[round(float(b), 3) for b in beats], strong_onsets=[round(float(x), 3) for x in strong],
                      rms_db_per_250ms=every(0.25, rms_db, r_t), centroid_hz_per_250ms=every(0.25, cent, r_t),
                      bands_db_per_500ms={k: every(0.5, v, s_t) for k, v in bands.items()}),
           per_frame=dict(luma=[round(float(x), 1) for x in lum], saturation=[round(float(x), 1) for x in sat],
                          motion=[None if m is None else {k: round(v, 3) if isinstance(v, float) else v for k, v in m.items()} for m in motion]))
json.dump(res, open(f'{out}/{name}.json', 'w'))
print(name, 'shots', len(shots), 'tempo', round(tempo, 1), 'letterbox', lb_top, lb_bot)
