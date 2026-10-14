// DEV ONLY. Runs tools/analyze-library.ts over the matching library files in
// parallel worker processes (one per CPU), then the bank consistency check.
// --level first loudness-matches each chunk (tools/level-patches.ts).
//   npx tsx tools/analyze-parallel.ts <file filter[,filter…]> [--force] [--level]
import { spawn } from 'node:child_process';
import { availableParallelism } from 'node:os';
import { loadLibrary } from './lib/data';

const only = process.argv.slice(2).find((a) => !a.startsWith('--')) ?? '';
const extra = process.argv.slice(2).filter((a) => a.startsWith('--'));
const pats = only.split(',');
const files = loadLibrary().map((e) => e.file).filter((f) => pats.some((p) => f.includes(p)));
if (!files.length) {
  console.log(`no library files match "${only}"`);
  process.exit(1);
}
const workers = Math.max(1, Math.min(availableParallelism(), files.length));
const chunks: string[][] = Array.from({ length: workers }, () => []);
files.forEach((f, i) => chunks[i % workers].push(f));

const run = (args: string[], tool = 'tools/analyze-library.ts') =>
  new Promise<number>((resolve) => {
    const p = spawn('npx', ['tsx', tool, ...args], { stdio: ['ignore', 'pipe', 'inherit'] });
    let out = '';
    p.stdout.on('data', (d) => (out += d));
    p.on('close', (code) => {
      process.stdout.write(out.split('\n').filter((l) => l.startsWith('✓') || l.startsWith('✗')).map((l) => l + '\n').join(''));
      resolve(code ?? 1);
    });
  });

const level = extra.includes('--level');
const pass = extra.filter((a) => a !== '--level');
const codes = await Promise.all(
  chunks.map(async (c) => {
    if (level) await run([`--files=${c.join(',')}`], 'tools/level-patches.ts');
    return run([`--files=${c.join(',')}`, '--no-consistency', ...pass]);
  }),
);
// Consistency over the whole bank, no re-analysis.
const final = await run(['--files=', ...pass]);
const failed = codes.some((c) => c !== 0) || final !== 0;
console.log(failed ? '\nproblems found' : '\nall pass');
process.exit(failed ? 1 : 0);
