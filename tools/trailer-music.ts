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

// F minor (the trailer of 20 Nov: everything new): Fm, Db, Bb minor, C (the dominant: tension), a chord a bar
const CH = [[53, 56, 60], [49, 53, 56], [46, 49, 53], [48, 52, 55]], ROOTS = [41, 37, 34, 36];
const chordAt = (beat: number) => CH[Math.floor(beat / 4) % 4], rootAt = (beat: number) => ROOTS[Math.floor(beat / 4) % 4];
const pad = (a: number, z: number, vel: number, lo = 0) => range(a, z, 4).flatMap((x) => chordAt(x - a).map((k) => n(x, Math.min(4, z - x) + .05, k + lo, vel)));
// THE RIFF: one bass line, heard clean first and then ruined (the story of card 2), eighths over a bar
const RIFF = [41, 41, 44, 41, 48, 41, 39, 37];
const riff = (a: number, z: number, oct = 0, vel = .85) => range(a, z, .5).map((x, k) => n(x, .42, RIFF[k % 8] + oct, k % 2 ? vel * .75 : vel));
// a hit on a cut; big: with the heavy bass
const hit = (beat: number, big = false) => { add('Crushed 808', .9, [n(beat, 3, 29, 1)]); add('Hammer Stab', .4, [n(beat, 1.5, 41, 1)]);
  if (big) add('Destroyed Reese', .5, [n(beat, 1.5, 29, 1)]); };
// the heartbeat: lub-dub every two beats (the dark parts)
const heart = (a: number, z: number, step = 2, vel = .7) => add('Velvet Thump', .7, range(a, z, step).flatMap((x) => [n(x, .2, 29, vel), n(x + .35, .2, 29, vel * .6)]));
// drums: kick, a noise snare on 2 and 4, ticking hats; heavy: kick on every beat and the sixteenths busier
const drums = (a: number, z: number, o: { heavy?: boolean; light?: boolean } = {}) => {
  add('Velvet Thump', .85, range(a, z, o.light ? 2 : 1).map((x) => n(x, .3, 29, .95)));
  if (!o.light) add('Snare Swing', .42, range(a + 1, z, 2).map((x) => n(x, .25, 53, .9)));
  add('Static Line', o.heavy ? .2 : .13, range(a, z, o.heavy ? .25 : .5).map((x, i) => n(x, .1, 77, i % 2 ? .4 : .7)));
};

// 1 the mystery: near-dark; a heartbeat, a breath of air, a few cold metallic notes far apart
heart(P.mystery, P.card1);
add('Air Fall', .3, [n(P.mystery, P.card1 - P.mystery, 53, .6)]);
add('Glass Tine', .28, [[P.mystery + 1.5, 72], [P.mystery + 5, 68], [P.mystery + 8.5, 75], [P.mystery + 11, 72]].map(([x, k]) => n(x, 1.5, k, .5)));
// 2 card 1: the heartbeat speeds up, a riser, the low pad swelling
heart(P.card1, P.card1 + 3, 1, .8); heart(P.card1 + 3, P.proof, .5, .9);
add('White Sweep', .45, [n(P.card1, P.proof - P.card1, 53, .9)]);
add('Tower Swell', .3, [n(P.card1, P.proof - P.card1, 41, .8), n(P.card1, P.proof - P.card1, 48, .7)]);
// 3 the proof: every shot is the sound you hear (the saw, the swell, the wobble, the scope's pluck), then all together
hit(P.proof); drums(P.proof, P.reveal, { light: true });   // (a pulse under the proof: the drop must be a step up)
add('Rust Saw', .65, range(P.proof, P.proof2, .5).map((x, k) => n(x, .4, [65, 65, 68, 72][k % 4], .8)));
add('Tidal Fog', .8, CH[0].map((k) => n(P.proof2, 2.2, k, .8)));
add('Iron Wobble', .75, [n(P.proof3, 2, 41, .9)]);
add('Neon Snap', .65, range(P.proof4, P.reveal, .25).map((x, k) => n(x, .2, [65, 68, 72, 77][k % 4], .75)));
hit(P.reveal); drums(P.reveal, P.card2, { light: true }); add('Tidal Fog', .4, pad(P.reveal, P.card2, .6));
add('Neon Snap', .3, range(P.reveal, P.card2, .5).map((x, k) => n(x, .3, [65, 68, 72, 77][k % 4], .6)));
// 4 card 2 (BUILD A SOUND. THEN RUIN IT.): the riff introduced alone, clean, on a round bass
add('Round Pulse', .6, riff(P.card2, P.clean));
// 5 the transformation: the riff clean with light drums, then the match cut: the same riff ruined
add('Round Pulse', .6, riff(P.clean, P.ruined)); drums(P.clean, P.ruined, { light: true });
hit(P.ruined, true);
add('Destroyed Reese', .55, riff(P.ruined, P.card3)); add('Grinder', .35, riff(P.ruined, P.card3, 12, .7));
add('Screaming FM / Neuro Bass', .3, range(P.ruined + .75, P.card3, 1).map((x) => n(x, .4, rootAt(x - P.ruined) + 24, .9)));
add('Doom Horns', .35, pad(P.ruined, P.card3, .7)); drums(P.ruined, P.card3, { heavy: true });
// 6-7 card 3 and abundance: a hit, then a new preset on every one-beat cut, playing the riff's opening
hit(P.card3); add('The Drone / Sub-Rumble Bass', .45, [n(P.card3, P.many - P.card3, 29, .8)]); drums(P.card3, P.card4, { light: true });
['Glass Bell Lead', 'Burnt Rhodes', 'Ringing Wire', 'Velvet Neon', 'Chainsaw Lead', 'Bone'].forEach((pr, i) =>
  add(pr, .32, [0, .5].map((d, k) => n(P.many + i + d, .45, [65, 68][k], .8))));
