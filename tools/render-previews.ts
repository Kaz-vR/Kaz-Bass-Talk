// DEV ONLY. Render every library patch to WAV for human review.
//   npm run render:previews [-- --seconds 8] [-- --only reese]
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { renderPatch } from '../src/engine/core/render';
import { DEFAULT_LOOP, loadLibrary, loadLoops, ROOT } from './lib/data';
import { quickStats } from './lib/measure';
import { writeWav } from './lib/wav';

const args = process.argv.slice(2);
const arg = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const seconds = Number(arg('seconds') ?? 8);
const only = arg('only')?.toLowerCase();
const outDir = join(ROOT, 'renders');
mkdirSync(outDir, { recursive: true });
const loops = loadLoops();

console.log('patch'.padEnd(16), 'loop'.padEnd(13), 'peak', '  rms dB', ' centroid', ' sub%', ' limiter');
for (const { file, json } of loadLibrary()) {
  if (only && !file.includes(only) && !json.meta.name.toLowerCase().includes(only)) continue;
  const loopIds = [DEFAULT_LOOP];
  if (json.meta.audition && json.meta.audition !== DEFAULT_LOOP) loopIds.push(json.meta.audition);
  for (const id of loopIds) {
    const loop = loops.get(id);
    if (!loop) throw new Error(`${file}: unknown audition loop ${id}`);
    const r = renderPatch(json, loop, { seconds, tail: 1 });
    const s = quickStats(r.left, r.right, r.sampleRate);
    const name = `${file.replace('.json', '')}__${id}.wav`;
    writeWav(join(outDir, name), r.left, r.right, r.sampleRate);
    console.log(
      json.meta.name.padEnd(16), id.padEnd(13), s.peak.toFixed(2),
      s.rmsDb.toFixed(1).padStart(8), `${s.centroidHz.toFixed(0)} Hz`.padStart(9), `${(s.subRatio * 100).toFixed(0)}%`.padStart(5),
      `${(20 * Math.log10(r.limiterMinGain)).toFixed(1)} dB`.padStart(9),
    );
  }
}
console.log(`\nWAVs written to ${outDir}`);
