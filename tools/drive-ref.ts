// Dev only: runs our drive (grind.ts DriveUnit, the FX page's DRIVE / a RUIN drive) on a WAV, whole band, tone open,
// for measuring against a reference.   npx tsx tools/drive-ref.ts in.wav out.wav <type 0..9> <drive 0..1>
import { readFileSync, writeFileSync } from 'fs';
import { DriveUnit } from '../src/engine/core/grind';
const [inp, outp, typeS, driveS] = process.argv.slice(2);
const b = readFileSync(inp), i = b.indexOf('data'), n = b.readUInt32LE(i + 4) / 8, fs = 48000;
const d = new DriveUnit();
const out = Buffer.alloc(44 + n * 8);
b.copy(out, 0, 0, 44);
for (let k = 0; k < n; k++) {
  if (k % 32 === 0) d.control(Number(typeS), Number(driveS), 1, 0, 1000, 9, fs, fs);
  d.process(b.readFloatLE(i + 8 + 8 * k), b.readFloatLE(i + 12 + 8 * k), 1);
  out.writeFloatLE(d.l, 44 + 8 * k);
  out.writeFloatLE(d.r, 48 + 8 * k);
}
writeFileSync(outp, out);
