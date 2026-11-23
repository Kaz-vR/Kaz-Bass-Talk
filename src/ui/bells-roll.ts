// The RUIN filter box's dice for BELLS (owner's call): rolls only the filter, from neuro-bass archetypes, not plain
// random (plain random is mostly mush). Each archetype is a recipe of four bands with ranges; WEIRD widens the
// variation and, near the top, swaps band types. Every roll then passes the same rules (see enforce()).

export const BELL_ARCHETYPES = ['any', 'yoi sweep', 'talker', 'screamer', 'hollow snarl', 'metal'] as const;
export type BellArchetype = (typeof BELL_ARCHETYPES)[number];

type Band = { type: string; freq: number; gain: number; q: number; range: number };
export type BellsRoll = { bands: Band[]; link: boolean; rate: number; clock: 'hz' | 'sync' | 'random' };

/** How often ANY picks each archetype: the two classics most. */
const WEIGHTS: [BellArchetype, number][] = [['yoi sweep', 30], ['talker', 25], ['screamer', 20], ['hollow snarl', 15], ['metal', 10]];
/** Vowel formants (F1, F2) in Hz, a male voice: A, E, I, O, U. */
const VOWELS: [number, number][] = [[730, 1090], [530, 1840], [300, 2290], [570, 840], [300, 870]];
/** Metal bar partials (a free-free bar): inharmonic, so driven it clangs. */
const METAL = [1, 2.76, 5.4, 8.93];
/** Synced rate values (grind<n>.rate, 0..1 in six steps): 1/4, 1/8, 1/16, 1/32. */
const R4 = 0.4, R8 = 0.6, R16 = 0.8, R32 = 1;

export function rollBells(arch: BellArchetype, weird: number, rnd: () => number = Math.random): BellsRoll {
  const w = Math.max(0, Math.min(1, weird));
  const between = (lo: number, hi: number) => lo + (hi - lo) * rnd();
  const logBetween = (lo: number, hi: number) => lo * Math.pow(hi / lo, rnd());
  const chance = (p: number) => rnd() < p;
  const pick = <T,>(xs: readonly T[]) => xs[Math.floor(rnd() * xs.length)];
  if (arch === 'any') {
    let r = rnd() * WEIGHTS.reduce((a, [, x]) => a + x, 0);
    arch = WEIGHTS.find(([, x]) => (r -= x) < 0)?.[0] ?? 'yoi sweep';
  }
  const bell = (freq: number, gain: number, q: number, range: number): Band => ({ type: 'bell', freq, gain, q, range });
  const darkTop = (): Band => ({ type: 'high cut 12', freq: logBetween(6000, 9000), gain: 0, q: 0.71, range: 0 });
  const syncOr = (pRandom: number, synced: number[], free: [number, number]): Pick<BellsRoll, 'rate' | 'clock'> =>
    chance(pRandom) ? { clock: 'random', rate: between(...free) } : { clock: 'sync', rate: pick(synced) };
  let r: BellsRoll;
  switch (arch) {
    case 'yoi sweep': {
      // one deep, narrow notch sweeping wide (the mover), maybe a second higher up, a small lift, the dark top
      const f = logBetween(400, 1500);
      const notch = (fr: number, range: number): Band => (chance(0.5)
        ? { type: 'notch', freq: fr, gain: 0, q: between(2, 5), range }
        : bell(fr, -between(15, 18), between(6, 12), range));
      r = {
        bands: [
          notch(f, between(2, 4)),
          chance(0.5) ? notch(f * between(2.8, 4), between(1, 2)) : bell(logBetween(250, 400), -between(4, 8), between(1, 2), 0),
          bell(logBetween(1500, 3000), between(4, 8), between(1.5, 3), between(0, 0.5)),
          chance(0.6) ? darkTop() : bell(logBetween(3000, 5000), -between(3, 6), between(1, 2), 0),
        ],
        link: chance(0.3),
        ...syncOr(0.3, [R8, R16], [0.35, 0.6]),
      };
      break;
    }
    case 'talker': {
      // a vowel's formants as narrow boosts moving together: the bass talks
      const [f1, f2] = pick(VOWELS), sh = Math.pow(2, between(-0.3, 0.3));
      r = {
        bands: [
          bell(f1 * sh, between(10, 15), between(4, 8), between(1, 1.5)),
          bell(f2 * sh, between(10, 14), between(4, 8), between(1, 1.5)),
          chance(0.6) ? bell(logBetween(2400, 2900) * sh, between(6, 9), between(4, 6), between(1, 1.5)) : bell(logBetween(250, 350), -between(4, 8), between(1, 2), 0),
          darkTop(),
        ],
        link: true,
        ...syncOr(0.35, [R4, R8], [0.3, 0.55]),
      };
      break;
    }
    case 'screamer': {
      // narrow, tall boosts an octave or a fifth apart: the drive after turns them into a scream
      const f = logBetween(600, 2500), iv = chance(0.5) ? 2 : 1.5;
      const range = between(1, 2);
      r = {
        bands: [
          bell(f, between(12, 18), between(8, 14), range),
          bell(f * iv, between(9, 15), between(8, 12), range),
          bell(logBetween(250, 400), -between(6, 10), between(1, 2), 0),
          darkTop(),
        ],
        link: chance(0.7),
        ...syncOr(0.5, [R8, R16], [0.4, 0.7]),
      };
      break;
    }
    case 'hollow snarl': {
      // a wide hole in the low mids, the top pushed up, one band moving slowly
      r = {
        bands: [
          bell(logBetween(400, 800), -between(8, 12), between(0.7, 1.5), between(0.5, 1)),
          { type: 'high shelf', freq: logBetween(1500, 3000), gain: between(4, 8), q: 0.71, range: between(0, 0.5) },
          bell(logBetween(1000, 2000), between(6, 9), between(3, 5), between(1, 2)),
          darkTop(),
        ],
        link: false,
        clock: 'random',
        rate: between(0.2, 0.4),
      };
      break;
    }
    default: {
      // metal: four narrow bands at a bar's inharmonic partials, boosts and cuts alternating, small fast moves
      const base = logBetween(300, 560), up = chance(0.5); // the top partial stays under 5 kHz
      r = {
        bands: METAL.map((m, i) => bell(base * m, ((i % 2 === 0) === up ? 1 : -1) * between(10, 14), between(10, 16), between(0.2, 0.6))),
        link: true,
        ...syncOr(0.35, [R16, R32], [0.6, 0.8]),
      };
    }
  }
  // WEIRD: wider variation; near the top a band may change type, the link and clock flip
  for (const b of r.bands) {
    if (b.type === 'high cut 12') continue;
    b.freq *= Math.pow(2, (rnd() * 2 - 1) * (0.05 + 0.6 * w));
    if (b.gain) b.gain += (rnd() * 2 - 1) * (0.5 + 4 * w);
    b.q *= Math.pow(2, (rnd() * 2 - 1) * (0.1 + 0.8 * w));
    b.range = Math.max(0, b.range + (rnd() * 2 - 1) * 1.5 * w);
    if (w > 0.85 && chance(0.3)) {
      b.type = pick(['bell', 'notch', 'bell']);
      if (b.type === 'bell' && Math.abs(b.gain) < 3) b.gain = (chance(0.5) ? 1 : -1) * between(8, 16);
    }
  }
  if (w > 0.85 && chance(0.3)) r.link = !r.link;
  if (w > 0.7 && chance(0.25)) r.clock = r.clock === 'random' ? 'sync' : 'random';
  return enforce(r);
}

