// DEV ONLY. The dark-bass architecture (the owner's rules): every dark bass
// uses exactly one octave template for oscillator 1, oscillator 2 and the sub,
// so no two layers fight in the low end.
//
// Shared rules, every template:
//   - sub: pure sine, mono, clean (the engine keeps it out of the drive,
//     filter, distortion, tape and effects, and its pitch follows only the
//     played note: never vibrato, drift or the mod matrix);
//   - oscillators 1 and 2 are high-passed before the drive (so their
//     harmonics distort without muddying the sub) and carry the tape wobble;
//   - stereo only above 250 Hz (mono crossover and effects low cut at 250 Hz).
//
//   A Heavy Reese          sub -1 · osc1 root · osc2 root, slightly detuned (beating)
//   B Cinematic Screamer   sub -1 · osc1 root · osc2 +12, 3-6 dB under osc1
//   C Ominous Fifth        sub -1 · osc1 root · osc2 +7, dark filter, tape saturation
//   D Deep Rumble          sub -2 · osc1 -12 · osc2 root, high-passed at 200 Hz
//   E 808 / Thump          the sub carries the note and its pitch drop; osc1 at the root for grit only
//   F Single Body          one oscillator at the root over the sub
//   G Tritone Bass         sub -1 · osc1 root · osc2 +6 (the devil's interval)

export type BassTemplate = 'A' | 'B' | 'C' | 'D' | 'E' | 'F' | 'G';
type Settings = Record<string, number | string | boolean>;

export const TEMPLATE_TAG: Record<BassTemplate, string> = {
  A: 'heavy-reese', B: 'cinematic-screamer', C: 'ominous-fifth', D: 'deep-rumble', E: '808-thump', F: 'single-body', G: 'tritone-bass',
};

/** Which template each dark bass uses (bank ids and Terror ids). */
export const BASS_TEMPLATE: Record<string, BassTemplate> = {
  // bank (tools/bank/bass.ts)
  'chrome-teeth': 'A', 'night-swell': 'A', 'square-shadow': 'A',
  'tape-sub': 'B', 'hammer-stab': 'B', rebar: 'B', 'neon-octave': 'B', 'rubber-night': 'B',
  'basement-pulse': 'C',
  'iron-wobble': 'D',
  'cold-iron': 'F', 'fold-lung': 'F', grinder: 'G', 'tear-line': 'B', 'rust-wobble': 'A', 'soft-drop': 'E',
  'kick-below': 'E',
  'upright-ghost': 'F', 'velvet-thump': 'F', 'felt-floor': 'F', 'round-pulse': 'F', 'glass-floor': 'F',
  // Terror (tools/build-terror.ts)
  wall: 'A', breather: 'A', exhale: 'A', 'slow-growl': 'A', 'worn-tape': 'A', 'reverse-swell': 'A', 'old-record': 'A',
  'dust-ghost': 'B',
  cavern: 'C', 'metal-hull': 'C',
  undertow: 'D',
  'crushed-808': 'E',
  dread: 'G',
};

const num = (s: Settings, k: string, d: number) => (typeof s[k] === 'number' ? (s[k] as number) : d);

/** The template's settings, given the preset's own (merged) settings. They win over the preset's. */
export function templateSettings(t: BassTemplate, s: Settings): Settings {
  const osc1Level = num(s, 'osc1.level', 0.6);
  const fine = num(s, 'osc2.fine', 0);
  const out: Settings = {
    'sub.wave': 'sine', 'sub.octave': -1, 'osc1.semi': 0,
    'osc1.highpass': 130, 'osc2.highpass': 130,
    'output.crossover': 250, 'fx.lowcut': Math.max(250, num(s, 'fx.lowcut', 250)),
  };
  switch (t) {
    case 'A':
      Object.assign(out, { 'osc2.semi': 0, 'osc2.fine': Math.abs(fine) >= 3 ? Math.sign(fine) * Math.min(12, Math.abs(fine)) : -7,
        'osc2.level': Math.max(0.3, num(s, 'osc2.level', 0)) });
      break;
    case 'B':
      Object.assign(out, { 'osc2.semi': 12, 'osc2.fine': 0, 'osc2.level': Math.round(osc1Level * 0.6 * 100) / 100 }); // about -4.4 dB
      break;
    case 'C':
      Object.assign(out, { 'osc2.semi': 7, 'osc2.fine': 0, 'osc2.level': Math.max(0.25, num(s, 'osc2.level', 0)),
        'tape.drive': Math.max(0.5, num(s, 'tape.drive', 0.4)), 'filter.cutoff': Math.round(num(s, 'filter.cutoff', 600) * 0.85) });
      break;
    case 'D':
      // osc1 an octave under the note: a gentler high-pass, or the cut would take most of it.
      Object.assign(out, { 'sub.octave': -2, 'osc1.semi': -12, 'osc1.highpass': 60, 'osc2.semi': 0, 'osc2.highpass': 200,
        'osc2.level': Math.max(0.3, num(s, 'osc2.level', 0)) });
      break;
    case 'E':
      Object.assign(out, { 'osc2.level': 0, 'osc2.semi': 0, 'osc2.fine': 0, 'osc2.highpass': 20, 'sub.level': Math.max(0.6, num(s, 'sub.level', 0.5)) });
      break;
    case 'F':
      Object.assign(out, { 'osc2.level': 0, 'osc2.semi': 0, 'osc2.fine': 0, 'osc2.highpass': 20, 'osc1.highpass': 120 });
      break;
    case 'G':
      Object.assign(out, { 'osc2.semi': 6 });
      break;
  }
  return out;
}

/** Apply a dark bass's template (when it has one) to its merged settings and tags. */
export function applyBassTemplate(id: string, raw: Record<string, unknown>, tags: string[]): string[] {
  const t = BASS_TEMPLATE[id];
  if (!t) return tags;
  Object.assign(raw, templateSettings(t, raw as Settings));
  return [...tags.filter((x) => !Object.values(TEMPLATE_TAG).includes(x)), TEMPLATE_TAG[t]];
}
