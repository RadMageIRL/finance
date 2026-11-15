// Mobile menu. A modal <dialog> provides the focus trap, Escape to close, and an inert page
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
