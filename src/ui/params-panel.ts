// Full parameter view, generated from the schema.
import {
  fromNormalized, getParam, params, toNormalized, type ParamDef, type ParamValue, type Patch,
} from '../schema';

type OnChange = (id: string, value: ParamValue) => void;
type OnWheel = (value: number) => void;
type OnMonitor = (solo: string[], mute: string[]) => void;

/** Sound layers with solo / mute, by box. */
const LAYERS: Record<string, string> = { osc1: 'osc1', osc2: 'osc2', sub: 'sub', noise: 'noise', breath: 'breath', texture: 'texture' };

const GROUP_TITLES: Record<string, string> = {
  voice: 'Voice', osc1: 'Oscillator 1', osc2: 'Oscillator 2', fm: 'FM', sub: 'Sub', noise: 'Noise', texture: 'Texture', drive: 'Drive',
  string: 'String / Shepard', vibrato: 'Vibrato', breath: 'Breath', filter: 'Filter', dist: 'Distortion', crush: 'Bitcrusher', tape: 'Tape', clip: 'Mid clip', amp_env: 'Amp envelope', mod_env: 'Mod envelope', env3: 'Env 3',
  env2: 'Env 2 (bloom)', wheel: 'Mod wheel', wobble: 'Wobble', lfo1: 'LFO 1', lfo2: 'LFO 2', lfo3: 'LFO 3', lfo4: 'LFO 4', mod: 'Mod matrix', fx: 'Effects', eq: 'EQ', output: 'Output',
};

/** What each box does, shown when hovering its title. */
const GROUP_TIPS: Record<string, string> = {
  voice: 'How notes are played: one at a time (mono, with legato and glide, the bass default) or several (chords), octave, velocity response and analog drift.',
  wheel: 'What the mod wheel does: one connected move (several things changing together, like playing harder). Wheel at 0 = the preset as designed.',
  osc1: 'The main sound source: a waveform with its pitch, unison (stacked detuned copies for width) and level.',
  osc2: 'A second sound source, often an octave or a detuned layer on top of oscillator 1.',
  fm: 'Frequency modulation: one tone wobbling another very fast, for metallic, glassy, bell or growly edges.',
  string: 'Settings for the plucked-string and endless-glide (Shepard) waveforms; only used when an oscillator is set to string or shepard.',
  sub: 'A clean sine or triangle one or two octaves below, always mono: the weight in the low end. Its own transparent clipper adds density without making it louder.',
  noise: 'White noise mixed in before the filter: air, grit and breath in the tone.',
  texture: 'A bed of crackle, dust, rumble or air that plays with the notes and lingers after them: the worn, recorded feel.',
  drive: 'Saturation before the filter: dirt that the filter then shapes, so the filter movement stays audible.',
  filter: 'Shapes the tone: low-pass (darker), band-pass, formant (vowels), 303 diode, notch, comb or low-pass gate. Cutoff, resonance and envelope.',
  dist: 'Distortion after the filter (soft, hard, fold, tube), optionally only on the mids so the low end stays clean.',
  crush: 'Bitcrusher: lowers bit depth and sample rate for digital grain and lo-fi grit.',
  tape: 'Tape machine: saturation, wow and flutter (pitch wobble) and age (a dull, worn top).',
  clip: 'A transparent soft clipper on oscillators 1 and 2 (after the dirt chain, before the effects): shaves spikes and adds density at the same level. The sub has its own in the Sub box.',
  amp_env: 'Volume over time for each note: attack, decay, sustain and release.',
  mod_env: 'A second envelope that sweeps the filter on each note (set its depth in the Filter box), and a source for the mod matrix.',
  env2: 'A slow envelope for long changes while a note is held (blooming open, swelling grit). Does nothing until routed in the mod matrix.',
  env3: 'A third mod envelope. Routed to Pitch it gives a pitch drop or rise at the start of each note: kicks, 808 drops, zaps, scoops.',
  vibrato: 'A human vibrato that starts after a short delay and fades in, so notes start straight and then sing.',
  breath: 'The player\'s air: a short noisy puff at the start of each note plus a soft breathy band under it. Only sounds when the texture type is breath (the Noise strip).',
  lfo1: 'A slow or fast repeating (or smoothly random) movement. Does nothing until routed in the mod matrix; the line under the title shows where it goes.',
  lfo2: 'A slow or fast repeating (or smoothly random) movement. Does nothing until routed in the mod matrix; the line under the title shows where it goes.',
  lfo3: 'A slow or fast repeating (or smoothly random) movement. Does nothing until routed in the mod matrix; the line under the title shows where it goes.',
  lfo4: 'A slow or fast repeating (or smoothly random) movement. Does nothing until routed in the mod matrix; the line under the title shows where it goes.',
  wobble: 'A tempo-locked wobble: the filter (and optionally the drive and texture) swings shut and open on the beat. Depth 0 = off.',
  mod: 'The mod matrix: connects movement sources (LFOs, envelopes, drift, velocity, mod wheel…) to what they move, with an amount for each.',
  fx: 'Chorus, flanger, phaser, delay and reverb, only above the low end so the bass stays clean and mono.',
  eq: 'Final tone shaping: low, mid and high bands and the high cut (where the dark, controlled top comes from).',
  output: 'Final level and the low-end crossover. The limiter and mono low end are always on.',
};

