// DEV ONLY. Proves the C++ engine (plugin/) sounds like the TypeScript one:
// renders presets through both and compares them sample by sample.
//   npx tsx tools/plugin-parity.ts <path to lowtalk_render> [filter] [--wheel=1] [--clip] [--set=id:value,...]
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { renderPatch } from '../src/engine/core/render';
import { compileLoop } from '../src/engine/core/sequencer';
import { analysisSetup } from '../src/quality/categories';
import { patchToArray, validatePatch } from '../src/schema';
import { loadLibrary, loadLoops } from './lib/data';

const [bin, filter = ''] = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const wheel = Number(process.argv.find((a) => a.startsWith('--wheel='))?.split('=')[1] ?? 0);
// --clip: also turn both soft clippers up (they're off on most presets).
const clip = process.argv.includes('--clip');
// --set: override parameters on every preset (to exercise features the bank leaves at their defaults).
const sets = (process.argv.find((a) => a.startsWith('--set='))?.slice(6) ?? '')
  .split(',').filter(Boolean).map((kv) => { const i = kv.lastIndexOf(':'); const v = kv.slice(i + 1); return [kv.slice(0, i), v === "true" ? true : v === "false" ? false : Number.isNaN(Number(v)) ? v : Number(v)] as const; });
const loops = loadLoops();
const dir = mkdtempSync(join(tmpdir(), 'parity-'));
const fs = 48000, seconds = 3, tail = 1;
let worst = -Infinity, fails = 0;
const lib = loadLibrary().filter((e) => e.file.includes(filter));
for (const e of lib) {
  if (clip) Object.assign(e.json, { 'sub.clip': 6, 'clip.mid': 9 });
  for (const [k, v] of sets) (e.json as Record<string, unknown>)[k] = v;
  const setup = analysisSetup(e.json.meta);
  const loop = loops.get(setup.loop)!;
  const c = compileLoop(loop);
  const values = patchToArray(validatePatch(e.json).patch);
  const ev: string[] = [];
  for (let i = 0; i < c.count; i++) ev.push(`${c.events[i * 4]} ${c.events[i * 4 + 1]} ${c.events[i * 4 + 2]} ${c.events[i * 4 + 3]}`);
  const job = join(dir, 'job.txt'), out = join(dir, 'out.f32');
  writeFileSync(job, `${fs} ${seconds} ${tail} ${wheel}\n${Array.from(values).join(' ')}\n${c.bpm} ${c.lengthBeats} ${c.count}\n${ev.join('\n')}\n`);
  execFileSync(bin, [job, out]);
  const buf = readFileSync(out);
  const f32 = new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4);
  const n = f32.length / 2;
  const ts = renderPatch(e.json, loop, { sampleRate: fs, seconds, tail, modWheel: wheel });
  let diff = 0, sig = 0, maxd = 0;
  for (let i = 0; i < n; i++) {
    for (const [a, b] of [[ts.left[i], f32[i]], [ts.right[i], f32[n + i]]]) {
      diff += (a - b) ** 2;
      sig += a * a;
      maxd = Math.max(maxd, Math.abs(a - b));
    }
  }
  const relDb = 10 * Math.log10((diff + 1e-30) / (sig + 1e-30));
  worst = Math.max(worst, relDb);
  const ok = relDb < -60;
  if (!ok) fails++;
  console.log(`${ok ? '✓' : '✗'} ${e.file.padEnd(36)} difference ${relDb.toFixed(1)} dB below the signal, max ${maxd.toExponential(1)}`);
}
console.log(`\n${lib.length - fails}/${lib.length} match (worst ${worst.toFixed(1)} dB)`);
process.exit(fails ? 1 : 0);
