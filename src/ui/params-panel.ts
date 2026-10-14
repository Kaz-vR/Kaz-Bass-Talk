// Full parameter view, generated from the schema.
import {
  fromNormalized, getParam, params, toNormalized, type ParamDef, type ParamValue, type Patch,
} from '../schema';

type OnChange = (id: string, value: ParamValue) => void;

const GROUP_TITLES: Record<string, string> = {
  voice: 'Voice', osc1: 'Oscillator 1', osc2: 'Oscillator 2', fm: 'FM', sub: 'Sub', noise: 'Noise', texture: 'Texture', drive: 'Drive',
  string: 'String / Shepard', click: 'Transient', vibrato: 'Vibrato', breath: 'Breath', filter: 'Filter', dist: 'Distortion', crush: 'Bitcrusher', tape: 'Tape', dynamics: 'Dynamics', amp_env: 'Amp envelope', mod_env: 'Mod envelope', pitch_env: 'Pitch envelope',
  env2: 'Env 2 (bloom)', lfo1: 'LFO 1', lfo2: 'LFO 2', lfo3: 'LFO 3', lfo4: 'LFO 4', mod: 'Mod matrix', fx: 'Effects', eq: 'EQ', output: 'Output',
};

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
  lfo1: 'lfo1', lfo2: 'lfo2', lfo3: 'lfo3', lfo4: 'lfo4', env2: 'env2', mod_env: 'mod_env', amp_env: 'amp_env',
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

  constructor(private root: HTMLElement, private onChange: OnChange) {
    this.build();
  }

  private emit(id: string, value: ParamValue): void {
    this.current = { ...this.current, [id]: value };
    this.onChange(id, value);
    if (/^mod\d+\./.test(id) || id === 'filter.env_amount' || id === 'pitch_env.amount') this.refreshRoutes();
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
    if (Number(c['pitch_env.amount'] ?? 0) !== 0) add('pitch_env', 'pitch');
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
      if (!groups.has(p.group)) groups.set(p.group, []);
      groups.get(p.group)!.push(p);
    }
    for (const [g, ps] of groups) {
      const box = document.createElement('div');
      box.className = 'group' + (g === 'mod' ? ' wide' : '');
      const h = document.createElement('h3');
      h.textContent = GROUP_TITLES[g] ?? g;
      box.append(h);
      if (Object.values(SOURCE_BOX).includes(g) || g === 'pitch_env') box.append(this.routeEl(g));
      if (g === 'mod') this.root.append(this.buildOtherSources());
      if (g === 'mod') this.buildMatrix(box, ps);
      else for (const p of ps) box.append(this.buildControl(p));
      this.root.append(box);
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

  /** Show a patch. `reference` (the unedited version) highlights edited controls. */
  show(patch: Patch, reference: Patch = patch): void {
    this.reference = reference;
    this.current = { ...patch };
    for (const [id, c] of this.controls) c.set(patch[id] as ParamValue);
    this.refreshRoutes();
  }
}
