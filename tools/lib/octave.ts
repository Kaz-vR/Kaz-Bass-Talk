// DEV ONLY. No hidden octave: a preset that sits an octave (or two) up or down says so
// where the user sees it, on oscillator 1 and 2 and the sub, instead of in voice.octave.
// Folding it in keeps the sound: the oscillators and sub move by the same octaves, the
// filter's cutoff moves by what its keytracking did, and keytracked source filters follow.
import { getParam } from '../../src/schema';

const def = (id: string) => getParam(id)!.default as number;

export function foldOctave(raw: Record<string, unknown>, name = '?'): void {
  const oct = Number(raw['voice.octave'] ?? 0);
  if (!oct) return;
  for (const n of [1, 2]) {
    const semi = Number(raw[`osc${n}.semi`] ?? def(`osc${n}.semi`)) + 12 * oct;
    if (Math.abs(semi) > 24) throw new Error(`${name}: osc ${n} would land at ${semi} semitones`);
    raw[`osc${n}.semi`] = semi;
    if (raw[`osc${n}.filter_key`] === true) raw[`osc${n}.highpass`] = Number(raw[`osc${n}.highpass`] ?? def(`osc${n}.highpass`)) * 2 ** oct;
  }
  const sub = Number(raw['sub.octave'] ?? def('sub.octave')) + oct;
  const audible = Number(raw['sub.level'] ?? def('sub.level')) > 0;
  if (audible && (sub < -2 || sub > -1)) throw new Error(`${name}: sub would land at octave ${sub}`);
  raw['sub.octave'] = Math.max(-2, Math.min(-1, sub));
  if (raw['sub.filter_key'] === true) raw['sub.filter_cutoff'] = Number(raw['sub.filter_cutoff'] ?? def('sub.filter_cutoff')) * 2 ** oct;
  // The main filter followed the octave by its keytracking amount.
  const kt = Number(raw['filter.keytrack'] ?? def('filter.keytrack'));
  const fc = Number(raw['filter.cutoff'] ?? def('filter.cutoff')) * 2 ** (kt * oct);
  raw['filter.cutoff'] = Math.round(Math.min(20000, Math.max(20, fc)) * 100) / 100;
  raw['voice.octave'] = 0;
}
