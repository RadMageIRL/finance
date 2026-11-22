// Money Supply Tracker: the seasonal adjustment switch. Without JavaScript the page shows both
// adjustments one after the other; with it, the native radio group shows one at a time. All
// figures are in the page already, so nothing is fetched or computed here.

const panels = [...document.querySelectorAll<HTMLElement>('[data-money-panel]')];
const radios = [...document.querySelectorAll<HTMLInputElement>('input[name="money-adjustment"]')];
const live = document.querySelector<HTMLElement>('[data-money-status]');

function show(value: string, announce: boolean): void {
  let label = '';
  for (const panel of panels) {
    const active = panel.dataset.moneyPanel === value;
    panel.toggleAttribute('data-inactive', !active);
    if (active) label = panel.dataset.moneyLabel ?? '';
  }
  if (announce && live && label) live.textContent = `Showing ${label} figures.`;
}

if (panels.length > 0 && radios.length > 0) {
  for (const radio of radios) {
    radio.addEventListener('change', () => {
      if (radio.checked) show(radio.value, true);
    });
  }
  // A restored page (back and forward cache, form state) may come back with the other choice.
  const checked = radios.find((r) => r.checked);
  if (checked) show(checked.value, false);
}

export {};
