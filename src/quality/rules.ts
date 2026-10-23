// Sound-design rules: the "logic of good bass" applied to a patch's settings
// before anything is rendered. Errors break a rule outright; warnings flag a
// risk the quality critic will then confirm or clear by measurement.
//
// Also computes safe regions: per family, the range each parameter takes
// across patches that sound good. Generated sounds (Sound Tree, macros) only
// move parameters inside these regions.

import { params, type Patch } from '../schema';

export type RuleSeverity = 'error' | 'warn';

export interface RuleIssue {
  rule: string;
  severity: RuleSeverity;
  message: string;
}

/** Families that are meant to decay rather than sustain. */
const DECAYING = new Set(['808', 'pluck', 'fm']);
/** Families that are deliberately static (no movement required). */
const STATIC_OK = new Set(['sub', '808', 'pluck', 'fm', 'organ']);
/** Families whose character is distortion reaching the whole signal. */
const FULLBAND_DIRT_OK = new Set(['808', 'distorted', 'experimental']);

const n = (p: Patch, id: string) => p[id] as number;
/** Mod sources that move a held note over time. */
const MOVING_SOURCES = new Set(['lfo1', 'lfo2', 'lfo3', 'lfo4', 'random', 'drift', 'drift_slow', 'lfo_product']);

function hasMovement(p: Patch): boolean {
  for (let s = 1; s <= 12; s++) {
    const src = p[`mod${s}.source`] as string;
    if (MOVING_SOURCES.has(src) && Math.abs(n(p, `mod${s}.amount`)) > 0.02 && p[`mod${s}.dest`] !== 'none') return true;
  }
  if (n(p, 'chorus.mix') > 0.05 || n(p, 'flanger.mix') > 0.05 || n(p, 'phaser.mix') > 0.05) return true;
  if (n(p, 'tape.wow') > 0.02 || n(p, 'voice.analog') >= 0.2) return true;
  for (const o of [1, 2]) {
    if (n(p, `osc${o}.level`) > 0.1 && n(p, `osc${o}.unison_voices`) > 1 && n(p, `osc${o}.unison_detune`) > 4) return true;
  }
  // Two oscillators detuned against each other beat (Reese movement).
  if (n(p, 'osc1.level') > 0.1 && n(p, 'osc2.level') > 0.1 && Math.abs(n(p, 'osc1.fine') - n(p, 'osc2.fine')) > 3) return true;
  return false;
}

/** Why modulating `dst` does nothing in this patch, or null when it does something. */
function deadRouting(p: Patch, dst: string): string | null {
  const osc = (k: 1 | 2) => n(p, `osc${k}.level`) > 0.001;
  const wave = (k: 1 | 2) => p[`osc${k}.wave`] as string;
  switch (dst) {
    case 'osc1_wt_pos': return wave(1) === 'wavetable' ? null : 'oscillator 1 is not a wavetable';
    case 'osc2_wt_pos': return wave(2) === 'wavetable' && osc(2) ? null : 'oscillator 2 is not a sounding wavetable';
    case 'osc1_pw': return ['pulse', 'pwm_saw'].includes(wave(1)) ? null : 'oscillator 1 has no pulse width';
    case 'osc2_pw': return ['pulse', 'pwm_saw'].includes(wave(2)) && osc(2) ? null : 'oscillator 2 has no sounding pulse width';
    case 'osc2_pitch': return osc(2) ? null : 'oscillator 2 is silent';
    case 'unison_detune':
      return n(p, 'osc1.unison_voices') > 1 || (osc(2) && n(p, 'osc2.unison_voices') > 1) ? null : 'no oscillator uses unison';
    case 'filter_vowel': return p['filter.type'] === 'formant' ? null : 'the filter is not the formant type';
    case 'dist_drive': case 'dist_tone': return n(p, 'dist.mix') > 0.01 ? null : 'distortion mix is 0';
    case 'chorus_depth': return n(p, 'chorus.mix') > 0.01 ? null : 'chorus mix is 0';
    case 'delay_time': return n(p, 'delay.mix') > 0.01 ? null : 'delay mix is 0';
    default: return null;
  }
}

