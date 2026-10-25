// Patch schema access, validation and conversion.
// Pure TypeScript: no browser or Node APIs, so it can run in the UI, the
// AudioWorklet, Node tests and (later) be ported to the plugin.

import schemaJson from '../../data/schema.json';

export type ParamType = 'float' | 'int' | 'enum' | 'bool';
export type Curve = 'linear' | 'log' | 'pow';

export interface ParamDef {
  id: string;
  label: string;
  type: ParamType;
  min?: number;
  max?: number;
  default: number | string | boolean;
  curve?: Curve;
  exponent?: number;
  unit?: string;
  options?: string[];
  group: string;
  describes: string;
}

export interface Schema {
  version: number;
  params: ParamDef[];
}

export type ParamValue = number | string | boolean;

export interface PatchMeta {
  name: string;
  description?: string;
  tags?: string[];
  features?: Record<string, number>;
  [key: string]: unknown;
}

/** A patch: flat `{ "<param id>": value }` plus `meta`. */
export interface Patch {
  meta: PatchMeta;
  [paramId: string]: ParamValue | PatchMeta;
}

export const schema: Schema = schemaJson as unknown as Schema;
export const params: readonly ParamDef[] = schema.params;
export const PARAM_COUNT = params.length;

const indexById = new Map<string, number>();
params.forEach((p, i) => indexById.set(p.id, i));

export function paramIndex(id: string): number {
  const i = indexById.get(id);
  if (i === undefined) throw new Error(`Unknown parameter: ${id}`);
  return i;
}

export function getParam(id: string): ParamDef | undefined {
  const i = indexById.get(id);
  return i === undefined ? undefined : params[i];
}

/** True for params whose change can't be smoothed (switches at a duck). */
export function isDiscrete(p: ParamDef): boolean {
  return p.type !== 'float';
}

export interface ValidationIssue {
  param: string;
  message: string;
}

export interface ValidationResult {
  patch: Patch;
  issues: ValidationIssue[];
}

function clampValue(p: ParamDef, raw: unknown, issues: ValidationIssue[]): ParamValue {
  switch (p.type) {
    case 'bool':
      if (typeof raw === 'boolean') return raw;
      if (raw === 0 || raw === 1) return raw === 1;
      issues.push({ param: p.id, message: `expected bool, got ${JSON.stringify(raw)}` });
      return p.default as boolean;
    case 'enum': {
      const opts = p.options!;
      if (typeof raw === 'string' && opts.includes(raw)) return raw;
      if (typeof raw === 'number' && Number.isInteger(raw) && raw >= 0 && raw < opts.length) return opts[raw];
      issues.push({ param: p.id, message: `invalid option ${JSON.stringify(raw)}` });
      return p.default as string;
    }
    case 'int':
    case 'float': {
      if (typeof raw !== 'number' || !Number.isFinite(raw)) {
        issues.push({ param: p.id, message: `expected number, got ${JSON.stringify(raw)}` });
        return p.default as number;
      }
      let v = p.type === 'int' ? Math.round(raw) : raw;
      if (p.type === 'int' && v !== raw) issues.push({ param: p.id, message: `rounded ${raw} to ${v}` });
      if (v < p.min!) {
        issues.push({ param: p.id, message: `${raw} below min ${p.min}` });
        v = p.min!;
      } else if (v > p.max!) {
        issues.push({ param: p.id, message: `${raw} above max ${p.max}` });
        v = p.max!;
      }
      return v;
    }
  }
}

/**
 * Older patches had a pitch envelope of their own and a matrix Pitch that never reached the sub.
 * Now Env 3 → Pitch moves the whole note (sub included) and Osc A+B pitch only the oscillators, so:
 * their Pitch rows become Osc A+B pitch, and the pitch envelope becomes Env 3 (an instant jump that
 * decays) routed to Pitch, in a free slot or, when all 12 are used, in place of the smallest one.
 */
