// DEV ONLY. Runs tools/analyze-library.ts over the matching library files in
// parallel worker processes (one per CPU), then the bank consistency check.
//   npx tsx tools/analyze-parallel.ts <file filter> [--force]
import { spawn } from 'node:child_process';
import { availableParallelism } from 'node:os';
import { loadLibrary } from './lib/data';

const only = process.argv.slice(2).find((a) => !a.startsWith('--')) ?? '';
const extra = process.argv.slice(2).filter((a) => a.startsWith('--'));
const files = loadLibrary().map((e) => e.file).filter((f) => f.includes(only));
const workers = Math.max(1, Math.min(availableParallelism(), files.length));
const chunks: string[][] = Array.from({ length: workers }, () => []);
files.forEach((f, i) => chunks[i % workers].push(f));

const run = (args: string[]) =>
  new Promise<number>((resolve) => {
    const p = spawn('npx', ['tsx', 'tools/analyze-library.ts', ...args], { stdio: ['ignore', 'pipe', 'inherit'] });
    let out = '';
    p.stdout.on('data', (d) => (out += d));
    p.on('close', (code) => {
      process.stdout.write(out.split('\n').filter((l) => l.startsWith('✓') || l.startsWith('✗')).map((l) => l + '\n').join(''));
      resolve(code ?? 1);
    });
  });

const codes = await Promise.all(chunks.map((c) => run([`--files=${c.join(',')}`, '--no-consistency', ...extra])));
// Consistency over the whole bank, no re-analysis.
const final = await run(['--files=', ...extra]);
const failed = codes.some((c) => c !== 0) || final !== 0;
console.log(failed ? '\nproblems found' : '\nall pass');
process.exit(failed ? 1 : 0);
