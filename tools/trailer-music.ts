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
const at: Record<string, number> = {}; let b = 0;   // (parts: see the timeline)
for (const s of TL.shots) { at[s.part] ??= b; b += s.beats; }
const P = at;                                                                  // where each part starts (beats)
const lib = new Map(loadLibrary().map((e) => [e.json.meta.name as string, e.json]));

type Track = { preset: string; gain: number; notes: LoopNote[] };
const tracks: Track[] = [];
const add = (preset: string, gain: number, notes: LoopNote[]) => { if (!lib.has(preset)) { console.log(`(no preset ${preset}: skipped)`); return; } tracks.push({ preset, gain, notes }); };
const n = (start: number, dur: number, note: number, vel = .8): LoopNote => ({ start, dur, note, vel });
const range = (a: number, z: number, step: number) => { const r: number[] = []; for (let x = a; x < z - 1e-6; x += step) r.push(x); return r; };

// v4 (21 Nov): E minor (three of the four references): Em, C, Am, B (the dominant: tension), a chord a bar
const CH = [[52, 55, 59], [48, 52, 55], [45, 48, 52], [47, 51, 54]], ROOTS = [40, 36, 33, 35];
const chordAt = (beat: number) => CH[Math.floor(beat / 4) % 4], rootAt = (beat: number) => ROOTS[Math.floor(beat / 4) % 4];
const pad = (a: number, z: number, vel: number) => range(a, z, 4).flatMap((x) => chordAt(x - a).map((k) => n(x, Math.min(4, z - x) + .05, k, vel)));
// the riff: one bass line, clean under card 2, ruined after it; sixteenths and eighths, a bar long
const RIFF: [number, number][] = [[0, 40], [.5, 40], [.75, 43], [1, 40], [1.5, 47], [2, 40], [2.5, 38], [3, 40], [3.25, 43], [3.5, 45]];
const riff = (a: number, z: number, oct = 0, vel = .85) => range(a, z, 4).flatMap((x) => RIFF.map(([d, k], q) => n(x + d, .3, k + oct, q % 2 ? vel * .8 : vel))).filter((e) => e.start < z);
const hit = (beat: number, big = false) => { add('Crushed 808', .9, [n(beat, 3, 28, 1)]); add('Hammer Stab', .4, [n(beat, 1.5, 40, 1)]);
  if (big) add('Destroyed Reese', .5, [n(beat, 1.5, 28, 1)]); };
const drums = (a: number, z: number, o: { heavy?: boolean; light?: boolean } = {}) => {
  add('Velvet Thump', .85, range(a, z, o.light ? 2 : 1).map((x) => n(x, .3, 28, .95)));
  if (!o.light) add('Snare Swing', .42, range(a + 1, z, 2).map((x) => n(x, .25, 52, .9)));
  add('Static Line', o.heavy ? .2 : .13, range(a, z, o.heavy ? .25 : .5).map((x, q) => n(x, .1, 76, q % 2 ? .4 : .7)));
};

