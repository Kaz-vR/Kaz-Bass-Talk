// scratch: compare two C++ render binaries on presets (level, brightness)
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { compileLoop } from '../src/engine/core/sequencer';
import { analysisSetup } from '../src/quality/categories';
import { patchToArray, validatePatch } from '../src/schema';
import { loadLibrary, loadLoops } from './lib/data';
const [binA, binB, filter = ''] = process.argv.slice(2);
const sets = (process.argv.find((a) => a.startsWith('--set='))?.slice(6) ?? '').split(',').filter(Boolean).map((kv) => { const i = kv.lastIndexOf(':'); const v = kv.slice(i + 1); return [kv.slice(0, i), v === 'true' ? true : v === 'false' ? false : Number.isNaN(Number(v)) ? v : Number(v)] as const; });
const setsB = (process.argv.find((a) => a.startsWith('--setB='))?.slice(7) ?? '').split(',').filter(Boolean).map((kv) => { const i = kv.lastIndexOf(':'); const v = kv.slice(i + 1); return [kv.slice(0, i), v === 'true' ? true : v === 'false' ? false : Number.isNaN(Number(v)) ? v : Number(v)] as const; });
const loops = loadLoops(); const dir = mkdtempSync(join(tmpdir(), 'ab-'));
function render(bin: string, e: ReturnType<typeof loadLibrary>[number]) {
  const setup = analysisSetup(e.json.meta); const c = compileLoop(loops.get(setup.loop)!);
  const values = patchToArray(validatePatch(e.json).patch);
  const ev: string[] = []; for (let i = 0; i < c.count; i++) ev.push(`${c.events[i * 4]} ${c.events[i * 4 + 1]} ${c.events[i * 4 + 2]} ${c.events[i * 4 + 3]}`);
  const job = join(dir, 'job.txt'), out = join(dir, 'out.f32');
  writeFileSync(job, `48000 3 1 0\n${Array.from(values).join(' ')}\n${c.bpm} ${c.lengthBeats} ${c.count}\n${ev.join('\n')}\n`);
  execFileSync(bin, [job, out]); const b = readFileSync(out); return new Float32Array(b.buffer, b.byteOffset, b.byteLength / 4);
}
function stats(x: Float32Array) { let s = 0, pk = 0, d = 0, nan = 0; for (let i = 0; i < x.length; i++) { const v = x[i]; if (!Number.isFinite(v)) nan++; s += v * v; pk = Math.max(pk, Math.abs(v)); if (i > 1) { const dv = v - x[i - 2]; d += dv * dv; } } return { rms: 10 * Math.log10(s / x.length + 1e-20), pk, bright: 10 * Math.log10(d / (s + 1e-20) + 1e-20), nan }; }
for (const e of loadLibrary().filter((x) => x.file.includes(filter))) {
  for (const [k, v] of sets) (e.json as Record<string, unknown>)[k] = v;
  const a = stats(render(binA, e)); for (const [k, v] of setsB) (e.json as Record<string, unknown>)[k] = v; const b = stats(render(binB, e));
  console.log(`${e.file.padEnd(48)} level ${(b.rms - a.rms).toFixed(1).padStart(5)} dB  bright ${(b.bright - a.bright).toFixed(1).padStart(5)} dB  peak ${b.pk.toFixed(2)}${b.nan ? ' NaN!' : ''}`);
}