function migratePitchEnv(src: Record<string, unknown>): Record<string, unknown> {
  if (!('pitch_env.amount' in src)) return src;
  const out: Record<string, unknown> = { ...src };
  for (let n = 1; n <= MOD_SLOT_COUNT; n++) if (out[`mod${n}.dest`] === 'pitch') out[`mod${n}.dest`] = 'osc_pitch';
  const amount = Number(src['pitch_env.amount']) || 0, decay = Number(src['pitch_env.decay']) || 60;
  if (Math.abs(amount) < 1e-6) return out;
  out['env3.attack'] = 0;
  out['env3.decay'] = decay;
  out['env3.sustain'] = 0;
  out['env3.release'] = decay;
  const amt = (n: number) => Math.abs(Number(out[`mod${n}.amount`]) || 0);
  const free = (n: number) => (out[`mod${n}.source`] ?? 'none') === 'none' || (out[`mod${n}.dest`] ?? 'none') === 'none' || amt(n) === 0;
  let slot = 0;
  for (let n = 1; n <= MOD_SLOT_COUNT && !slot; n++) if (free(n)) slot = n;
  if (!slot) {
    slot = 1;
    for (let n = 2; n <= MOD_SLOT_COUNT; n++) if (amt(n) < amt(slot)) slot = n;
  }
  out[`mod${slot}.source`] = 'env3';
  out[`mod${slot}.dest`] = 'pitch';
  out[`mod${slot}.amount`] = Math.max(-1, Math.min(1, amount / 24));
  out[`mod${slot}.on`] = true;
  return out;
}

/**
 * Older patches gave breath its own dials (chiff, decay, tone, level) and played it inside each
 * voice; now it is one of the Noise strip's beds with the strip's own dials (Level, Tone, Tail).
 */
function migrateBreath(src: Record<string, unknown>): Record<string, unknown> {
  if (!('breath.level' in src) && !('breath.chiff' in src)) return src;
  const out: Record<string, unknown> = { ...src };
  if (src['texture.type'] === 'breath') {
    // The old breath was a chiff (a puff at the attack) plus a sustained level. Now the puff is
    // air hit and a sustained breath is the air bed, so each sound gets the one it leaned on:
    // brass, bowed strings and plucked keys their attack puff; choirs, flutes and pads their air.
    const level = Number(src['breath.level']) || 0, chiff = Number(src['breath.chiff']) || 0;
    const decay = Number(src['breath.decay']) || 120;
    if (chiff >= level) {
      out['texture.type'] = 'air hit';
      out['texture.level'] = Math.max(0.15, Math.min(0.7, chiff * 1.2));
      out['texture.tail'] = Math.max(150, Math.min(900, decay * 3));
    } else {
      out['texture.type'] = 'air';
      out['texture.level'] = Math.max(0.08, Math.min(0.6, level * 1.3));
    }
    if ('breath.tone' in src) out['texture.tone'] = src['breath.tone'];
  }
  return out;
}

/**
 * Older patches had a Freeverb-style reverb with Size and Tone; the reverb is now a vintage
 * digital one with a type, Decay (seconds) and Pre-delay. Size picks the type and the decay.
 */
function migrateAttackCurve(src: Record<string, unknown>): Record<string, unknown> {
  if (!('amp_env.attack_curve' in src) || 'amp_env.attack_bend' in src) return src;
  // the old attack shape (0 analog .. 1 reverse swell) as the attack's bend
  return { ...src, 'amp_env.attack_bend': 0.15 - 0.75 * Math.max(0, Math.min(1, Number(src['amp_env.attack_curve']) || 0)) };
}

/**
 * The noise strip lost hum and machine (owner's call: no tonal beds; they load as rumble) and wind
 * (it loads as air); breath is now air's hit ("air hit"). Its Character dial became Density (same
 * place, 0.5 still each type's classic sound).
 */
function migrateTexture(src: Record<string, unknown>): Record<string, unknown> {
  const t = src['texture.type'];
  const renamed: Record<string, string> = { hum: 'rumble', machine: 'rumble', wind: 'air', breath: 'air hit' };
  if (!(String(t) in renamed) && !('texture.character' in src)) return src;
  const out: Record<string, unknown> = { ...src };
  if (String(t) in renamed) out['texture.type'] = renamed[String(t)];
  if ('texture.character' in src && !('texture.density' in src)) out['texture.density'] = src['texture.character'];
  return out;
}

function migrateReverb(src: Record<string, unknown>): Record<string, unknown> {
  if (!('reverb.size' in src) || 'reverb.decay' in src) return src;
  const out: Record<string, unknown> = { ...src };
  const size = Math.max(0, Math.min(1, Number(src['reverb.size']) || 0));
  out['reverb.decay'] = 0.5 * Math.pow(16, size);
  out['reverb.type'] = size >= 0.85 ? 'cathedral' : size >= 0.55 ? 'hall' : size >= 0.3 ? 'plate' : 'room';
  return out;
}

