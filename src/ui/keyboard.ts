// On-screen keyboard + computer-keyboard input.

const KEYMAP: Record<string, number> = {
  KeyA: 0, KeyW: 1, KeyS: 2, KeyE: 3, KeyD: 4, KeyF: 5, KeyT: 6, KeyG: 7, KeyY: 8, KeyH: 9, KeyU: 10, KeyJ: 11,
  KeyK: 12, KeyO: 13, KeyL: 14, KeyP: 15, Semicolon: 16,
};
const KEY_LABELS: Record<number, string> = Object.fromEntries(
  Object.entries(KEYMAP).map(([code, off]) => [off, code === 'Semicolon' ? ';' : code.slice(3)]),
);
const BLACK = new Set([1, 3, 6, 8, 10]);

export interface KeyboardHandlers {
  noteOn(note: number, velocity: number): void;
  noteOff(note: number): void;
  onOctave?(base: number): void;
  onVelocity?(velocity: number): void;
}

export class Keyboard {
  base = 36; // C2
  private readonly span = 37; // C .. C (three octaves)
  private held = new Map<string, number>();
  private pointerNote = -1;
  private keyEls = new Map<number, HTMLElement>();

  constructor(private root: HTMLElement, private h: KeyboardHandlers) {
    this.render();
    window.addEventListener('keydown', (e) => this.keyDown(e));
    window.addEventListener('keyup', (e) => this.keyUp(e));
    window.addEventListener('blur', () => this.releaseAll());
  }

  private render(): void {
    this.root.innerHTML = '';
    this.keyEls.clear();
    const whites = [...Array(this.span).keys()].filter((i) => !BLACK.has(i % 12)).length;
    const w = 100 / whites;
    let wi = 0;
    for (let i = 0; i < this.span; i++) {
      const black = BLACK.has(i % 12);
      const el = document.createElement('div');
      el.className = `key ${black ? 'black' : 'white'}`;
      if (black) {
        el.style.left = `${wi * w - w * 0.3}%`;
        el.style.width = `${w * 0.6}%`;
      } else {
        el.style.left = `${wi * w}%`;
        el.style.width = `${w}%`;
        wi++;
      }
      const lbl = document.createElement('span');
      lbl.className = 'lbl';
      lbl.textContent = i % 12 === 0 ? `C${(this.base + i) / 12 - 1}` : '';
      if (KEY_LABELS[i]) el.title = `Computer key: ${KEY_LABELS[i]}`;
      el.append(lbl);
      el.onpointerdown = (e) => {
        el.setPointerCapture(e.pointerId);
        this.pointerNote = this.base + i;
        const rect = el.getBoundingClientRect();
        const vel = Math.min(1, 0.4 + (0.6 * (e.clientY - rect.top)) / rect.height);
        this.h.noteOn(this.pointerNote, vel);
        this.h.onVelocity?.(vel);
        this.mark(this.pointerNote, true);
      };
      el.onpointerup = el.onpointercancel = () => {
        if (this.pointerNote >= 0) {
          this.h.noteOff(this.pointerNote);
          this.mark(this.pointerNote, false);
          this.pointerNote = -1;
        }
      };
      this.root.append(el);
      this.keyEls.set(this.base + i, el);
    }
    this.h.onOctave?.(this.base);
  }

  mark(note: number, down: boolean): void {
    this.keyEls.get(note)?.classList.toggle('down', down);
  }

  private isTyping(e: KeyboardEvent): boolean {
    const t = e.target as HTMLElement | null;
    return !!t && (t.tagName === 'INPUT' && (t as HTMLInputElement).type === 'text' || t.tagName === 'TEXTAREA');
  }

  private keyDown(e: KeyboardEvent): void {
    if (e.repeat || e.metaKey || e.ctrlKey || e.altKey || this.isTyping(e)) return;
    if (e.code === 'KeyZ' || e.code === 'KeyX') {
      this.shift(e.code === 'KeyZ' ? -1 : 1);
      return;
    }
    const off = KEYMAP[e.code];
    if (off === undefined || this.held.has(e.code)) return;
    const note = this.base + off;
    this.held.set(e.code, note);
    this.h.noteOn(note, 0.85);
    this.h.onVelocity?.(0.85);
    this.mark(note, true);
  }

  private keyUp(e: KeyboardEvent): void {
    const note = this.held.get(e.code);
    if (note === undefined) return;
    this.held.delete(e.code);
    this.h.noteOff(note);
    this.mark(note, false);
  }

  /** Move the keyboard an octave down (-1) or up (+1). */
  shift(dir: number): void {
    this.releaseAll();
    this.base = Math.max(12, Math.min(72, this.base + 12 * dir));
    this.render();
  }

  releaseAll(): void {
    for (const note of this.held.values()) {
      this.h.noteOff(note);
      this.mark(note, false);
    }
    this.held.clear();
  }
}
