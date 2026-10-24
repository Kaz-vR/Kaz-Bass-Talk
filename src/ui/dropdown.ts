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

function item(sel: HTMLSelectElement, o: HTMLOptionElement): HTMLButtonElement {
  const it = document.createElement('button');
  it.className = 'dd-item';
  it.textContent = o.text;
  it.disabled = o.disabled;
  it.dataset.value = o.value;
  if (o.value === sel.value) it.classList.add('on');
  it.onclick = (e) => {
    e.stopPropagation();
    choose(sel, o.value);
  };
  return it;
}

const visible = (o: HTMLOptionElement) => !o.hidden && o.style.display !== 'none';

function show(sel: HTMLSelectElement): void {
  close();
  const accent = getComputedStyle(sel).getPropertyValue('--knob-accent').trim() || '#ffffff';
  const menu = document.createElement('div');
  menu.className = 'dd-menu';
  menu.style.setProperty('--dd-accent', accent);
  const groups = [...sel.children].filter((c): c is HTMLOptGroupElement => c instanceof HTMLOptGroupElement);
  if (groups.length) {
    // option groups become columns with a heading each (the Wobbler's rate menu)
    menu.classList.add('dd-groups');
    const cols = document.createElement('div');
    cols.className = 'dd-group-cols';
    for (const gr of groups) {
      const col = document.createElement('div');
      col.className = 'dd-group';
      const head = document.createElement('div');
      head.className = 'dd-group-head';
      head.textContent = gr.label;
      col.append(head);
      for (const o of [...gr.children] as HTMLOptionElement[]) if (visible(o)) col.append(item(sel, o));
      cols.append(col);
    }
    menu.append(cols);
  } else {
    const items = [...sel.options].filter(visible);
    if (items.length > 14) menu.classList.add('dd-cols');
    for (const o of items) menu.append(item(sel, o));
  }
  if (sel.dataset.ddStep) {
    // a footer with the current value and arrows that step through the options, keeping the menu open
    const foot = document.createElement('div');
    foot.className = 'dd-foot';
    const val = document.createElement('span');
    val.className = 'dd-foot-val';
    const arrow = (txt: string, d: number) => {
      const b = document.createElement('button');
      b.className = 'dd-foot-arrow';
      b.textContent = txt;
      b.onclick = (e) => {
        e.stopPropagation();
        // (within the current option's group, when the options are grouped)
        const cur = sel.selectedOptions[0], scope = cur?.parentElement instanceof HTMLOptGroupElement ? cur.parentElement : sel;
        const opts = [...scope.querySelectorAll('option')].filter((o) => visible(o) && !o.disabled), i = opts.findIndex((o) => o.value === sel.value);
        const next = opts[Math.max(0, Math.min(opts.length - 1, i + d))];
        if (!next || next.value === sel.value) return;
        sel.value = next.value;
        sel.dispatchEvent(new Event('change', { bubbles: true }));
        sel.dispatchEvent(new Event('input', { bubbles: true }));
        mark();
      };
      return b;
    };
    const mark = () => {
      val.textContent = sel.selectedOptions[0]?.text ?? '';
      for (const it of menu.querySelectorAll<HTMLElement>('.dd-item')) it.classList.toggle('on', it.dataset.value === sel.value);
    };
    foot.append(val, arrow('‹', -1), arrow('›', 1));
    menu.append(foot);
    mark();
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
  const current = menu.querySelector<HTMLElement>('.dd-item.on');
  current?.scrollIntoView({ block: 'nearest' });
  (current ?? menu.querySelector<HTMLElement>('.dd-item'))?.focus({ preventScroll: true });
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
