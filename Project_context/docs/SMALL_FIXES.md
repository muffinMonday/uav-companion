# Small fixes list

Bugs and changes small enough for a lesser model (Haiku). Admission rule: straightforward, one or two files, an exact fix that can be stated, and a check that can be run. Anything needing a design choice stays in "Needs a decision" until the owner chooses.

Working through the list: plan with the owner first, wait for confirmation, then remind the owner to switch model (`/model`) before editing. Follow `AGENTS.md` (tests before commit; ask before commit, push or deploy).

## Ready

### SF-1 Name tag covers the stop badge on a selected pin
- Symptom: selecting a marker with details off shows the name tag over the `.seq` badge ("D2·3", "#3") on the pin, hiding it.
- Cause: `.name-tag` in `src/styles.css` (~l.740) is shifted `translate(-50%,-62px)`. Pin is 30x40, anchor `[15,38]`, so the `.seq` badge spans about -47px to -31px from the anchor; the tag spans about -62px to -34px (28px high) and overlaps it. The tag marker has `zIndexOffset: 900` (`selectMarker`, `src/poi-ui.js` ~l.625), so it draws on top.
- Fix: change `-62px` to `-82px` in the `.name-tag` rule. Change nothing else.
- Check: in the browser, select a marker that has a `.seq` badge; `.name-tag` bottom (`getBoundingClientRect().bottom`) must be at or above `.seq` top. Also try a pin with a trip dot and a "×N" visit badge. Run `npm run test:unit` and the browser suites that touch name tags (grep `name-tag` in `tests/`).
- Status: done (`styles.css` `.name-tag` -62px to -82px). No browser test added for the overlap; checked by CSS only.

### SF-2 Side Quest chip makes POI cards different widths
- Symptom: in the POI list, `.side-chip` ("▾ 2") was a flex sibling of `.poi-item`, so cards with Side Quests were narrower than cards without.
- Decision: A (chip inside the card at its right edge).
- Done: `renderItem` in `src/poi-ui.js` wraps the button in `.poi-card`; the chip sits inside it, absolutely positioned, and `.poi-card.has-side` adds right padding. Check added to `tests/sidelist.mjs`: Alpha's card and Hotel's card have the same width.
- Not changed: the trips-tab day cards (`stopRow` in `src/trips-ui.js`) still put the chip beside the row. Same issue may appear there; not part of this fix.
- Status: done

## Done

- SF-1 (name tag over the seq badge), SF-2 (above). Implemented on Haiku 5.5.
