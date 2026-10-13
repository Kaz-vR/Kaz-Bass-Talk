// DEV ONLY. Loudness-match the library: render each patch on the default
// loop and set output.gain so the RMS lands on TARGET_DB, without letting
// peaks go above PEAK_LIMIT (so the limiter stays a safety net, not a sound).
import { writeFileSync } from 'node:fs';
import { renderPatch } from '../src/engine/core/render';
import { DEFAULT_LOOP, loadLibrary, loadLoops } from './lib/data';
import { quickStats } from './lib/measure';

const TARGET_DB = -16;
const PEAK_LIMIT = 0.85; // just under the -1 dBFS limiter ceiling: it only ever touches stray transients
const loop = loadLoops().get(DEFAULT_LOOP)!;

for (const entry of loadLibrary()) {
  const patch = entry.json;
  for (let pass = 0; pass < 3; pass++) {
    const r = renderPatch(patch, loop, { seconds: 4 });
    const s = quickStats(r.left, r.right, r.sampleRate);
    const delta = Math.min(TARGET_DB - s.rmsDb, 20 * Math.log10(PEAK_LIMIT / s.peak));
    if (Math.abs(delta) < 0.25) break;
    const gain = Math.max(-24, Math.min(12, (patch['output.gain'] as number) + delta));
    patch['output.gain'] = Math.round(gain * 10) / 10;
  }
  const r = renderPatch(patch, loop, { seconds: 4 });
  const s = quickStats(r.left, r.right, r.sampleRate);
  console.log(`${patch.meta.name.padEnd(16)} gain ${String(patch['output.gain']).padStart(5)} dB → rms ${s.rmsDb.toFixed(1)} dB, peak ${s.peak.toFixed(2)}`);
  writeFileSync(entry.path, JSON.stringify(patch, null, 2) + '\n');
}
