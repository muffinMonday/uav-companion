# Flight Sessions 2.0 — Product and Implementation Backlog

**Status: IN PROGRESS (owner authorized autonomous implementation 2026-11-14; answers to section 2 are in `DECISIONS.md`; phase status is in `CURRENT_STATUS.md`).** Prepared 2026-11-14. The owner wants Claude to clarify unresolved policies before starting, then (only after explicit approval) implement, test, commit, push and deploy autonomously. See `FLIGHT_SESSIONS_2_AGENT_HANDOFF.md` for the authorization boundary.

## 1. Confirmed requirements

- Any signed-in user with a valid profile can create a flight session (not just organizers).
- Public/private visibility, **private by default**. Public sessions are guest-discoverable and expose the **exact meeting coordinates**. Private sessions are visible only to authorized hosts, invitees and participants.
- Private joining supports both named invitations and revocable private links. For recurring series, invitation scope can be **one occurrence** or **entire series**.
- Replace the text-only Location input with a map pin picker, including draggable pin, map-centre shortcut and optional existing-POI shortcut; persist independent coordinates and optional label.
- Date/time inputs must match the existing app's `controls.js` / `DESIGN.md` conventions; UTC instants stored, explicit event IANA timezone for recurrence.
- Capacity is optional (null = unlimited); enforce atomically on RSVP.
- Limit each host to **five active hosted commitments**. One-off upcoming/ongoing session counts one; recurring series counts one regardless of occurrence count; cancelled/finished commitments release their slot.
- Same-host sessions within **300 m AND overlapping in time** are blocked. Different-host overlapping **public** sessions produce a warning, not a block. Never reveal private sessions through warnings.
- Recurrence: weekly Saturday ending after N occurrences is the **preferred preset**, not the only supported option. Proposed additional frequencies: weekly, biweekly, monthly; finite end required. Proposed 2–12 occurrences/default 4 needs confirmation.
- Individual occurrences have independent RSVP, capacity, attendance and XP. Hosts can edit/cancel one occurrence or a series, preserving historical attendance.
- Two navigation entries: dashboard card and compact map calendar button. Both open a dedicated Sessions Hub (Discover / My Sessions: Hosting & Joined / Invitations). Create Session is inside hub, not Friends. No fifth side-panel tab.
- Nearby dashboard discovery: public sessions within about **10 km**; in-app summary rather than push notification. Private invitations and joined sessions are account-only. Location-based discovery opt-in, or search around user-selected map centre.
- Publishing a public session explicitly warns that exact coordinates are visible to anyone. This never enables live-location sharing or overrides official regulatory point checks.
- No XP for hosting or RSVP. Existing attendance XP must remain server-authoritative.

## 2. Required questions BEFORE implementation

Claude must ask the owner **one consolidated set** of these unresolved questions, offering defaults, and wait for an explicit answer and execution approval:

1. **Public publication:** immediate with report/rate-limit/moderation safeguards (recommended), or admin preapproval?
2. **Public RSVP:** instant when space available (recommended), or host approval?
3. **Public host identity:** display name and preset avatar (recommended, explicit consent), or anonymous?
4. **Existing sessions:** migrate as private, preserve participants/attendance/XP (recommended), or require host review?
5. **Recurrence:** confirm 2–12 occurrences/default 4, handling DST and missing monthly dates, and edits to occurrences with RSVPs.
6. **Attendance XP:** should ordinary hosts be allowed to verify attendance for XP? Recommended **no** initially: only trusted organizers/admins verify XP; hosting and XP authority must be separate to prevent farming.
7. **Private links:** require sign-in to accept (recommended), token expiry and usage limits, guest preview policy, revoke and forwarding behavior.
8. **Blocking/reporting:** interaction with blocked users, host participant removal, abuse reports and moderation route before public launch.
9. **Visibility changes:** handling public-to-private transitions, cache invalidation and already-joined participants.
10. **Deployment:** explicitly authorize feature-scoped autonomous commits, pushes and non-destructive production deployment after tests/security gates; confirm target Supabase project and release staging.

Do not treat recommended defaults as approved answers.

## 3. UX architecture

### Hub
Desktop accessible large modal (~960 px max); mobile full-screen sheet with sticky header. Discover (guest-readable public list/map, pagination, search, radius, date, capacity filters), My Sessions (hosting, joined, history), Invitations (received, sent, private links). Preserve tab filters and scroll; Escape/Back closes detail before hub. Guests see Discover and sign-in prompts for private actions.

