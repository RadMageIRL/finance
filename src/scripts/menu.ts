// Header menus.
//
// More: a native <details> disclosure, so it opens without JavaScript. This adds Escape,
// outside clicks and focus leaving to close it, returning focus to its toggle on Escape.

const more = document.querySelector<HTMLDetailsElement>('[data-more-menu]');

if (more) {
  const summary = more.querySelector('summary');
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && more.open) {
      more.open = false;
      summary?.focus();
    }
  });
  document.addEventListener('click', (event) => {
    if (more.open && event.target instanceof Node && !more.contains(event.target)) more.open = false;
  });
  more.addEventListener('focusout', (event) => {
    const next = event.relatedTarget;
    if (more.open && next instanceof Node && !more.contains(next)) more.open = false;
  });
}

// Phone menu. A modal <dialog> provides the focus trap, Escape to close, and an inert page
// behind it; this module opens it, keeps aria-expanded in step, and returns focus.

const openButton = document.querySelector<HTMLButtonElement>('[data-menu-open]');
const dialog = document.querySelector<HTMLDialogElement>('#site-menu');

if (openButton && dialog && typeof dialog.showModal === 'function') {
  const close = (): void => {
    if (dialog.open) dialog.close();
  };

  openButton.addEventListener('click', () => {
    dialog.showModal();
    openButton.setAttribute('aria-expanded', 'true');
  });

  dialog.addEventListener('close', () => {
    openButton.setAttribute('aria-expanded', 'false');
    openButton.focus();
  });

  dialog.querySelector('[data-menu-close]')?.addEventListener('click', close);

  // A click on the backdrop lands on the dialog element itself.
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) close();
  });

  // Following a link closes the menu (matters for links to the current page).
  dialog.querySelectorAll('a').forEach((link) => link.addEventListener('click', close));

  // Growing past the breakpoint shows the full header, so the menu is no longer needed.
  const wide = window.matchMedia('(min-width: 56.25em)');
  wide.addEventListener('change', (event) => {
    if (event.matches) close();
  });
}