/**
 * Validate any patch-like object against the schema. Missing params get
 * defaults; out-of-range values are clamped; unknown keys are dropped.
 * Always returns a complete, safe patch plus a list of what was fixed.
 */
export function validatePatch(input: unknown): ValidationResult {
  const issues: ValidationIssue[] = [];
  const src = migrateTexture(migrateAttackCurve(migrateReverb(migrateBreath(migratePitchEnv((input && typeof input === 'object' ? input : {}) as Record<string, unknown>)))));
  const rawMeta = src.meta && typeof src.meta === 'object' ? (src.meta as PatchMeta) : undefined;
  const meta: PatchMeta = { ...(rawMeta ?? {}), name: typeof rawMeta?.name === 'string' ? rawMeta.name : 'Untitled' };
  if (!rawMeta) issues.push({ param: 'meta', message: 'missing meta' });

  const patch: Patch = { meta };
  for (const p of params) {
    // Older patches had one shared FX low cut: each effect takes it as its own.
    const old = p.id.endsWith('.lowcut') && !(p.id in src) && 'fx.lowcut' in src ? 'fx.lowcut' : p.id;
    // The wobble's one target became two lamps: volume alone, otherwise cutoff.
    if ((p.id === 'wobble.cutoff' || p.id === 'wobble.volume') && !(p.id in src) && 'wobble.target' in src) {
      const vol = src['wobble.target'] === 'volume';
      patch[p.id] = p.id === 'wobble.volume' ? vol : !vol;
      continue;
    }
    // The wobbler's old triangle is now a sine you click into corners.
    if (p.id === 'wobble.shape' && src[old] === 'triangle') {
      patch[p.id] = 'sine';
      continue;
    }
    patch[p.id] = old in src ? clampValue(p, src[old], issues) : (p.default as ParamValue);
  }
  for (const key of Object.keys(src)) {
    if (key !== 'meta' && key !== 'fx.lowcut' && key !== 'wobble.target' && key !== 'wobble.highcut' && key !== 'reverb.size' && key !== 'amp_env.attack_curve' && key !== 'texture.character' && key !== 'reverb.tone' && !key.startsWith('pitch_env.') && !key.startsWith('breath.') && !indexById.has(key)) issues.push({ param: key, message: 'unknown parameter (dropped)' });
  }
  sortModSlots(patch);
  return { patch, issues };
}

/** The matrix sources with an on / off switch of their own. */
const SWITCHED_SOURCES = ['env2', 'env3', 'lfo1', 'lfo2', 'lfo3', 'lfo4'];

/**
 * Switch off the LFOs and envelopes no matrix row uses (owner's call: a preset shows only what it
 * uses). The sound is unchanged: an unused source does nothing. Run when a preset or roll loads.
 */
export function switchOffUnused(patch: Patch): void {
  for (const src of SWITCHED_SOURCES) {
    let used = false;
    for (let n = 1; n <= MOD_SLOT_COUNT && !used; n++) {
      used = patch[`mod${n}.source`] === src && patch[`mod${n}.dest`] !== 'none' && Number(patch[`mod${n}.amount`]) !== 0 && patch[`mod${n}.on`] !== false;
    }
    if (!used) patch[`${src}.on`] = false;
  }
  // the filter envelope: used when it sweeps the cutoff or a matrix row uses it
  let fenv = Number(patch['filter.env_amount']) !== 0;
  for (let n = 1; n <= MOD_SLOT_COUNT && !fenv; n++) {
    fenv = patch[`mod${n}.source`] === 'mod_env' && patch[`mod${n}.dest`] !== 'none' && Number(patch[`mod${n}.amount`]) !== 0 && patch[`mod${n}.on`] !== false;
  }
  if (!fenv) patch['mod_env.on'] = false;
}