/** The page's sections, in the order the sound flows: play, sources, the dirt chain, envelopes, movement, space, out. */
const SECTIONS: { id: string; title: string; hint: string; groups: string[] }[] = [
  { id: 'play', title: 'Play', hint: 'How it is played: voices, glide, touch, the mod wheel and a player\'s vibrato.', groups: ['voice', 'wheel', 'vibrato'] },
  { id: 'sources', title: 'Sources', hint: 'What makes the sound: oscillators, FM, sub and noise (breath is a texture type).', groups: ['osc1', 'osc2', 'string', 'fm', 'sub', 'noise'] },
  { id: 'tone', title: 'Tone and dirt', hint: 'The fixed chain, left to right: drive → filter → distortion → bitcrusher → tape → mid clip.', groups: ['drive', 'filter', 'dist', 'crush', 'tape', 'clip'] },
  { id: 'shape', title: 'Shape over time', hint: 'Per-note envelopes: volume, the filter sweep, the slow bloom and Env 3 (pitch bumps and drops).', groups: ['amp_env', 'mod_env', 'env2', 'env3'] },
  { id: 'movement', title: 'Movement', hint: 'What keeps it alive: the wobble, four LFOs, the other sources and the matrix that routes them.', groups: ['wobble', 'lfo1', 'lfo2', 'lfo3', 'lfo4', 'other', 'mod'] },
  { id: 'space', title: 'Space and finish', hint: 'After the voices, in order: the texture bed, effects (chorus → flanger → phaser → delay → reverb, each above its own low cut) and EQ.', groups: ['texture', 'fx', 'eq'] },
  { id: 'out', title: 'Output', hint: 'Final level. The limiter and the mono low end are always on.', groups: ['output'] },
];
const FOLD_KEY = 'lowtalk.folded-sections';

