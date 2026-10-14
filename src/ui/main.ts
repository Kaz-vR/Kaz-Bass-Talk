// Prototype UI: browse the preset bank by category, play it from the
// computer keyboard, MIDI or the audition loops, and edit every schema
// parameter. (Macros and the create area follow their phases.)
import { EngineHost } from '../engine/host';
import { roll, type Roll } from '../generator/randomizer';
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
// The randomizer: its own tab after the categories (rolls, not presets).
const RANDOMIZER = 'randomizer';
groups.push({ id: RANDOMIZER, name: '🎲 Randomizer', description: "Roll new sounds from the bank's own parts: tame cousins of a category, or weird collisions.", items: [] });
library.forEach((p, i) => {
  const g = groups.find((x) => x.id === ((p.meta.category as string | undefined) ?? ATLAS))!;
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
    if (!g.items.length && g.id !== RANDOMIZER) continue;
    const b = document.createElement('button');
    b.className = 'cat' + (g === currentGroup ? ' active' : '') + (g.id === ATLAS ? ' secondary' : '');
    b.textContent = g.name;
    const n = document.createElement('span');
    n.className = 'count';
    n.textContent = String(g.items.length);
    if (g.id !== RANDOMIZER) b.append(n);
    b.title = g.description;
    b.onclick = () => {
      if (g.id === RANDOMIZER) {
        // Keep the sound on screen: locked boxes are taken from it.
        if (currentGroup.id !== RANDOMIZER && currentGroup.id !== ATLAS) basedOn = currentGroup.id;
        currentGroup = g;
        renderBrowser();
        return;
      }
      currentGroup = g;
      // Each category has its own audition loop (chords for pads, a lead line for leads, ...).
      if (g.audition) setLoop(g.audition);
      loadPatch(g.items[0]);
    };
    cats.append(b);
  }
  const list = $('presets');
  list.innerHTML = '';
  list.classList.toggle('rolls', currentGroup.id === RANDOMIZER);
  if (currentGroup.id === RANDOMIZER) {
    renderRandomizer(list);
    return;
  }
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

// ---------------------------------------------------------------- randomizer

interface RollEntry { roll: Roll; kept: boolean; id: number }
const KEPT_KEY = 'lowtalk.kept-rolls';
const bank = library.filter((p) => p.meta.category);
let rolls: RollEntry[] = [];
let currentRoll: RollEntry | null = null;
let basedOn = 'any';
let weirdness = 0.4;
let rolling = false;
let nextId = 1;
try {
  const kept = JSON.parse(localStorage.getItem(KEPT_KEY) ?? '[]') as Roll[];
  rolls = kept.map((r) => ({ roll: { ...r, patch: validatePatch(r.patch).patch }, kept: true, id: nextId++ }));
} catch {
  // No storage (private window): kept rolls just don't survive a reload.
}
function saveKept(): void {
  try {
    localStorage.setItem(KEPT_KEY, JSON.stringify(rolls.filter((r) => r.kept).map((r) => r.roll)));
  } catch {
    // ignore
  }
}

function loadRoll(e: RollEntry): void {
  currentRoll = e;
  reference = e.roll.patch;
  current = structuredClone(reference);
  showPatchInfo(current);
  panel.show(current, reference);
  host?.setPatch(current);
  renderBrowser();
}

function doRoll(): void {
  if (rolling) return;
  rolling = true;
  renderBrowser();
  // Let the "Rolling…" state paint before the (about a second of) work.
  setTimeout(() => {
    const audition = basedOn === 'any' ? loopSel.value : categories.find((c) => c.id === basedOn)?.audition ?? loopSel.value;
    setLoop(audition);
    const r = roll({
      basedOn, weirdness, locked: panel.getLocked(), current, bank,
      loop: loops.find((l) => l.id === audition) ?? loops[0], seed: (Date.now() ^ (nextId * 0x9e3779b1)) >>> 0,
    });
    const e: RollEntry = { roll: r, kept: false, id: nextId++ };
    // Newest first; old unkept rolls drop off after 24.
    rolls = [e, ...rolls];
    let unkept = 0;
    rolls = rolls.filter((x) => x.kept || ++unkept <= 24);
    rolling = false;
    loadRoll(e);
  }, 30);
}

function renderRandomizer(list: HTMLElement): void {
  const bar = document.createElement('div');
  bar.className = 'roll-bar';
  const dice = document.createElement('button');
  dice.className = 'btn primary dice';
  dice.textContent = rolling ? 'Rolling…' : '🎲 Roll';
  dice.disabled = rolling;
  dice.title = 'Roll a new sound (locked boxes stay as they are)';
  dice.onclick = doRoll;

  const weird = document.createElement('label');
  weird.className = 'field weird';
  const wr = document.createElement('input');
  wr.type = 'range';
  wr.min = '0';
  wr.max = '1';
  wr.step = '0.01';
  wr.value = String(weirdness);
  const wv = document.createElement('span');
  const describe = () => (wv.textContent = weirdness < 0.2 ? 'close cousins' : weirdness < 0.5 ? 'a twist' : weirdness < 0.8 ? 'strange' : 'wild');
  describe();
  wr.oninput = () => {
    weirdness = Number(wr.value);
    describe();
  };
  weird.title = 'Low: close cousins of the presets. High: parts from other categories collide, wild ideas, far from anything in the bank.';
  weird.append('Weirdness', wr, wv);

  const based = document.createElement('label');
  based.className = 'field';
  const sel = document.createElement('select');
  sel.append(new Option('Anything', 'any'));
  for (const c of categories) sel.append(new Option(c.name, c.id));
  sel.value = basedOn;
  sel.onchange = () => (basedOn = sel.value);
  based.title = "Which presets the roll is built from. 'Anything' draws from the whole bank.";
  based.append('Based on', sel);

  const tip = document.createElement('span');
  tip.className = 'roll-tip';
  tip.textContent = 'Tip: 🔒 a box to keep it while rolling the rest.';
  bar.append(dice, weird, based, tip);
  list.append(bar);

  for (const e of rolls) {
    const card = document.createElement('div');
    card.className = 'preset roll' + (e === currentRoll ? ' active' : '') + (e.kept ? ' kept' : '');
    card.onclick = () => loadRoll(e);
    const name = document.createElement('b');
    name.textContent = e.roll.name;
    const keep = document.createElement('button');
    keep.className = 'keep';
    keep.textContent = e.kept ? '★' : '☆';
    keep.title = e.kept ? 'Kept (click to let it go)' : 'Keep this roll (it stays, even after reloading)';
    keep.onclick = (ev) => {
      ev.stopPropagation();
      e.kept = !e.kept;
      saveKept();
      renderBrowser();
    };
    name.append(keep);
    const desc = document.createElement('span');
    desc.textContent = e.roll.hint;
    card.append(name, desc);
    list.append(card);
  }
}

function loadPatch(index: number): void {
  currentRoll = null;
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

$<HTMLButtonElement>('revert').onclick = () => (currentRoll ? loadRoll(currentRoll) : loadPatch(currentIndex));
/** Step through the current category, wrapping around at either end. */
function stepPreset(dir: number): void {
  if (currentGroup.id === RANDOMIZER) {
    if (!rolls.length) return;
    const at = currentRoll ? rolls.indexOf(currentRoll) : -1;
    loadRoll(rolls[(at + dir + rolls.length) % rolls.length]);
    return;
  }
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
