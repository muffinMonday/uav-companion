# Small fixes list

Bugs and changes small enough for a lesser model (Haiku). Admission rule: straightforward, one or two files, an exact fix that can be stated, and a check that can be run. Anything needing a design choice stays in "Needs a decision" until the owner chooses. When discussing changes with the owner, suggest to park changes which can be delegated to Haiku in this document to be tackled in bulk.

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

### SF-3 Swipe to close the map popups
- Request (owner): the marker window and the point-check window close on a swipe. Left or right anywhere on the window; up or down from its border (the top bar with the edit, close and tool buttons, and the previous / next footer; on the point-check window, the top bar and the bottom row). In edit mode a swipe does not close the window.
- Change: `onPopupSwipe` in `src/swipe.js` (four `onSwipe` calls, two for the sides, two for the borders); `src/poi-ui.js` `popupContent` (edit flag, `enabled`, borders; `openPopup` now sets `popup` before the content is built, so the window closes itself and not a newer one); `src/main.js` `showCheck`. The whole pane moves with the finger (the bubble, the tip and the close button: the children of the Leaflet popup container), using the CSS `translate` property, since Leaflet positions the container with `transform` and `maprotate.js` sets `translate` on it when the map is turned. `onSwipe` takes `css` and a `follow` function or list for this.
- Check: `tests/popswipe.mjs` (new, in the browser list in `tests/run.mjs`): both windows, both borders, the body not closing downward, the map not moving, edit mode, the window's own close button.
- Status: done in code; `test:unit` and the browser suites run (see CURRENT_STATUS). Not tested on a real phone.

### SF-4 Locate button icon sits 5 px high
- Symptom: the "Show my location" icon is not centred in its button.
- Cause (measured in the browser, at 390 and 1200 px): the icon's wrapper span is 30 px tall, but the SVG sits on the text baseline at its top. The icon centre was 5 px above the button centre.
- Change: `styles.css` `.leaflet-bar a.locate-btn .locate-icon{display:flex;align-items:center;justify-content:center}`. Nothing else.
- Check: `tests/locatemode.mjs` measures the icon's centre against the button's centre (under 0.5 px). `npm run test:unit` and `npm test` pass.
- Status: done in code. Committed in the same commit as the code.

### SF-5 Popup swipe snaps back to the middle before it closes
- Symptom: a swipe that dismisses a map popup moved the pane in the swipe direction, then flashed back to the centre before it was dismissed.
- Cause: `finish()` in `src/swipe.js` cleared the pane's inline transform before the popup closed. Leaflet keeps the popup container for about 200 ms while it fades out, so the pane was visible again at the centre.
- Change (owner, 2026-11-12): the pane fades with the drag (opacity falls with the distance travelled); on release it keeps moving and fades to 0, then the popup is removed. A faded pane is not cleared, since the popup goes with it. Non-fading callers (dashboard, dock) keep the old order. `onPopupSwipe` passes `fade: true`.
- Check: `tests/popswipe.mjs` has a block with motion allowed (partly faded mid-drag, position and opacity never go back after release, the window is removed). It fails with the old order. `npm run test:unit` and `npm test` pass.
- Status: done. Committed in `b326b14` and deployed. Not tested on a real phone.

## Done

- SF-1 (name tag over the seq badge), SF-2 (above). Implemented on Haiku 5.5.
