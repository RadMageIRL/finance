// Range and adjustment switches (src/components/data/RangeSwitch.astro): when the controlled
// element holds children marked data-switch-panel, the chosen one shows and the others hide.
// Pages that need more listen to `change` themselves; this never prevents that.
export function wireSwitches(): void {
  document.querySelectorAll<HTMLFieldSetElement>('fieldset.data-switch[data-controls]').forEach((group) => {
    const target = document.getElementById(group.dataset.controls ?? '');
    if (!target) return;
    const apply = (value: string) => {
      const panels = target.querySelectorAll<HTMLElement>('[data-switch-panel]');
      if (!panels.length) return;
      panels.forEach((p) => {
        p.hidden = p.dataset.switchPanel !== value;
      });
    };
    group.addEventListener('change', (event) => {
      const input = event.target;
      if (input instanceof HTMLInputElement && input.type === 'radio') apply(input.value);
    });
  });
}