add('Classic Reese', .4, riff(P.many, P.card4, 0, .7));
// 8-9 card 4 and Create: a hit; every ROLL a dice click and a new sound out of it, faster each time, a snare roll rising
hit(P.card4); drums(P.card4, P.create, { light: true }); add('Tidal Fog', .35, pad(P.card4, P.create, .55));
const rolls: [number, string][] = [[P.create, 'Static Heaven'], [P.create + 2, 'Warp Line'], [P.create + 3, 'Fold Lung'], [P.create + 4, 'Space Squiggle'], [P.create + 5, 'Random Bleeps']];
add('Tick-Tock Pluck', .45, rolls.map(([x]) => n(x, .15, 84, 1)));
rolls.forEach(([x, pr], i) => add(pr, .34, [n(x + .1, i ? .9 : 1.9, [65, 68, 72, 70, 77][i], .85)]));
add('Snare Swing', .32, [...range(P.create, P.create + 4, .5), ...range(P.create + 4, P.ready, .25)].map((x, i, arr) => n(x, .15, 53, .35 + .55 * i / arr.length)));
add('Classic Reese', .4, riff(P.create, P.ready, 0, .7));
// 10 ARE YOU READY?: everything stops; the heartbeat again, a deep drone, a swell, then one beat of silence
add('Velvet Thump', .35, range(P.ready, P.logo - 1, 2).flatMap((x) => [n(x, .2, 29, .6), n(x + .35, .2, 29, .4)])); add('The Drone / Sub-Rumble Bass', .22, [n(P.ready, P.logo - 1 - P.ready, 29, .8)]);
add('White Sweep', .3, [n(P.ready + 3, P.logo - 1 - (P.ready + 3), 53, .9)]);
// 11 the logo: a braam (horns, tubas, warhorn and the ruined bass on F, held) on the biggest hit, ringing out
hit(P.logo, true);
for (const [pr, g] of [['Doom Horns', .45], ['Low Tubas', .45], ['Warhorn', .35]] as [string, number][]) add(pr, g, [n(P.logo, 6, 41, 1), n(P.logo, 6, 48, .9), n(P.logo, 6, 53, .8)]);
add('Destroyed Reese', .45, [n(P.logo, 4, 29, 1)]);
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
for (const [a0, a1] of [[0, P.mystery], [P.logo - 1, P.logo]]) for (let i = B(a0); i < B(a1); i++) { L[i] = 0; R[i] = 0; }
// level: peak at -1 dBFS, a gentle fade over the last 3 s
let pk = 0; for (let i = 0; i < len; i++) pk = Math.max(pk, Math.abs(L[i]), Math.abs(R[i]));
const k = .89 / (pk || 1), f0 = len - 3 * SR;
for (let i = 0; i < len; i++) { const g = k * (i > f0 ? (len - i) / (len - f0) : 1); L[i] *= g; R[i] *= g; }
mkdirSync(dirname(OUT), { recursive: true }); writeWav(OUT, L, R, SR);
console.log(`${(len / SR).toFixed(2)} s at ${BPM} BPM -> ${OUT}`);
