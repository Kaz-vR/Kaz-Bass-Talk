/**
 * Every <select> on the page opens this menu instead of the operating system's: a dark panel in the
 * page's style, the current choice lit in the colour of the box it belongs to. The <select> stays
 * the source of truth (value + change event), so nothing else has to know about the menu.
 */

let open: { menu: HTMLElement; sel: HTMLSelectElement } | null = null;

function close(): void {
  if (!open) return;
  open.menu.remove();
  open.sel.classList.remove('dd-open');
  open = null;
}

function choose(sel: HTMLSelectElement, value: string): void {
  close();
  if (sel.value === value) return;
  sel.value = value;
  sel.dispatchEvent(new Event('change', { bubbles: true }));
  sel.dispatchEvent(new Event('input', { bubbles: true }));
}

function show(sel: HTMLSelectElement): void {
  close();
  const accent = getComputedStyle(sel).getPropertyValue('--knob-accent').trim() || '#ffffff';
  const items = [...sel.options].filter((o) => !o.hidden && o.style.display !== 'none');
  const menu = document.createElement('div');
  menu.className = 'dd-menu';
  menu.style.setProperty('--dd-accent', accent);
  if (items.length > 14) menu.classList.add('dd-cols');
  let current: HTMLElement | null = null;
  for (const o of items) {
    const it = document.createElement('button');
    it.className = 'dd-item';
    it.textContent = o.text;
    it.disabled = o.disabled;
    if (o.value === sel.value) {
      it.classList.add('on');
      current = it;
    }
    it.onclick = (e) => {
      e.stopPropagation();
      choose(sel, o.value);
    };
    menu.append(it);
  }
  document.body.append(menu);
  sel.classList.add('dd-open');
  open = { menu, sel };

  // Under the select (above it when there is no room), kept inside the window.
  const r = sel.getBoundingClientRect(), m = menu.getBoundingClientRect(), pad = 8;
  let left = Math.min(r.left - 10, window.innerWidth - m.width - pad);
  left = Math.max(pad, left);
  let top = r.bottom + 6;
  if (top + m.height > window.innerHeight - pad) top = Math.max(pad, r.top - 6 - m.height);
  menu.style.left = `${left}px`;
  menu.style.top = `${top}px`;
  current?.scrollIntoView({ block: 'nearest' });
  (current ?? (menu.firstElementChild as HTMLElement | null))?.focus({ preventScroll: true });
}

/** Take over every <select> in the document (now and later). */
export function installDropdowns(): void {
  document.addEventListener('mousedown', (e) => {
    const t = e.target as HTMLElement;
    if (t instanceof HTMLSelectElement && !t.multiple) {
      e.preventDefault();
      if (open?.sel === t) close();
      else show(t);
      return;
    }
    if (open && !open.menu.contains(t)) close();
  }, true);
  document.addEventListener('keydown', (e) => {
    const t = e.target as HTMLElement;
    if (!open && t instanceof HTMLSelectElement && (e.key === 'Enter' || e.key === ' ')) {
      e.preventDefault();
      show(t);
      return;
    }
    if (!open) return;
    const items = [...open.menu.querySelectorAll<HTMLButtonElement>('.dd-item:not(:disabled)')];
    const i = items.indexOf(document.activeElement as HTMLButtonElement);
    if (e.key === 'Escape') {
      e.preventDefault();
      const sel = open.sel;
      close();
      sel.focus();
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      items[Math.max(0, Math.min(items.length - 1, i + (e.key === 'ArrowDown' ? 1 : -1)))]?.focus();
    }
  }, true);
  window.addEventListener('resize', close);
  window.addEventListener('blur', close);
  document.addEventListener('scroll', (e) => { if (open && !open.menu.contains(e.target as Node)) close(); }, true);
}
