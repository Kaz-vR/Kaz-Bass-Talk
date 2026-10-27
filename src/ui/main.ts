// Prototype UI: browse the preset bank by category, play it from the
// computer keyboard or MIDI, and edit every schema
// parameter. (Macros and the create area follow their phases.)
import { EngineHost } from '../engine/host';
import { arrayToPatch, inPlugin, PluginHost } from '../engine/plugin-host';
import { roll, type Roll } from '../generator/randomizer';
import { categories } from '../quality/categories';
import { params, switchOffUnused, validatePatch, type ParamValue, type Patch } from '../schema';
import { DEFAULT_LOOP_ID, library, loops } from './data';
import { Keyboard } from './keyboard';
import { initMidi } from './midi';
import { ParamsPanel } from './params-panel';
import { Scope } from './scope';
import { SynthView, type PresetSource } from './synth-view';
import { installDropdowns } from './dropdown';
import { UndoHistory } from '../history/undo';
import builtInUser from '../../data/user-sounds.json';

// Every dropdown opens the page's own menu, not the operating system's.
installDropdowns();

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

// The shelf's loop: the Randomizer renders its candidates with it (no playback any more).
let loopId = DEFAULT_LOOP_ID;

// The browser's AudioWorklet engine, or the plugin's C++ engine when this page is the plugin window.
let host: EngineHost | PluginHost | null = null;
let reference: Patch = library[Math.max(0, library.findIndex((p) => p.meta.name === 'Classic Reese'))];
let current: Patch = structuredClone(reference);

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
groups.push({ id: USER, name: '★ User', description: 'Sounds you saved and rolls you starred. They stay here even when you clear the rolls.', items: [] });
library.forEach((p, i) => {
  const cat = (p.meta.category as string | undefined) ?? ATLAS;
  const g = groups.find((x) => x.id === (SHELF[cat] ?? cat))!;
  g.items.push(i);
});
// The synth opens on Classic Reese, first on the Dark Basses shelf (owner's call).
const START = library.findIndex((p) => p.meta.name === 'Classic Reese');
if (START >= 0) {
  const g = groups.find((x) => x.items.includes(START))!;
  g.items.splice(g.items.indexOf(START), 1);
  g.items.unshift(START);
}
let currentIndex = START >= 0 ? START : (groups[0].items[0] ?? 0);
let currentGroup = groups.find((g) => g.items.includes(currentIndex)) ?? groups[0];

// Undo / redo: every edit gesture and every preset or roll load is a step.
const history = new UndoHistory();
let loaded = false;
function noteEdit(id: string, value: ParamValue): void {
  if (current[id] === value) return;
  history.edit(current, performance.now());
  updateHistory();
}
function updateHistory(): void {
  synth.setHistory(history.canUndo, history.canRedo);
}
function applySnapshot(p: Patch | null): void {
  if (!p) return;
  current = p;
  showPatchInfo(current);
  panel.show(current, reference);
  synth.show(current);
  host?.setPatch(current);
  updateHistory();
}

const panel = new ParamsPanel(
  $('params'),
  (id: string, value: ParamValue) => {
    noteEdit(id, value);
    current[id] = value;
    host?.setParam(id, value);
    synth.setValue(id, value);
  },
  (v) => {
    host?.modWheel(v);
    synth.setWheel(v);
  },
  (solo, mute) => host?.monitor(solo, mute),
);

