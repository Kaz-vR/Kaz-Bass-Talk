// DEV ONLY: measures every noise type's loudness (K-weighted, as LUFS) at Tone 0 .. 1 and prints
// the trim table for TEX_TRIM_DB in src/engine/core/voicefx.ts, so all types play equally loud.
// Run with the table at 0 (or pass --check to see how far the current table is off).
import { Texture } from '../src/engine/core/voicefx';
import { textureLoudness } from '../src/engine/core/loudness';

const TARGET = -11;
const TONES = [0, 0.25, 0.5, 0.75, 1];
const rows: string[] = [];
for (let type = 0; type < 14; type++) {
  const row = TONES.map((tone) => {
    const lu = textureLoudness(new Texture(), type, tone, 0.5, 48000);
    return Math.round((TARGET - lu) * 10) / 10;
  });
  rows.push(`  [${row.join(', ')}],`);
}
console.log(rows.join('\n'));
