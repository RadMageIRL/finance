// Base-aware internal links. The site is served under /finance/, so every internal link
// goes through here instead of being written as a root-relative path.

const BASE = import.meta.env.BASE_URL.endsWith('/')
  ? import.meta.env.BASE_URL
  : `${import.meta.env.BASE_URL}/`;

/** href('learn/') returns '/finance/learn/'; href() returns the site root. */
export function href(path = ''): string {
  return BASE + path.replace(/^\/+/, '');
}

/** True when `pathname` is `path` itself or a page inside it. */
export function isWithin(pathname: string, path: string): boolean {
  const target = href(path);
  return target === href() ? pathname === target : pathname.startsWith(target);
}