/**
 * The rules every roll keeps: band centres 250 Hz-5 kHz (cuts and shelves excepted), never below 120 Hz; gains
 * ±18 dB and the boosts adding up to at most +24 dB (the drive after shouldn't choke); the bigger the boost, the narrower
 * (Q at least gain / 2.5 over +6 dB; wide cuts stay wide); the movers' ranges kept so only one or two move far.
 */
function enforce(r: BellsRoll): BellsRoll {
  const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
  for (const b of r.bands) {
    const peaky = b.type === 'bell' || b.type === 'notch';
    b.freq = Math.round(clamp(b.freq, peaky ? 250 : 120, peaky ? 5000 : 12000));
    b.gain = Math.round(clamp(b.gain, -18, 18) * 10) / 10;
    if (b.type === 'bell' && b.gain > 6) b.q = Math.max(b.q, b.gain / 2.5);
    b.q = Math.round(clamp(b.q, 0.3, 18) * 100) / 100;
    b.range = Math.round(clamp(b.range, 0, 4) * 10) / 10;
  }
  const boost = r.bands.reduce((a, b) => a + (b.type !== 'notch' && !b.type.includes('cut') ? Math.max(0, b.gain) : 0), 0);
  if (boost > 24) for (const b of r.bands) if (b.gain > 0) b.gain = Math.round(b.gain * (24 / boost) * 10) / 10;
  // at most two far movers: the rest move an octave at most
  const order = r.bands.map((b, i) => [b.range, i] as const).sort((a, b) => b[0] - a[0]);
  for (const [, i] of order.slice(2)) r.bands[i].range = Math.min(r.bands[i].range, 1);
  r.rate = Math.round(clamp(r.rate, 0, 1) * 100) / 100;
  return r;
}
