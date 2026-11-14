// Shows the contextual hints (help-content.js): one small, non-modal card at a time, with a Got it button.
//   auto(id, place)    the one automatic showing of a feature's hint. Skipped, and NOT queued, when the hint was seen, another hint is up, or the visitor is busy
//                      (a dialog, placing a marker, a point being picked). Showing it marks it seen.
//   replay(id, place)  shows it again on request: ignores the seen state and leaves it unchanged.
//   clear()            removes the hint that is up (a tab change, a closed window).
// `place(card)` puts the card into the page (prepend to a pane, append to the map, after the sessions tabs).
import { el } from './cards.js';
import { helpById } from './help-content.js';

/** True while the visitor is in the middle of something a hint must not interrupt. `inDialog` lets a hint sit inside the dialog that is open (the sessions hub). */
export function busy({ inDialog = false } = {}) {
  if (typeof document === 'undefined') return true;
  if (document.hidden) return true;
  if (!inDialog && document.querySelector('dialog[open]')) return true;
  if (document.querySelector('.is-placing, .ses-bar:not([hidden])')) return true; // placing a marker, picking a point, exploring sessions on the map
  return false;
}

export function createHelp({ state, isBusy = busy }) {
  let current = null; // { id, card, auto }
  function clear() { current?.card.remove(); current = null; }
  function render(id, place, auto) {
    const h = helpById(id); if (!h) return false;
    clear();
    const card = el('div', 'help-hint'); card.setAttribute('role', 'status'); card.dataset.hint = id;
    const text = el('p', 'help-text', h.text);
    const ok = el('button', 'btn small help-ok', 'Got it'); ok.type = 'button';
    const dismiss = () => { if (current?.card === card) clear(); state.mark(id); };
    ok.addEventListener('click', dismiss);
    card.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.stopPropagation(); dismiss(); } });
    card.append(text, ok);
    place(card);
    current = { id, card, auto };
    return true;
  }
  return {
    auto(id, place, opts = {}) {
      if (state.has(id) || current || isBusy(opts)) return false;
      if (!render(id, place, true)) return false;
      state.mark(id);
      return true;
    },
    replay(id, place) { return render(id, place, false); },
    clear,
    /** The feature was used or understood without the hint: take it down if it is up, and never show it automatically. */
    done(id) { if (current?.id === id) clear(); state.mark(id); },
    get current() { return current?.id ?? null; },
  };
}
