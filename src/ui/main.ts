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
import { SynthView, type PresetSource } from './synth-view';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

// The audition loop: picked by the shelf (and a preset can name its own).
let loopId = DEFAULT_LOOP_ID;

let host: EngineHost | null = null;
let playing = false;
let current: Patch = structuredClone(library[0]);
let reference: Patch = library[0];

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
  (v) => {
    host?.modWheel(v);
    synth.setWheel(v);
  },
  (solo, mute) => host?.monitor(solo, mute),
);

// The new synth page on top; the gear opens the full parameter view under it. Both edit the same patch.
const synth = new SynthView($('synth-v2'), (id, value) => {
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
  toggleLoop: () => setPlaying(!playing),
  playing: () => playing,
};
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
  host?.setLoop(loops.find((l) => l.id === id) ?? null);
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


function setPlaying(on: boolean): void {
  playing = on;
  if (!host) return;
  on ? host.play() : host.stop();
  synth.setPlaying(on);
}
window.addEventListener('keydown', (e) => {
  if (e.code === 'Space' && (e.target as HTMLElement).tagName !== 'SELECT') {
    e.preventDefault();
    setPlaying(!playing);
  }
});

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
  host.setLoop(loops.find((l) => l.id === loopId) ?? null);
  new Scope(host.analyser, $<HTMLCanvasElement>('scope'), $<HTMLCanvasElement>('spectrum'));
  synth.setAnalyser(host.analyser);
  initMidi({
    noteOn: (n, v) => { host?.noteOn(n, v); keyboard.mark(n, true); },
    noteOff: (n) => { host?.noteOff(n); keyboard.mark(n, false); },
    pitchBend: (v) => host?.pitchBend(v),
    modWheel: (v) => {
      host?.modWheel(v);
      panel.setWheel(v);
      synth.setWheel(v);
    },
    allNotesOff: () => host?.panic(),
    status: () => {},
  });
});