// 1 the boxes, one by one: a breathing pad, a hiss of air, a slow glassy motif; a low pulse joins under the filter
add('Breathing Walls', .32, pad(P.intro + 1, P.card1, .55));
add('Sunk Hiss', .25, [n(P.intro + 1, P.card1 - P.intro - 1, 52, .6)]);
add('Glass Harp', .24, [[1.5, 64], [3.5, 67], [5.5, 71], [7.5, 69], [9.5, 67], [11.5, 64]].map(([d, k]) => n(P.intro + d, 1.4, k, .6)));
add('Velvet Thump', .45, range(P.intro + 9, P.card1, 1).map((x) => n(x, .2, 28, .7)));
// 2 card 1: a riser, the pulse doubling, the drop on its last frame
add('White Sweep', .45, [n(P.card1, P.main - P.card1, 52, .9)]); add('Rift', .3, [n(P.card1, P.main - P.card1, 40, .8), n(P.card1, P.main - P.card1, 47, .7)]);
add('Velvet Thump', .5, [...range(P.card1, P.card1 + 3, .5), ...range(P.card1 + 3, P.main, .25)].map((x, q, arr) => n(x, .15, 28, .5 + .45 * q / arr.length)));
// 3 OSC B, noise, the LFOs, the matrix: the groove, the bass on the root, the pad moving
hit(P.main, true); drums(P.main, P.card2, { heavy: true }); add('Cold Iron', 1.1, range(P.main, P.card2, .5).map((x) => n(x, .42, rootAt(x - P.main), x % 1 ? .6 : .85)));
add('Breathing Walls', .5, pad(P.main, P.card2, .6)); add('Neon Snap', .3, range(P.main, P.card2, .5).map((x, q) => n(x, .3, [64, 67, 71, 76][q % 4], .7)));
// 4 BUILD A SOUND. / THEN RUIN IT.: the riff alone, clean, on a soft bass
add('Felt Floor', .65, riff(P.card2, P.ruined));
// 5 the RUIN page and the FX: the same riff ruined, full drums, horns: the peak
hit(P.ruined, true); add('Rebar', .5, riff(P.ruined, P.card3)); add('Grinder', .32, riff(P.ruined, P.card3, 12, .7));
add('Chrome Teeth', .28, range(P.ruined + .75, P.card3, 1).map((x) => n(x, .4, rootAt(x - P.ruined) + 24, .9)));
add('Warhorn', .32, pad(P.ruined, P.card3, .7)); drums(P.ruined, P.card3, { heavy: true });
// 6-7 250+ SOUNDS and the presets: a hit, a lighter groove, a different preset on every cut
hit(P.card3); drums(P.card3, P.ready, { light: true }); add('Cold Iron', .9, range(P.card3, P.ready, 1).map((x) => n(x, .8, rootAt(x - P.card3), .75)));
['Hollow Euphoria', 'Glass Throat', 'Moth Keys'].forEach((pr, q) => add(pr, .65, [0, .5, 1, 1.5].map((d, k) => n(P.many + q * 2 + d, .45, [64, 67, 71, 69][k], .8))));
// 10 ARE YOU READY?: everything stops; a low dark pad and a swell, then one beat of silence
add('Cathedral Rot', .3, [n(P.ready, P.logo - 1 - P.ready, 40, .7), n(P.ready, P.logo - 1 - P.ready, 47, .6)]);
add('White Sweep', .3, [n(P.ready + 2, P.logo - 1 - (P.ready + 2), 52, .9)]);
// 11 the logo: a braam on the biggest hit (horns, tubas, a rotting fanfare and the ruined bass on E), ringing out
hit(P.logo, true);
for (const [pr, g] of [['Doom Horns', .45], ['Low Tubas', .45], ['Rotting Fanfare', .3]] as [string, number][]) add(pr, g, [n(P.logo, 6, 40, 1), n(P.logo, 6, 47, .9), n(P.logo, 6, 52, .8)]);
add('Destroyed Reese', .45, [n(P.logo, 4, 28, 1)]);
add('Cathedral Rot', .5, CH[0].map((k) => n(P.logo, 10, k, .75)));

// render every track through the engine over the whole length (one long, non-repeating loop), then mix
const len = Math.round(total * 60 / BPM * SR), L = new Float32Array(len), R = new Float32Array(len);
for (const t of tracks) {
  const loop: Loop = { id: 'trailer', name: 'trailer', description: '', bpm: BPM, length_beats: total + 64, notes: t.notes };
  const r = renderPatch(lib.get(t.preset), loop, { sampleRate: SR, seconds: total * 60 / BPM, tail: 0 });
  for (let i = 0; i < len; i++) { L[i] += r.left[i] * t.gain; R[i] += r.right[i] * t.gain; }
  console.log(`${t.preset.padEnd(28)} ${t.notes.length} notes`);
}
// silences (hard, as cuts to black are): the opening beat and the beat before the logo
const B = (beat: number) => Math.round(beat * 60 / BPM * SR);
for (const [a0, a1] of [[0, P.intro + 1], [P.logo - 1, P.logo]]) for (let i = B(a0); i < B(a1); i++) { L[i] = 0; R[i] = 0; }
// level: peak at -1 dBFS, a gentle fade over the last 3 s
let pk = 0; for (let i = 0; i < len; i++) pk = Math.max(pk, Math.abs(L[i]), Math.abs(R[i]));
const k = .89 / (pk || 1), f0 = len - 3 * SR;
for (let i = 0; i < len; i++) { const g = k * (i > f0 ? (len - i) / (len - f0) : 1); L[i] *= g; R[i] *= g; }
mkdirSync(dirname(OUT), { recursive: true }); writeWav(OUT, L, R, SR);
console.log(`${(len / SR).toFixed(2)} s at ${BPM} BPM -> ${OUT}`);
