## 2026-11-27 - Community Flying Areas Phase 1 released
- Private local polygons/rectangles, point editing, Pilot setup spots, validated GeoJSON import/export, and My flying areas in More tools are live. Source `5f59089`; gh-pages `a7634ed`; successful Pages run `45915229886`; live HTML and 10 referenced JS/CSS assets match the build. Existing accounts, feature flags, custom domain and all 33 airspace regions retained; no backend change.
- Phase 1: 203 unit checks and 99 browser checks pass, including 99 against the production build. Full regression: 191/212 suites passing, 21 failures; unit baseline comparisons and residual limits in `CURRENT_STATUS.md`. Further phases remain unstarted.

## 2026-11-26 - Profile visible on first open
- Reposition the account panel when asynchronous progression/Steam content or section toggles change its size. A delayed first progression response now stays within the viewport, with the same geometry as a cached reopen on desktop, tablet, unfolded phone and folded phone (24 regression checks). No styling, backend or region-data changes.

## 2026-11-26 - Feature-rich privacy defaults and copy
- New browsers: automatic weather (rounded coordinates), ground elevation, AI place-name lookup, marker check-in on; nearby public sessions on while signed in. Live sharing and automatic attendance still need explicit consent. Existing browsers keep their choices (migration). Live-sharing consent dialog with Keep off. First-time notice and `privacy.html` rewritten; mascot removed from the profile popover.

## 2026-11-26 - Unified touch gestures
- Swipe added to the top-right cluster, search header, More tools sheet, route summary, Sessions explorer fold and the phone panel's expand handle, all through the existing `onSwipe()` and each component's own state function. Smaller disclosures (Saved Places groups, Side Quests, trip warnings, profile sections, Help) stay tap-only (scroll conflict). Details: DESIGN.md section 26.

## 2026-11-26 - Malaysia airport traffic zones (66)
- 5 NM circles around AIP ARPs (CAAM SI 11/2022, MCAR 2016 reg. 140(1)(b)); class "Airport traffic zone — authorisation required" under P/R/D. 2 unresolved (WBKE, WMAE). Merge `8228974`, gh-pages `0160734`, rollback `de13c55` / `7c8fb77`. Details: `docs/regions/my-enr51.md`.

## 2026-11-26 - Vietnam ENR 5.1 complete (74/74)
- VVR19, VVD43, VVD45 added as approximate layers (provenance and notice in-app); 71 exact areas unchanged. Merge `bc1f7af`, gh-pages `9300888`, rollback `c5fb712` / `43a4692`. Details: `docs/regions/vn-enr51.md`.

## 2026-11-25 - Prefer the Amap app on phones
- China Navigate and Open in Amap actions now try the native app directly on Android and iPhone, with a browser fallback. Route stops, travel modes, coordinate conversion, Home confirmation, copied links and desktop behavior are preserved. Source `39bbe09`, gh-pages `9b973af4`; deployed with the existing live flags and backend build configuration; all 33 published regions retained.
- Focused validation: 90 unit checks, 14 new mobile browser checks, 34 existing map-link checks and 20 controls checks passed. Live Android/iPhone user-agent checks passed against the served release. Actual installed-app handoff still needs phone verification. Full-suite failures and release evidence: `CURRENT_STATUS.md`.

## 2026-11-24 - Vietnam ENR 5.1
- `vn-enr51` (71 of 74 areas, AIP Viet Nam 2026-10-01-AIRAC) released in `33d1a04`, gh-pages `dfae17e`; VVR19, VVD43, VVD45 unresolved. Details: `docs/regions/vn-enr51.md`.

## 2026-11-24 - Malaysia ENR 5.1 second pass
- 15 more areas recovered from navaid/ARP/waypoint references; Singapore (8) and Brunei (14) administered areas excluded; now 57 of 86 Malaysian-administered areas. Commit `551da2c`, gh-pages `ad75cc95`. Details: `docs/regions/my-enr51.md`.

## 2026-11-24 - Malaysia CAAM ENR 5.1 prohibited, restricted and danger areas
- `my-enr51` (61 of 108 numbered areas, AIP AMDT 04/26) released in `8c18781`, gh-pages `bc81bfab`; P/R/D worded separately, disclaimer extended for all countries. Backlog: `docs/backlogs/completed/MALAYSIA_AIRSPACE_ENR51_BACKLOG.md`.

