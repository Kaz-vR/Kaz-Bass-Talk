// DEV ONLY: how loud each RUIN recipe plays against the chain switched off, on Classic Reese and on a
// saw chord, so each recipe's Output can be set to play about as loud (prints the dB to write in).
import { readFileSync } from 'node:fs';
import { renderPatch } from '../src/engine/core/render';
import { RUIN_RECIPES, recipeParams } from '../src/ui/ruin-recipes';

const reese = JSON.parse(readFileSync('data/library/bass-classic-reese.json', 'utf8'));
const loop = (notes: number[], poly: boolean) => ({ id: 't', name: 't', description: '', bpm: 120, length_beats: 8, notes: notes.map((n) => ({ note: n, start: 0, dur: 6, vel: 100 })), poly } as any);
const rms = (p: object, l: any) => {
  const r: any = renderPatch(p, l, { seconds: 3 });
  let s = 0;
  for (let i = r.sampleRate; i < r.left.length; i++) s += r.left[i] ** 2 + r.right[i] ** 2;
  return Math.sqrt(s / (2 * (r.left.length - r.sampleRate)));
};
const chord = { 'osc1.wave': 'saw', 'osc2.level': 0, 'sub.level': 0, 'voice.polyphony': 6, 'filter.cutoff': 3000 };
for (const r of RUIN_RECIPES) {
  const dbs: number[] = [];
  for (const [base, l] of [[reese, loop([40], false)], [chord, loop([57, 60, 64], true)]] as const) {
    const off = rms({ ...base, 'grind.on': false }, l), on = rms({ ...base, ...recipeParams({ ...r, output: 0 }) }, l);
    dbs.push(20 * Math.log10(off / on));
  }
  console.log(r.name.padEnd(14), dbs.map((d) => d.toFixed(1)).join(' '), '→', ((dbs[0] + dbs[1]) / 2).toFixed(1));
}
