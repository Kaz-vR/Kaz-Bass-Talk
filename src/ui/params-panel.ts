// Full parameter view, generated from the schema.
import {
  fromNormalized, params, toNormalized, type ParamDef, type ParamValue, type Patch,
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

interface Control {
  p: ParamDef;
  set(v: ParamValue): void;
}

export class ParamsPanel {
  private controls = new Map<string, Control>();
  private reference: Patch | null = null;

  constructor(private root: HTMLElement, private onChange: OnChange) {
    this.build();
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
        this.onChange(p.id, sel.value);
        mark(sel.value);
      };
      wrap.append(sel);
      this.controls.set(p.id, { p, set: (v) => { sel.value = String(v); mark(v); } });
      val.remove();
    } else if (p.type === 'bool') {
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.onchange = () => {
        this.onChange(p.id, cb.checked);
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
        this.onChange(p.id, v);
      };
      range.ondblclick = () => {
        const v = p.default as number;
        range.value = String(toNormalized(p, v));
        show(v);
        this.onChange(p.id, v);
      };
      wrap.append(range);
      this.controls.set(p.id, { p, set: (v) => { range.value = String(toNormalized(p, v as number)); show(v as number); } });
    }
    return wrap;
  }

  private buildMatrix(box: HTMLElement, ps: ParamDef[]): void {
    for (let n = 1; n <= 8; n++) {
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
          sel.onchange = () => this.onChange(p.id, sel.value);
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
            this.onChange(p.id, Number(range.value));
          };
          range.ondblclick = () => {
            range.value = '0';
            val.textContent = formatValue(p, 0);
            this.onChange(p.id, 0);
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
    for (const [id, c] of this.controls) c.set(patch[id] as ParamValue);
  }
}