## 2026-11-15 (Mascot and personality integration, Phases 0 to 2)

## 2026-11-15 ? Sichuan coverage replacement
- PR #11 merged `ad25a34`, production `6dd8ede`: 468 original unmasked KDji polygons replace Chengdu. All 57 former source features and seven unaffected regions preserved. Google OAuth retained; focused source/point/rendering, preflight and OAuth checks pass. Live artifact hashes, all 468 interiors, outside-Chengdu pixels/point metadata and Google provider redirect verified. No acquisition/GEOS repeat or provider/database change. [Release evidence](../../docs/china-airspace/evidence/sichuan-release.json).
- New app icon and web manifest; mascot on the quick setup, dashboard greeting, Help header and the empty Trips, Saved Places and Discover states. Decorative only. Thumbs-up celebration deferred (needs a server-side milestone signal). Backlog `backlogs/in-progress/MASCOT_PERSONALITY_INTEGRATION.md`.

# Changelog

## 2026-11-15 (Flight Sessions Discover backlog completed; Wave E descoped)
- Backlog `backlogs/completed/FLIGHT_SESSIONS_DISCOVER_AND_AUTO_ATTENDANCE_BACKLOG.md` closed by the owner: waves A to D released, Wave E (canary, flag flip, real phone) cancelled pending an architecture review. `auto_attendance_enabled` remains 0; residual risks stay in its section 13. Documentation only.

## 2026-11-15 (Flight Sessions automatic attendance app side, wave D; still off in the database)
- New Privacy card with an off-by-default switch (the server records the consent first), one foreground position sampler (30 to 60 s, only while a joined session is under way and the page is visible, stops after the award, on sign-out, opt-out, denied permission and hidden page), a progress line in the session detail and a toast only after a server-confirmed award. `auto_attendance_enabled` stays 0, so nothing is sent in production.

## 2026-11-15 (Flight Sessions automatic attendance backend, wave C; switched off)
- Migration `20261119110000_session_auto_attendance.sql`: consent and probe tables without coordinates, `submit_session_arrival`, `source = 'auto'`, settings for every threshold, admin bulk revoke by time range, audit actions, place and times frozen once a session starts. `auto_attendance_enabled` = 0: nothing awards XP.

## 2026-11-15 (Flight Sessions people and XP badge, wave B2)
- Migration `20261119100000_sessions_people_xp.sql`: `xp_reward` on the session lists, `list_session_participants` and `request_friend_from_session` (random per-session handles), the "Show me in attendee lists" switch. Discover rows, explorer cards and the detail show one server-fed XP badge; the host and everyone listed open the profile popover (Add friend for non-friends; "In your friends list" for friends). Reverses "RSVP names are managers-only" (DECISIONS).

## 2026-11-15 (Flight Sessions Discover, wave A)
- Discover: date filter gains **Today (your time)** (from now to the next local midnight minus 1 ms, DST-safe; no SQL change), cached rows that have ended are dropped and the list is re-checked at the earliest end time, and `Has space` no longer shows a false empty state or hides `Show more`. Backlog `FLIGHT_SESSIONS_DISCOVER_AND_AUTO_ATTENDANCE_BACKLOG.md` (`completed/`).

## 2026-11-15 (trip marker map view)
- Trips: `Show this trip` shows one trip's pins, routes and Side Quest links on the map (page state only; clears when the Trips tab is left). Completed trips are off the global map unless `Show completed trips` (Points of Interest tab) is on. Name tag shows the trip name under the marker name; pins carry an `aria-label` with the trip. Backlog `TRIP_MARKER_MAP_VISIBILITY_AND_DISAMBIGUATION_BACKLOG.md` (`completed/`).

## 2026-11-14 (Chongqing airspace release)
- PR #8 / source 3fb4f1a, production 8018ea0: all 777 original polygons preserved using regional z14 MVT precision. GEOS, exhaustive presence, point and desktop/mobile checks pass; previous regions unchanged. Chengdu captures retain 57 valid unique polygons locally, withheld pending a reviewed city coverage mask. [Release and rollback](../../docs/china-airspace/EXPRESS_CHONGQING_CHENGDU.md).