/** Matrix sources in reading order (rows and the source menu): the envelopes, the LFOs, what the player does, the machine's own life. */
export const SRC_ORDER = ['env2', 'env3', 'mod_env', 'amp_env', 'lfo1', 'lfo2', 'lfo3', 'lfo4', 'lfo_product', 'velocity', 'modwheel', 'keytrack', 'random', 'drift', 'drift_slow'];
/** Destinations in signal order: pitch, the sources, drive and filter, dirt, level, effects, LFO rates. */
export const DEST_ORDER = ['pitch', 'osc_pitch', 'osc1_pitch', 'osc2_pitch', 'noise_pitch', 'vibrato_depth', 'osc1_wt_pos', 'osc2_wt_pos', 'osc1_pw', 'osc2_pw', 'osc1_level', 'osc2_level',
  'unison_detune', 'fm_amount', 'fm2_amount', 'sub_level', 'noise_level', 'breath_level', 'texture_level', 'drive', 'filter_cutoff', 'filter_resonance',
  'filter_vowel', 'dist_drive', 'dist_mix', 'dist_tone', 'crush_mix', 'tape_wow', 'amp', 'chorus_depth', 'phaser_mix', 'delay_time', 'delay_mix',
  'reverb_mix', 'width', 'lfo1_rate', 'lfo2_rate', 'lfo3_rate', 'lfo4_rate'];
const MOD_SLOT_COUNT = 12;

/**
 * Put the 12 mod-matrix slots in reading order: the envelopes first, then LFO 1, 2, 3, 4,
 * velocity / wheel / keytrack, random and the drifts; the same source's rows together, in
 * signal order of their destinations; empty slots last. The slots are summed, so the sound is
 * unchanged. Runs on every patch that is loaded (presets, rolls, saved sounds).
 */
export function sortModSlots(patch: Patch): void {
  const rank = (list: string[], v: string) => {
    const i = list.indexOf(v);
    return i < 0 ? list.length : i;
  };
  const slots = Array.from({ length: MOD_SLOT_COUNT }, (_, i) => {
    const n = i + 1;
    return { src: patch[`mod${n}.source`], dest: patch[`mod${n}.dest`], amt: patch[`mod${n}.amount`], on: patch[`mod${n}.on`] ?? true, i };
  });
  const used = (s: (typeof slots)[number]) => s.src !== 'none' && s.dest !== 'none' && s.amt !== 0;
  slots.sort((a, b) =>
    Number(used(b)) - Number(used(a)) ||
    (used(a) ? rank(SRC_ORDER, String(a.src)) - rank(SRC_ORDER, String(b.src)) || rank(DEST_ORDER, String(a.dest)) - rank(DEST_ORDER, String(b.dest)) : 0) ||
    a.i - b.i);
  slots.forEach((s, i) => {
    const n = i + 1;
    patch[`mod${n}.source`] = s.src;
    patch[`mod${n}.dest`] = s.dest;
    patch[`mod${n}.amount`] = s.amt;
    patch[`mod${n}.on`] = s.on;
  });
}

export function defaultPatch(name = 'Init'): Patch {
  return validatePatch({ meta: { name } }).patch;
}

/** Numeric engine value for one param: enums → option index, bools → 0/1. */
export function toEngineValue(p: ParamDef, v: ParamValue): number {
  if (p.type === 'enum') return Math.max(0, p.options!.indexOf(v as string));
  if (p.type === 'bool') return v ? 1 : 0;
  return v as number;
}

/** Flatten a (validated) patch into a Float64Array in schema order for the engine. */
export function patchToArray(patch: Patch, out = new Float64Array(PARAM_COUNT)): Float64Array {
  for (let i = 0; i < params.length; i++) {
    const p = params[i];
    out[i] = toEngineValue(p, (patch[p.id] ?? p.default) as ParamValue);
  }
  return out;
}

/** Map a param value to 0..1 knob position, honouring its curve. */
export function toNormalized(p: ParamDef, v: number): number {
  if (p.type === 'enum') return p.options!.length > 1 ? v / (p.options!.length - 1) : 0;
  if (p.type === 'bool') return v ? 1 : 0;
  const min = p.min!, max = p.max!;
  const t = Math.min(1, Math.max(0, (v - min) / (max - min)));
  if (p.curve === 'log') return Math.log(v / min) / Math.log(max / min);
  if (p.curve === 'pow') return Math.pow(t, 1 / (p.exponent ?? 3));
  return t;
}

/** Inverse of toNormalized. */
export function fromNormalized(p: ParamDef, n: number): number {
  const t = Math.min(1, Math.max(0, n));
  if (p.type === 'enum') return Math.round(t * (p.options!.length - 1));
  if (p.type === 'bool') return t >= 0.5 ? 1 : 0;
  const min = p.min!, max = p.max!;
  let v: number;
  if (p.curve === 'log') v = min * Math.pow(max / min, t);
  else if (p.curve === 'pow') v = min + (max - min) * Math.pow(t, p.exponent ?? 3);
  else v = min + (max - min) * t;
  return p.type === 'int' ? Math.round(v) : v;
}
