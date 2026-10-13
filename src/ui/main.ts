// Phase 1 prototype UI: play the engine from the computer keyboard, MIDI or
// the audition loops, and edit every schema parameter. (The conversational UI
// from the mockup arrives in Phase 6.)
import { EngineHost } from '../engine/host';
import { validatePatch, type ParamValue, type Patch } from '../schema';
import { DEFAULT_LOOP_ID, library, loops } from './data';
import { Keyboard } from './keyboard';
import { initMidi } from './midi';
import { ParamsPanel } from './params-panel';
import { Scope } from './scope';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const playBtn = $<HTMLButtonElement>('play');
const loopSel = $<HTMLSelectElement>('loop');
const patchSel = $<HTMLSelectElement>('patch');

let host: EngineHost | null = null;
let playing = false;
let current: Patch = structuredClone(library[0]);
let reference: Patch = library[0];

for (const l of loops) loopSel.append(new Option(`${l.name} · ${l.bpm} BPM`, l.id));
loopSel.value = DEFAULT_LOOP_ID;
library.forEach((p, i) => patchSel.append(new Option(p.meta.name, String(i))));

const panel = new ParamsPanel($('params'), (id: string, value: ParamValue) => {
  current[id] = value;
  host?.setParam(id, value);
});

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

function loadPatch(index: number): void {
  reference = library[index];
  current = structuredClone(reference);
  showPatchInfo(current);
  panel.show(current, reference);
  host?.setPatch(current);
}

patchSel.onchange = () => loadPatch(Number(patchSel.value));
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

$<HTMLButtonElement>('revert').onclick = () => loadPatch(Number(patchSel.value));
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

loadPatch(0);

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
    modWheel: (v) => host?.modWheel(v),
    allNotesOff: () => host?.panic(),
    status: (t) => {
      $('midi').textContent = t;
      $('midi').classList.toggle('dim', !/^MIDI: (?!not|blocked|no )/.test(t));
    },
  });
});
