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

export interface Debounced<T extends unknown[]> {
  (...args: T): void;
  /** Runs a pending call now instead of after the pause; does nothing if none is pending. */
  flush: () => void;
  /** Drops a pending call. */
  cancel: () => void;
}

export function debounce<T extends unknown[]>(fn: (...args: T) => void, ms: number): Debounced<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let pending: T | undefined;
  const run = () => {
    timer = undefined;
    const args = pending!;
    pending = undefined;
    fn(...args);
  };
  const debounced = (...args: T) => {
    if (timer) clearTimeout(timer);
    pending = args;
    timer = setTimeout(run, ms);
  };
  debounced.flush = () => {
    if (!timer) return;
    clearTimeout(timer);
    run();
  };
  debounced.cancel = () => {
    if (timer) clearTimeout(timer);
    timer = undefined;
    pending = undefined;
  };
  return debounced;
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

export type ShareMode = 'exact' | 'rounded' | 'none';

const SHARE_MODE_HELP: Record<ShareMode, string> = {
  exact: 'The link holds your amounts exactly as entered.',
  rounded: 'Each dollar amount is rounded on its own to its first two digits: $12,345.67 becomes $12,000 and $137.50 becomes $140. The results in the link are calculated from the rounded amounts.',
  none: 'The link leaves out every dollar amount, so whoever opens it enters their own. The rate, the years and the other choices are kept.',
};

/**
 * Share panel: builds the link for the chosen amounts mode on open and on demand, shows
 * what the person opening it will see, copies it, and reports status. `build` returns the
 * fragment (without #) and a one-sentence preview, or null while results are withheld.
 */