### Entry points
Map calendar button must not overlap existing Leaflet controls, crosshair, search, dock or phone sheet. Dashboard card prioritizes: (1) session starting soon that user hosts/attends; (2) private invitation; (3) nearby public sessions; (4) generic discovery. Map button opens Discover; dashboard links deep-link to relevant section/detail.

### Create
Single progressive form: title/description, start/end, repeat, map point, visibility, capacity, review/publish. Reuse existing form controls, accessible labels, 44 px touch targets, theme and dialog patterns. In-memory draft survives temporary map selection and hub navigation. Public exact-location disclosure requires confirmation. Recurrence preview shows at least next three dates and total count. A recurring private invitation can target one occurrence or entire series.

## 4. Existing code and proposed files

Current owners: `src/sessions-ui.js` (dynamic Friends-tab card), `src/sessions.js` (RPC/validation), `supabase/migrations/20261114130000_flight_sessions.sql` (sessions/RSVP/attendance), `src/friends-ui.js`, `src/dashboard.js`, `src/main.js`, `src/app/`, `src/components/`, `scripts/html-components.js`. Check latest `MODULES.md` before edits.

**New candidates:** `src/components/sessions-hub.html`, `src/sessions-hub.js`, `src/sessions-create.js`, `src/sessions-lobby.js`, `src/sessions-invites.js`, `src/sessions-recurrence.js` (pure), `src/sessions-nearby.js`, `src/sessions-admin.js`. Prefer existing helpers and avoid unnecessary modules.

**Modify as needed:** `src/sessions.js`, `src/sessions-ui.js`, `src/friends-ui.js`, `src/dashboard.js`, `src/main.js`, map control module, `src/styles.css`, `scripts/html-components.js`, `tests/run.mjs`. Update `Project_context/docs/{MODULES,DATABASE,ARCHITECTURE,DEVELOPMENT,DECISIONS,PROJECT,PROGRESSION,CURRENT_STATUS,CHANGELOG}.md` and `supabase/README.md`. Do not modify Community Flying Areas.

## 5. Supabase migration plan

**Existing behavior:** `flight_sessions` currently has text `location`, timestamps/status/creator, and no visibility or coordinates. `create_session` checks organizer role; `list_sessions` requires authentication and exposes scheduled sessions to signed-in users. `session_rsvps` and `session_attendance` support verified attendance XP.

Use **new additive migrations only**, never edit applied migrations:

1. **Visibility and location:** add `visibility` (default private), latitude, longitude, location_label, event timezone, nullable capacity and moderation/publication state. Preserve old location text, IDs, RSVP, attendance and XP. Existing rows remain private; coordinates nullable until host supplies them.
2. **Series and occurrences:** `flight_session_series` with host, recurrence rule, local wall-clock time, timezone, finite count and defaults. Each occurrence is a `flight_sessions` row with series ID and ordinal, unique per series; exception records/overrides for edits. Bounded materialization with idempotent generation; do not create unbounded future records.
3. **Invitations and links:** scoped invitation rows and hashed high-entropy bearer tokens with expiry, revocation and use limits. Private details never returned to unauthorized callers.
4. **Public discovery and moderation:** guest-safe paginated public RPC, authenticated owner/member RPC, transactional creation, capacity, five-slot quota, 300 m/time-overlap checks, report/block, admin removal and rate limiting.
5. **Deletion/compatibility:** integrate account deletion, retain historical attendance/XP semantics, clean invitation tokens and preserve existing API consumers or migrate them atomically.

**RPC candidates:** `list_public_sessions`, `get_public_session`, `list_my_sessions`, `list_my_session_invitations`, `get_session_for_member`, `create_session_v2`, `update_session_v2`, `cancel_session_v2`, `rsvp_session_v2`, `withdraw_rsvp_v2`, invitation/link create/redeem/revoke, `report_session`, `admin_review_session_report`, `admin_unpublish_session`. Final signatures require SQL review.

RLS enabled on all tables; direct client table writes revoked; `SECURITY DEFINER` RPC with `set search_path=''`, explicit grants, validated inputs and `auth.uid()` ownership. Guest reads return public-only safe fields. Private session existence, coordinates, membership and tokens must not leak via errors, counts, conflict warnings or cache. Quota, RSVP capacity and same-host conflict checks must be concurrency-safe. Use geodesic distance and actual time-interval overlap. Do not let one user block other hosts' sessions.

