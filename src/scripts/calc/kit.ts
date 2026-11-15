// Shared browser behavior for calculators. Calculations happen in the engines; this file
// only reads inputs, shows errors, and handles CSV, share links, the chart tooltip and the
// sticky summary. Visitor text is never inserted as HTML.

export function $(root: ParentNode, selector: string): HTMLElement {
  const el = root.querySelector<HTMLElement>(selector);
  if (!el) throw new Error(`calculator: missing ${selector}`);
  return el;
}

export function setFieldError(input: HTMLInputElement, message: string | null): void {
  const error = document.getElementById(`${input.id}-error`);
  if (message) {
    input.setAttribute('aria-invalid', 'true');
    if (error) {
      error.textContent = message;
      error.hidden = false;
    }
  } else {
    input.removeAttribute('aria-invalid');
    if (error) {
      error.textContent = '';
      error.hidden = true;
    }
  }
}

export function debounce<T extends unknown[]>(fn: (...args: T) => void, ms: number): (...args: T) => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return (...args: T) => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
}

export function downloadText(filename: string, text: string, type = 'text/csv;charset=utf-8'): void {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Share panel: builds the link on open and on demand, copies it, reports status. */
export function wireShare(root: HTMLElement, idPrefix: string, buildFragment: (round: boolean) => string): { refresh: () => void } {
  const button = $(root, '[data-action="share"]');
  const panel = $(root, `#${idPrefix}-share`);
  const field = $(root, `#${idPrefix}-share-link`) as HTMLInputElement;
  const round = $(root, '[data-action="round"]') as HTMLInputElement;
  const status = $(root, '[data-out="share-status"]');
  const refresh = () => {
    field.value = `${location.origin}${location.pathname}#${buildFragment(round.checked)}`;
  };
  button.addEventListener('click', () => {
    const open = panel.hidden;
    panel.hidden = !open;
    button.setAttribute('aria-expanded', String(open));
    status.textContent = '';
    if (open) {
      refresh();
      field.focus();
      field.select();
    }
  });
  round.addEventListener('change', refresh);
  $(root, '[data-action="copy"]').addEventListener('click', async () => {
    refresh();
    try {
      await navigator.clipboard.writeText(field.value);
      status.textContent = 'Link copied.';
    } catch {
      field.select();
      status.textContent = 'Select the link and copy it.';
    }
  });
  return { refresh: () => (!panel.hidden ? refresh() : undefined) };
}

/**
 * Chart tooltip for columns: pointer hover on each column's hit area, and keyboard reading
 * with the arrow keys, Home and End when the chart has focus. Lines are set as text.
 */
export function wireChartTooltip(box: HTMLElement, lines: () => string[][]): void {
  const tooltip = $(box, '[data-tooltip]');
  let active = -1;

  const show = (index: number, anchor?: { x: number; y: number }) => {
    const data = lines();
    if (index < 0 || index >= data.length) return hide();
    active = index;
    tooltip.replaceChildren(
      ...data[index]!.map((line, i) => {
        const el = document.createElement(i === 0 ? 'strong' : 'span');
        el.textContent = line;
        return el;
      }),
    );
    tooltip.hidden = false;
    box.querySelectorAll('.chart__col').forEach((col) => col.classList.toggle('is-active', col.getAttribute('data-index') === String(index)));
    const col = box.querySelector<SVGGraphicsElement>(`.chart__col[data-index="${index}"] .chart__hit`);
    const boxRect = box.getBoundingClientRect();
    const colRect = col?.getBoundingClientRect();
    const x = anchor?.x ?? (colRect ? colRect.left + colRect.width / 2 - boxRect.left : boxRect.width / 2);
    const left = Math.max(8, Math.min(x + 12, boxRect.width - tooltip.offsetWidth - 8));
    tooltip.style.left = `${left}px`;
    tooltip.style.top = `${Math.max(8, (anchor?.y ?? 24) - 12)}px`;
  };
  const hide = () => {
    active = -1;
    tooltip.hidden = true;
    box.querySelectorAll('.chart__col.is-active').forEach((col) => col.classList.remove('is-active'));
  };

  box.addEventListener('pointermove', (event) => {
    const target = (event.target as Element).closest('.chart__col');
    if (!target) return hide();
    const rect = box.getBoundingClientRect();
    show(Number(target.getAttribute('data-index')), { x: event.clientX - rect.left, y: event.clientY - rect.top });
  });
  box.addEventListener('pointerleave', hide);
  box.addEventListener('blur', hide);
  box.addEventListener('keydown', (event) => {
    const count = lines().length;
    if (!count) return;
    const keys: Record<string, number> = {
      ArrowRight: Math.min(count - 1, active + 1),
      ArrowLeft: Math.max(0, active < 0 ? 0 : active - 1),
      Home: 0,
      End: count - 1,
    };
    if (event.key in keys) {
      event.preventDefault();
      show(keys[event.key]!);
    } else if (event.key === 'Escape') {
      hide();
    }
  });
}

/** On narrow screens, a compact result bar shows while the results panel is out of view. */
export function wireSticky(results: HTMLElement, bar: HTMLElement): void {
  if (!('IntersectionObserver' in window)) return;
  const observer = new IntersectionObserver(([entry]) => bar.classList.toggle('is-visible', !entry!.isIntersecting), { threshold: 0 });
  observer.observe(results);
}