History only. **Do not load at session start**; open it when you need to know when or why something shipped. Current state: `CURRENT_STATUS.md`. Newest first. Work-board IDs (W1 to W24) come from the retired work board; commits are on `main`.

## 2026-11-15 (Wave 2: social, account, sessions and AI import cards)
- Presentation only (CSS at the end of `styles.css`): rows of equally outlined secondary buttons in Friends, party, account popover, privacy and cloud copy, the sessions dialog and the AI import card now use soft secondary actions (one filled action per card; danger keeps its red outline). Weather, toast, banner, splash, progression and the sessions layout were audited and left alone. No behaviour, consent, privacy, schema or permission change.
- `scripts/ui-baseline.mjs`: twelve new screens, a mocked server per viewport and theme. Design: `DESIGN.md` section 22. Backlog `DASHBOARD_TOOLBAR_VISUAL_REFINEMENT.md` closed (`completed/`).

## 2026-11-14 (UX and discoverability)
- Map: a tag button under the left-hand buttons writes the name of each one beside it (current action: Show/Hide crosshair, Follow me, Hide trip markers and so on; the compass only while it shows). Collapsed after every reload; nothing is stored. New `map-toolbar-help.js`, `map-tool-labels.js`; the controls got `data-tool` attributes.
- Quick Setup: optional three-step *Learn the map* (official information is not permission to fly, how to check a spot, where the tools are), skippable at every step; asks for no permission. `splash.js`.
- Once-per-feature hints for Map buttons, Checking a spot, Points of Interest, Trips, Friends, Map Configs and Flight Sessions (`help-*.js`, key `uavzones.v1.help`); one at a time, never while a dialog is open or a marker is being placed, replayable from the dashboard.
- Dashboard Help card: shortcuts for checking a location, saving a place, planning a trip, finding flight sessions and customizing the map; *Tips for each feature*.
- Tests: new unit suite `help-unit`, browser suites `toolbar` and `discover`; the shared harness marks hints as seen. Spec: `UX_DISCOVERABILITY_BACKLOG.md`.

## 2026-11-14 (Flight Sessions map explorer)
- New `src/sessions-map-explorer.js`: a non-modal dock beside the interactive map (left panel from about 620 px wide, bottom sheet below) listing sessions as compact cards; tapping a card selects that occurrence and centres its marker in the unobstructed map area (rotation-aware); one marker per place with a count badge for recurring occurrences; Expand, Collapse and Close; Escape; relayout on resize, fold and rotation; the main side panel steps aside temporarily (`panel.suspend()`) without touching the saved choice.
- Hub: **Explore on map** on Discover, My sessions and Invitations; every session card has outlined **Map** (internal) and **Navigate** (external, Maps settings apply) plus Details; cards without a meeting point say so. The old "Show these on the map" bar is replaced by the explorer; the picker bar stays.
- Marker windows and point-check windows: **Open in <app>** and **Navigate in <app>** are now outlined icon + text controls (`.map-action`), same links, same Home two-step consent.
- Hidden hub DOM is emptied on sign-out (a suspended hub kept the previous private text). Tests: new browser suite `sessions-explorer`, `tools` updated. Spec: `FLIGHT_SESSIONS_MAP_EXPLORER.md`; design `DESIGN.md` section 17.

## 2026-11-14 (aesthetic pass: Sessions forms)
- New session form: one 600 px centred column, four flat sections (Basics, When, Where, Visibility and capacity), date and times in one row from 480 px, repeat picker beside the Saturday preset, count and preview on a left rule, meeting point as one row, visibility as two cards, short capacity field, Cancel then a wide Create. Fixed radios and checkboxes stretched to 100% width. Discover filters are a bounded flex row; list and detail buttons are content-width; detail paragraphs no longer double-margined; time inputs styled like date inputs. Files: `styles.css`, `sessions-create.js` (markup only), two lines in `sessions-hub.js`, `tests/responsive.mjs` (210 checks). Same ids, data, validation and API. See `DESIGN.md` section 16.

## 2026-11-14 (responsive dialogs for unfolded phones)
- Sessions hub: sized in % instead of `vh` (header and close button no longer end up above the screen when the visible area is shorter than the dialog), full-screen sheet on touch screens up to 900 px wide, follows `visualViewport` for the keyboard, sticky Create/Cancel row, Discover filters and the New session form in columns by container width, sectioned form, calmer empty states, hosting-limit text corrected (five active hosted sessions, public or private, a series counts once), focus returns to the calendar button after the map picker. `.profile-dialog` and `.account-pop` heights no longer use `100vh`. New browser suite `responsive`. Details and measurements: `DESIGN.md` section 9, `CURRENT_STATUS.md`.

