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
import { SynthView } from './synth-view';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const playBtn = $<HTMLButtonElement>('play');
const loopSel = $<HTMLSelectElement>('loop');

let host: EngineHost | null = null;
let playing = false;
let current: Patch = structuredClone(library[0]);
let reference: Patch = library[0];

for (const l of loops) loopSel.append(new Option(`${l.name} · ${l.bpm} BPM`, l.id));
loopSel.value = DEFAULT_LOOP_ID;
// Browser groups: the bank categories (13 shelves), then the Bass Atlas (one patch per bass type, no category).
const ATLAS = 'atlas';
interface Group { id: string; name: string; description: string; audition?: string; items: number[] }
// Plucks and sequences share one shelf: the same short sounds, played as notes or patterns (each keeps its own audition).
const SHELF: Record<string, string> = { arp: 'pluck' };
// Browser titles (the category data keeps its own names).
const TITLE: Record<string, string> = { bass: 'Dark Basses', lead: 'Leads', pad: 'Pads', pluck: 'Plucks', brass: 'Brass', choir: 'Choir', texture: 'Textures' };
const groups: Group[] = categories.filter((c) => !SHELF[c.id]).map((c) =>
  c.id === 'pluck'
    ? { id: c.id, name: TITLE.pluck, description: 'Short, defined sounds to play as notes, chords or patterns: soft and round to hard and driving.', audition: c.audition, items: [] }
    : { id: c.id, name: TITLE[c.id] ?? c.name, description: c.description, audition: c.audition, items: [] });
groups.push({ id: ATLAS, name: 'Classic Basses', description: 'One patch for each of 51 well-known synth bass types across genres and history (outside the LORN style).', items: [] });
// The randomizer: its own tab after the categories (rolls, not presets).
const RANDOMIZER = 'randomizer';
groups.push({ id: RANDOMIZER, name: '🎲 Randomizer', description: "Roll new sounds from the bank's own parts: tame cousins of a category, or weird collisions.", items: [] });
// Your own sounds: rolls you starred (kept in this browser).
const USER = 'user';
groups.push({ id: USER, name: '★ User', description: 'The rolls you starred. They stay here even when you clear the rolls.', items: [] });
library.forEach((p, i) => {
  const cat = (p.meta.category as string | undefined) ?? ATLAS;
  const g = groups.find((x) => x.id === (SHELF[cat] ?? cat))!;
  g.items.push(i);
});
let currentIndex = groups[0].items[0] ?? 0;
let currentGroup = groups[0];

const panel = new ParamsPanel(
  $('params'),
  (id: string, value: ParamValue) => {
    current[id] = value;
    host?.setParam(id, value);
    synth.setValue(id, value);
  },
  (v) => host?.modWheel(v),
  (solo, mute) => host?.monitor(solo, mute),
);

