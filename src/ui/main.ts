// Prototype UI: browse the preset bank by category, play it from the
// computer keyboard, MIDI or the audition loops, and edit every schema
// parameter. (Macros and the create area follow their phases.)
import { EngineHost } from '../engine/host';
import { categories } from '../quality/categories';
import { validatePatch, type ParamValue, type Patch } from '../schema';
import { DEFAULT_LOOP_ID, library, loops } from './data';
import { Keyboard } from './keyboard';
import { initMidi } from './midi';
import { ParamsPanel } from './params-panel';
import { Scope } from './scope';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const playBtn = $<HTMLButtonElement>('play');
const loopSel = $<HTMLSelectElement>('loop');

let host: EngineHost | null = null;
let playing = false;
let current: Patch = structuredClone(library[0]);
let reference: Patch = library[0];

for (const l of loops) loopSel.append(new Option(`${l.name} · ${l.bpm} BPM`, l.id));
loopSel.value = DEFAULT_LOOP_ID;
// Browser groups: the 14 bank categories, then the Bass Atlas (one patch per bass type, no category).
const ATLAS = 'atlas';
interface Group { id: string; name: string; description: string; audition?: string; items: number[] }
const groups: Group[] = categories.map((c) => ({ id: c.id, name: c.name, description: c.description, audition: c.audition, items: [] }));
groups.push({ id: ATLAS, name: 'Bass Atlas', description: 'One patch for each of 51 synth bass types across genres and history (outside the LORN style).', items: [] });
library.forEach((p, i) => {
  const g = groups.find((x) => x.id === ((p.meta.category as string | undefined) ?? ATLAS)) ?? groups[groups.length - 1];
  g.items.push(i);
});
let currentIndex = groups[0].items[0] ?? 0;
let currentGroup = groups[0];

const panel = new ParamsPanel(
  $('params'),
  (id: string, value: ParamValue) => {
    current[id] = value;
    host?.setParam(id, value);
  },
  (v) => host?.modWheel(v),
  (solo, mute) => host?.monitor(solo, mute),
);

function showPatchInfo(p: Patch): void {
  $('patch-name').textContent = p.meta.name;
  $('patch-title').textContent = p.meta.name;
  $('patch-desc').textContent = p.meta.description ?? '';
  const tags = $('patch-tags');
  tags.innerHTML = '';
  for (const t of p.meta.tags ?? []) {
    const el = document.createElement('span');
    el.className = 'tag';
    el.textContent = t;
    tags.append(el);
  }
}

function setLoop(id: string): void {
  if (!loops.some((l) => l.id === id) || loopSel.value === id) return;
  loopSel.value = id;
  host?.setLoop(loops.find((l) => l.id === id) ?? null);
}

function renderBrowser(): void {
  const cats = $('categories');
  cats.innerHTML = '';
  for (const g of groups) {
    if (!g.items.length) continue;
    const b = document.createElement('button');
    b.className = 'cat' + (g === currentGroup ? ' active' : '') + (g.id === ATLAS ? ' secondary' : '');
    b.textContent = g.name;
    const n = document.createElement('span');
    n.className = 'count';
    n.textContent = String(g.items.length);
    b.append(n);
    b.title = g.description;
    b.onclick = () => {
      currentGroup = g;
      // Each category has its own audition loop (chords for pads, a lead line for leads, ...).
      if (g.audition) setLoop(g.audition);
      loadPatch(g.items[0]);
    };
    cats.append(b);
  }
  const list = $('presets');
  list.innerHTML = '';
  for (const i of currentGroup.items) {
    const p = library[i];
    const card = document.createElement('button');
    card.className = 'preset' + (i === currentIndex ? ' active' : '');
    const name = document.createElement('b');
    name.textContent = p.meta.name;
    const desc = document.createElement('span');
    desc.textContent = p.meta.description ?? '';
    card.append(name, desc);
    card.onclick = () => loadPatch(i);
    list.append(card);
  }
}

function loadPatch(index: number): void {
  currentIndex = index;
  renderBrowser();
  reference = library[index];
  current = structuredClone(reference);
  showPatchInfo(current);
  panel.show(current, reference);
  host?.setPatch(current);
}

loopSel.onchange = () => host?.setLoop(loops.find((l) => l.id === loopSel.value) ?? null);

function setPlaying(on: boolean): void {
  playing = on;
  if (!host) return;
  on ? host.play() : host.stop();
  playBtn.textContent = on ? '■ Stop' : '▶ Play';
}
playBtn.onclick = () => setPlaying(!playing);
window.addEventListener('keydown', (e) => {
  if (e.code === 'Space' && (e.target as HTMLElement).tagName !== 'SELECT') {
    e.preventDefault();
    setPlaying(!playing);
  }
});

$<HTMLButtonElement>('revert').onclick = () => loadPatch(currentIndex);
/** Step through the current category, wrapping around at either end. */
function stepPreset(dir: number): void {
  const items = currentGroup.items;
  const at = items.indexOf(currentIndex);
  loadPatch(items[(at + dir + items.length) % items.length]);
}
$<HTMLButtonElement>('prev-preset').onclick = () => stepPreset(-1);
$<HTMLButtonElement>('next-preset').onclick = () => stepPreset(1);
$<HTMLButtonElement>('panic').onclick = () => {
  setPlaying(false);
  host?.panic();
};
$<HTMLButtonElement>('copy').onclick = async () => {
  const json = JSON.stringify(validatePatch(current).patch, null, 2);
  try {
    await navigator.clipboard.writeText(json);
    $('copy').textContent = 'Copied ✓';
  } catch {
    console.log(json);
    $('copy').textContent = 'Logged to console';
  }
  setTimeout(() => ($('copy').textContent = 'Copy patch JSON'), 1500);
};

const keyboard = new Keyboard($('keyboard'), {
  noteOn: (n, v) => host?.noteOn(n, v),
  noteOff: (n) => host?.noteOff(n),
  onOctave: (base) => ($('octave').textContent = `keys start at C${base / 12 - 1}`),
});

if (groups[0].audition) loopSel.value = groups[0].audition;
loadPatch(currentIndex);

$('start').querySelector('button')!.addEventListener('click', async () => {
  try {
    host = await EngineHost.create();
    await host.resume();
  } catch (err) {
    $('start').querySelector('p')!.textContent = `Could not start audio: ${(err as Error).message}`;
    return;
  }
  $('start').classList.add('hidden');
  host.setPatch(current, true);
  host.setLoop(loops.find((l) => l.id === loopSel.value) ?? null);
  new Scope(host.analyser, $<HTMLCanvasElement>('scope'), $<HTMLCanvasElement>('spectrum'));
  initMidi({
    noteOn: (n, v) => { host?.noteOn(n, v); keyboard.mark(n, true); },
    noteOff: (n) => { host?.noteOff(n); keyboard.mark(n, false); },
    pitchBend: (v) => host?.pitchBend(v),
    modWheel: (v) => {
      host?.modWheel(v);
      panel.setWheel(v);
    },
    allNotesOff: () => host?.panic(),
    status: (t) => {
      $('midi').textContent = t;
      $('midi').classList.toggle('dim', !/^MIDI: (?!not|blocked|no )/.test(t));
    },
  });
});
