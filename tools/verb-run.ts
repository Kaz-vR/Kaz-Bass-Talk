// Dev only: a WAV through our reverb, dry + wet (50 / 50), for listening comparisons.
//   npx tsx tools/verb-run.ts in.wav out.wav <type 0..3> <decay s>
import { readFileSync, writeFileSync } from 'fs';
import { Reverb } from '../src/engine/core/fx';
const [inp, outp, typeS, decayS] = process.argv.slice(2);
const b = readFileSync(inp), i = b.indexOf('data'), n = b.readUInt32LE(i + 4) / 8;
const rv = new Reverb(48000), o = new Float64Array(2), out = Buffer.alloc(44 + n * 8);
b.copy(out, 0, 0, 44);
for (let k = 0; k < n; k++) {
  const l = b.readFloatLE(i + 8 + 8 * k), r = b.readFloatLE(i + 12 + 8 * k);
  rv.process(0.5 * (l + r), Number(typeS), Number(decayS), 10, o);
  out.writeFloatLE(0.5 * l + o[0], 44 + 8 * k);
  out.writeFloatLE(0.5 * r + o[1], 48 + 8 * k);
}
writeFileSync(outp, out);