// The new synth page on top; the gear opens the full parameter view under it. Both edit the same patch.
const synth = new SynthView($('synth-v2'), (id, value) => {
  current[id] = value;
  host?.setParam(id, value);
  panel.setValue(id, value);
});
synth.onGear = () => {
  const old = $('old-ui');
  old.classList.toggle('hidden');
  document.querySelector('.gear')?.classList.toggle('on', !old.classList.contains('hidden'));
  if (!old.classList.contains('hidden')) old.scrollIntoView({ behavior: 'smooth', block: 'start' });
};

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
    if (!g.items.length && g.id !== RANDOMIZER && g.id !== USER) continue;
    const b = document.createElement('button');
    b.className = 'cat' + (g === currentGroup ? ' active' : '') + (g.id === ATLAS ? ' secondary' : '');
    b.textContent = g.name;
    const n = document.createElement('span');
    n.className = 'count';
    n.textContent = String(g.id === USER ? userSounds.length : g.items.length);
    if (g.id !== RANDOMIZER) b.append(n);
    b.title = g.description;
    b.onclick = () => {
      if (g.id === RANDOMIZER || g.id === USER) {
        // Keep the sound on screen (for the randomizer, locked boxes are taken from it).
        if (g.id === RANDOMIZER && !['randomizer', 'user', ATLAS].includes(currentGroup.id)) basedOn = currentGroup.id;
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
  list.classList.toggle('rolls', currentGroup.id === RANDOMIZER || currentGroup.id === USER);
  // The randomizer's box locks only show while it's open.
  document.body.classList.toggle('randomizing', currentGroup.id === RANDOMIZER);
  if (currentGroup.id === RANDOMIZER) {
    renderRandomizer(list);
    return;
  }
  if (currentGroup.id === USER) {
    renderUser(list);
    return;
  }
  for (const i of currentGroup.items) {
    const p = library[i];
    const card = document.createElement('button');
    card.className = 'preset' + (i === currentIndex ? ' active' : '');
    const name = document.createElement('b');
    name.textContent = p.meta.name;
    if (p.meta.iconic) {
      const second = p.meta.iconic === 2;
      const tag = document.createElement('em');
      tag.className = 'iconic-tag' + (second ? ' ii' : '');
      tag.textContent = second ? 'Iconic II' : 'Iconic';
      tag.title = second
        ? 'A LORN version of an iconic or deeply satisfying key, pluck, lead or arp sound (second wave)'
        : 'A LORN version of an iconic sound from synthwave, cyberpunk, Vangelis or Stranger Things';
      name.append(tag);
    }
    const tpl = (p.meta.tags as string[] | undefined)?.find((t) => t in BASS_TEMPLATES);
    if (tpl) {
      const [label, tip] = BASS_TEMPLATES[tpl];
      const tag = document.createElement('em');
      tag.className = 'iconic-tag tpl';
      tag.textContent = label;
      tag.title = tip;
      name.append(tag);
    }
    if ((p.meta.tags as string[] | undefined)?.includes('new')) {
      const tag = document.createElement('em');
      tag.className = 'iconic-tag new';
      tag.textContent = 'New';
      tag.title = 'Added to cover a role this category was missing: audition it and keep or delete';
      name.append(tag);
    }
    const desc = document.createElement('span');
    desc.textContent = p.meta.description ?? '';
    card.append(name, desc);
    card.onclick = () => loadPatch(i);
    list.append(card);
  }
}

/** The dark bass octave templates (tools/bank/bass-templates.ts), shown as a label next to the name. */
const BASS_TEMPLATES: Record<string, [string, string]> = {
  'heavy-reese': ['Heavy Reese', 'Template A: sub -1 oct, osc 1 and 2 at the root, slightly detuned so they beat'],
  'cinematic-screamer': ['Cinematic Screamer', 'Template B: sub -1 oct, osc 1 at the root, osc 2 an octave up and a few dB under it'],
  'ominous-fifth': ['Ominous Fifth', 'Template C: sub -1 oct, osc 1 at the root, osc 2 a fifth up, dark and tape-saturated'],
  'deep-rumble': ['Deep Rumble', 'Template D: sub -2 oct, osc 1 an octave down, osc 2 at the root high-passed at 200 Hz'],
  '808-thump': ['808 Thump', 'Template E: the sub carries the note and its pitch drop, osc 1 adds grit, osc 2 off'],
  'single-body': ['Single Body', 'Template F: sub -1 oct and one oscillator at the root, osc 2 off'],
  'tritone-bass': ['Tritone Bass', 'Template G: sub -1 oct, osc 1 at the root, osc 2 a tritone (+6) up'],
};

// ---------------------------------------------------------------- randomizer

interface RollEntry { roll: Roll; id: number }
const USER_KEY = 'lowtalk.user-sounds';
const OLD_KEPT_KEY = 'lowtalk.kept-rolls';
const bank = library.filter((p) => p.meta.category);
let rolls: RollEntry[] = [];
/** Starred rolls: the User tab. */
let userSounds: RollEntry[] = [];
let currentRoll: RollEntry | null = null;
let basedOn = 'any';
let weirdness = 0.4;
let rolling = false;
let nextId = 1;
try {
  const stored = JSON.parse(localStorage.getItem(USER_KEY) ?? localStorage.getItem(OLD_KEPT_KEY) ?? '[]') as Roll[];
  userSounds = stored.map((r) => ({ roll: { ...r, patch: validatePatch(r.patch).patch }, id: nextId++ }));
} catch {
  // No storage (private window): starred sounds just don't survive a reload.
}
function saveUser(): void {
  try {
    localStorage.setItem(USER_KEY, JSON.stringify(userSounds.map((e) => e.roll)));
  } catch {
    // ignore
  }
}
const isStarred = (e: RollEntry) => userSounds.includes(e);
function toggleStar(e: RollEntry): void {
  userSounds = isStarred(e) ? userSounds.filter((x) => x !== e) : [e, ...userSounds];
  saveUser();
  renderBrowser();
}

function loadRoll(e: RollEntry): void {
  currentRoll = e;
  reference = e.roll.patch;
  current = structuredClone(reference);
  showPatchInfo(current);
  panel.show(current, reference);
  synth.show(current);
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
    const e: RollEntry = { roll: r, id: nextId++ };
    // Newest first; the oldest drop off after 30 (starred ones live on in User).
    rolls = [e, ...rolls].slice(0, 30);
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
  tip.textContent = 'Tip: 🔒 a box to keep it while rolling the rest. ☆ adds a roll to User.';
  const clear = document.createElement('button');
  clear.className = 'btn clear-rolls';
  clear.textContent = 'Clear all rolls';
  clear.title = 'Remove every roll from this page (starred ones stay in User)';
  clear.disabled = !rolls.length;
  clear.onclick = () => {
    rolls = [];
    renderBrowser();
  };
  bar.append(dice, weird, based, tip, clear);
  list.append(bar);
  for (const e of rolls) list.append(soundCard(e, () => { rolls = rolls.filter((x) => x !== e); renderBrowser(); }, 'Throw this roll away'));
}

/** A rolled or starred sound: click to load, ☆ to star (adds to User), ✕ to remove. */
function soundCard(e: RollEntry, remove: () => void, removeTitle: string): HTMLElement {
  const card = document.createElement('div');
  card.className = 'preset roll' + (e === currentRoll ? ' active' : '') + (isStarred(e) ? ' kept' : '');
  card.onclick = () => loadRoll(e);
  const name = document.createElement('b');
  const title = document.createElement('span');
  title.className = 'roll-name';
  title.textContent = e.roll.name;
  const tools = document.createElement('span');
  tools.className = 'roll-tools';
  const star = document.createElement('button');
  star.className = 'keep';
  star.textContent = isStarred(e) ? '★' : '☆';
  star.title = isStarred(e) ? 'In User (click to take it out)' : 'Star: add this sound to User';
  star.onclick = (ev) => {
    ev.stopPropagation();
    toggleStar(e);
  };
  const del = document.createElement('button');
  del.className = 'drop';
  del.textContent = '✕';
  del.title = removeTitle;
  del.onclick = (ev) => {
    ev.stopPropagation();
    remove();
  };
  tools.append(star, del);
  name.append(title, tools);
  const desc = document.createElement('span');
  desc.textContent = e.roll.hint;
  card.append(name, desc);
  return card;
}

function renderUser(list: HTMLElement): void {
  if (!userSounds.length) {
    const empty = document.createElement('p');
    empty.className = 'roll-tip user-empty';
    empty.textContent = 'Nothing here yet. Star (☆) a roll in the Randomizer and it lands here.';
    list.append(empty);
    return;
  }
  for (const e of userSounds) {
    list.append(soundCard(e, () => { userSounds = userSounds.filter((x) => x !== e); saveUser(); renderBrowser(); }, 'Delete this sound from User'));
  }
}

function loadPatch(index: number): void {
  currentRoll = null;
  currentIndex = index;
  renderBrowser();
  reference = library[index];
  // A preset can name its own audition loop (a short bass wants a riff, not long notes).
  if (typeof reference.meta.audition === 'string') setLoop(reference.meta.audition);
  current = structuredClone(reference);
  showPatchInfo(current);
  panel.show(current, reference);
  synth.show(current);
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
  if (currentGroup.id === RANDOMIZER || currentGroup.id === USER) {
    const list = currentGroup.id === USER ? userSounds : rolls;
    if (!list.length) return;
    const at = currentRoll ? list.indexOf(currentRoll) : -1;
    loadRoll(list[(at + dir + list.length) % list.length]);
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
  synth.setAnalyser(host.analyser);
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