// The new synth page on top; the gear opens the full parameter view under it. Both edit the same patch.
const synth = new SynthView($('synth-v2'), (id, value) => {
  noteEdit(id, value);
  current[id] = value;
  host?.setParam(id, value);
  panel.setValue(id, value);
});
// The preset selector in the middle of the synth page: the bank's shelves (not the rolls).
const TPL_LETTER: Record<string, string> = { 'heavy-reese': 'A', 'cinematic-screamer': 'B', 'ominous-fifth': 'C', 'deep-rumble': 'D', '808-thump': 'E', 'single-body': 'F', 'tritone-bass': 'G' };
let shelfCache: ReturnType<PresetSource['shelves']> | null = null;
synth.presets = {
  shelves: () => (shelfCache ??= groups.filter((g) => g.items.length && g.id !== RANDOMIZER && g.id !== USER).map((g) => ({
    id: g.id,
    name: g.name,
    secondary: g.id === ATLAS,
    items: g.items.map((i) => {
      const m = library[i].meta;
      const tags = (m.tags as string[] | undefined) ?? [];
      const tpl = tags.find((t) => t in BASS_TEMPLATES);
      return {
        index: i,
        name: m.name,
        tpl: tpl ? TPL_LETTER[tpl] ?? '' : '',
        tplName: tpl ? BASS_TEMPLATES[tpl][0] : '',
        description: String(m.description ?? ''),
        tags: tags.filter((t) => !(t in BASS_TEMPLATES)),
        features: (m.features ?? {}) as Record<string, number>,
      };
    }),
  }))),
  current: () => ({ shelf: currentRoll ? '' : currentGroup.id, index: currentRoll ? -1 : currentIndex, roll: currentRoll?.id ?? -1 }),
  rollState: () => {
    const item = (e: RollEntry) => ({ id: e.id, name: e.roll.name, hint: e.roll.hint, starred: isStarred(e) });
    return {
      rolls: rolls.map(item),
      user: userSounds.map(item),
      rolling,
      weirdness,
      basedOn,
      basedOptions: [['any', 'Anything'], ...categories.map((c) => [c.id, c.name] as [string, string])],
    };
  },
  roll: () => doRoll(),
  setWeirdness: (v) => { weirdness = v; },
  setBasedOn: (id) => { basedOn = id; },
  clearRolls: () => {
    rolls = [];
    renderBrowser();
  },
  pickRoll: (id) => {
    const e = [...rolls, ...userSounds].find((x) => x.id === id);
    if (e) loadRoll(e);
  },
  exportUser: () => {
    const text = JSON.stringify(userSounds.map((e) => e.roll), null, 2);
    // a download where the page may save files; otherwise the clipboard
    try {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
      a.download = 'user-sounds.json';
      document.body.append(a);
      a.click();
      a.remove();
    } catch {
      void navigator.clipboard?.writeText(text);
    }
  },
  starRoll: (id) => {
    const e = [...rolls, ...userSounds].find((x) => x.id === id);
    if (e) toggleStar(e);
  },
  removeRoll: (id, from) => {
    if (from === 'rolls') rolls = rolls.filter((x) => x.id !== id);
    else {
      userSounds = userSounds.filter((x) => x.id !== id);
      saveUser();
    }
    renderBrowser();
  },
  pick: (shelf, index) => {
    const g = groups.find((x) => x.id === shelf);
    if (!g) return;
    if (g !== currentGroup && g.audition) setLoop(g.audition);
    currentGroup = g;
    loadPatch(index);
  },
  step: (dir) => stepPreset(dir),
};
synth.onUndo = () => applySnapshot(history.undo(current));
synth.onRedo = () => applySnapshot(history.redo(current));
synth.onSave = () => saveSound();
document.addEventListener('keydown', (e) => {
  if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
  const k = e.key.toLowerCase();
  if (k === 'z' && !e.shiftKey) synth.onUndo();
  else if ((k === 'z' && e.shiftKey) || k === 'y') synth.onRedo();
  else if (k === 's') synth.onSave();
  else return;
  e.preventDefault();
});
synth.onPitch = (v) => host?.pitchBend(v);
synth.onOctave = (dir) => keyboard.shift(dir);
synth.onWheel = (v) => {
  host?.modWheel(v);
  panel.setWheel(v);
};
synth.onGear = () => {
  const old = $('old-ui');
  old.classList.toggle('hidden');
  document.querySelector('.gear')?.classList.toggle('on', !old.classList.contains('hidden'));
  if (!old.classList.contains('hidden')) old.scrollIntoView({ behavior: 'smooth', block: 'start' });
};

function showPatchInfo(p: Patch): void {
  synth.setTitle(p.meta.name, synthCaption(p));
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
  if (!loops.some((l) => l.id === id) || loopId === id) return;
  loopId = id;
}

/** Something the preset page shows changed (a preset loaded, a roll added or starred). */
function renderBrowser(): void {
  queueMicrotask(() => synth.refreshPresets());
}