/** Check a (validated) patch against the sound-design rules. */
export function checkRules(p: Patch, family = (p.meta?.family as string | undefined) ?? ''): RuleIssue[] {
  const out: RuleIssue[] = [];
  const add = (rule: string, severity: RuleSeverity, message: string) => out.push({ rule, severity, message });

  // Clean low end: heavy distortion should leave the sub alone unless the type is about full-band dirt.
  const heavyDirt = n(p, 'dist.drive') > 0.35 && n(p, 'dist.mix') > 0.5;
  if (heavyDirt && n(p, 'dist.clean_below') < 60 && n(p, 'sub.level') < 0.2 && !FULLBAND_DIRT_OK.has(family)) {
    add('clean-low-end', 'warn', 'Heavy distortion reaches the lowest octave with no clean sub; set dist.clean_below to 100 Hz or more, or add sub.');
  }

  // Coupled: hard distortion wants a tamed post-tone.
  if (n(p, 'dist.drive') > 0.5 && n(p, 'dist.mix') > 0.5 && n(p, 'dist.post_tone') > 0.8 && !FULLBAND_DIRT_OK.has(family)) {
    add('drive-vs-tone', 'warn', 'Strong distortion with a wide-open post-tone tends to fizz; bring dist.post_tone below 0.8.');
  }

  // Coupled: near self-oscillation only where squelch is the point.
  if (n(p, 'filter.resonance') > 0.8 && family !== 'acid' && family !== 'experimental') {
    add('resonance', 'warn', 'Resonance above 0.8 whistles outside acid/experimental patches.');
  }

  // Stereo effects must stay above the sub.
  const low = ['chorus', 'flanger', 'phaser', 'delay', 'reverb'].filter((f) => n(p, `${f}.mix`) > 0.3 && n(p, `${f}.lowcut`) < 100);
  if (low.length) {
    add('fx-low-cut', 'error', `Stereo/space effects reach below 100 Hz (${low.join(', ')}); raise their low cut to keep the low end centred and tight.`);
  }

  // Envelope shape fits the family.
  if (DECAYING.has(family) && n(p, 'amp_env.sustain') > 0.6) {
    add('envelope-family', 'warn', `A ${family} patch should decay: amp sustain is ${n(p, 'amp_env.sustain').toFixed(2)}.`);
  }
  if ((family === 'reese' || family === 'cinematic' || family === 'sub') && n(p, 'amp_env.sustain') < 0.3) {
    add('envelope-family', 'warn', `A ${family} patch normally sustains: amp sustain is ${n(p, 'amp_env.sustain').toFixed(2)}.`);
  }

  // Coupled: heavy distortion after the filter regenerates the harmonics the filter removed,
  // so filter movement (envelope, LFOs) is masked. Put the dirt in front (drive.amount) instead.
  const filterMoves = n(p, 'filter.env_amount') > 0.05 || [...Array(12)].some((_, i) =>
    p[`mod${i + 1}.dest`] === 'filter_cutoff' && MOVING_SOURCES.has(p[`mod${i + 1}.source`] as string) && Math.abs(n(p, `mod${i + 1}.amount`)) > 0.05);
  if (filterMoves && n(p, 'dist.drive') > 0.5 && n(p, 'dist.mix') > 0.6 && (p['dist.type'] === 'soft' || p['dist.type'] === 'tube')) {
    add('masked-filter', 'warn', 'Heavy saturation after a moving filter hides the movement; move some dirt to drive.amount (before the filter) and lower dist.drive.');
  }

  // Dead routings: modulating something the patch doesn't use does nothing.
  for (let i = 1; i <= 12; i++) {
    const dst = p[`mod${i}.dest`] as string;
    if (dst === 'none' || p[`mod${i}.source`] === 'none' || Math.abs(n(p, `mod${i}.amount`)) < 0.0005) continue;
    const dead = deadRouting(p, dst);
    if (dead) add('dead-routing', 'error', `Mod ${i} → ${dst} does nothing: ${dead}.`);
  }

  // A light bitcrusher under a dark top is inaudible: its artifacts sit above the high cut.
  if (n(p, 'crush.mix') > 0.01 && n(p, 'crush.rate') < 6 && n(p, 'crush.bits') > 6 && n(p, 'eq.highcut') < 8000) {
    add('hidden-crush', 'warn', 'Bitcrusher artifacts sit above the high cut and will not be heard; downsample more (rate ≥ 6) or use fewer bits.');
  }

  // Movement: sustained patches shouldn't be static.
  if (n(p, 'amp_env.sustain') >= 0.5 && !STATIC_OK.has(family) && !hasMovement(p)) {
    add('movement', 'warn', 'Sustained patch with no movement (no LFO, modulation FX, drift or detune): it will sound static.');
  }

  return out;
}

// ------------------------------------------------------------ safe regions

export interface SafeRegion {
  /** Continuous/int params: allowed [min, max] (widened by a margin, clamped to the schema). */
  ranges: Record<string, [number, number]>;
  /** Enum/bool params: values seen in good patches. */
  choices: Record<string, (string | boolean)[]>;
  patches: number;
}

/**
 * Per family, the region of parameter space covered by the given (good)
 * patches. `margin` widens each range by that fraction of the schema range.
 */
export function safeRegions(patches: Patch[], margin = 0.1): Record<string, SafeRegion> {
  const byFamily = new Map<string, Patch[]>();
  for (const p of patches) {
    const fam = (p.meta?.family as string) ?? 'unknown';
    if (!byFamily.has(fam)) byFamily.set(fam, []);
    byFamily.get(fam)!.push(p);
  }
  const out: Record<string, SafeRegion> = {};
  for (const [fam, ps] of byFamily) {
    const region: SafeRegion = { ranges: {}, choices: {}, patches: ps.length };
    for (const def of params) {
      if (def.type === 'float' || def.type === 'int') {
        const vals = ps.map((p) => p[def.id] as number);
        const span = (def.max! - def.min!) * margin;
        region.ranges[def.id] = [Math.max(def.min!, Math.min(...vals) - span), Math.min(def.max!, Math.max(...vals) + span)];
      } else {
        region.choices[def.id] = [...new Set(ps.map((p) => p[def.id] as string | boolean))];
      }
    }
    out[fam] = region;
  }
  return out;
}

/** True when every parameter of p lies inside the region. */
export function inRegion(p: Patch, region: SafeRegion): boolean {
  for (const [id, [lo, hi]] of Object.entries(region.ranges)) {
    const v = p[id] as number;
    if (v < lo - 1e-9 || v > hi + 1e-9) return false;
  }
  for (const [id, vals] of Object.entries(region.choices)) if (!vals.includes(p[id] as string | boolean)) return false;
  return true;
}
