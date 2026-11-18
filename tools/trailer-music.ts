// DEV ONLY: a guide track for the rough cut, played on RUIN-1 itself (the bank's presets through the real engine,
// offline): no samples, no outside music. A sketch for timing, not the trailer's music (the owner makes that).
//   npx tsx tools/trailer-music.ts [out.wav]      (default renders/trailer/track.wav, which trailer-cut.mjs picks up)
// The sections follow the timeline's parts (tools/trailer/timeline.json), so every change lands on its cut, in D minor
// at the timeline's tempo, after RULES.md section 10: a soft intro, a riser to an impact on the drop, the full part, a
// short drop-out, the biggest part, and a final hit on the logo with a ringing tail.
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { renderPatch } from '../src/engine/core/render';
import type { Loop, LoopNote } from '../src/engine/core/sequencer';
import { loadLibrary, ROOT } from './lib/data';
import { writeWav } from './lib/wav';

const OUT = process.argv[2] ?? join(ROOT, 'renders/trailer/track.wav');
const TL = JSON.parse(readFileSync(join(ROOT, 'tools/trailer/timeline.json'), 'utf8'));
const BPM: number = TL.bpm, SR = 48000;
const total = TL.shots.reduce((a: number, s: { beats: number }) => a + s.beats, 0);
// where each part starts (beats)
const at: Record<string, number> = {}; let b = 0;   // (parts: hook slam hush intro riser riser2 main fill ruin sounds create break logo)
for (const s of TL.shots) { at[s.part] ??= b; b += s.beats; }
const P = { ...at, break_: at.break };                                                                  // where each part starts (beats)
const lib = new Map(loadLibrary().map((e) => [e.json.meta.name as string, e.json]));

type Track = { preset: string; gain: number; notes: LoopNote[] };
const tracks: Track[] = [];
const add = (preset: string, gain: number, notes: LoopNote[]) => { if (!lib.has(preset)) { console.log(`(no preset ${preset}: skipped)`); return; } tracks.push({ preset, gain, notes }); };
const n = (start: number, dur: number, note: number, vel = .8): LoopNote => ({ start, dur, note, vel });
const range = (a: number, z: number, step: number) => { const r: number[] = []; for (let x = a; x < z - 1e-6; x += step) r.push(x); return r; };

// D minor: Dm, Bb, Gm, A minor, a chord a bar (4 beats)
const CH = [[50, 53, 57], [46, 50, 53], [43, 46, 50], [45, 48, 52]], ROOTS = [26, 22, 19, 21];
const chordAt = (beat: number) => CH[Math.floor(beat / 4) % 4], rootAt = (beat: number) => ROOTS[Math.floor(beat / 4) % 4];
const pad = (a: number, z: number, vel: number) => range(a, z, 4).flatMap((x) => chordAt(x - a).map((k) => n(x, Math.min(4, z - x) + .05, k, vel)));
// a hit on a cut: the low thump and a stab (big: the heavy bass too)
const hit = (beat: number, big = false) => { add('Crushed 808', .9, [n(beat, 3, 26, 1)]); add('Hammer Stab', .45, [n(beat, 1.5, 38, 1)]);
  if (big) add('Destroyed Reese', .5, [n(beat, 1.5, 26, 1)]); };
// the groove: bass in eighths, kick on the beat, a noise backbeat, ticking hats; heavy = the RUIN part
const groove = (a: number, z: number, o: { bass?: string; heavy?: boolean; light?: boolean } = {}) => {
  add(o.bass ?? 'Classic Reese', o.heavy ? .6 : .5, range(a, z, .5).map((x) => n(x, .45, rootAt(x - a) + 12, (x % 1 ? .6 : .85))));
  add('Velvet Thump', .8, range(a, z, 1).map((x) => n(x, .3, 26, .95)));
  if (!o.light) add('Snare Swing', .4, range(a + 1, z, 2).map((x) => n(x, .25, 50, .9)));
  add('Static Line', o.light ? .12 : .18, range(a, z, .25).map((x, i) => n(x, .1, 74, i % 2 ? .4 : .7)));
  if (o.heavy) { add('Screaming FM / Neuro Bass', .3, range(a + .75, z, 2).map((x) => n(x, .6, rootAt(x - a) + 24, .9)));
    add('Doom Horns', .35, pad(a, z, .7)); add('Chainsaw Lead', .26, range(a, z, 2).map((x, i) => n(x, 1.5, [74, 77, 76, 72][i % 4], .75))); }
};
// a short phrase per shot, each on another preset (the presets and Create parts: the sound changes with every cut)
const phrases = (a: number, list: string[]) => list.forEach((pr, i) => add(pr, .32, [0, .5, 1, 1.5].map((d, k) => n(a + i * 2 + d, .45, [62, 65, 69, 67][k], .75))));