export function wireShare(root: HTMLElement, idPrefix: string, build: (mode: ShareMode) => { fragment: string; preview: string } | null): { refresh: () => void } {
  const button = $(root, '[data-action="share"]');
  const panel = $(root, `#${idPrefix}-share`);
  const field = $(root, `#${idPrefix}-share-link`) as HTMLInputElement;
  const help = $(root, '[data-out="share-mode-help"]');
  const preview = $(root, '[data-out="share-preview"]');
  const status = $(root, '[data-out="share-status"]');
  const mode = (): ShareMode => (root.querySelector<HTMLInputElement>(`input[name="${idPrefix}-share-amounts"]:checked`)?.value ?? 'exact') as ShareMode;
  const refresh = () => {
    const m = mode();
    help.textContent = SHARE_MODE_HELP[m];
    const built = build(m);
    field.value = built ? `${location.origin}${location.pathname}#${built.fragment}` : '';
    preview.textContent = built?.preview ?? '';
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
  root.querySelectorAll<HTMLInputElement>('[data-action="amounts"]').forEach((radio) =>
    radio.addEventListener('change', () => {
      refresh();
      status.textContent = '';
    }),
  );
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

export interface Evaluation<I, R> {
  input: I | null;
  result: R | null;
  /** Problems by field key, worded for the visitor. */
  errors: Map<string, string>;
}

export interface CalculatorOptions<I, R> {
  root: HTMLElement;
  form: HTMLFormElement;
  /** Text inputs by field key; each has an error slot `#<id>-error`. */
  fields: Record<string, HTMLInputElement>;
  /** Reads every input and runs the engine. Cheap enough to run on every keystroke. */
  evaluate: () => Evaluation<I, R>;
  render: (input: I, result: R) => void;
  /** Live region for announcements. */
  status: HTMLElement;
  announce: (input: I, result: R) => string;
  /** Called after results are shown (with them) or withheld (with null). */
  changed?: (current: { input: I; result: R } | null) => void;
  delayMs?: number;
}

/**
 * The shared input-to-results loop. Results show only for valid input: the moment an edit
 * makes the input invalid, the results are withheld (never left on screen from the previous
 * input), while field messages and announcements wait for a pause in typing (250 ms by
 * default) or for the field to lose focus. Choices (selects, radios) update at once.
 *
 * Fields can be marked blank on purpose (a share link without amounts): while such a field
 * stays empty it shows no error, and the results area asks for the missing amounts instead.
 */
export function wireCalculator<I, R>(o: CalculatorOptions<I, R>) {
  const delay = o.delayMs ?? 250;
  const results = o.root.querySelector<HTMLElement>('.calc__results');
  const blank = new Set<string>();
  let current: { input: I; result: R } | null = null;
  let lastAnnouncement = '';

  const say = (text: string) => {
    if (text === lastAnnouncement) return;
    lastAnnouncement = text;
    o.status.textContent = text;
  };

  /** Errors that are not just a deliberately blank field left empty. */
  const shownErrors = (errors: Map<string, string>) => {
    const out = new Map(errors);
    for (const key of blank) {
      if (o.fields[key]?.value.trim() === '') out.delete(key);
      else blank.delete(key);
    }
    return out;
  };

  const withhold = (state: 'invalid' | 'incomplete') => {
    o.root.dataset.state = state;
    results?.removeAttribute('aria-busy');
    current = null;
    o.changed?.(null);
  };

  function refresh(announce: boolean): void {
    // This reads the form as it is now, so an edit still waiting for the pause is covered.
    later.cancel();
    const ev = o.evaluate();
    const errors = shownErrors(ev.errors);
    for (const [key, el] of Object.entries(o.fields)) setFieldError(el, errors.get(key) ?? null);
    if (ev.input && ev.result) {
      o.root.dataset.state = 'ok';
      results?.removeAttribute('aria-busy');
      current = { input: ev.input, result: ev.result };
      o.render(ev.input, ev.result);
      o.changed?.(current);
      if (announce) say(o.announce(ev.input, ev.result));
      return;
    }
    const incomplete = errors.size === 0;
    withhold(incomplete ? 'incomplete' : 'invalid');
    if (announce) say(incomplete ? 'Enter the missing amounts to see results.' : 'Results hidden until the highlighted entries are fixed.');
  }

  const later = debounce(() => refresh(true), delay);

  o.form.addEventListener('input', (event) => {
    const target = event.target as HTMLInputElement | HTMLSelectElement;
    for (const [key, el] of Object.entries(o.fields)) if (el === target) blank.delete(key);
    if (target instanceof HTMLSelectElement || target.type === 'radio' || target.type === 'checkbox') {
      refresh(true);
      return;
    }
    // Withhold at once if this edit made the input invalid; otherwise mark the shown
    // results as about to change. Messages and the redraw follow after the pause.
    const ev = o.evaluate();
    if (!ev.input || !ev.result) withhold(shownErrors(ev.errors).size === 0 ? 'incomplete' : 'invalid');
    else results?.setAttribute('aria-busy', 'true');
    later();
  });
  o.form.addEventListener('change', () => refresh(true));
  o.form.addEventListener('submit', (event) => event.preventDefault());

  return {
    refresh,
    /**
     * Applies an edit still waiting for the typing pause, so a link or download made right
     * after typing reflects what is on screen in the form, never the previous input.
     */
    settle: () => later.flush(),
    /** Marks fields as deliberately blank until the visitor types in them. */
    leaveBlank(keys: readonly string[]) {
      for (const key of keys) blank.add(key);
    },
    /** The shown input and result after settling any pending edit; null while withheld. */
    current: () => {
      later.flush();
      return current;
    },
  };
}

/** What a chart tooltip reads: how many points there are, and the lines for one point. */
export interface TooltipSource {
  count: () => number;
  lines: (index: number) => readonly string[];
}

/**
 * Chart tooltip: pointer hover, and keyboard reading with the arrow keys, Page Up and Page
 * Down (a tenth of the points at a time), Home and End when the chart has focus. Column and
 * bar charts give each point a hit area (.chart__col); charts over many points (areas and
 * lines, with data-count on the svg) map the pointer to the nearest point and move a cursor
 * line. Lines are set as text.
 */
export function wireChartTooltip(box: HTMLElement, source: TooltipSource): void {
  const tooltip = $(box, '[data-tooltip]');
  let active = -1;

  /** For a chart read by position: its point count and plot geometry in viewBox units. */
  const geometry = () => {
    const svg = box.querySelector<SVGSVGElement>('svg[data-count]');
    if (!svg) return null;
    const rect = svg.getBoundingClientRect();
    const scale = rect.width / Number(svg.dataset.width || rect.width || 1);
    return { svg, rect, scale, count: Number(svg.dataset.count), left: Number(svg.dataset.plotLeft), width: Number(svg.dataset.plotWidth) };
  };
  const pointX = (g: NonNullable<ReturnType<typeof geometry>>, index: number) => g.left + (g.count <= 1 ? g.width / 2 : (index / (g.count - 1)) * g.width);

  const show = (index: number, anchor?: { x: number; y: number }) => {
    const count = source.count();
    if (index < 0 || index >= count) return hide();
    active = index;
    tooltip.replaceChildren(
      ...source.lines(index).map((line, i) => {
        const el = document.createElement(i === 0 ? 'strong' : 'span');
        el.textContent = line;
        return el;
      }),
    );
    tooltip.hidden = false;
    const boxRect = box.getBoundingClientRect();
    let x: number;
    const g = geometry();
    if (g) {
      const cursor = g.svg.querySelector('.chart__cursor');
      const at = pointX(g, index);
      cursor?.setAttribute('x1', String(at));
      cursor?.setAttribute('x2', String(at));
      cursor?.setAttribute('visibility', 'visible');
      x = anchor?.x ?? g.rect.left - boxRect.left + at * g.scale;
    } else {
      box.querySelectorAll('.chart__col').forEach((col) => col.classList.toggle('is-active', col.getAttribute('data-index') === String(index)));
      const col = box.querySelector<SVGGraphicsElement>(`.chart__col[data-index="${index}"] .chart__hit`);
      const colRect = col?.getBoundingClientRect();
      x = anchor?.x ?? (colRect ? colRect.left + colRect.width / 2 - boxRect.left : boxRect.width / 2);
    }
    const left = Math.max(8, Math.min(x + 12, boxRect.width - tooltip.offsetWidth - 8));
    tooltip.style.left = `${left}px`;
    tooltip.style.top = `${Math.max(8, (anchor?.y ?? 24) - 12)}px`;
  };
  const hide = () => {
    active = -1;
    tooltip.hidden = true;
    box.querySelectorAll('.chart__col.is-active').forEach((col) => col.classList.remove('is-active'));
    box.querySelector('.chart__cursor')?.setAttribute('visibility', 'hidden');
  };

  box.addEventListener('pointermove', (event) => {
    const rect = box.getBoundingClientRect();
    const anchor = { x: event.clientX - rect.left, y: event.clientY - rect.top };
    const g = geometry();
    if (g) {
      const at = (event.clientX - g.rect.left) / g.scale;
      if (at < g.left - 4 || at > g.left + g.width + 4) return hide();
      const index = Math.round(((at - g.left) / g.width) * (g.count - 1));
      return show(Math.max(0, Math.min(g.count - 1, index)), anchor);
    }
    const target = (event.target as Element).closest('.chart__col');
    if (!target) return hide();
    show(Number(target.getAttribute('data-index')), anchor);
  });
  box.addEventListener('pointerleave', hide);
  box.addEventListener('blur', hide);
  box.addEventListener('keydown', (event) => {
    const count = source.count();
    if (!count) return;
    const jump = Math.max(1, Math.round(count / 10));
    const from = active < 0 ? 0 : active;
    const keys: Record<string, number> = {
      ArrowRight: Math.min(count - 1, active + 1),
      ArrowLeft: Math.max(0, active < 0 ? 0 : active - 1),
      PageDown: Math.min(count - 1, from + jump),
      PageUp: Math.max(0, from - jump),
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
