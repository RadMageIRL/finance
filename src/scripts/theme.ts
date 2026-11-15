// Theme control behavior. The head script has already applied the stored choice before the
// first paint; this module wires the radio groups, saves changes, and follows the operating
// system live while System is selected.
import { DEFAULT_THEME, THEME_CHOICES, THEME_STORAGE_KEY } from '../lib/theme/head-script.mjs';

type ThemeChoice = (typeof THEME_CHOICES)[number];
type AppliedTheme = 'dark' | 'light';

const root = document.documentElement;
const lightQuery = typeof window.matchMedia === 'function'
  ? window.matchMedia('(prefers-color-scheme: light)')
  : null;
const themeColor = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
const THEME_COLORS: Record<AppliedTheme, string> = { dark: '#10151f', light: '#f6f7f9' };

function isChoice(value: unknown): value is ThemeChoice {
  return typeof value === 'string' && (THEME_CHOICES as readonly string[]).includes(value);
}

function currentChoice(): ThemeChoice {
  const value = root.getAttribute('data-theme-choice');
  return isChoice(value) ? value : DEFAULT_THEME;
}

function resolve(choice: ThemeChoice): AppliedTheme {
  if (choice === 'system') return lightQuery?.matches ? 'light' : 'dark';
  return choice;
}

function save(choice: ThemeChoice): void {
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, choice);
  } catch {
    // Storage blocked or full: the choice still applies for this page view.
  }
}

function paint(theme: AppliedTheme): void {
  root.setAttribute('data-theme', theme);
  themeColor?.setAttribute('content', THEME_COLORS[theme]);
}

function syncControls(choice: ThemeChoice): void {
  document
    .querySelectorAll<HTMLInputElement>('[data-theme-control] input[type="radio"]')
    .forEach((input) => {
      input.checked = input.value === choice;
    });
}

function onSystemChange(): void {
  if (currentChoice() === 'system') paint(resolve('system'));
}

let following = false;

function followSystem(on: boolean): void {
  if (!lightQuery || on === following) return;
  if (on) lightQuery.addEventListener('change', onSystemChange);
  else lightQuery.removeEventListener('change', onSystemChange);
  following = on;
}

function apply(choice: ThemeChoice): void {
  root.setAttribute('data-theme-choice', choice);
  paint(resolve(choice));
  syncControls(choice);
  followSystem(choice === 'system');
}

document.querySelectorAll<HTMLFieldSetElement>('[data-theme-control]').forEach((group) => {
  group.addEventListener('change', (event) => {
    const target = event.target;
    if (target instanceof HTMLInputElement && isChoice(target.value)) {
      save(target.value);
      apply(target.value);
    }
  });
});

// Another tab changed the theme.
window.addEventListener('storage', (event) => {
  if (event.key === THEME_STORAGE_KEY) apply(isChoice(event.newValue) ? event.newValue : DEFAULT_THEME);
});

apply(currentChoice());

// Allow transitions only after the first frames have painted.
requestAnimationFrame(() => {
  requestAnimationFrame(() => root.setAttribute('data-ready', ''));
});
