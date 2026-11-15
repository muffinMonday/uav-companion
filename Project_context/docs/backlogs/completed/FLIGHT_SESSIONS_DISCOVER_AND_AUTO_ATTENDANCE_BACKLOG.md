# UAV Companion — Flight Sessions Discover, Preview, People and Automatic Attendance

**Status:** COMPLETED, WAVE E DESCOPED (2026-11-15). Waves A, B1, B2, C and D are built, tested, committed, pushed, deployed and live-checked (commits `7b241ea`, `24304d8`, `6cdb845`, `886252a`, `5fcd847`, docs `f18cdc1`; evidence and tests in section 14). `auto_attendance_enabled` is 0 on the hosted project and no automatic XP is awarded. **Wave E (canary, flag flip, real-phone pass) was cancelled by the owner** so the architecture of the automatic-attendance section can be reviewed first; it is deferred, not done. Residual risks: section 13.
**Prepared:** 2026-11-15
**Repository:** `muffinMonday/uav-companion`
**Direction:** Discover improvements, tile-grid previews, a participant list with Add friend, and opt-in automatic proximity attendance with server-awarded XP. Automatic XP ships **off** (`progression_settings.auto_attendance_enabled = 0`) and stays off in this backlog.
**Checked against:** HEAD `7575401`. Source code beats this text; reconcile before acting.

## Status history
- 2026-11-15: original planning draft (organiser-removed auto XP, shared Leaflet preview, host profile reuse).
- 2026-11-15: waves A to D implemented and deployed (section 14); Wave E not started.
- 2026-11-15: owner descoped Wave E (needs more time to review the architecture) and moved this backlog to `completed/`; flag stays 0.
- 2026-11-15: code review amended this file: conflicts with the code recorded (section 2), Today needs no SQL change, previews become a tile grid, host and participants open the profile popover with Add friend, section 7 rewritten (any-host thresholds, coordinate-free evidence, consent table), waves A, B1, B2, C, D (E out of scope).

## 1. Outcomes and scope
1. **Today** date filter (viewer-local day), expiry guard, fix the false empty state with `Has space`.
2. One **XP badge** helper for rows, explorer cards and detail, fed by a server `xp_reward` field.
3. **Tile-grid previews** on Discover cards, expanded on demand through a right-edge chevron.
4. **People:** host and all participants are clickable for any viewer (guests included) and open the existing profile popover; non-friends show name, avatar and Add friend only.
5. **Automatic attendance** (consent, probes, server award), flag 0.

Out of scope: background geofencing, push, a new map service, anti-spoofing guarantees, live-position exposure to hosts, POI check-in changes, Wave E (canary, flag flip, real phone, separate project), thumbnails in Map Explorer cards.

## 2. Conflicts between the original draft and the code
| Draft said | Code says |
|---|---|
| Date options already include Today | Only any/week/month (`sessions-hub.js`). Today is new. |
| `+50 XP` on eligible sessions | Only an admin or an organiser hosting the session can award XP (`can_verify_session`); `list_public_sessions` returns no reward field, so the badge needs a server `xp_reward`. Never hardcode 50. |
| Reuse profile popover for host | `showProfile` accepts only friend/member handles; `list_public_sessions` returns `host_name`, `host_avatar`, no id. Solved by section 6. |
| Server `<=` may need an SQL fix for Today | Not needed: server uses `ends_at >= p_from`, `starts_at <= p_until` (inclusive) and `ends_at > now()`. Client sends `until = next local midnight - 1 ms`. |
| Expired rows are a backend gap | Backend is correct. Stale only in memory: `discoverList()` has no time guard (`upcomingMine()` and `summaryNow()` do). |
| No false empty state | Existing bug: `Has space` filters client-side after the page loads; if all rows drop out, the empty message shows and `Show more` is hidden although more pages exist. |
| `session_attendance.source` | Allows only `rsvp`, `walk_in`; `auto` needs a constraint change. |
| Single shared watch | Three independent watchers exist (`locate.js`, `checkin-ui.js`, `live.js`); a shared sampler is new, no fourth watcher. |
| Achievements | `attendance_verified_count` counts positive attendance ledger rows (legendary at 50). Auto awards feed it (decided). |
| Waves A and B frontend only | B2 needs an additive migration. |

## 3. Discover date, eligibility and expiry (Wave A, frontend only)
- Date select: Any date, **Today (your time)**, Next 7 days, Next 30 days.
- Today: `from = now`, `until = next local midnight - 1 ms`, computed from the viewer's local calendar (DST-safe: build the next midnight with calendar arithmetic, not +24 h). The server needs no change.
- `discoverList()` drops rows with `endsAt <= now`; the hub and explorer re-evaluate at the earliest `ends_at` (one bounded timer, cleared on close and visibility hidden) and on visibility change, filter change and resume. A selected card that expires resets selection and focus safely.
- Fix `Has space`: when client filtering hides every loaded row but `pub.more` is true, show a "Show more" control (and load more) instead of the empty state; the empty state appears only when no more pages exist.
- Labels use the viewer's time zone.

