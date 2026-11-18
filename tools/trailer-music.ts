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
const at: Record<string, number> = {}; let b = 0;
for (const s of TL.shots) { at[s.part] ??= b; b += s.beats; }
const P = { intro: at.intro, riser: at.riser, main: at.main, brk: at.break, peak: at.peak, outro: at.outro, logo: at.logo, end: total };
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

// intro: a dark pad and a sparse plucked motif
add('Cold Breath', .22, pad(P.intro, P.main, .5));
add('Blackwater', .2, range(P.intro + 2, P.riser, 2).map((x, i) => n(x, .5, [62, 65, 69, 67, 65, 62, 60, 57][i % 8] , .55)));
// the riser under card 1 (a swelling noise and rising pad), then the impact on the drop
add('White Sweep', .45, [n(P.riser, P.main - P.riser, 50, .9)]);
add('Tower Swell', .25, [n(P.riser, P.main - P.riser, 38, .8), n(P.riser, P.main - P.riser, 45, .7)]);
const hit = (beat: number) => { add('Crushed 808', .9, [n(beat, 3, 26, 1)]); add('Hammer Stab', .45, [n(beat, 1.5, 38, 1)]); };
hit(P.main);
// the full parts: a dark bass in eighths, a kick on the beat, a noise backbeat, the pad
const groove = (a: number, z: number, big: boolean) => {
  add('Classic Reese', .55, range(a, z, .5).map((x) => n(x, .45, rootAt(x - a) + 12, (x % 1 ? .6 : .85))));
  add('Velvet Thump', .8, range(a, z, 1).map((x) => n(x, .3, 26, .95)));
  add('Snare Swing', .4, range(a + 1, z, 2).map((x) => n(x, .25, 50, .9)));
  add('Static Line', .18, range(a, z, .25).map((x, i) => n(x, .1, 74, i % 2 ? .4 : .7)));
  add(big ? 'Doom Horns' : 'Cold Breath', big ? .4 : .35, pad(a, z, .6));
  if (big) add('Chainsaw Lead', .28, range(a, z, 2).map((x, i) => n(x, 1.5, [74, 77, 76, 72][i % 4], .7)));
};
groove(P.main, P.brk, false);
// the break: the pad alone, filtered down, then 1.5 beats of near-silence before the biggest part
add('Sunken', .45, pad(P.brk, P.peak - 1.5, .5));
hit(P.peak); groove(P.peak, P.outro, true);
// the outro under BUILT FOR RUIN: bass drone and pad thinning out
add('The Drone / Sub-Rumble Bass', .5, [n(P.outro, P.logo - P.outro, 26, .8)]);
add('Cold Breath', .45, pad(P.outro, P.logo, .55));
// the logo: a final hit, and its tail rings out
hit(P.logo);
add('Cathedral Rot', .5, [n(P.logo, 8, 50, .8), n(P.logo, 8, 53, .7), n(P.logo, 8, 57, .7), n(P.logo, 8, 38, .8)]);

// render every track through the engine over the whole length (one long, non-repeating loop), then mix
const len = Math.round(total * 60 / BPM * SR), L = new Float32Array(len), R = new Float32Array(len);
for (const t of tracks) {
  const loop: Loop = { id: 'trailer', name: 'trailer', description: '', bpm: BPM, length_beats: total + 64, notes: t.notes };
  const r = renderPatch(lib.get(t.preset), loop, { sampleRate: SR, seconds: total * 60 / BPM, tail: 0 });
  for (let i = 0; i < len; i++) { L[i] += r.left[i] * t.gain; R[i] += r.right[i] * t.gain; }
  console.log(`${t.preset.padEnd(28)} ${t.notes.length} notes`);
}
// the drop-out: near-silence for 1.5 beats right before the biggest part
const s0 = Math.round((P.peak - 1.5) * 60 / BPM * SR), s1 = Math.round(P.peak * 60 / BPM * SR);
for (let i = s0; i < s1; i++) { const g = .06; L[i] *= g; R[i] *= g; }
// level: peak at -1 dBFS, a gentle fade over the last 3 s
let pk = 0; for (let i = 0; i < len; i++) pk = Math.max(pk, Math.abs(L[i]), Math.abs(R[i]));
const k = .89 / (pk || 1), f0 = len - 3 * SR;
for (let i = 0; i < len; i++) { const g = k * (i > f0 ? (len - i) / (len - f0) : 1); L[i] *= g; R[i] *= g; }
mkdirSync(dirname(OUT), { recursive: true }); writeWav(OUT, L, R, SR);
console.log(`${(len / SR).toFixed(2)} s at ${BPM} BPM -> ${OUT}`);