## 2026-11-14 (Flight Sessions 2.0 front end)
- Sessions hub dialog (Discover, My sessions, Invitations, detail, host tools), New session form with map pin picker, repeat preview, visibility, capacity; reporting; invitations and private links; dashboard card with opt-in 10 km discovery; calendar button on the map; hosting vs "can verify attendance for XP" wording. Backend: earlier commits `adb918a`, `bb78261` (migrations `20261118*` not yet pushed to the hosted project at the time of this entry). Later the same day: front end `a387936`, release recorded `0d4257b`, public sessions switched on `7690262`. Handoff archived in `docs/handoffs/archived/`.

## 2026-11-14 (HTML/main.js refactor Phases 2-5)
- `main.js` (327 -> 171 lines) delegates to `src/app/point-check.js`, `map-settings.js`, `region-loader.js`, `region-ui.js`; startup order, concurrent cloud/data loading, launch flags and error handling unchanged. New `region-loader-unit`; `launchloc` gained slow-data checks. Commit `7cb0347`, published with `deploy:live`.
- `MODULES.md` has the component ownership map; `AGENTS.md` points to it. Docs-only commits for Phases 3 and 4. No database change.
- Screenshot note: the Phase 1 image set no longer matches unmodified HEAD on this machine (date text comma); the refactor is 298/298 identical to same-day HEAD.

## 2026-11-14 (HTML refactor Phase 1)
- Root `index.html` is a 41-line shell with eight build-time HTML components. A local Vite plugin assembles nested includes during dev/build and reloads on fragment edits/additions/deletions; no runtime fetch or new dependency/command. Frozen pre-extraction DOM/source fixture plus compiler and real Vite/browser reload tests. Build and all 48 unit / 106 total suites passed; all 298 screenshots byte-identical to the corrected baseline. `main.js`, runtime JS, CSS and dependencies unchanged in this phase. Full validation: `HTML_MAIN_REFACTOR_BACKLOG.md` section 11. Phase 2 has not started.
- Released as `97d6df7`, pushed and published through `deploy:live` (`gh-pages` `dc4e2a7`, accounts enabled). Public HTML and referenced JS/CSS match the built files; guest coverage/sign-in UI/status/ID checks pass with no page exceptions. Publication and continuation: backlog section 12. No database changes.

## 2026-11-14 (duplicate weather-status IDs)
- Privacy now uses `pv-mw-status`, while Map Configs retains `mw-status`; both receive the same weather/elevation status. Previously the duplicate ID left Privacy's line blank. Browser checks cover unique IDs, matching status through refresh/error/cache states, and saved elevation status. Build passed; unrestricted full `npm test` passed all 104 suites (471 s), and unit-impact passed all 47 suites. Corrected DOM/screenshot baseline and execution-locale notes: `HTML_MAIN_REFACTOR_BACKLOG.md` section 10. HTML/main.js refactor Phase 1 has not started.

## 2026-11-13 (automatic location sharing with friends)
- Sharing no longer has to be switched on each time: after a one-time yes (or the privacy switch), `autoshare.js` starts sharing with a trip's party when another member is online and with all friends when a friend is online, and stops when they are gone; a by-hand stop sticks. New migration `20261117100000` (friend positions, `online_others`). Friends' pins are rounded squares labelled "Friend"; the Friends tab has two switches. Tests: `autoshare-unit`, `autoshare` (browser), additions to `db-live-unit`.

## 2026-11-13 (UI design system, phases 0 to 8)
- Phases 2 to 8: tokens for space, radius, elevation, scrim, layers, type, weight, controls and icons (phase 2 pixel-identical); headings and font scale (3); button, card, dialog proportions (4, and a tab-label overflow found by `tests/shell.mjs` fixed); one `pointer:coarse` block (5); hierarchy of progression, dashboard, sessions, friends (6, CSS only); pill family and identity-colour sources (7, pixel-identical); small-text floor and audit (8). Audit data and evidence: `DESIGN.md` section 15.
- Fixes from the owner's phone check: profile popover no longer cut off on an unfolded phone; Previous/Next in the marker window scroll the lists to the card.
- Phase 0: `docs/DESIGN.md`, `scripts/ui-baseline.mjs` (screenshots outside the repo), date and wording fixes in the docs. Phase 1 (`styles.css`): `--danger-solid`/`--on-danger` for white text on red (dark was 2.5:1), `--control-border` for fields and the switch track, `--rank-edge` outline on rank badges and rings, one disabled look, all `:hover` rules under `@media (hover:hover)`, dead colour fallbacks removed; new `tests/contrast-unit.mjs`.