export function formatValue(p: ParamDef, v: ParamValue): string {
  if (p.type === 'bool') return v ? 'on' : 'off';
  if (p.type === 'enum') return String(v);
  const n = v as number;
  const unit = p.unit ?? '';
  if (unit === 'Hz') return n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 1 : 2)} kHz` : `${n.toFixed(n < 10 ? 2 : 0)} Hz`;
  if (unit === 'ms') return n >= 1000 ? `${(n / 1000).toFixed(2)} s` : `${n.toFixed(n < 10 ? 1 : 0)} ms`;
  if (p.type === 'int') return `${n > 0 && (unit === 'st' || unit === 'oct') ? '+' : ''}${n}${unit ? ' ' + unit : ''}`;
  if (unit === 'dB' || unit === 'st' || unit === 'ct') return `${n > 0 ? '+' : ''}${n.toFixed(1)} ${unit}`;
  if (unit === 'x') return `×${n.toFixed(2)}`;
  if (p.min === -1 && p.max === 1) return `${n > 0 ? '+' : ''}${Math.round(n * 100)}%`;
  if (p.min === 0 && p.max === 1) return `${Math.round(n * 100)}%`;
  return n.toFixed(2);
}

/** Mod sources with their own box show their routings there; the rest get the "Other sources" box. */
const SOURCE_BOX: Record<string, string> = {
  lfo1: 'lfo1', lfo2: 'lfo2', lfo3: 'lfo3', lfo4: 'lfo4', env2: 'env2', env3: 'env3', mod_env: 'mod_env', amp_env: 'amp_env',
};
const OTHER_SOURCES: [string, string][] = [
  ['drift', 'Drift'], ['drift_slow', 'Drift slow'], ['random', 'Random (per note)'], ['velocity', 'Velocity'],
  ['modwheel', 'Mod wheel'], ['keytrack', 'Keytrack'], ['lfo_product', 'LFO 1 × 2'],
];
const MOD_SLOTS = params.filter((p) => /^mod\d+\.source$/.test(p.id)).length;

interface Control {
  p: ParamDef;
  set(v: ParamValue): void;
}

export class ParamsPanel {
  private controls = new Map<string, Control>();
  private reference: Patch | null = null;
  private current: Record<string, ParamValue | unknown> = {};
  /** Routing readouts: group (or 'other:<source>') → element. */
  private routes = new Map<string, HTMLElement>();

  private wheelSlider: HTMLInputElement | null = null;
  private wheelVal: HTMLElement | null = null;

  constructor(private root: HTMLElement, private onChange: OnChange, private onWheel: OnWheel = () => {}, private onMonitor: OnMonitor = () => {}) {
    this.build();
  }

  private emit(id: string, value: ParamValue): void {
    this.current = { ...this.current, [id]: value };
    this.onChange(id, value);
    if (/^mod\d+\./.test(id) || id === 'filter.env_amount') this.refreshRoutes();
  }

  private routeEl(key: string): HTMLElement {
    const el = document.createElement('div');
    el.className = 'routes';
    this.routes.set(key, el);
    return el;
  }

  /** Where each source is sent: the mod matrix plus the fixed routings. */
  private refreshRoutes(): void {
    const c = this.current;
    const out = new Map<string, string[]>();
    const add = (src: string, text: string) => {
      if (!out.has(src)) out.set(src, []);
      out.get(src)!.push(text);
    };
    add('amp_env', 'amp (always)');
    if (Number(c['filter.env_amount'] ?? 0) !== 0) add('mod_env', `filter cutoff (env amount ${formatValue(getParam('filter.env_amount')!, c['filter.env_amount'] as number)})`);
    for (let n = 1; n <= MOD_SLOTS; n++) {
      const src = String(c[`mod${n}.source`] ?? 'none'), dest = String(c[`mod${n}.dest`] ?? 'none');
      const amt = Number(c[`mod${n}.amount`] ?? 0);
      if (src === 'none' || dest === 'none' || amt === 0) continue;
      const pct = Math.abs(amt) < 0.01 ? (amt * 100).toFixed(2) : String(Math.round(amt * 100));
      add(src, `${dest.replace(/_/g, ' ')} ${amt > 0 ? '+' : ''}${pct}%`);
    }
    for (const [key, el] of this.routes) {
      const src = key.startsWith('other:') ? key.slice(6) : key;
      const list = out.get(src) ?? [];
      el.replaceChildren();
      if (!list.length) {
        el.textContent = key.startsWith('other:') ? '—' : '→ not routed';
        el.classList.add('none');
        continue;
      }
      el.classList.remove('none');
      if (!key.startsWith('other:')) el.append('→ ');
      for (const t of list) {
        const chip = document.createElement('span');
        chip.className = 'route';
        chip.textContent = t;
        el.append(chip);
      }
    }
  }

  private buildOtherSources(): HTMLElement {
    const box = document.createElement('div');
    box.className = 'group';
    const h = document.createElement('h3');
    h.textContent = 'Other sources';
    h.title = 'Movement sources without settings of their own (drift, random per note, velocity, mod wheel, keytrack) and where each is routed.';
    box.append(h);
    for (const [src, label] of OTHER_SOURCES) {
      const row = document.createElement('div');
      row.className = 'src-row';
      const name = document.createElement('span');
      name.className = 'src-name';
      name.textContent = label;
      row.append(name, this.routeEl(`other:${src}`));
      box.append(row);
    }
    return box;
  }

  private build(): void {
    const groups = new Map<string, ParamDef[]>();
    for (const p of params) {
      // No hidden octave: a sound's register shows on the oscillators and the sub.
      if (p.id === 'voice.octave') continue;
      if (!groups.has(p.group)) groups.set(p.group, []);
      groups.get(p.group)!.push(p);
    }
    const boxes = new Map<string, HTMLElement>();
    for (const [g, ps] of groups) {
      const box = document.createElement('div');
      box.className = 'group' + (g === 'mod' ? ' wide' : '');
      const h = document.createElement('h3');
      h.textContent = GROUP_TITLES[g] ?? g;
      if (GROUP_TIPS[g]) h.title = GROUP_TIPS[g];
      box.append(h);
      if (Object.values(SOURCE_BOX).includes(g)) box.append(this.routeEl(g));
      if (LAYERS[g]) h.append(this.monitorButtons(LAYERS[g]));
      if (g !== 'output' && g !== 'wheel') h.append(this.lockButton(g, box));
      const power = ps.find((p) => p.id === `${g}.on`);
      if (power) h.append(this.powerButton(power, box));
      const rest = ps.filter((p) => p !== power);
      if (g === 'mod') this.buildMatrix(box, rest);
      else if (/^lfo\d$/.test(g)) this.buildLfo(box, g, rest);
      else if (g === 'wheel') this.buildWheel(box, rest);
      else if (g === 'fx') this.buildEffects(box, rest);
      else for (const p of rest) box.append(this.buildControl(p));
      boxes.set(g, box);
    }
    boxes.set('other', this.buildOtherSources());
    // Sections in signal order; anything new in the schema lands in a last section rather than disappearing.
    const placed = new Set(SECTIONS.flatMap((s) => s.groups));
    const leftover = [...boxes.keys()].filter((g) => !placed.has(g));
    const sections = leftover.length ? [...SECTIONS, { id: 'more', title: 'More', hint: '', groups: leftover }] : SECTIONS;
    let folded = new Set<string>();
    try { folded = new Set(JSON.parse(localStorage.getItem(FOLD_KEY) ?? '[]')); } catch { /* no storage: everything open */ }
    for (const sec of sections) {
      const head = document.createElement('button');
      head.className = 'section-head';
      head.type = 'button';
      const title = document.createElement('span');
      title.className = 'section-title';
      const hint = document.createElement('span');
      hint.className = 'section-hint';
      hint.textContent = sec.hint;
      head.append(title, hint);
      const members = sec.groups.map((g) => boxes.get(g)).filter((b): b is HTMLElement => !!b);
      const apply = () => {
        const shut = folded.has(sec.id);
        title.textContent = `${shut ? '▸' : '▾'} ${sec.title}`;
        head.classList.toggle('folded', shut);
        for (const b of members) b.hidden = shut;
      };
      head.onclick = () => {
        if (folded.has(sec.id)) folded.delete(sec.id); else folded.add(sec.id);
        try { localStorage.setItem(FOLD_KEY, JSON.stringify([...folded])); } catch { /* not remembered */ }
        apply();
      };
      apply();
      this.root.append(head, ...members);
    }
  }

  private buildControl(p: ParamDef): HTMLElement {
    const wrap = document.createElement('div');
    wrap.className = 'ctl';
    wrap.title = p.describes;
    const label = document.createElement('label');
    label.textContent = p.label.replace(/^(Osc \d|LFO \d|Amp|Mod|Sub|Filter|Distortion|Pitch envelope|EQ|FX|FM) /, '');
    const val = document.createElement('span');
    val.className = 'val';
    wrap.append(label, val);

    const mark = (v: ParamValue) => {
      const ref = this.reference?.[p.id];
      wrap.classList.toggle('changed', ref !== undefined && ref !== v);
    };

    if (p.type === 'enum') {
      const sel = document.createElement('select');
      for (const o of p.options!) sel.append(new Option(o, o));
      sel.onchange = () => {
        this.emit(p.id, sel.value);
        mark(sel.value);
      };
      wrap.append(sel);
      this.controls.set(p.id, { p, set: (v) => { sel.value = String(v); mark(v); } });
      val.remove();
    } else if (p.type === 'bool') {
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.onchange = () => {
        this.emit(p.id, cb.checked);
        mark(cb.checked);
      };
      val.replaceWith(cb);
      this.controls.set(p.id, { p, set: (v) => { cb.checked = !!v; mark(v); } });
    } else {
      const range = document.createElement('input');
      range.type = 'range';
      range.min = '0';
      range.max = '1';
      range.step = p.type === 'int' ? String(1 / (p.max! - p.min!)) : '0.001';
      const show = (v: number) => { val.textContent = formatValue(p, v); mark(v); };
      range.oninput = () => {
        const v = fromNormalized(p, Number(range.value));
        show(v);
        this.emit(p.id, v);
      };
      range.ondblclick = () => {
        const v = p.default as number;
        range.value = String(toNormalized(p, v));
        show(v);
        this.emit(p.id, v);
      };
      wrap.append(range);
      this.controls.set(p.id, { p, set: (v) => { range.value = String(toNormalized(p, v as number)); show(v as number); } });
    }
    return wrap;
  }

  /**
   * An LFO runs either free (rate in Hz) or locked to the tempo (a note
   * length), never both: a Hz | Sync switch shows only the control in use.
   */
  private buildLfo(box: HTMLElement, g: string, ps: ParamDef[]): void {
    const syncP = ps.find((p) => p.id === `${g}.sync`)!;
    const rateWrap = this.buildControl(ps.find((p) => p.id === `${g}.rate`)!);
    const syncWrap = this.buildControl(syncP);
    const sel = syncWrap.querySelector('select')!;
    sel.querySelector('option[value="free"]')?.remove();
    syncWrap.querySelector('label')!.textContent = 'note length';
    let lastDivision = '1/8';

    const sw = document.createElement('div');
    sw.className = 'seg';
    const mk = (text: string, title: string) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = text;
      b.title = title;
      sw.append(b);
      return b;
    };
    const hz = mk('Hz', 'Free-running: the rate knob sets the speed');
    const sync = mk('Sync', 'Locked to the tempo: a note length sets the speed');
    const view = (v: string) => {
      const synced = v !== 'free';
      if (synced) lastDivision = v;
      hz.classList.toggle('on', !synced);
      sync.classList.toggle('on', synced);
      rateWrap.hidden = synced;
      syncWrap.hidden = !synced;
    };
    hz.onclick = () => {
      this.emit(syncP.id, 'free');
      view('free');
    };
    sync.onclick = () => {
      this.emit(syncP.id, lastDivision);
      sel.value = lastDivision;
      view(lastDivision);
    };
    sel.addEventListener('change', () => view(sel.value));
    const ctl = this.controls.get(syncP.id)!;
    const inner = ctl.set;
    ctl.set = (v) => {
      inner(v);
      view(String(v));
    };

    for (const p of ps) {
      if (p.id === `${g}.shape`) box.append(this.buildControl(p), sw, rateWrap, syncWrap);
      else if (p.id !== `${g}.rate` && p.id !== `${g}.sync`) box.append(this.buildControl(p));
    }
    view(String(syncP.default));
  }

  /**
   * The mod wheel: which connected move it plays (the preset's own by
   * default, named in the list) and a wheel you can drag, which also follows
   * a hardware mod wheel.
   */
  private buildWheel(box: HTMLElement, ps: ParamDef[]): void {
    const moveP = ps.find((p) => p.id === 'wheel.move')!;
    const presetP = ps.find((p) => p.id === 'wheel.preset')!;
    const nice = (o: string) => o.charAt(0).toUpperCase() + o.slice(1);
    const row = document.createElement('div');
    row.className = 'wheel-row';
    const left = document.createElement('div');
    left.className = 'wheel-left';
    const sel = document.createElement('select');
    sel.title = moveP.describes;
    for (const o of moveP.options!) sel.append(new Option(nice(o), o));
    const def = sel.options[0];
    sel.onchange = () => this.emit(moveP.id, sel.value);
    const hint = document.createElement('p');
    hint.className = 'wheel-hint';
    const describe = () => {
      const m = sel.value === 'preset default' ? String(this.current['wheel.preset'] ?? presetP.default) : sel.value;
      const text = moveP.describes.match(new RegExp(`${nice(m)}: ([^.]*)\\.`))?.[1] ?? '';
      hint.textContent = text.charAt(0).toUpperCase() + text.slice(1);
    };
    sel.addEventListener('change', describe);
    this.controls.set(moveP.id, { p: moveP, set: (v) => { sel.value = String(v); describe(); } });
    this.controls.set(presetP.id, {
      p: presetP,
      set: (v) => {
        def.textContent = `Preset default (${nice(String(v))})`;
        describe();
      },
    });
    left.append(sel, hint);

    const wheel = document.createElement('div');
    wheel.className = 'wheel';
    const slider = document.createElement('input');
    slider.type = 'range';
    slider.min = '0';
    slider.max = '1';
    slider.step = '0.001';
    slider.value = '0';
    slider.className = 'wheel-slider';
    slider.title = 'Mod wheel (follows your keyboard\'s wheel; drag to try it). Double-click to reset.';
    const val = document.createElement('span');
    val.className = 'val';
    val.textContent = '0%';
    const move = () => {
      val.textContent = `${Math.round(Number(slider.value) * 100)}%`;
      this.onWheel(Number(slider.value));
    };
    slider.oninput = move;
    slider.ondblclick = () => {
      slider.value = '0';
      move();
    };
    this.wheelSlider = slider;
    this.wheelVal = val;
    wheel.append(slider, val);
    row.append(left, wheel);
    box.append(row);
  }

  /** A block's power switch (saved in the preset); `dim` greys out while it's off. */
  private powerButton(p: ParamDef, dim: HTMLElement): HTMLElement {
    const wrap = document.createElement('span');
    wrap.className = 'monitor';
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'mon power';
    b.textContent = '⏻';
    wrap.append(b);
    b.title = p.describes;
    let on = true;
    const view = () => {
      b.classList.toggle('on', on);
      dim.classList.toggle('off', !on);
    };
    b.onclick = () => {
      on = !on;
      view();
      this.emit(p.id, on);
    };
    this.controls.set(p.id, {
      p,
      set: (v) => {
        on = !!v;
        view();
      },
    });
    view();
    return wrap;
  }

  /** The effects box: each effect gets its own row with a power switch. */
  private buildEffects(box: HTMLElement, ps: ParamDef[]): void {
    let section: HTMLElement = box;
    for (const p of ps) {
      if (p.id.endsWith('.on')) {
        section = document.createElement('div');
        section.className = 'fx-section';
        const title = document.createElement('div');
        title.className = 'fx-title';
        title.append(p.label.replace(/ on$/, ''), this.powerButton(p, section));
        section.append(title);
        box.append(section);
      } else {
        section.append(this.buildControl(p));
      }
    }
  }

  /** Boxes the randomizer keeps as they are. */
  private readonly locked = new Set<string>();

  /** The randomizer's lock for a box (not saved in the preset). */
  private lockButton(group: string, box: HTMLElement): HTMLElement {
    const wrap = document.createElement('span');
    wrap.className = 'monitor';
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'mon lock';
    b.textContent = '🔒';
    b.title = 'Lock: the randomizer keeps this box exactly as it is and only rolls the unlocked ones.';
    b.onclick = () => {
      if (this.locked.has(group)) this.locked.delete(group);
      else this.locked.add(group);
      b.classList.toggle('on', this.locked.has(group));
      box.classList.toggle('locked', this.locked.has(group));
    };
    wrap.append(b);
    return wrap;
  }

  /** Boxes locked for the randomizer. */
  getLocked(): ReadonlySet<string> {
    return this.locked;
  }

  // Solo / mute: listening aids, not saved in the preset. Several layers can be soloed at once.
  private readonly solo = new Set<string>();
  private readonly mute = new Set<string>();
  private readonly monitorViews: (() => void)[] = [];

  private monitorButtons(layer: string): HTMLElement {
    const wrap = document.createElement('span');
    wrap.className = 'monitor';
    const mk = (text: string, set: Set<string>, title: string) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = `mon ${text === 'S' ? 'solo' : 'mute'}`;
      b.textContent = text;
      b.title = title;
      b.onclick = () => {
        if (set.has(layer)) set.delete(layer);
        else set.add(layer);
        for (const v of this.monitorViews) v();
        this.onMonitor([...this.solo], [...this.mute]);
      };
      wrap.append(b);
      return b;
    };
    const solo = mk('S', this.solo, 'Solo: hear only this layer (and any other soloed ones). A listening aid, not saved.');
    const mute = mk('M', this.mute, 'Mute: hear the sound without this layer. A listening aid, not saved.');
    this.monitorViews.push(() => {
      solo.classList.toggle('on', this.solo.has(layer));
      mute.classList.toggle('on', this.mute.has(layer));
    });
    return wrap;
  }

  /** A hardware mod wheel moved: show it. */
  setWheel(v: number): void {
    if (!this.wheelSlider || !this.wheelVal) return;
    this.wheelSlider.value = String(v);
    this.wheelVal.textContent = `${Math.round(v * 100)}%`;
  }

  private buildMatrix(box: HTMLElement, ps: ParamDef[]): void {
    for (let n = 1; n <= MOD_SLOTS; n++) {
      const row = document.createElement('div');
      row.className = 'mod-row';
      const num = document.createElement('span');
      num.className = 'n';
      num.textContent = String(n);
      row.append(num);
      for (const suffix of ['source', 'dest', 'amount']) {
        const p = ps.find((q) => q.id === `mod${n}.${suffix}`)!;
        if (p.type === 'enum') {
          const sel = document.createElement('select');
          for (const o of p.options!) sel.append(new Option(o.replace(/_/g, ' '), o));
          sel.title = p.describes;
          sel.onchange = () => this.emit(p.id, sel.value);
          row.append(sel);
          this.controls.set(p.id, { p, set: (v) => { sel.value = String(v); } });
        } else {
          const range = document.createElement('input');
          range.type = 'range';
          range.min = '-1';
          range.max = '1';
          range.step = '0.01';
          const val = document.createElement('span');
          val.className = 'val';
          range.oninput = () => {
            val.textContent = formatValue(p, Number(range.value));
            this.emit(p.id, Number(range.value));
          };
          range.ondblclick = () => {
            range.value = '0';
            val.textContent = formatValue(p, 0);
            this.emit(p.id, 0);
          };
          row.append(range, val);
          this.controls.set(p.id, { p, set: (v) => { range.value = String(v); val.textContent = formatValue(p, v as number); } });
        }
      }
      box.append(row);
    }
  }

  /** One value changed elsewhere (the synth page above): show it without emitting. */
  setValue(id: string, v: ParamValue): void {
    this.current = { ...this.current, [id]: v };
    this.controls.get(id)?.set(v);
    if (/^mod\d+\./.test(id) || id === 'filter.env_amount') this.refreshRoutes();
  }

  /** Show a patch. `reference` (the unedited version) highlights edited controls. */
  show(patch: Patch, reference: Patch = patch): void {
    this.reference = reference;
    this.current = { ...patch };
    for (const [id, c] of this.controls) c.set(patch[id] as ParamValue);
    this.refreshRoutes();
  }
}