/** The print caption on the synth page: shelf · frame number · bass template. */
function synthCaption(p: Patch): string {
  if (currentRoll) return 'Randomizer roll';
  const cat = (p.meta.category as string | undefined) ?? ATLAS;
  const g = groups.find((x) => x.id === (SHELF[cat] ?? cat));
  const parts = [g?.name ?? ''];
  const at = g ? g.items.indexOf(currentIndex) : -1;
  if (at >= 0) parts.push(`Frame ${String(at + 1).padStart(2, '0')}`);
  const tpl = (p.meta.tags as string[] | undefined)?.find((t) => t in BASS_TEMPLATES);
  if (tpl) parts.push(BASS_TEMPLATES[tpl][0]);
  return parts.filter(Boolean).join(' · ');
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
// The User sounds built into the synth (data/user-sounds.json, owner's call: they ship with it), after
// the ones kept in this browser, each once (by name).
{
  const have = new Set(userSounds.map((e) => e.roll.name));
  for (const r of builtInUser as unknown as Roll[]) {
    if (have.has(r.name)) continue;
    userSounds.push({ roll: { ...r, patch: validatePatch(r.patch).patch }, id: nextId++ });
  }
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
  if (loaded) history.replace(current);
  loaded = true;
  currentRoll = e;
  reference = e.roll.patch;
  const prev = current;
  switchOffUnused(reference); // (the preset as designed shows only what it uses)
  current = structuredClone(reference);
  synth.keepLocked(current, prev);
  showPatchInfo(current);
  panel.show(current, reference);
  synth.show(current);
  host?.setPatch(current);
  renderBrowser();
  updateHistory();
}

/** Save the sound on screen as your own preset: it goes to the top of ★ User (kept in this browser). */
function saveSound(): void {
  const own = String(current.meta.name ?? 'My sound');
  // Saving one of your own again numbers it on ("Name 2", "Name 3") instead of "Name 2 2".
  const base = currentRoll && userSounds.includes(currentRoll) ? own.replace(/ \d+$/, '') : own;
  const taken = new Set(userSounds.map((e) => e.roll.name));
  let name = base;
  for (let i = 2; taken.has(name); i++) name = `${base} ${i}`;
  const patch = structuredClone(validatePatch(current).patch);
  patch.meta = { ...patch.meta, name, description: `Your own, saved from ${current.meta.name}.` };
  const e: RollEntry = { roll: { patch, name, hint: `Saved from ${current.meta.name}` }, id: nextId++ };
  userSounds = [e, ...userSounds];
  saveUser();
  currentRoll = e;
  reference = patch;
  current.meta = structuredClone(patch.meta);
  showPatchInfo(current);
  synth.flashSaved();
  renderBrowser();
}

function doRoll(): void {
  if (rolling) return;
  rolling = true;
  renderBrowser();
  // Let the "Rolling…" state paint before the (about a second of) work.
  setTimeout(() => {
    const audition = basedOn === 'any' ? loopId : categories.find((c) => c.id === basedOn)?.audition ?? loopId;
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




function loadPatch(index: number): void {
  if (loaded) history.replace(current);
  loaded = true;
  currentRoll = null;
  currentIndex = index;
  renderBrowser();
  reference = library[index];
  // A preset can name its own audition loop (a short bass wants a riff, not long notes).
  if (typeof reference.meta.audition === 'string') setLoop(reference.meta.audition);
  const prev = current;
  switchOffUnused(reference); // (the preset as designed shows only what it uses)
  current = structuredClone(reference);
  synth.keepLocked(current, prev);
  showPatchInfo(current);
  panel.show(current, reference);
  synth.show(current);
  host?.setPatch(current);
  updateHistory();
}



$<HTMLButtonElement>('revert').onclick = () => (currentRoll ? loadRoll(currentRoll) : loadPatch(currentIndex));
/** Step through the current category, wrapping around at either end. */
function stepPreset(dir: number): void {
  if (currentRoll) {
    const list = userSounds.includes(currentRoll) && !rolls.includes(currentRoll) ? userSounds : rolls;
    if (!list.length) return;
    const at = currentRoll ? list.indexOf(currentRoll) : -1;
    loadRoll(list[(at + dir + list.length) % list.length]);
    return;
  }
  const items = currentGroup.items;
  const at = items.indexOf(currentIndex);
  loadPatch(items[(at + dir + items.length) % items.length]);
}
$<HTMLButtonElement>('panic').onclick = () => {
  host?.panic();
  synth.allNotesOff();
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

const keyboard = new Keyboard(synth.keysEl, {
  noteOn: (n, v) => { host?.noteOn(n, v); synth.noteOn(); },
  noteOff: (n) => { host?.noteOff(n); synth.noteOff(); },
  onOctave: (base) => synth.setOctave(base),
  onVelocity: (v) => synth.setVelocity(v),
});

if (groups[0].audition) loopId = groups[0].audition;
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
  new Scope(host.analyser, $<HTMLCanvasElement>('scope'), $<HTMLCanvasElement>('spectrum'));
  synth.setAnalyser(host.analyser);
  const engine = host;
  synth.setLiveFilter(() => engine.liveFilter());
  synth.setLiveWobble(() => engine.liveWobble());
  synth.setLiveLfos(() => engine.liveLfos());
  synth.setLiveGrind(() => engine.liveGrind());
  initMidi({
    noteOn: (n, v) => { host?.noteOn(n, v); keyboard.mark(n, true); synth.noteOn(); },
    noteOff: (n) => { host?.noteOff(n); keyboard.mark(n, false); synth.noteOff(); },
    pitchBend: (v) => host?.pitchBend(v),
    modWheel: (v) => {
      host?.modWheel(v);
      panel.setWheel(v);
      synth.setWheel(v);
    },
    allNotesOff: () => { host?.panic(); synth.allNotesOff(); },
    status: () => {},
  });
});

// Inside the plugin window: no start button, no Web MIDI (the host sends MIDI); the plugin
// holds the patch (its parameters are automatable and saved with the project).
function startPlugin(): void {
  document.documentElement.classList.add('in-plugin');
  $('start').classList.add('hidden');
  let held = new Set<number>();
  let lastWheel = -1;
  const ph = new PluginHost({
    state: ({ values, name }) => {
      const i = library.findIndex((p) => p.meta.name === name);
      const r = i < 0 ? [...rolls, ...userSounds].find((e) => e.roll.name === name) : undefined;
      if (i >= 0) {
        currentRoll = null;
        currentIndex = i;
        currentGroup = groups.find((g) => g.items.includes(i)) ?? currentGroup;
        reference = library[i];
      } else if (r) {
        currentRoll = r;
        reference = r.roll.patch;
      }
      current = arrayToPatch(values, i >= 0 || r ? structuredClone(reference.meta) : { ...current.meta, name });
      if (i < 0 && !r) reference = current;
      showPatchInfo(current);
      panel.show(current, reference);
      synth.show(current);
      renderBrowser();
    },
    params: (changes) => {
      for (const [i, v] of changes) {
        const p = params[i];
        if (!p) continue;
        const value = (p.type === 'enum' ? p.options![Math.round(v)] : p.type === 'bool' ? v > 0.5 : p.type === 'int' ? Math.round(v) : v) as ParamValue;
        current[p.id] = value;
        panel.setValue(p.id, value);
        synth.setValue(p.id, value);
      }
    },
    notes: (notes, wheel) => {
      const now = new Set(notes);
      for (const n of held) if (!now.has(n)) { keyboard.mark(n, false); synth.noteOff(); }
      for (const n of now) if (!held.has(n)) { keyboard.mark(n, true); synth.noteOn(); }
      held = now;
      if (wheel >= 0 && wheel !== lastWheel) {
        lastWheel = wheel;
        panel.setWheel(wheel);
        synth.setWheel(wheel);
      }
    },
  });
  host = ph;
  new Scope(host.analyser, $<HTMLCanvasElement>('scope'), $<HTMLCanvasElement>('spectrum'));
  synth.setAnalyser(host.analyser);
  // the moving prints read the engine's live values, sent with the scope
  synth.setLiveFilter(() => ph.liveFilter());
  synth.setLiveWobble(() => ph.liveWobble());
  synth.setLiveLfos(() => ph.liveLfos());
  synth.setLiveGrind(() => ph.liveGrind());
}
if (inPlugin()) startPlugin();