## 2026-11-13 (logging and audit trail, F53)
- Milestone 1: `log.js`, `logscrub.js`, `logstore.js`, `errors.js`; `console.*` replaced; back-off streaks and about 12 silent network and behaviour catches logged; global handlers. Milestone 2: migration `20261116120000_audit_events.sql` (local only), `_shared/log.js`, `delete-account` fixed messages, Steam sync failure logging. Milestone 3: Diagnostics card, `tests/diag.mjs`, docs. A browser test caught a start-up crash when site data is blocked (a default parameter read `localStorage`).

## 2026-11-13 (colour theme, F52)
- System / Light / Dark: selector in Map Configs, before-first-paint script, dark colours as one token block in the stylesheet plus three small dark-only rules (`a1170e1`). Dark basemap by CSS filter on the base layer, `baseTiles()` seam, rank-9 contrast fix (`9e679b6`). Theme stored in the `user_data` document, last choice wins, no chooser, `baseSig` (`9e679b6`; no migration). Tests: `theme-unit`, `theme`, `sync-settings-unit`, `cloud`.

## 2026-11-13 (profile pane)
- Progression and Steam moved from Friends into the account pane; Edit profile gets grouping, validation and an unsaved-changes guard. Tests updated (progression, steam, sessions, friends).

## 2026-11-13 (progression, phases 1 to 6)
- Progression system, phases 1 to 6 (design and owner to-do: `PROGRESSION.md`; features F49 to F51):
  - 1 XP ledger, ranks and settings as data, admin and organiser roles, administrator XP adjustment (`9470fd0`, migration `20261114100000_progression_core.sql`).
  - 2 Achievements: 16 launch definitions, permanent unlocks, featured three, unlock engine, shared-trip counter; fix so deleting an administrator account works (`e2408b6`, `20261114110000_achievements.sql`).
  - 3 Read API with the one visibility rule, own and others' progression cards, collection and XP history (`de1e8b8`, `20261114120000_progression_read.sql`).
  - 4 Rank ring and tier badge on live party pins, rank card on selection (`047bdaa`, no migration).
  - 5 Flight sessions, RSVP, organiser-verified attendance XP, administrator revoke (`d079a94`, `20261114130000_flight_sessions.sql`).
  - 6 Steam linking and playtime XP, three edge functions, switched off until the owner adds the key (`f16aa66`, `20261114140000_steam.sql`).
  - Tests added: `db-progression-unit`, `db-progression-read-unit`, `db-sessions-unit`, `db-steam-unit`, `progression-unit`, `sessions-unit`, `steam-unit`, `steamui-unit`, browser `progression`, `sessions`, `steam`; rank checks added to `live`; `dashboard` updated for the new What's new entry.

## 2026-11-13
- Account and profile milestone finished: delete-account edge function and typed-word dialog (AC-10 to AC-12, `54c5c23`); profile avatar, bio, location, interests and sharing switch (AC-7 to AC-9, `3c23a1e`); account button and popover (AC-4, AC-5), splash account row (AC-6); data safety phase A (AC-1 to AC-3, migration `20261112100000_live_device.sql`); `deploy:live` script (`3b50eef`).
- Profile and location UX: tab pill glides (`ac19dec`); Edit profile is a dialog with a preview (`9d3adc5`); friend and party rows open a profile popover (`f2ebad5`); first sign-in asks for a display name (`6b3aa02`, `20261113110000_profile_named.sql`); locate on launch (`41fb73b`).
- Project skills in `.claude/skills/`: change-workflow, test-impact (`impact.mjs`), supabase-change, region-data (`e40eaef`, follow-ups `73fdd6e`, `6ac4203`).

