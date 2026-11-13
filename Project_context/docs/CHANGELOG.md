# Changelog

History only. **Do not load at session start**; open it when you need to know when or why something shipped. Current state: `CURRENT_STATUS.md`. Newest first. Work-board IDs (W1 to W24) come from the retired work board; commits are on `main`.

## 2026-11-13 (UI design system, phases 0 and 1)
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