## 4. XP badge (Wave B2 server field, front end shares one helper)
- `list_public_sessions` gains `xp_reward` (integer or null; null = no XP possible; drop and recreate, re-grant). Existing clients ignore the extra column.
- One helper `xpBadge(session)` for rows, explorer cards and detail. States: `+N XP` (N from the server), nothing when null, no hardcoded 50.
- Text stays truthful per stage: organiser/admin verification now; "automatic attendance" wording only when the flag is on and the stage exists. RSVP alone earns nothing.

## 5. Previews (Wave B1, frontend only)
- A 2x2 raster tile grid computed from lat/lng (Web Mercator), `<img loading="lazy">` from `baseTiles(pref)`, a CSS pin and that basemap's attribution. Browser HTTP cache does the caching. Dark theme reuses the base-layer CSS filter. No Leaflet per card, no PMTiles, no airspace overlay; the text says "Open the map to check airspace".
- Expanded on demand at every width through a right-edge chevron button (44 px target, `aria-expanded`, `aria-controls`, one open at a time, no persistence, no swipe, reduced motion respected). Four tile requests only for the opened card.
- Tapping the preview opens the existing Map Explorer focus path (`explore(section, {focus})`). Missing coordinates: no preview. Map Explorer cards get no thumbnail.

## 6. People: host and participants (Wave B2)
- Host name/avatar and every participant are buttons that open the existing profile popover for any viewer, guests included. Friends keep today's full profile and show "In your friends list". Non-friends show name, avatar and an **Add friend** button only.
- New functions: `list_session_participants(p_session, page, size)` returns session-scoped opaque handles (not the RSVP id, not a user id), display name, avatar, relation (`friend` / `pending` / `none` / `self`); `request_friend_from_session(p_session, p_handle)` resolves server-side, honours `accepts_requests` and blocks, one uniform answer.
- Safeguards (accepted): "Show me in attendee lists" switch (default on) and a one-line notice in the RSVP step; private sessions list attendees only to joined people; page and size caps; rate limit; blocked pairs hidden both ways.
- This **reverses** two recorded decisions ("RSVP names are managers-only", "no function returns another user's id"); recorded in `DECISIONS.md`. `progression_viewable` is not changed.

## 7. Automatic attendance and XP (Waves C and D, flag 0)
### Eligibility (values stored in `progression_settings`, tunable without a migration)
- Any host may award XP. No per-pair limit. At least 2 distinct non-host users with a qualifying check-in at that occurrence before any award. Attendee account at least 24 h old. Caps: 1 auto award per day, 5 per week. Host account at least 7 days old; a host never earns from their own session. Location and times are frozen once the session starts; a trigger resets probes on any edit.
### Evidence (no coordinates stored)
- `submit_session_arrival(p_session, lat, lng, accuracy)`: the server computes the distance, discards the coordinates and stores only server timestamps and a count per (session, user). Defaults: radius 100 m, accuracy 50 m or better, at least 3 qualifying probes spanning at least 120 s, spacing at least 30 s, a gap over 10 minutes restarts. Client timestamps and client "I arrived" flags are never trusted. No coordinates in logs.
- Probe rows are deleted on award, 24 h after the session ends (opportunistic cleanup), in `purge_user_sessions` and in `delete_profile`.
### Award path
- Reuses `award_xp` with ledger key `(user,'attendance','session:<id>')`; `session_attendance.source = 'auto'` (constraint change); per (user, session) advisory lock; a prior revoked row refuses; manual and auto race: first wins, the second returns `already_attended`. `mark_attended` is unchanged. `attendance_xp = 0` records no false success.
- Admin bulk revoke by source and time range; controlled audit reason codes. Grants: clients get no table access and no `award_xp`.
### Consent and sampler (Wave D)
- Server-recorded consent table `(user_id, accepted_at, notice_version)`; the RPC refuses without it; withdrawing deletes it and the probes. Pref `autoSessionAttendance` is off by default and separate from `checkIn`, `locateOnLaunch`, `autoShare`.
- Foreground only, no background or push. One shared sampler (30 to 60 s) active only inside a joined occurrence's window, stopped after the award.
- Toast only after the server returns `awarded` with xp above 0; "Attendance already recorded" is neutral.

## 8. Waves
| Wave | Content | Gate |
|---|---|---|
| A | Today, expiry guard, `Has space` fix | frontend only |
| B1 | tile-grid previews + chevron | frontend only |
| B2 | additive migration (`xp_reward`, participants, friend request, opt-out); badge, participant icons, popover changes, privacy switch | migration ships with the deploy |
| C | consent and probe tables, `submit_session_arrival`, settings, bulk revoke, purge, audit codes, grants; flag 0 | backend only |
| D | consent UI, sampler, progress, toast; flag still 0 | frontend |
| E | canary | **descoped by owner 2026-11-15** (deferred, not done) |

Each wave is built, tested, committed, pushed and deployed (one `deploy:live` per wave that changes `src/`) before the next.