## 2026-11-12
- Side Quests (optional nearby stops under a main stop), five phases: check-in restyle; data and plumbing (`isSub`/`parentId`, `isMain`, `z2.` share slots 11 and 12, AI import); create and convert; folded display with "+N" badge and "▾ N" chip; reorder (`planSideMove`). Small fixes SF-1 to SF-5 (name tag, card width, swipe to close the marker window, locate icon, popup fade `b326b14`); selected marker scrolls and highlights its card. Design: `DECISIONS.md`, feature F45 in `PROJECT.md`.
- First-visit quick setup: plan a trip (AI prompt form or itinerary link) or plan a flight; saves `mode` (W24, `5f6679f`).
- More swipes; `?` button for How it works; Map key at half height (W22, W23, `e23788d`).
- Locate: no automatic point check on the first fix (`bfe2262`).
- Heading-up compass mode, two-finger map turning, direction arrow; own rotation code because `leaflet-rotate` is GPL-3.0; layers limited to the OpenStreetMap family, Esri layers and satellite removed (W20, W21, `8b70a8e`).
- Live locations of party members (W17, `18bca99`).
- Online status (W16, `b29d23c`).

## 2026-11-11
- Swipe to dismiss; the rail folds into one circle (W18, W19, `073813e`).
- Shared trips with Party Members (W15, `b983275`).
- Phone panel expand and remembered expand states (W14, `ec1dce5`); phone dashboard expand (W13, `dd7eb46`); panel collapses sideways to a rail (W12, `b353af4`).
- Friends and profiles, friend codes (W5, database in `e4e0206` and later commits).
- Optional accounts and cloud copy on Supabase (W1): database and rules `e4e0206`, sync engine and sign-in UI; OpenStreetMap became the default basemap.
- Parallel test runner, 4 suites at once (W3 step a): full set about 262 s instead of 960 s.
- Storage readout, orphan cache cleanup, 2,000-marker ceiling (W4, `e29cbf4`).
- Check-in discoverability: a What's new entry (W2, `cded9ee`).
- Dashboard: crosshair and tight grid (`5c5e963`), fuller dashboard (`33f91f1`), overnight arrows through the hotel and second animations (`b3f1025`), snow and compact `z2.` share links (`6bc09bf`), cross-day arrows (`156a7c3`), eye in the window and fixed scale bar (`f2eee70`), marker details switch and day route (`24505ef`), centred dashboard and basic animations (`91c2d30`), check-in (`aea6d31`), route builder (`d692323`), the dashboard replacing the welcome dialog (`2e1f701`).
- Collapsible search (`209ae6f`); trip days as a flip card (`95e09e2`); map links as icons (`2be5931`); trip forecast and no-fly check (`da0b00e`); trip plan screen (`ade7810`); map selection (`03e3b7d`); window tidy-up and Singapore published (`f8ffc85`); Singapore zones (`498eff8`).
- Features F19 to F32 (before the work board): trips, bulk delete, UI pass, frosted window, rain block, hold-to-check, welcome screen, expanded window, same place on several dates, reorder by hold, Google Maps/Amap links, coordinate search, day from date, previous/next stop. Details are the F-numbers in `PROJECT.md`.
- Persistent project context (`Project_context/`) created; initial commit `11aa7ce` pushed to `muffinMonday/uav-companion` (`main`).

## 2026-11-10
- Rebuilt as an open-source static app: Vite, Leaflet, PMTiles; Hubei data; renamed UAV Companion (storage prefix `uavzones.` kept).

## Test history (proxy for confidence at the time)
- 2026-11-11 after W3 step a: 48 suites passing in 262 s (4 jobs).
- 2026-11-12 (documentation audit): `npm run test:unit` all passing, 8 s; browser suites not rerun.

## Retired planning notes
- W3 steps b to f (serve a built copy for tests, source-to-suite map, replace fixed waits, split `trip.mjs`, one browser per worker) were planned and not started.
- Ideas not chosen (W11): duplicate trip, trip colours, whole-trip route button, GPX/KML export, printable summary, move markers between trips, search inside a trip, undo for share-link imports. Check-in discoverability options A, B, C were offered and not chosen.
- Documentation restructure 2026-11-12: `CURRENT_STATUS.md` reduced to a checkpoint; this file created; `docs/PROJECT.md` moved to `Project_context/docs/PROJECT.md`.