**Critical security decision:** Allowing anyone to host must not automatically allow anyone to award attendance XP. Resolve the trusted-verifier policy before changing `mark_attended`.

## 6. Recurrence and edge cases

Weekly Saturday end-after-count preferred. Preserve local wall time across DST using IANA timezone; explicitly resolve nonexistent/ambiguous times. Monthly recurrence must define handling of the 29th–31st. One occurrence or series edits/cancellations must preserve past RSVPs and attendance. RSVP capacity is per occurrence; invitation scope is one or entire series. Quota counts series once. Check each occurrence for same-host overlaps; make conflict detection atomic. Cancellation and visibility changes must invalidate public discovery and notify affected participants in-app.

## 7. Test inventory and acceptance

New proposed suites:
- `tests/sessions-recurrence-unit.mjs`: weekly Saturdays, finite count, monthly dates, DST, timezones, exceptions and edit scope.
- `tests/sessions-nearby-unit.mjs`: 10 km boundary, opt-in/map centre, private non-disclosure, stale responses.
- `tests/sessions-hub.mjs`: guest Discover, filters, list/map, deep links, dialog focus, back/escape, responsive UI.
- `tests/sessions-create.mjs`: date styles, map pin/POI shortcut, draft preservation, private default, public warning, capacity and recurrence.
- `tests/sessions-invites.mjs`: named/link invites, series vs occurrence, expiry/revoke and unauthorized access.
- `tests/db-sessions-v2-unit.mjs`: RLS/RPC, guest public only, private non-leakage, capacity races, five slots, 300 m/time overlap, recurrence, moderation, legacy migration.
- `tests/db-sessions-v2-deletion-unit.mjs`: account deletion, attendance and XP continuity.
Extend existing `sessions-unit`, `db-sessions-unit`, browser `sessions`, `friends`, `dashboard`, `html-dom`, theme and contrast suites. Use `/test-impact`, `npm run test:unit`, `npm test` with dev server on 5173, `npm run build`, screenshot baseline and mobile smoke. Verify real migrations against legacy fixtures, not only empty DB.

## 8. Phases and release gates

0. **Clarify and authorize:** owner answers section 2, confirms target environment and explicitly authorizes autonomous execution. No coding before this.
1. **Backend safety:** additive schema, private/public access, location, quota, capacity, conflict and security tests. Keep new public UI disabled until moderation safeguards ready.
2. **Creation UX:** consistent dates, map pin, visibility, capacity, draft and recurrence preview; browser tests.
3. **Recurrence/invitations:** series, occurrence overrides, scoped private links/invitations, timezone and XP regression tests.
4. **Sessions Hub:** guest public lobby, My Sessions and Invitations, list/map, pagination and filters.
5. **Dashboard/map entry:** calendar shortcut, 10 km discovery and privacy-safe dashboard priorities.
6. **Moderation/release:** reports, blocks, rate limits, admin unpublish, legacy migration, full test/screenshot/security checks, controlled deployment and live verification.

**Exit rule:** Each phase must pass its tests and update `CURRENT_STATUS.md`. Prefer small commits. Do not deploy a partially public feature without moderation/privacy prerequisites. Deployment instructions and stop conditions are in the agent handoff.

## 9. Exclusions and compatibility

No new framework, no unrelated HTML/main refactor, no Community Flying Areas implementation, no push notifications, chat, payments, automatic legal-flight approval or XP for hosting/RSVP. Do not alter existing live-location consent. The new exact-public-location policy supersedes the older approximate-location proposal in `PROJECT.md`, but never retroactively publishes legacy locations.

## 10. Completion checklist

- [ ] Open policies clarified and recorded
- [ ] Explicit feature-scoped autonomous authorization received
- [ ] Current git tree and migrations inspected
- [ ] Legacy data, RSVP, attendance and XP preserved
- [ ] Public/private RLS and guest access verified
- [ ] Five-slot quota, 300 m overlap and capacity races verified
- [ ] Recurrence and invitations fully tested
- [ ] Exact public-coordinate disclosure and private link security verified
- [ ] Reporting, blocking, rate limits and moderation available before public release
- [ ] Hub, map picker, dashboard, mobile, keyboard and theme tested
- [ ] Full tests/build/screenshot results inspected
- [ ] Documentation and checkpoint updated; commits/deployments verified
