// Touch devices: screens that open by themselves must not raise the on-screen keyboard. A text field is only focused when the pointer is a mouse.
// (Search, the marker name and the trip name are focused after a deliberate tap, so they keep their focus.)

export const coarse = () => globalThis.matchMedia?.('(pointer: coarse)').matches ?? false;

/** Focuses a field, except on a touch device, where the keyboard would open without the person asking for it. */
export function focusField(input) { if (!coarse()) input?.focus(); }

/** dialog.showModal() without the browser's own autofocus landing on the first text field on a touch device (the dialog itself takes the focus instead). */
export function showModalQuiet(dlg) {
  if (dlg.open) return;
  if (!coarse()) { dlg.showModal(); return; }
  dlg.tabIndex = -1; dlg.setAttribute('autofocus', '');
  dlg.showModal();
  const a = document.activeElement;
  if (a && a !== dlg && a.matches?.('input, textarea, select, [contenteditable]')) a.blur();
}
