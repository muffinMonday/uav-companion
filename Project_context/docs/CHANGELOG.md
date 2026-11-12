# Changelog

History only. **Do not load at session start**; open it when you need to know when or why something shipped. Current state: `CURRENT_STATUS.md`. Newest first. Work-board IDs (W1 to W24) come from the retired work board; commits are on `main`.

## 2026-11-12
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
