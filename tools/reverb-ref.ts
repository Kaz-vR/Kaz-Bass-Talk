// Dev only: our reverb's impulse response (fx.ts Reverb, wet only), for measuring against a reference.
//   npx tsx tools/reverb-ref.ts <out.wav> <type 0..3> <decay s> [predelay ms] [seconds]
import { writeFileSync } from 'fs';
import { Reverb } from '../src/engine/core/fx';
const [outp, typeS, decayS, preS = '0', secS = '10'] = process.argv.slice(2);
const fs = 48000, n = Math.round(Number(secS) * fs), rv = new Reverb(fs), o = new Float64Array(2);
const buf = Buffer.alloc(44 + n * 8);
buf.write('RIFF', 0); buf.writeUInt32LE(36 + n * 8, 4); buf.write('WAVEfmt ', 8); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(3, 20); buf.writeUInt16LE(2, 22);
buf.writeUInt32LE(fs, 24); buf.writeUInt32LE(fs * 8, 28); buf.writeUInt16LE(8, 32); buf.writeUInt16LE(32, 34); buf.write('data', 36); buf.writeUInt32LE(n * 8, 40);
for (let i = 0; i < n; i++) {
  rv.process(i === 0 ? 1 : 0, Number(typeS), Number(decayS), Number(preS), o);
  buf.writeFloatLE(o[0], 44 + 8 * i);
  buf.writeFloatLE(o[1], 48 + 8 * i);
}
writeFileSync(outp, buf);