## 9. Tests
- Unit: `sessions-unit` (day boundaries, DST with an injected clock), preview geometry, `xpBadge`, sampler state machine.
- Browser: `sessions`, `sessions-explorer` updates, `responsive`, new preview suite (320/360/390/520/768 px, dark, reduced motion, keyboard), people popover, privacy switch.
- PGlite DB suites. B2: friend, party, stranger, guest, blocked, `share_profile`, private session, opt-out. C: no consent, no RSVP, host self, outside window, edited session, revoked, cancelled, two-device race, manual vs auto race, zero XP, caps, deletion, grants.
- Per wave: `/test-impact`, `npm run test:unit`, `npm test`, `npm run build`; before/after screenshots with `scripts/ui-baseline.mjs` for UI waves; live guest smoke check and bundle hashes after each deploy.

## 10. File ownership
`src/sessions-hub.js`, `src/sessions.js`, `src/sessions-map-explorer.js`, new `src/sessions-preview.js`, new `src/session-arrival.js`, `src/profile-popover.js`, `src/privacy.js`, `src/privacy-ui.js`, `src/prefs.js`, `src/styles.css`, additive `supabase/migrations/*`, `tests/`, docs (MODULES, DATABASE, DECISIONS, PROGRESSION, DESIGN, CHANGELOG, CURRENT_STATUS).

## 11. Decisions
**Closed (2026-11-15):** any host with the thresholds above; GPS-only evidence plus caps, no on-site code; previews expand on demand at every width, no swipe, no airspace overlay; host and all participants clickable for any viewer with Add friend; people-list safeguards accepted; auto awards count toward attendance achievements; thresholds "looser" as in section 7; radius/accuracy/dwell 100 m / 50 m / 120 s.

**Still open (deferred with Wave E; reopen only with a new plan):** an architecture review of section 7, a canary path (second Supabase project, a hosted allowlist migration, or local Supabase with a tunnel), pre-start and post-end grace (none now); hosted sign-up and email-confirmation settings unverified before any auto-XP rollout; Wave E canary and flag flip; real-phone pass; thresholds to tune after a pilot.

## 14. Implementation evidence (2026-11-15)
| Wave | Commit | Hosted / deploy | Tests |
|---|---|---|---|
| docs | `fe21279` | none | n/a |
| A | `7b241ea` | deploy:live, bundle `index-CgiUpX5u.js` identical live | `sessions-unit` 66, `sessions` 73 |
| B1 | `24304d8` | deploy:live, `index-C6YCX0re.js` identical live | `sessions-preview-unit` 30, `session-preview` 64 |
| B2 | `6cdb845` | migration `20261119100000` (dry run listed only it, read-only backup `tests/out/sessions-people-release/`), deploy:live `index-DwS37eiV.js` | `db-sessions-people-unit` 54, `sessions` 90, `sessions-unit` 88 |
| C | `886252a` | migration `20261119110000` (dry run listed only it, backup `tests/out/sessions-auto-release/`); no src change, so no deploy; flag verified 0 on the hosted project | `db-session-arrival-unit` 60 |
| D | `5fcd847` | deploy:live, `index-CFwqLmbV.js` identical live | `session-arrival-unit` 48, `session-arrival` 19; `html-dom` fixture regenerated (7 new elements) |

Every wave: full `npm run test:unit` and full `npm test` run before the commit; the only failing suite each time is `diag`, which imports `/src/log.js` and so cannot run against the `vite preview` server on :5173 (environmental; not caused by these changes). `live-engine-unit` flaked once under load (passes alone). Live guest smoke checks were read-only (no sign-in, no writes, `list_session_participants` deliberately not called because it writes handle rows). Hosted advisors reported nothing.

Deviations: the attendee-list switch is in My sessions (not the Privacy card); `xp_reward` is also on `list_sessions` and invitations; the probe count uses the server clock only; one `rate limit` counter (60 calls a minute) is shared by the attendee list and the sampler; tile previews were checked with a stub tile image in tests.

## 12. Stop conditions
Stop and report if a hosted migration dry run lists anything unexpected, tests fail without a test-side cause, the linked project is not `tgptrtcuaryyyfzhrffm`, a secret or permission is missing, or the code contradicts a decision above. Never turn `auto_attendance_enabled` on in this backlog.

## 13. Residual risks (to keep updated)
- GPS spoofing is not preventable in a web client; caps and the bulk revoke only bound it.
- Ring farming: cooperating accounts older than 7 days can still earn once per day and five per week each.
- Attendee-list exposure: public sessions publish who will come, to guests; only the opt-out switch, the page cap and the per-person rate limit mitigate it (guests have no per-person limit).
- Hosted sign-up and email-confirmation settings were not verified (local config has confirmations off).
- No real-phone or Safari pass; previews were tested with a stub tile image; screenshots of the sessions dialog are not in the baseline matrix.
- A started session can no longer be moved or re-timed (decision), which also blocks a host extending the end time.
- The flag is 0 everywhere: the whole automatic path is untested against real GPS and a real second person. With Wave E descoped, nobody has exercised it end to end outside the test suites; do not set the flag to 1 without a new plan.
