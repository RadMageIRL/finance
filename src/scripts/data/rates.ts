// The range switch of the federal funds rate chart (src/data-pages/federal-funds-rate.astro).
// The page builds one static chart per range; without JavaScript only the default (five years)
// is shown and the switch is hidden. Here the chosen range's chart is shown and the others are
// hidden. Nothing is fetched and nothing is computed.

const root = document.querySelector<HTMLElement>('[data-rates-chart]');
const inputs = [...document.querySelectorAll<HTMLInputElement>('input[name="rates-range"]')];

function show(range: string): void {
  if (!root) return;
  for (const panel of root.querySelectorAll<HTMLElement>('[data-range-panel]')) panel.hidden = panel.dataset.rangePanel !== range;
  // A chart that measures its container can redraw now that its panel is visible.
  window.dispatchEvent(new Event('resize'));
}

for (const input of inputs) {
  input.addEventListener('change', () => {
    if (input.checked) show(input.value);
  });
}

// A browser restoring the form after Back may have checked another range already.
const checked = inputs.find((i) => i.checked);
if (checked) show(checked.value);