// the hook: silence, one slam on the cut, silence again (gated below)
hit(P.slam, true);
// the intro: a dark pad, a sparse plucked motif, kept soft (the drop must be a big step up)
add('Cold Breath', .55, pad(P.intro, P.main, .5));
add('Blackwater', .5, range(P.intro + 1, P.riser2, 2).map((x, i) => n(x, .5, [62, 65, 69, 67, 65, 62, 60, 57][i % 8], .55)));
// the riser under the last intro shot and card 1, then the impact on the drop
add('White Sweep', .45, [n(P.riser, P.main - P.riser, 50, .9)]);
add('Tower Swell', .25, [n(P.riser2, P.main - P.riser2, 38, .8), n(P.riser2, P.main - P.riser2, 45, .7)]);
add('Snare Swing', .3, [...range(P.riser2 + 1, P.main - 2, .5), ...range(P.main - 2, P.main, .25)].map((x, i, arr) => n(x, .15, 50, .4 + .5 * i / arr.length)));
hit(P.main, true); groove(P.main, P.fill);
// card 2: a hit, the groove held back to kick and bass, then the heaviest part on the RUIN page
hit(P.fill); groove(P.fill, P.ruin, { light: true });
hit(P.ruin, true); groove(P.ruin, P.sounds, { bass: 'Destroyed Reese', heavy: true });
// card 3 and the presets: lighter, a different preset on every cut
hit(P.sounds); groove(P.sounds, P.create, { light: true }); phrases(P.sounds + 4, ['Neon Snap', 'Glass Bell Lead', 'Burnt Rhodes', 'Ringing Wire']);
// card 4 and Create: the same, new rolls
hit(P.create); groove(P.create, P.break_, { light: true }); phrases(P.create + 4, ['Static Heaven', 'Warp Line', 'Fold Lung']);
// card 5: the drop-out, a low pad and a swelling noise, then one beat of silence before the logo
add('Sunken', .45, pad(P.break_, P.logo - 1, .5));
add('White Sweep', .4, [n(P.break_ + 2, P.logo - 1 - (P.break_ + 2), 50, .9)]);
// the logo: the biggest hit, its chord ringing out
hit(P.logo, true);
add('Doom Horns', .4, CH[0].map((k) => n(P.logo, 3, k, .9)));
add('Cathedral Rot', .5, [n(P.logo, 8, 50, .8), n(P.logo, 8, 53, .7), n(P.logo, 8, 57, .7), n(P.logo, 8, 38, .8)]);

// render every track through the engine over the whole length (one long, non-repeating loop), then mix
const len = Math.round(total * 60 / BPM * SR), L = new Float32Array(len), R = new Float32Array(len);
for (const t of tracks) {
  const loop: Loop = { id: 'trailer', name: 'trailer', description: '', bpm: BPM, length_beats: total + 64, notes: t.notes };
  const r = renderPatch(lib.get(t.preset), loop, { sampleRate: SR, seconds: total * 60 / BPM, tail: 0 });
  for (let i = 0; i < len; i++) { L[i] += r.left[i] * t.gain; R[i] += r.right[i] * t.gain; }
  console.log(`${t.preset.padEnd(28)} ${t.notes.length} notes`);
}
// silences (hard, as cuts to black are): before the slam, after it, and the beat before the logo
const B = (beat: number) => Math.round(beat * 60 / BPM * SR);
for (const [a0, a1] of [[0, P.slam], [P.hush, P.intro], [P.logo - 1, P.logo]]) for (let i = B(a0); i < B(a1); i++) { L[i] = 0; R[i] = 0; }
// level: peak at -1 dBFS, a gentle fade over the last 3 s
let pk = 0; for (let i = 0; i < len; i++) pk = Math.max(pk, Math.abs(L[i]), Math.abs(R[i]));
const k = .89 / (pk || 1), f0 = len - 3 * SR;
for (let i = 0; i < len; i++) { const g = k * (i > f0 ? (len - i) / (len - f0) : 1); L[i] *= g; R[i] *= g; }
mkdirSync(dirname(OUT), { recursive: true }); writeWav(OUT, L, R, SR);
console.log(`${(len / SR).toFixed(2)} s at ${BPM} BPM -> ${OUT}`);
