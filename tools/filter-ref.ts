// Dev only: renders our engine's main filter on a plain saw (everything else off), for measuring against a reference.
//   npx tsx tools/filter-ref.ts <out dir> <type> <cutoff Hz> <res 0..1> [note] [level 0..1] [seconds]
// Writes <type>_<cutoff>_<res>.wav (float, stereo) and, with type "off", the unfiltered saw.
import { writeFileSync } from 'fs';
import schema from '../data/schema.json';
import { renderPatch } from '../src/engine/core/render';

const [out, type, cut, res, noteS = '12', levelS = '0.8', secS = '3'] = process.argv.slice(2);
const p: Record<string, unknown> = { meta: { id: 'filter-ref', name: 'filter ref', category: 'lead', description: '', tags: [] } };
for (const q of (schema as { params: { id: string; default: unknown }[] }).params) p[q.id] = q.default;
const off = (re: RegExp, v: unknown) => { for (const k of Object.keys(p)) if (re.test(k)) p[k] = v; };
off(/\.on$/, false);
off(/^wobble\d?\.master$/, 0);
Object.assign(p, {
  'osc1.on': true, 'osc1.wave': 'saw', 'osc1.unison_voices': 1, 'osc1.level': Number(levelS), 'osc1.highpass': 20,
  'osc2.level': 0, 'sub.level': 0, 'noise.level': 0, 'voice.analog': 0, 'voice.velocity': 0,
  'filter.on': type !== 'off', 'filter.type': type === 'off' ? 'lowpass' : type, 'filter.cutoff': Number(cut), 'filter.resonance': Number(res),
  'filter.keytrack': 0, 'filter.env_amount': 0, 'filter.mix': 1,
});
const r = renderPatch(p, { id: 'n', name: 'n', description: '', bpm: 120, length_beats: 16, notes: [{ start: 0, dur: 8, note: Number(noteS), vel: 1 }] }, { seconds: Number(secS), sampleRate: 48000 });
const n = r.left.length, buf = Buffer.alloc(44 + n * 8);
buf.write('RIFF', 0); buf.writeUInt32LE(36 + n * 8, 4); buf.write('WAVEfmt ', 8); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(3, 20); buf.writeUInt16LE(2, 22);
buf.writeUInt32LE(48000, 24); buf.writeUInt32LE(48000 * 8, 28); buf.writeUInt16LE(8, 32); buf.writeUInt16LE(32, 34); buf.write('data', 36); buf.writeUInt32LE(n * 8, 40);
for (let i = 0; i < n; i++) { buf.writeFloatLE(r.left[i], 44 + 8 * i); buf.writeFloatLE(r.right[i], 48 + 8 * i); }
writeFileSync(`${out}/${type.replace(/ /g, '-')}_${cut}_${res}.wav`, buf);
