// Modern number and date fields. Number inputs get − / + buttons (the browser's tiny spinner is hidden) and date inputs get a clear
// button. The inputs themselves stay real <input type="number|date">, so keyboards, validation and the native date picker keep working.
// Fields created later (marker windows are built on demand) are picked up by an observer.

const ICON = {
  minus: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 12h12"/></svg>',
  plus: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 6v12M6 12h12"/></svg>',
  clear: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 7l10 10M17 7L7 17"/></svg>',
};

function button(cls, label, icon, onClick) {
  const b = document.createElement('button');
  b.type = 'button'; b.className = `ctl-btn ${cls}`; b.tabIndex = -1; b.setAttribute('aria-label', label); b.innerHTML = icon;
  b.addEventListener('click', onClick);
  return b;
}
const fire = (input) => { input.dispatchEvent(new Event('input', { bubbles: true })); input.dispatchEvent(new Event('change', { bubbles: true })); };

function enhanceNumber(input) {
  const wrap = document.createElement('span');
  wrap.className = 'num-field';
  input.replaceWith(wrap);
  const step = (dir) => {
    if (input.disabled || input.readOnly) return;
    if (input.value === '' && input.min !== '' && dir > 0) input.value = input.min;
    else if (dir > 0) input.stepUp(); else input.stepDown();
    fire(input);
  };
  wrap.append(button('dec', 'Decrease', ICON.minus, () => step(-1)), input, button('inc', 'Increase', ICON.plus, () => step(1)));
}

function enhanceDate(input) {
  const wrap = document.createElement('span');
  wrap.className = 'date-field';
  input.replaceWith(wrap);
  const sync = () => { wrap.dataset.empty = String(input.value === ''); };
  const clear = button('clear', 'Clear date', ICON.clear, () => { if (input.disabled) return; input.value = ''; sync(); fire(input); input.focus(); });
  wrap.append(input, clear);
  for (const ev of ['input', 'change', 'focusin', 'pointerenter', 'pointerdown']) wrap.addEventListener(ev, sync);
  sync();
}

function enhance(root) {
  if (root.nodeType !== 1) return;
  const found = root.matches?.('input[type=number],input[type=date]') ? [root] : [...root.querySelectorAll('input[type=number],input[type=date]')];
  for (const input of found) {
    if (input.closest('.num-field, .date-field') || input.dataset.plain !== undefined) continue;
    if (input.type === 'number') enhanceNumber(input); else enhanceDate(input);
  }
}

export function initControls() {
  enhance(document.body);
  new MutationObserver((records) => { for (const r of records) for (const n of r.addedNodes) enhance(n); })
    .observe(document.body, { childList: true, subtree: true });
}
