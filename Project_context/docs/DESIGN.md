# DESIGN: UI design system

Load before any styling change. One stylesheet (`src/styles.css`), no framework. Source code beats this file: if they disagree, fix the file in the same change. Review that produced this file and the phased plan: owner-approved 2026-11-13 (plan in the owner's plans folder, summary below).

**Status.** Phases 0 and 1 are done. **Everything marked "planned" does not exist in `styles.css` yet.** Later phases are listed in section 12 and each needs the owner's approval first.

Terms: **current** = in `styles.css` today; **planned (Pn)** = decided, to be added in phase n; **rule** = binding for new and changed CSS from now on.

## 1. Principles (rules)
1. Standardise, refine, do not redesign: keep the look, the colour language and the identity colours (section 7).
2. Hierarchy first: title > primary value > body > meta > micro. Each role has one size and weight.
3. Shared foundations, not mega-components: tokens plus a few small building blocks (section 6). A component with one use stays bespoke and only uses tokens.
4. Use semantic tokens. No raw colour in component CSS except `#fff`/`#000` for glyphs and shadows, and the identity palette.
5. Light and dark use the same tokens; a component never branches on theme (only `styles.css` token blocks and the three dark-only rules in section 8 do).
6. Phones first for space and touch: 44 px hit area on touch, 12 px minimum for text people read, 16 px inputs on touch screens.
7. No new runtime cost: do not add `backdrop-filter`, CSS filters or extra shadow layers; animate transform and opacity only; no web fonts.
8. Do not change behaviour or the tuned phone sheet / dashboard logic (`.sidepanel.tall`, `.dash.tall`, swipe handling) when restyling.

## 2. Tokens (current, `:root` and `:root[data-theme="dark"]`)
| Group | Tokens | Notes |
|---|---|---|
| Colour | `--bg --surface --surface-2 --fg --muted --line` | page, cards, inset areas, text, secondary text, dividers |
| | `--accent --accent-fg --accent-soft` | brand teal; soft = 12% tint for hover and selected |
| | `--danger` | text/outline red; **not a fill behind white text in dark** (2.5:1): use `--danger-solid` with `--on-danger` (P1, built) |
| | `--danger-solid --on-danger` | fill and its text (tab badge, armed delete buttons); 5.6:1 light, 4.8:1 dark |
| | `--control-border` | edge of fields, number buttons and the switch track, >= 3:1 on `--surface-2` (light `#7b8b99`, dark `#6a8094`); `--line` stays for dividers |
| | `--rank-edge` | 1 px outline on rank badges and rings (55% of `--fg`, 3.7:1 light, 5:1 dark) |
| | `--disabled-opacity` | .5 for every disabled control |
| | `--ok --ok-bg --no --no-bg --unk --unk-bg` | status pairs (text on tinted background) |
| | `--zone` | zone teal (identity) |
| Shape | `--radius-xs:6px --radius-sm:9px --radius:14px --radius-lg:18px --radius-pill:999px` | P2. Other radii (8/10/11/12/16/20/24) are still literals until P4 |
| Space | `--sp-1:4px --sp-2:8px --sp-3:12px --sp-4:16px --sp-5:24px` | P2: defined for new code; existing margins and gaps were **not** rewritten (rule: adopt in new and changed CSS) |
| Elevation | `--shadow-2` (panels, popups), `--shadow-1` (small floating controls); `--shadow`, `--shadow-sm` remain as aliases | P2 |
| Scrim | `--scrim` (dialog backdrop) | P2 |
| Layers | `--z-crosshair 450, --z-hold 700, --z-panel 1000, --z-dock 1001, --z-search 1002, --z-live-chip 1003, --z-dash 1004, --z-card 1050, --z-banner 1060, --z-sheet 1070, --z-popover 1080, --z-toast 1100, --z-drag 3000` | P2; section 5 |
| Type | `--font`; `--fs-micro 11, --fs-meta 12, --fs-small 13, --fs-body 14, --fs-title 16, --fs-head 18, --fs-display 24`; `--fw-light 250, --fw-regular 400, --fw-medium 500, --fw-semibold 600, --fw-bold 700`; `--lh-tight 1.2, --lh-meta 1.35, --lh-body 1.45` | P3 (section 3) |
| Touch | `--tap:44px` is documented, not a variable: the block uses `::after` insets | P5 |
| Controls | `--control-h 36px, --control-h-sm 30px`; `--icon 18px, --icon-sm 16px, --icon-lg 22px` | P4. Buttons reach these heights through padding (no `min-height`: fixed-size icon buttons keep their own size) |
| Motion | `--dur-fast .12s --dur .2s --dur-slow .28s --ease` | motion block is wrapped in `prefers-reduced-motion:no-preference` |
| Popup | `--pop-alpha` (0.5 to 1) | set from the opacity slider; glass effect |
| Rank / rarity | `--rank-1..10 --rar-common/rare/epic/legendary` | identity; `--rank-9` has a dark override |
| Layout vars set by code | `--panel-w --dash-lift --cols --h --hold-ms --rot --rank --rb --c` | written from JS with `style.setProperty`; keep |

### Planned tokens (names are the contract, values may be tuned in review)
- **Space:** 2 px and 6 px stay allowed in dense rows (the 4-px scale is in section 2).
- **Control size:** `--tap:44px` (touch only, P5). Different control categories keep different sizes (owner decision): buttons 36 (small 30), inputs 38, icon buttons 36 (34 in the panel header, which is full), tabs 34 on desktop, map controls 30.
- **Elevation:** `--shadow-pin` (not added in P2: the pin drop-shadow has one use, so by rule 3 it stays a literal).
- **Colour:** `--info` (replaces `#1a73e8` for the location dot and accuracy ring), `--focus`. (`--danger-solid`, `--on-danger`, `--control-border`, `--rank-edge`, `--disabled-opacity` were added in P1: see section 2.)

## 3. Typography (built in P3)
| Role | Size / weight | Used for |
|---|---|---|
| Display | 24, light | dashboard greeting, hero numbers |
| Head | 18, bold | popup place name, splash title, big values (XP) |
| **Section title** | **16, bold, normal case** | genuine card / section / dialog / pane headings (owner decision 2026-11-13). Replaces `.card h2` (12 px, uppercase, muted) |
| Body | 14, regular; item titles 600 | list rows, form text |
| Small | 13 | secondary lines, buttons (small) |
| Meta | 12, muted | captions, counts, timestamps |
| Micro / eyebrow | 11, uppercase, 600-700, tracked | **secondary labels and metadata only**: sub-group labels, stat keys, day heads, badges. Never a primary heading |
Numbers: `font-variant-numeric:tabular-nums` for counts, distances, times, XP. Minimum readable text: 12 px on phones. **Clarification made in P3 (the first draft of this file said both "eyebrow 11" and "12 minimum"):** 11 px is allowed only for all-caps labels (eyebrows, stat keys, day heads), badges and map labels; sentence-case text is 12 px or more.
How it was applied (P3): every `font-size` and `font-weight` is a token; half-pixel sizes were snapped (10.5 to 11, 11.5 to 12, 12.5 to 13, 13.5 and 14.5 to 14, 25 to 24, 17 and 19 to 18); weights 550/650 became 600 and 750/800 became 700 (Windows renders 650 as bold, so some labels are now a step lighter). `.card h2`, `.dash-head h2`, `.account-pop h2` and the cloud/account dialogs are Section titles (16, bold, normal case); `.splash h2` is Head (18); `.ach-group h3`, `.ses-manage h3`, `.route-box h3` are eyebrows. `.section-title` and `.eyebrow` classes exist for new markup. **Literal sizes that remain on purpose** (enforced by `tests/contrast-unit.mjs`): 9 and 10 px (rank mini-badge, pin badges on the map), 15 px (check mark, info glyph), 20 px (close glyph, avatar letter, friend code), 22 px (achievement emoji). The phone greeting is `--fs-display` minus 2 px.

## 4. Spacing and layout (rules, planned values)
4-px rhythm. Card padding 12/16 (`--sp-3` `--sp-4`); gap between cards 12; stack gap inside a card 8; popup padding 16; dialog padding 24 (today 18; owner approved roomier dialogs); `.btn-row` margin symmetric. Related items closer than unrelated ones. Current state: gaps 2/3/4/5/6/8/10/12, margin-top 2/3/4/6/8/10/12/18 chosen by feel.

## 5. Elevation, layers, motion
Shadows: two tokens today. Do not add new shadow values.
Layers. `#map` has no `z-index`, so there is no stacking context around the whole map: Leaflet's map pane (`.leaflet-map-pane`, which carries `.leaflet-pane`, **400 at page level**) and its controls (800, 1000) compete with the application's overlays in one stack. The Leaflet pane values 100 to 700 below are **relative inside the map pane**, not page levels. Verified in `styles.css` and `leaflet.css` 2026-11-13:
| Level | Value | Who |
|---|---|---|
| **Leaflet (library, not ours)** | | |
| **map pane** | **400 (page level)** | `.leaflet-map-pane`: everything below, up to the popup pane, is inside it |
| canvas / svg inside the map pane | 100 / 200 | |
| tile pane | 200 | |
| panes (default), overlay pane | 400 | zones, routes, circles |
| shadow pane | 500 | |
| marker pane | 600 | markers (per marker: `zIndexOffset`) |
| tooltip pane | 650 | |
| popup pane | 700 | marker windows, point check |
| controls | 800 (`.leaflet-control`) | zoom, locate, tool buttons |
| control corners | 1000 (`.leaflet-top`, `.leaflet-bottom`) | ties with our panel; the later element in the DOM wins |
| marker offsets (JS, relative inside the marker pane) | 900 live pins (`livemap.js`), 1000 location dot (`locate.js`) | not page-level z-index |
| **Application overlays (`styles.css`)** | | |
| 1 | `.search-btn` | inside `.search` (its own stacking: `position:absolute` with `z-index:1002`), orders the button above the input |
| 5 | `.subpanel` | inside `.sidepanel` (`overflow:hidden`, `z-index:1000`): local ordering, not a page layer |
| 450 | `.crosshair` | page level, just above the map pane (so above markers and popups; the class `.crosshair.under` hides it, set from `crosshair.js`, not checked when) |
| 700 | `.hold-ring` | page level, above the map pane, below the panels |
| 1000 | `.sidepanel` | |
| 1001 | `.dock` (rail) | |
| 1002 | `.search` | |
| 1003 | `.live-chip` | |
| 1004 | `.dash`, `.dash-peek`, `.dash-tab` | |
| 1050 | `.wx` (weather card) | |
| 1060 | `.banner` | |
| 1070 | `.sidepanel.tall`, `.dash.tall` (phone) | above the banner and weather card |
| 1080 | `.account-pop` | |
| 1100 | `.toast` | |
| 3000 | `.drag-ghost` | |
Native `<dialog>`s use the browser's top layer (above all of this). The 1 and 5 are local orderings inside a parent that already forms a stacking context, so they are not layers and stay numbers; every application layer from 450 up is a `--z-*` token (P2; `tests/contrast-unit.mjs` fails on a raw number of 100 or more). New overlays take an existing layer or ask.
Motion: short, transform/opacity only, always inside `prefers-reduced-motion:no-preference` (or killed by the global `reduce` rule). Do not add continuous animations.

## 6. Components and states
### Building blocks (shared foundations; consolidation planned P7)
| Block | Current classes | Standard |
|---|---|---|
| Button | `.btn` `.primary` `.small` `.danger` `.tool` (icon), `.icon-btn`, `.link-btn` | primary / secondary / danger / ghost-icon; heights per category (planned); disabled uniform |
| Field | `input[type=text|url|email|number|date]`, `select`, `textarea`, `.field`, `.num-field`, `.date-field`, `.switch`, `.check-row`, `.radio` | one control rule, visible 3:1 border, label 12-13 semibold, help text meta |
| Pill | `.chip`, `.side-chip`, `.pop-side-btn`, `.visit-chip`, `.pop-seq-btn` (+ separate: `.badge`, `.tab-badge`, `.ach-chip`) | the first five become one `.chip`; badges stay display-only |
| Dialog / sheet | `.account-dialog` (+ `.profile-dialog`, `.prog-dialog`), `.cloud-dialog`, `.splash`; phone sheets `.account-pop`, `.sidepanel`, `.dash` | one shell; phone = bottom sheet with safe-area padding |
| Section heading | `.card h2`, `.dash-card h3`, `.account-pop h2` ... | `.section-title` plus `.eyebrow` (planned P3) |
| Message | `.form-error`, `.fr-message`, `.cloud-status`, `.pf-msg`, `.steam-message`, `.ses-message`, `.hint` | `.msg` with `.error/.ok/.warn` (planned, low priority) |
### Bespoke (stay separate; tokens only)
`.card` (side panel), `.pane-sec` (collapsible), `.dash-card`, `.trip-card`; tabs + `.tab-pill`, rail `.dock`, side panel, dashboard, popup content, verdict `.status` and `.stat` tiles (the model for "primary information"), name tag, live pin, crosshair, Leaflet controls. Tooltips: native `title` only.
### State contract (rule)
- **hover:** pointer devices only: every `:hover` rule sits in `@media (hover:hover)` (P1, enforced by `tests/contrast-unit.mjs`). A disabled button still shows its hover look on a mouse (not yet changed).
- **active:** pressed feedback (scale .96-.97 or `--surface-2`), inside the motion-safe block.
- **focus-visible:** the global 2 px `--accent` ring, offset 2; never remove it; inputs also change border colour.
- **disabled:** `opacity:var(--disabled-opacity); cursor:not-allowed` (P1; was .3 to .55 and mixed cursors).
- **loading:** `[aria-busy=true]` on the control or card, spinner or dimmed content, still announces its label.
- **selected / on:** ARIA drives it (`aria-selected|pressed|checked|current|expanded`): accent border + `--accent-soft`; solid accent for toggles that stay on.
- **error:** `[aria-invalid=true]` -> danger border plus a message below; colour is never the only signal.
- **destructive:** two steps: first press arms (label changes, solid danger fill, white text via `--on-danger`), second confirms. Dialogs for irreversible actions name the consequence.

## 7. Identity colours (intentional hardcoded colours: do not "tokenise" them into the theme)
Marker types (`poi.js`): home `#2e7d32`, hotel `#6a4fb3`, takeoff `#1565c0`, landing `#8d6e63`, photo `#c2185b`, train `#00796b`, airport `#039be5`, hazard `#e65100`, residence `#827717`, other `#546e7a`. Trip colours (`TRIP_COLORS`, `poi.js`): `#e91e63 #3949ab #00897b #fb8c00 #6d4c41 #546e7a #7cb342 #8e24aa`. Friend palette (`livemap.js` `PALETTE`): `#e53935 #8e24aa #1e88e5 #00897b #f4511e #6d4c41 #3949ab #c0ca33`. Zone fills (`map.js` `FILL`): allow `#2aa6b8`, restrict `#d64545` (duplicated in the legend, `main.js:302-303`: planned single source, P7). Ranks `--rank-1..10`, rarities `--rar-*` (`styles.css`, bottom). Location dot `#1a73e8` (CSS `.you-dot` and `locate.js` ring: to become `--info`). These are not themed (DECISIONS.md, colour theme). **Fix contrast around them** (outline, text colour, the label inside), never by changing the hue, unless the owner decides.
**Friend pins (2026-11-13):** a live pin for a friend (`.live-pin.friend`) has a rounded-square avatar (9 px radius) instead of a circle, the word "Friend" at the start of its label and a dashed accuracy circle; no new colour, the identity colour and rank ring work as for party pins. Not yet in the screenshot set.

**Rank indicators (owner decision 2026-11-13):** keep the palette; one subtle, consistent outline (`--rank-edge`) on rank badges and rings for contrast in both themes (P1, built). The ten colours are unchanged. Screens `rank-rings` (27) in the screenshot set draw all ten tiers as badges and live pins.

## 8. Themes
`theme.js` writes the resolved theme to `<html data-theme>`; `index.html` runs the same few lines before first paint (`tests/theme-unit.mjs` keeps them equal). Dark values: the `:root[data-theme="dark"]` token block at the top of `styles.css`, plus three small dark-only rules: `:root[data-theme="dark"]{color-scheme:dark}`, the `.base-tiles` filter (dark basemap = light OSM tiles inverted by a CSS filter, base layer only), and `--rank-9`. Rules: a new colour is a token with a dark value; no `@media (prefers-color-scheme)` in components; test both themes.

## 9. Responsive and mobile
Breakpoints (documented, current): **phone <= 520 px** (bottom sheets: `.sidepanel`, `.dash`, `.account-pop`), **compact <= 760 px** (rail icons only, search shortens), 420 px (splash choices stack), touch + height <= 900 (dashboard expand button). No tablet tier (761-1024 uses the desktop layout: checked in the baseline screenshots `tabport`, `tabland`). Phone sheet sizes: panel 62vh (max 560) / `tall` 90dvh; dashboard max 54vh / `tall` 90dvh; account sheet 85vh; marker window: sized to fit above the pin (collapsed) or 60% of the screen (expanded, 85% on a computer) (`src/view.js`). **Do not change these without the owner.**
Rules: touch hit area 44 px (grow the target with padding or `::after`, not necessarily the glyph; `.checkin-btn` is the existing example); inputs 16 px on `(pointer:coarse)` to stop iOS zoom (P5); bottom safe-area padding on sheets and dialogs; no information carried only by colour; never rely on hover.

### Dialog sizing and unfolded phones (2026-11-14)
- **Never size a fixed-position or modal overlay from `vh`.** On Android Chrome `100vh` is the height with the toolbar hidden. A modal `<dialog>` taller than the visible area is centred by its auto margins with negative values, so its header and close button end up above the screen. (Measured: visible area 850x620, dialog sized from a 700 px `100vh`: dialog top -24 px, close button -11..25 px.) Use `%` of the dialog's containing block (`max-height:calc(100% - 32px)`), or `dvh` with a `vh` line before it. `.ses-hub` and `.profile-dialog` use `%`; `.account-pop` uses `dvh` with a `vh` fallback. The map shell is `html,body{height:100%}`, so absolutely positioned pieces (panel, dashboard) already follow the visible area.
- **A touch-first screen gets a sheet, not a desktop dialog:** `(max-width:520px), (pointer:coarse) and (max-width:900px), (pointer:coarse) and (max-height:520px)`. This is how an unfolded foldable (about 700 to 850 wide) is told from a mouse window: width alone is not enough. The Sessions hub is the first user. It follows `visualViewport` (`--ses-vvh`, `--ses-vvtop`, set in `sessions-hub.js`) so the on-screen keyboard and a moving toolbar do not cover its header, tabs or the Create/Cancel row.
- **Columns follow the room a component has**, not the screen: the hub body is a size container (`container:ses/inline-size`); `@container ses (min-width:560px)` gives Discover three filter columns, `(min-width:600px)` gives the New session form two columns. Header and tabs are `flex:none` outside the scrolling body, so they never scroll away; the form's action row is `position:sticky` at the bottom of the body.
- Not changed: the side panel (380 px, map stays visible), the dashboard (existing foldable rules, centred beside the open panel) and the phone breakpoints above. Browser suite `responsive` covers the hub, account popup, panel and dashboard on nine viewports; it emulates touch, size and a fake `visualViewport` only.

## 10. Accessibility: facts and known issues (verified 2026-11-13 from the token values, WCAG 2 luminance)
| Pair | Light | Dark | Needs | Status |
|---|---|---|---|---|
| `--fg` / `--bg` | 16.5 | 13.8 | 4.5 | ok |
| `--muted` / `--bg`, `--surface-2` | 5.5, 5.0 | 7.2, 6.3 | 4.5 | ok |
| `--accent` text on `--bg` / `--surface-2` | 4.9 / 4.5 | 7.7 / 6.7 | 4.5 | ok (light on surface-2 is borderline) |
| `--accent-fg` on `--accent` | 4.9 | 7.8 | 4.5 | ok |
| white on `--danger` (old) / on `--danger-solid` (now) | 5.6 / 5.6 | 2.5 / **4.8** | 4.5 | **fixed in P1** (dark fill `#d03a35`) |
| white preset-avatar glyph on its disc (`hsl(h 52% 36%)`, 20 hues) | worst 3.6 | same (not themed) | 3 | **ok.** The phase 0 review wrongly listed this as 2.1:1 on `--accent`; preset avatars never sit on `--accent` (letter avatars use `--accent-fg`). Retracted |
| `--ok/--no/--unk` on their `-bg` | 4.7 to 5.7 | 6.5 to 8.2 | 4.5 | ok |
| `--line` vs `--bg` (control edge) | **1.25** | **1.42** | 3 (controls) | `--line` is now only for dividers; controls use `--control-border` (3.5 / 3.9 on the page): **fixed in P1** |
| switch track vs `--bg` | 1.9 -> **3.5** | 2.6 -> **3.9** | 3 | **fixed in P1** (track = `--control-border`) |
| rank colours vs surface | ranks 1,2,4,5,6,10 = 2.4-3.0 (**below 3**) | rank 7/8/9 = 3.9/3.0/2.8 (9 already overridden) | 3 (graphic) | **fixed in P1** by `--rank-edge` (hues unchanged); the `--rank-9` comment in `styles.css` now says so |
Other known gaps: touch targets 18-30 px (only `.checkin-btn` extends its hit area); one `pointer:coarse` rule; no `forced-colors` rules; inputs 14 px; native `title` tooltips do not show on touch; 39 text declarations at <= 11.5 px. Not verified: screen readers, a real phone's touch accuracy.
Good and to keep: global focus ring, `prefers-reduced-motion` handling, accessible names on icon buttons (`.tool-label`, `.sr-only`), `color-scheme`, native `<dialog>`.

## 11. Map UI
Popups (frosted glass via `--pop-alpha`), scale, attribution and Leaflet bar buttons follow the theme; `!important` in the Leaflet skin is deliberate (Leaflet's CSS is more specific). Markers, zones and routes keep identity colours. Do not add filters or blur beyond today's two (popup blur, `.base-tiles` filter): filter cost on a weak phone or a rotated map is still unmeasured. Check on the filtered dark map: `.crosshair` (`#111`), `.dist-label-text` border (`#888`).

## 12. Phases (owner approved the direction 2026-11-13; each phase from 1 on needs approval after review)
| Phase | Scope | Visible | Status |
|---|---|---|---|
| 0 | Baseline screenshots, this file, doc fixes | no | **done** |
| 1 | Contrast and state fixes (`--danger-solid`, rank outline, `--control-border`, disabled, hover gating, contrast test) | small | **done** (validated 2026-11-13: after-p1 screenshots, contrast test, full npm test) |
| 2 | Token layer, pixel-identical (diff must be empty); duplicate rules removed | none | **done** (258 screenshots identical to after-p1) |
| 3 | Typography and hierarchy (scale, section title vs eyebrow, weights) | yes | **done** (after-p3 screenshots, 298 incl. stress content; targeted suites pass) |
| 4 | Controls and proportions (+2-3 px, roomier dialogs, per-category sizes) | yes | **done**: `.btn` 33 to 36 px, `.btn.small` 27 to 29, `.icon-btn` 34 to 36 (34 in the panel header), tabs +2 px, number-field buttons 38 (match the input), card padding 12/14 to 12/16, dialogs 18 to 24, popovers 14 to 16, section summaries 8/10 to 10/12, popup radius 20 to 18, rail radius to pill (identical), icons 14/17/19 onto 16/18. Found by the full suite: P3's tab font 12.5 to 13 pushed the panel's close button out of the header (`tests/shell.mjs`); tabs are now 12 px |
| 5 | Mobile ergonomics (44 px targets, 16 px inputs, safe areas) | phones | **done**: one `@media (pointer:coarse)` block at the end of `styles.css`. Tap targets grow past the drawn control with `::after` (44 px tall for buttons, tools, chips, pop-up toggles and icon buttons; a few are 44 x 30 because neighbours share the width), 16 px text in fields, map buttons 36 px with a 6 px left margin, tabs 40 px tall, grab handle 48 x 32, checkboxes 24, range inputs 28 tall, bottom safe-area on the phone sheet. **Not done and why:** the rail stays 40 px (44 px made it 20 px taller and it then covered the marker window's Next button, `tests/stops.mjs`); map buttons are 36 not 40 (a 40 px stack hid the start of a marker window's title and more of the stack under the phone sheet); tabs stay 30 px wide on a phone (the header is full); hit areas cannot be enlarged inside `overflow:hidden` parents (tabs, Leaflet bar). `tests/swipe.mjs` now starts its body swipe on the first card's title instead of a fixed offset (the browser's touch adjustment snapped to the country box once fields were taller) |
| 6 | Hierarchy of dashboard, profile, progression, sessions, friends | yes | **done**, CSS only (one block at the end of `styles.css`, no markup or JS change): the rank name is Head (18) with a thicker bar and the Progression section is titled 16 bold while Steam steps back (muted, medium); the dashboard trip card gets an accent top edge; session titles are semibold and Manage becomes a ghost button (RSVP was already the single primary); friend rows are 52 px tall; destructive buttons carry a danger-tinted border and a tinted hover. Already satisfied and left alone: the rank badge is 40 px, XP is 18, friend avatars are 34 |
| 7 | Consolidation (pills, fields, dialog shell, messages, identity-colour registry) | minimal | **done**, pixel-identical (298 of 298 screenshots equal to after-p6): the pill family shares one rule for edge, shape, cursor and weight (JS classes unchanged, so no aliases were needed); the zone fills and the location blue each have one source, `--zone`, `--zone-restrict` and `--info` in `styles.css`, read by `map.js` (`zoneFill`), the legend in `main.js` and `locate.js`. Field and dialog selector lists were already merged in P2/P4. **Not done:** the `.msg` message class (six classes with different margins, no value without changing markup in five files); the planned `--shadow-pin` (one use) |
| 8 | Final audit (screenshots, contrast test, performance) | no | **done** (data in section 15; the owner's real-device pass is still open) |
Phases 3 to 6 need the owner's approval of the before/after screenshots before they are committed. The owner does the final real-device pass; automated screenshots, browser tests and regression checks are ours.

## 13. Screenshot baseline and regression workflow
Tool: `scripts/ui-baseline.mjs` (drives the running app like the browser suites; changes nothing in the app). Output goes **outside the repository** to `~/UAV_UI_Screenshots/<label>/` (override with `--out`), so nothing is committed.
```
npm run dev                                         # the app on :5173
node scripts/ui-baseline.mjs --label baseline       # all viewports x light/dark (about 25-35 min with --jobs 3)
node scripts/ui-baseline.mjs --label after-p3 --vp desk,phone --only popup,panel
node scripts/ui-baseline.mjs --compare baseline after-p3   # per-file pixel difference, writes diff_<a>_vs_<b>.json
node tests/run.mjs --unit contrast                          # token contrast pairs and the hover/fallback guards
```
Viewports (fixed): `desk` 1440x900, `tabland` 1024x768, `tabport` 768x1024, `phone` 390x844, `phones` 360x640; touch on all but `desk`; theme forced per run; scale 1. File names: `<viewport>_<theme>_<NN>-<screen>.png` (NN is the screen's position in `SCREENS`; do not reorder, append new screens at the end so numbers stay stable for comparison). Each run writes `manifest.json` (browser version, clock, failures) and `index.html`, a contact sheet with light beside dark and the **priority** screens (marked `prio`, desktop and phone only) first for manual review.
Determinism: fixed browser date (2026-11-13 10:00 +08, then running), `Asia/Singapore`, `en-GB`, reduced motion, placeholder map tiles (no network: everything not on localhost is blocked), fixed seed data (9 markers, 3 trips, in `ui-baseline.mjs`), a mocked Supabase on in-memory Postgres for signed-in screens, friend codes masked. Sessions are seeded for March 2027 because the database cannot be given a fake "now"; **re-date them in the script after March 2027**. Baselines are only comparable on the same machine and browser build (fonts and rendering differ otherwise); regenerate `baseline` if either changes.
Not covered: live friends' pins with the rank ring, weather card, real map tiles, a scrolled-down panel, hover/focus states, a real phone. Add screens at the end of `SCREENS` as needed.
Per-phase validation: before/after screenshots for both themes and the five viewports; `--compare` must report zero differences for a phase that claims "no visual change" (P2); stress content (long names, CJK, many items) before P3/P4; automated checks planned for P1-P5 (contrast pairs in a unit test, minimum hit area at 390 px, text-size floor, overflow); performance: the count of `box-shadow`/`filter`/`backdrop-filter` rules must not rise, and a CPU-throttled trace of panel open and map pan before/after P4 to P6; then `/test-impact` while iterating and the full `npm test` before each commit (AGENTS.md).

## 14. Decisions (owner, 2026-11-13)
1. Genuine card/section headings become 16 px normal case; small uppercase stays for secondary labels and metadata.
2. Rank palette unchanged; subtle consistent outline on rank indicators where needed, both themes.
3. Modest +2-3 px on controls and roomier dialogs are approved; keep different sizes for different control categories (no single height).
4. Owner does the final real-device pass; automated browser tests, screenshots and regression checks are ours.
5. Screenshots live outside the repository or in a git-ignored folder, with consistent names and viewports (section 13).

## 15. Final audit (phase 8, 2026-11-13)
Measured on one machine and browser build (Chrome 157), app on :5173, files in `~/UAV_UI_Screenshots/` (`checks_original.json` and `perf_original.json` are the pre-phase-3 CSS; `checks_final.json`, `perf_final.json` and `after-p8/` are the end state). Re-run with `scripts/ui-checks.mjs`, `scripts/ui-perf.mjs`, `scripts/ui-baseline.mjs`.
| Check | Original | Final | Note |
|---|---|---|---|
| Phone tap targets under 44 px reach (list of failures, 28 runs) | 540, median reach 29 px, 364 under 30 | 510, median reach 35 px, 82 under 30 | Better, **not at 44**. Still short by design: the Leaflet bar and map buttons (36 px), tabs and header icons (`overflow:hidden` parents, section 12 phase 5) |
| Text under the size floor (all runs) | 172, smallest 10.5 px | 112, smallest 11 px | Remaining items are 11 px labels (sequence numbers, crosshair label, badges) |
| Truncated text | 146 | 146 | Unchanged: the same ellipsis spots as before, none new |
| Horizontal page overflow | 0 of 56 | 0 of 56 | |
| `tests/contrast-unit.mjs` | | 35 pass | Both themes, token pairs, hover and fallback guards |
| CSS size (bytes / gzip) | 84,333 / 18,271 | 92,738 / 20,377 | +10% raw, +2.1 KB gzip (token blocks, coarse-pointer block, hierarchy block) |
| `box-shadow` / `filter` / `backdrop-filter` rules | 38 / 11 / 6 | 41 / 11 / 6 | Filters and blur did not rise. Shadow rules +3 (cause not traced); the plan's rule was "must not rise", so this is a deviation the owner may accept or ask to trace |
| Style recalc / layout / task time, 4x CPU slowdown (median of 5) | 425 / 324 / 2404 ms | 435 / 272 / 2352 ms | No regression; frame gap median 8.3 ms, p95 8.5 ms in both |
`ui-perf.mjs` times a scripted session (panel open, popup, dashboard), not a map pan on a real phone. Not covered: forced-colors (no rules exist), screen readers, tab order, a real device. Owner pass still to do on iPhone Safari and Android Chrome: tap accuracy on the 36 px map buttons and 30 px tabs, the 16 px field text, dialog roominess on a 360x640 screen, the dark map filter cost.

## 16. Form and detail layout (aesthetic pass, 2026-11-14)
Built for the Sessions hub; reuse for new forms. CSS: the block "Form and detail layout in the hub" in `styles.css`.
- **One centred column.** A form or detail view adds `.ses-narrow` to `.ses-hub-inner` (max 600 px, centred). Lists keep 720 px. Short controls stay short: capacity 160 px, repeat picker 260 px, count 150 px, Discover search 260 to 360 px, filter selects 150 to 220 px (a wrapping flex row, not a grid).
- **Field = `.ses-field`:** label (`.fr-label`, margin 0), control, optional `.hint` (margin 0), 4 px apart; 12 px between fields.
- **Sections are flat:** `.ses-sec` = eyebrow `h4` + fields, divided by a hairline (16 px above). No bordered card inside a bordered card; a tint (`--surface-2`) is allowed one level deep (`.ses-pin`, `.ses-public-warn`); the repeat block hangs off a 2 px left rule.
- **Two-column controls follow the container, not the screen** (`@container ses`): date, start and end in one row from a 480 px container, else date then two times; the two visibility choices are cards in two columns (one column under 420 px).
- **Choices as cards:** `.ses-vis > .ses-radio` (1.5 px border, accent border and `--accent-soft` when checked, like `.radio`). Checkboxes and radios must never inherit `width:100%` (bug fixed here: `.ses-form input` stretched them).
- **Action row:** `.ses-actions`, sticky at the bottom of the scrolling body: secondary (Cancel) first, primary last and wide (max 220 px on wide containers, fills on phones). Buttons in cards and detail views are content-width (min 88 px).
- `input[type=time]` shares the control look of `input[type=date]`.
- Reviewed and left unchanged: side panel cards, dashboard, account and profile dialogs, popups (their field widths already follow the 380 px panel and read as balanced).

## 17. Map actions and the sessions map explorer (2026-11-14)
> **Superseded in part by section 20 (2026-11-14):** a marker or point-check window now has ONE `Navigate` action (no Open in), and session cards have no `Map` button (the card body selects or opens the explorer). The outlined style, sizes, explorer layout and centring rules below still hold.
Spec: `FLIGHT_SESSIONS_MAP_EXPLORER.md`. CSS: the blocks "map actions" and "the sessions map explorer" at the end of `styles.css`.
- **Map action = `.btn.map-action`:** outlined (1.5 px `--control-border`), icon (16 px, `currentColor`) + visible text, accent text, `--accent-soft` on hover, wraps instead of clipping, 32 px tall (44 px on `pointer:coarse`). Built only by `maplinks-ui.js` (`actionControl`): an external `<a class="maplink" target="_blank" rel="noopener noreferrer">`, a Home confirm `<button class="maplink">` (text becomes "Tap again to share", class `armed share`), or an internal `<button>` (Map; never a `.maplink`). Marker windows and point-check windows: **Open in <app>** and **Navigate in <app>** (both external); session cards: **Map** (internal) and **Navigate** (external) plus **Details** (`.btn.small`). Do not draw new map links by hand.
- **Explorer dock `.ses-explorer`** (`position:fixed`, `--z-sheet`, outside the Leaflet container, so the map is never inert and its size never changes): `data-mode=side` when the viewport leaves at least 320 px of map beside a dock of `clamp(36% of the width, 300, 360)` px (so from about 620 px up: unfolded phones, tablets, desktop), else `bottom` (a sheet of 30 to 40% of the visual-viewport height, safe-area aware). Opacity-only entry animation, so measured rectangles are final. Header: heading (focus target), **Expand** (back to the hub), **Collapse** (header only), **Close**; 44 px targets on touch.
- **Cards:** the summary is a `<button class="ses-xsel">` (focusable, Enter or Space selects; `aria-current` and `.selected` mark the choice) and the action row is a sibling, so no interactive element is nested; a click anywhere on the card outside `.ses-xactions` selects. Selection is click-only: scrolling never selects.
- **Free map area:** container rectangle minus the dock (a side dock trims left, a bottom dock trims the bottom) minus the open side panel. The panel steps aside (not saved: `panel.suspend()`) only when less than 320 x 200 px would be left. The map's own left controls and the search box shift by `--ses-x-off` (`body[data-sesx]`). Centring maths (rotation-aware, because the map pane is turned about the container centre): new centre = `unproject(project(marker, z) - Rot(bearing)(freeCentre - containerCentre), z)`; `map.getCenter()` is not the measure, the marker's screen position is.
- **Markers:** one per place (several occurrences at one place share a marker with a count badge; tapping it steps through them), selected one ringed, title and alt carry the selected occurrence's date.

## 18. Map tool labels, hints and orientation (UX discoverability, 2026-11-14)
> **Superseded in part by section 20 (2026-11-14):** the tag button, `#map-tool-labels` and the dashboard *Help card* / *Tips* are gone, replaced by the More tools menu and the Help subview. Hints, the orientation steps and the once-per-feature rules below still hold.
- **Tag button** `a.labels-btn[data-tool=labels]`: the last button of the left column (it re-appends itself below buttons that arrive later, such as Flight sessions). Same 30 px (36 px coarse) bar as its neighbours; `aria-expanded`, `aria-controls=map-tool-labels`. Expanded state is page memory only.
- **Labels** `#map-tool-labels .tool-label-row`: a layer over the map (`--z-tool-labels` 999, `pointer-events:none`, `aria-hidden` rows) placed from each button's own rectangle (level with it, 6 px to its right), so no Leaflet control is cloned or moved. Each button is identified by `data-tool`; the text comes from `map-tool-labels.js` and follows `aria-pressed`. The +/- zoom buttons are not labelled (their labels would sit under the search button). The layer steps aside while a marker is placed (`.is-placing`) or a session point is picked (`.ses-bar`). On short coarse screens (max-height 480 px) the buttons are 3 px apart so nine fit above the scale bar.
- **Hints** `.help-hint`: one card at a time (accent border, `--accent-soft` fill, role status, one *Got it* button, Escape dismisses). In a panel pane it is the first child; on the map (`.on-map`) it sits bottom-left above the scale bar; in the Sessions dialog it sits under the tabs. Marked seen after 1.5 s on screen or on dismissal.
- **Orientation** (Quick Setup): optional link *Learn the map* under the task cards; three steps, each with Next, Back and Skip; ends on the task choice.
- **Help card**: *What do you want to do?* shortcut buttons above the steps; *Tips for each feature* `<details>` below them.

## 19. POI Explorer: Add a marker, type picker, folding list (2026-11-14)
- **Add a marker** is a `details.card.add-card`, folded on every load; the header is the whole row (title, one muted line "Tap to choose a type and place it on the map", a + or minus). It opens by itself when placing or edit mode starts, so the controls that end a mode are never inside a folded card (the banner has its own Cancel too).
- **Type picker:** four group buttons (`.type-tabs .chip`, `aria-pressed`, a dot on the group that holds the chosen type) over the radio buttons `.type-btn`; only the open group is shown, all 16 stay in the DOM, and "Chosen: X" names the choice. The groups are presentation only (`TYPE_GROUPS` in `poi.js`), never stored. Not `role=tab`: that is the panel's own tab pattern.
- **Saved list folding:** trip and day headings carry `.sec-toggle` buttons (`aria-expanded`, chevron drawn in CSS so the heading text is the label). Folded rows get `hidden` and stay in the page, so reorder and the keyboard see one list. Folding is list-only and in memory. Selecting markers, a type filter or a trip filter shows everything (buttons disabled) and gives the folds back afterwards. `.out-tag` marks a day outside the trip dates; `.unlinked-head` introduces Side Quests with no main stop. Touch targets for `.sec-toggle` are 36 px.
- Tests: `picker`, `hierarchy` (browser, start folded via `addFolded` and `listFolded` in `tests/lib.mjs`), `poi-types-unit`, `poi-model-unit`.

## 20. Wave 1: focused dashboard, Help subview, More tools, contextual legends (2026-11-14)
Spec: `DASHBOARD_TOOLBAR_VISUAL_REFINEMENT.md` (sections 1 to 11, 14). Frontend only, existing tokens only; no gradients, glows, extra shadows, blur or fonts.
- **Shared patterns (foundation for the later visual wave):** cards are `--surface` with a 1px `--line` border and 12px padding; a section heading is `--fs-body` bold, support text is `--muted` at 12px or more; one primary action per context (`.btn.primary`), the rest outlined or quiet; icons are 16 to 18px SQUARE with `flex:none` and explicit `width`/`height`; 44px targets on `pointer:coarse`; state is never colour only (rows say On/Off, Shown/Hidden in words).
- **Dashboard (`dashboard.js`):** default view = greeting, the task row `.dash-tasks` (Check a location, Plan a trip, Save a place, Find sessions only when the build has accounts; ids `task-check`, `task-trip`, `task-save`, `task-sessions`), the Route card while selecting, the next trip (with a folded *What do the lines on the map mean?*), then only what needs attention (friend requests, a session soon or invitations, a full-storage alert, a backup reminder, What's new), *Fly in* and a folded *Your data* row (export, import, share link, cloud status). No empty cards: no trip means no trip card, no sessions news means no sessions card. Save a place opens Points of Interest and unfolds Add a marker through `poi.openAdd()`; `poi.focusSearch()` puts the cursor in the saved-places search (used by *Find saved places* in Help); neither touches the chosen type, query, folds or visibility.
- **Help subview:** the ? button swaps the drawer body between `dash` and `help` (in memory, never stored; `help-open` opens straight into Help). Heading `#dash-help-title` (focused), `#dash-back`, six `details.dash-topic` (unfolded state kept across redraws) holding the existing hint replays by id (`data-replay`), the actions that left the dashboard (Check where I am, crosshair, Save a place, Find saved places, Open Map Configs, Run the quick setup again, the nearby-sessions switch) and the map key and coverage note. Scroll is remembered per view. Leaving the dashboard marks What's new seen only if it was actually shown.
- **More tools (`map-more-tools.js`):** `a.more-btn[data-tool=more]` is the last left-hand button (30px, 36px coarse); Zoom, Locate and the conditional Compass stay direct. `#more-tools-menu` rows (`.more-row[data-tool]`, `aria-pressed` when the tool has a state, a `.more-state` word) press the tools' own folded controls (`.leaflet-control.tool-folded{display:none}`): no clone, one handler. Popover beside the button on roomy screens; sheet (`.sheet`, `--z-sheet`, safe-area padding) at max-width 520px. Display toggles keep it open; Flight Sessions closes it and focus returns to the button. Outside press and Escape close it; it closes while a marker is placed or a point picked. Global switches only: `hideTrips` and `showSide`; per-trip `tripHidden` and `unassignedHidden` are never read or written here.
- **Contextual legends (`legends.js`):** a folded *What does this mean?* under the verdict in point-check and marker windows. It uses the region's semantics: `allow` (teal, suitable-flight) and `restrict` (red, restricted) are never mixed, named classes list their colours, and outside coverage it says unknown is not permission. The verdict, its detail line and the disclaimer stay visible outside the fold.
- **Sessions cards:** the title is the one control (`.ses-row-open`, its `::after` covers the card) so no control nests in another; it opens the explorer on that session, or Details when there is no meeting point. Navigate and Details are separate and stop propagation. The explorer card selects and centres (unchanged). One Navigate (`.map-action`, 16px square icon) replaces Open in and Navigate in; the name reads `Navigate to X in Google Maps`. Route buttons (`routeLinks`) keep their wording.
- Tests: `toolbar` (rewritten), `dashboard`, `discover`, `helppoi`, `sessions`, `sessions-explorer`, `maplinks`, `search`, `tools`, `help-unit`.

## 21. Wave 2: trips, shared panel header (2026-11-14)
Spec: `DASHBOARD_TOOLBAR_VISUAL_REFINEMENT.md` section 12 (Wave 2) and 16. CSS only (block "Wave 2" at the end of `styles.css`); no markup, behaviour or token change.
- **Trips and itinerary:** a trip card and the trip detail had five or six equally outlined buttons. Now one filled action (Open), soft actions (`--surface-2`, no outline; accent border on hover) and Delete keeps its red outline (`.trip-acts .btn:not(.primary):not(.danger)`). The shared-trip members box (`.trip-party`) is a hairline row inside the detail card, not a second outlined box; Notes and Checklist are separated by a hairline and 16px.
- **Shared panel header:** with the Friends tab present, the selected "Points of Interest" tab pushed the collapse button 18px past the panel edge above 520px wide (the compact header rules applied only below it). The phone header (30px icon buttons, 4px gap, 30px icon tabs, 8px selected padding) now applies at every width. Touch targets keep the `::after` inset of `.icon-btn`.
- **Screens measured and left alone (they already meet the section 20 patterns):** Map Config (cards, fields, switches, radio cards), the POI Add a marker card and picker, the saved list (rows, group headers, glyphs, selected state), Privacy settings. A small hover difference remains (`.poi-item` accent-soft, `.plan-stop` surface-2); not changed because both are intentional selection cues. Not examined: Friends, AI import, Account, Progression, Sessions forms (P2) and weather/toast (P3).
- **Baseline tool:** `scripts/ui-baseline.mjs` gains viewports `p412` (412x915), `w700`, `w850`, `land` (844x390; opt-in with `--vp`) and screens `stress-trip-detail`, `config-open`, `trip-open`, `poi-saved` (appended, numbering unchanged). The `privacy` screen is captured mid-slide and differs between runs.

## 22. Wave 2: social, account, sessions and AI import cards (P2), status feedback (P3) (2026-11-14)
Spec: `DASHBOARD_TOOLBAR_VISUAL_REFINEMENT.md` sections 12 and 16. CSS only (blocks "Wave 2, P2a" to "P2d/P2e" at the end of `styles.css`); no markup, behaviour, consent, privacy, schema or permission change; existing tokens only.
- **Audit:** 47 screens x 5 viewports x 2 themes captured before the change (label `w2b-before`, 458 shots). New baseline screens: `party-unshared`, `party-shared`, `ai-card`, `ai-preview`, `ai-error`, `cloud-card`, `privacy-open`, `ses-hub`, `ses-mine`, `ses-create`, `weather-card`, `weather-error` (the banner is `placing-banner`).
- **The one pattern applied:** the Trips rule, one filled action per card and the other actions soft (`--surface-2`, no outline, accent border on hover); `.danger` keeps its red outline. Scopes: `#pane-friends` and `#trip-detail .trip-party` (P2a); `#account-pop`, `#privacy`, `#cloud-card` (P2b); `#ses-hub` and `#ai-card` (P2d, P2e). Exceptions: buttons inside the Progression and Steam cards (`.prog-card`, `.steam-card`, on `--surface-2`) keep the outlined look because a soft button would vanish there (P2c, rank and rarity colours untouched); `.map-action` (outlined Navigate and Map, section 20) is kept.
- **Left alone (already meet the patterns):** weather card, toast, `#banner`, splash, achievements and XP history, Edit profile, the sessions hub and New session form layout (sections 9 and 16), profile popover.
- **Baseline tool:** the mocked server is per viewport and theme (parallel jobs no longer share one database), cleared of cloud copies at the start of every signed-in screen; more set-returning RPCs are listed so trips, party members and sessions load; `localData` and `trips` open options; the weather card uses a mocked Open-Meteo reply.
- **Not covered:** session cards with data and invitation rows (nothing seeded), a shared trip with several members, real phone, Safari, screen reader, 200% zoom.
