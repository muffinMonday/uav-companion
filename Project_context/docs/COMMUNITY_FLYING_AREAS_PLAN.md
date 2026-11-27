# Community Flying Areas — Approved Product Specification and Implementation Backlog

**Status:** PHASE 1 (local authoring) and PHASE 2 (submission and backend) DEPLOYED 2026-11-27 UTC; Phases 3 to 6 NOT STARTED. Section 0 has the evidence.
**Decision date:** 2026-11-13; discussion baseline refreshed 2026-11-27.  
**Review baseline:** `main` at `91df30d65562b32c63c051babfd0a34e9707b17c` (PR #15 merge).  
**Authorization:** Phases 1 and 2 (implementation, the Phase 2 hosted migrations and both production deployments) were explicitly authorized by the owner and are complete (section 0). Phases 3–6, further hosted migrations and further feature releases require separate explicit owner approval.
**Architecture dependency:** The HTML/main.js refactor is complete. Before implementation, reconcile proposed paths and initialization seams against the current `src/components/`, `src/app/`, `Project_context/docs/MODULES.md` and source code.

## 0. Implementation status (updated 2026-11-27)

**Phase 1 — Local drawing and storage: DEPLOYED (2026-11-27 UTC).** Original implementation authorization covered implement/test/build/commit/push only. The owner subsequently explicitly requested deployment of the latest Phase 1 changes. Source `5f59089`, gh-pages `a7634ed`, bundle `main-Biy7hNXK.js`; [Pages run](https://github.com/muffinMonday/uav-companion/actions/runs/45915229886) succeeded. Live HTML and 10 referenced JS/CSS assets match the production build; all 33 regions and existing live flags/accounts retained. Phase 1 production browser checks 99/0; full regression 191/212 passing (21 failures, details and baseline comparisons in `CURRENT_STATUS.md`). No hosted migration or public submission. Real-device review remains; further phases need separate owner authorization.

**Phase 2 — Submission and backend: DEPLOYED (2026-11-27 UTC).** The three migrations were applied to the hosted project (`db push --remote --yes`, then an up-to-date dry-run); frontend deployed from `main` `19f7440` as gh-pages `049e5fc60602`, bundle `main-D6dgaz60.js`. Live anonymous checks pass (table read 401, RPC permission denied). A signed-in submission on production is not yet verified. Earlier status, before release: Migrations `20261127100000_community_areas.sql`, `20261127110000_community_area_api.sql`, `20261127120000_community_area_deletion.sql`; RPCs `submit_community_area`, `list_my_community_areas`, `withdraw_community_revision`; `delete_profile` integration; client `src/areas/api.js`, `submit.js`, UI in `ui.js`. Delivers: signed-in submission of a saved local area with server validation (parity-tested with `core.js` on 245 shapes), idempotency, five pending per account, one pending per area, audit `area.submit`/`area.withdraw`, owner-scoped list and withdrawal, pending status shown on the local draft, account-deletion anonymisation. Not delivered (unchanged): moderation (Phase 3), public layer and guest RPCs (Phase 4), revisions of published areas and unpublication (Phase 5), release gate (Phase 6), contribution XP, photos, section 13.1 attributes. Hosted migration and deploy were blocked: this environment holds no `SUPABASE_DB_PASSWORD` or `.env.development.local` (see `CURRENT_STATUS.md`).

| Item | State |
|---|---|
| Polygon by taps/clicks; rectangle by two opposite corners (axis-aligned in longitude/latitude) | Done (`src/areas/editor.js`, `draw.js`) |
| Vertex move, midpoint insert, delete, undo (200 steps), finish, cancel with discard confirmation, Escape | Done |
| Validation: 3 to 100 distinct vertices, 25 km² spherical area, self-intersection (incl. touching and doubling back), degenerate, invalid coordinates, antimeridian, holes rejected, live feedback while drawing | Done (`core.js`) |
| Name 1 to 80 (required), description up to 500 | Done (`form.js`) |
| Pilot setup spots: add, move, remove; max 10; four fixed types; note up to 120; inside or on the boundary; flagged when an outline edit strands one; shown from zoom 13 or while their area is selected | Done |
| Local persistence `uavzones.v1.areas` (v1), memory fallback with warning, corrupted data backed up to `uavzones.v1.areas.bak` | Done (`store.js`) |
| Edit, duplicate, delete (confirmed), reopen, show on map, export one or all, import | Done (`ui.js`) |
| GeoJSON import/export: FeatureCollection / Feature / Polygon in; polygons only, holes, MultiPolygon, Point, oversize, invalid skipped with reasons; 2 MB and 200-area ceilings; spots travel as Point features naming their area | Done |
| Guest use; nothing sent to Supabase | Done (no network code in `src/areas/`; asserted in `tests/areas.mjs`) |
| Touch: taps add points, a press over 600 ms is not a tap, hold-to-check / right-click / Inspect disabled while drawing, pan, pinch and two-finger rotation add no points, double-tap zoom off for the session | Done; verified with Chromium touch emulation and CDP touch events, **not on a real phone** |
| Community polygons never interactive; never read by `pointcheck.js`; own purple dashed style | Done |

**Where it lives:** the map control `data-tool="areas"` (folded into More tools as "My flying areas"); code map in `MODULES.md`; storage in `DATABASE.md`; look in `DESIGN.md` section 27; decisions in `DECISIONS.md`.

**Tests:** `areas-unit` (79), `areas-store-unit` (62), `areas-editor-unit` (62), browser `areas` (99; desktop, 390 px touch, dark theme, corrupted and blocked storage, regressions). Existing `toolbar`, `help-unit` updated for the new row.

**Deviations and decisions for owner review**
1. The proposed `api.js`, `admin-ui.js` and the public/pending layers are Phase 2 to 4 and were not created. `draw.js`, `editor.js` (pure state), `form.js` and `ui.js` split the proposed `draw.js`/`ui.js` so the drawing rules are testable in Node. Entry point `src/areas/index.js`; no HTML fragment (dynamic, like More tools).
2. Area is a spherical approximation (mean radius). The future server must use the same formula, or its 25 km² limit will disagree at the edge.
3. Stored spot and area ids are local; import always creates new ids.
4. Rectangles are lat/lng-axis-aligned, not rotated with a turned map.
5. The More tools popover now scrolls and starts below the search box on short screens (needed for the seventh row).
6. No "Phase 1 acknowledgement of the regulatory disclaimer" checkbox: the disclaimer text is shown in the panel, dialog and spot popup; the acknowledgement belongs to submission (Phase 2).

**Not done / blockers:** real-device touch review (owner); photo, structured attributes (section 13.1 fields), submission, moderation, public layer, XP are deferred by instruction. Pre-existing failures on `main` (not caused by this work): `region-labels-unit`, `country-groups-unit`, `vn-ad-unit`, `vn-enr51-unit`, `html-components-unit`, `contrast-unit` (2), `preflight-safety-unit`, `bench-safety-unit`, `html-dom`, `fly-in`, `country-buttons`, `splash`, `window`, `prefs`, `swipe`, `sessions` when run from a worktree without the full local data (see `CURRENT_STATUS.md`).

## 1. Owner-approved requirements

| Topic | Decision |
|---|---|
| Purpose | User-recommended drone flying places, not legal authorization |
| Shapes | Polygons and rectangles |
| Private drafts | Browser `localStorage`, optional GeoJSON export/import |
| Submission | Signed-in users, explicitly initiated |
| Moderation | Admin approval/rejection |
| Reasons | Required for rejection and unpublication, optional for approval |
| Restricted-zone overlap | Allowed, including complete overlap |
| Public identity | Anonymous; no contributor attribution |
| Published edits | New revision requires approval |
| Public delivery | Online-only via Supabase, visible to guests |
| Account deletion | Retain approved areas, anonymize ownership; remove pending/rejected |
| Limits | 3–100 distinct vertices, 25 km² maximum geodesic area, five pending submissions per account |
| Text | Name 1–80 characters; description up to 500 |
| MVP exclusions | Ratings, comments, votes, videos, offline public snapshot, automated regulatory approval. One optional photo per revision and admin-controlled contribution XP are included in the agreed scope; see Sections 12 and 13.6. |

A community recommendation must **never** override the official zone layer or change the existing point-check verdict. Display: “Community recommendation, not flight authorization. Check current official restrictions and local conditions before flying.” Missing official data must not be interpreted as permission.

## 2. User journeys

1. A guest or signed-in user enters drawing mode and selects polygon or rectangle.
2. Polygon vertices are placed by taps/clicks; rectangle by opposite corners. Support undo, finish, cancel, vertex editing, keyboard and mobile touch. Drawing must not accidentally trigger map pan, hold-to-check, or interfere with rotation.
3. A form collects name, optional description and acknowledges the regulatory disclaimer.
4. **Save privately** stores a versioned local draft; **Submit for review** explicitly uploads after authentication. Retain and link the local draft to the submission ID.
5. My Areas displays private, pending, rejected and published states, with rejection reasons. Avoid rendering private/public duplicates.
6. Admin moderation queue shows geometry preview and metadata; approve/reject with required reason rules, plus unpublication with reason.
7. Public layer shows only current approved revisions and safe anonymous fields, with a disclaimer popup.

## 3. Storage and geometry

Keep areas separate from `src/poi.js`, `uavzones.v1.pois`, trips and personal cloud-copy `user_data`. Use `uavzones.v1.areas` with versioned validated local records; if storage is blocked, fall back to memory with a warning and offer GeoJSON export/import.

Persist both drawing types as canonical WGS-84 GeoJSON Polygon coordinates `[longitude, latitude]`, with a closed ring. Optional `drawKind` may retain editor intent. Server validates geometry and is authoritative: coordinate ranges/order, 3–100 distinct vertices, self-intersection, nonzero area, <=25 km² geodesic area, payload bounds and strings. Reject antimeridian-crossing polygons in MVP with an explicit message. Client mirrors validation for immediate feedback.

## 4. Proposed source files

**New:** `src/areas/core.js` (pure geometry validation and area calculation), `src/areas/store.js` (local store and export/import), `src/areas/draw.js` (Leaflet drawing), `src/areas/layer.js` (private/pending/public overlays), `src/areas/api.js` (RPC and response validation), `src/areas/ui.js` (forms/list), `src/areas/admin-ui.js` (review queue).

**Modify as necessary:** `src/main.js`, `src/map.js`, `src/styles.css`, `index.html` or the post-refactor equivalent HTML component, `src/sync/supabase.js` (reuse existing session/client), `tests/run.mjs`.

**Documentation during implementation:** `README.md`, `Project_context/docs/{PROJECT,ARCHITECTURE,DATABASE,MODULES,DEVELOPMENT,DECISIONS,CURRENT_STATUS,CHANGELOG}.md`; follow `DESIGN.md` before styling.

These paths are a proposal; reconcile them with the refactored source before Phase 1.

## 5. Database design and migrations

Use dedicated `community_areas` and `community_area_revisions` tables. Choose new unused, monotonically ordered migration filenames at implementation time.

**`community_areas`**: `id UUID` primary key, `owner_id UUID NULL` internal only, `published_revision_id UUID NULL`, `created_at timestamptz`, `unpublished_at timestamptz NULL`, and server-derived published bounding box for viewport filtering.

**`community_area_revisions`**: `id UUID` primary key, `area_id UUID` foreign key, `revision_no integer`, `name text`, `description text`, `geometry jsonb`, `status` (pending/approved/rejected/withdrawn), `submitted_at`, `reviewed_at`, `reviewed_by UUID NULL`, `review_reason text NULL`. Submitted content and geometry immutable; review state changes transactionally. Unique `(area_id, revision_no)`, one pending revision per area, and published revision must belong to that area and be approved. Avoid unsafe circular FK behavior.

Proposed migrations:
1. `*_community_areas.sql`: tables, constraints, indexes, RLS.
2. `*_community_area_api.sql`: public and owner RPCs.
3. `*_community_area_moderation.sql`: admin RPCs and audit integration.
4. `*_community_area_deletion.sql`: existing account deletion integration.

Proposed RPCs:
- `list_public_areas(bounds,cursor,limit)` and `get_public_area(area_id)` callable by `anon` and `authenticated`; approved-only, capped, anonymous safe fields.
- `submit_community_area(payload)` authenticated, server validation, idempotency key, derives owner from `auth.uid()`, five-pending limit.
- `list_my_community_areas()` and `withdraw_community_revision(revision_id)` owner-only.
- `list_pending_community_areas(cursor,limit)`, `review_community_area(revision_id,decision,reason)`, `unpublish_community_area(area_id,reason)` admin-only using existing `app_roles`.

Every table has RLS enabled; revoke direct client table writes. Use controlled `SECURITY DEFINER` functions with fixed empty search path, explicit grants, bounded inputs and no client-supplied owner or role. Public output must not include private IDs, pending/rejected revisions or reviewer data.

Extend existing append-only audit events with `area.submit`, `area.approve`, `area.reject`, `area.withdraw`, `area.unpublish`; write events atomically with state transitions. Store bounded structured metadata only; free-text moderation reasons belong in review records, not audit metadata.

## 6. Revisions, deletion and concurrency

One pending revision per area; an approved revision stays published while a replacement is pending or rejected. Review transactions check expected state; two admins cannot both finalize the same pending revision. Withdrawal does not alter an older published revision. Unpublication requires a reason and removes the area from fresh public reads.

Account deletion retains approved public geometry with null owner and anonymized internal references. Remove pending/rejected submissions and unnecessary identifying history; preserve FK integrity and idempotency. Warn users not to include identifying text in public descriptions and allow admins to unpublish inappropriate content.

## 7. Public query and performance

Online-only public layer. Fetch when enabled, by validated viewport bounds with a buffer, pagination and response caps. Debounce map movements; short (~60-second) in-memory cache; ignore stale responses and invalidate on publication/unpublication. Use server-derived bounding-box filtering, with exact geometry intersection where necessary. No PMTiles rebuild or PostGIS dependency required for MVP. If a simple bbox approximation is used, document its false positives.

## 8. Edge cases

- Restricted-zone overlap permitted, but existing regulatory verdict remains independent.
- Network failure preserves local draft; submission retries use idempotency keys.
- Sign-out retains private drafts; browser storage can be cleared, so export is the backup.
- Self-crossing/degenerate/oversized geometry rejected on client and server.
- Touch drawing, map rotation, panel stacking and popup gestures must not conflict.
- Malicious text rendered using `textContent` or safe DOM helpers.
- Anonymous users never see pending/rejected revisions or ownership data.
- Cached results must not resurrect an unpublished area after refresh.
- Public content may contain voluntary personal information despite anonymous attribution; provide warning and admin removal.

## 9. Test inventory

| Proposed test | Coverage |
|---|---|
| `tests/areas-unit.mjs` | 3/100 vertices valid; 101 rejected; invalid coordinates, self-intersection, zero area, >25 km², antimeridian, rectangle encoding |
| `tests/areas-store-unit.mjs` | Local CRUD, reload, corrupted storage, import/export, memory fallback, sign-out |
| `tests/areas-api-unit.mjs` | API response validation, idempotent retry, stale responses |
| `tests/db-areas-unit.mjs` | SQL validation, RLS, guest denial, ownership, five pending, direct writes |
| `tests/db-areas-moderation-unit.mjs` | Admin-only actions, reasons, concurrency, immutable revisions, atomic audit |
| `tests/db-areas-deletion-unit.mjs` | Retained approved content, anonymization, removal of pending/rejected, FK and idempotent deletion |
| `tests/areas.mjs` | Browser drawing/editing, undo/cancel, touch, rotation, persistence, overlays and gesture conflicts |
| `tests/areas-admin.mjs` | Queue, approve/reject, public guest visibility, resubmission and unpublication |

Run impacted existing map, point-check, theme, POI, auth, audit, deletion and browser suites, `npm run test:unit`, and full `npm test` with the app on port 5173. Inspect actual results before claiming success.

## 10. Implementation phases and gates

1. **Local drawing and storage:** guest drawing/editing/export/import and touch/rotation tests pass.
2. **Submission and backend:** PGlite migrations, authenticated ownership, idempotency, limits, no public leakage pass.
3. **Moderation:** admin approve/reject, reason rules, concurrency, audit and permission tests pass.
4. **Public layer:** guest approved-only view, viewport loading, caching, anonymity and regulatory independence pass.
5. **Revisions and deletion:** pending replacement preserves published version, unpublication and account-deletion anonymization pass.
6. **Release:** full tests, owner real-device review, docs/security/performance; hosted migration and `deploy:live` only after explicit approval.

Each phase requires owner authorization. Inspect `git status`, recent commits, `CURRENT_STATUS.md` and relevant docs before editing. Follow existing change-workflow, supabase-change and test-impact guidance. The progression-specific standing commit/deploy rule does not authorize this feature.

## 11. Relationship to refactor

The HTML/main.js refactor is complete. Before implementation, reconcile the proposed file paths and initialization seams with the current component ownership map in `Project_context/docs/MODULES.md`, the `src/components/` fragments and `src/app/` startup modules. Do not repeat the refactor or treat the proposed paths in section 4 as mandatory if the current architecture has a clearer owner.

## 12. Contribution XP for accepted community areas — APPROVED POLICY; IMPLEMENTATION NOT STARTED

**Product intent:** Recognize useful community contributions without turning submissions into a volume-based farming mechanism. XP is a moderation outcome, not a reward for merely submitting a polygon.

### 12.1 Admin approval workflow

- Add an `Award contribution XP` checkbox to the administrator's approval action. It is **enabled by default**; the administrator can untick it to approve and publish without a reward (for example, a duplicate, marginal or low-value contribution).
- When enabled, show an admin-controlled slider for the reward amount: **100–500 XP, in 100 XP increments** (100, 200, 300, 400 or 500 XP). The initial slider value is **100 XP** as the conservative default; the administrator may increase it for an especially useful contribution.
- Show the selected amount beside the slider and in the final confirmation before approval.
- The controls are available only when approving a submission/revision; rejecting, withdrawing or merely editing a record never awards XP.
- The admin-only review interface may identify the submitter; public area responses and public map UI must remain anonymous.
- The reward remains optional and does not affect whether geometry is published. An administrator can approve with the checkbox off.

### 12.2 Eligibility and one-time policy

- One reward at most per `community_areas.id`, on approval of its first published revision.
- For the first publication, award at most once for the initial area contribution.
- For an already-published area, a **materially improved revision may independently earn one reward** when approved. Each revision can be rewarded at most once; retries, concurrent moderation, re-approval and duplicate calls for that same revision cannot create another award.
- A rejected or withdrawn revision earns nothing. If corrected and resubmitted, only the eventual approved revision is eligible; the earlier rejected/withdrawn revision is never paid.
- Revisions that are merely cosmetic or do not materially improve the area's usefulness should be approved without XP. The administrator makes this judgement and may untick the reward checkbox.
- A newly created area that duplicates another area is a separate candidate only if an administrator explicitly approves it and elects to award XP; consider duplicate detection/moderation separately, not as an automatic geometry-merging feature.
- Unpublishing an area later does not automatically claw back XP. Fraud or abuse can be handled through the existing administrator XP adjustment mechanism with a reason; do not silently mutate or delete the original ledger row.
- No XP for private drafts, pending submissions, self-approval (if the submitter is an administrator), or a revision that is not materially useful. The reward applies to the contributor who submitted the specific approved revision, not automatically to the area's original creator.

### 12.2a What qualifies as a material improvement — PROPOSED MODERATION GUIDANCE

Examples of improvements that may merit XP when supported by credible local knowledge or evidence:

- **Boundary correction:** fixing an inaccurate, incomplete or misleading polygon boundary; moving vertices to better reflect the actual usable site.
- **Coverage completion:** adding a genuinely missing part of the same flying area or correcting an omitted section. Do not split disconnected places into one area merely to inflate coverage; the MVP geometry type remains Polygon unless separately approved.
- **Removal of false coverage:** trimming parts incorrectly shown as usable, such as inaccessible land, buildings, water, fenced/private property or other unsuitable portions. A smaller, more accurate area can be a valuable improvement.
- **Material site-information correction:** updating the description with useful, verifiable practical information that materially changes a pilot's understanding of the location, such as access limitations, landowner permission requirements, operating-hour constraints or significant site hazards. The existing form only has a name and description; do not add new structured fields or photos as part of this XP change.
- **Evidence-backed revalidation:** updating an area when its physical layout or access conditions have changed, with a clear explanation of what changed and why the new revision is more reliable.

Examples that should normally be approved without XP:

- Spelling, punctuation, formatting or cosmetic name changes.
- Re-submitting identical or nearly identical geometry without a substantive explanation.
- Tiny vertex adjustments that do not improve practical accuracy.
- Rewording a description without adding useful information.
- Unsupported speculation, duplicate areas or changes that make the area less accurate or less safe to interpret.

The admin should see a concise revision diff/summary (old versus proposed geometry and text) before deciding. The contributor's free-text explanation is supporting context, not proof by itself. XP is not automatically calculated from polygon size, vertex count, number of edits or the amount of text changed.

**Safety boundary:** community-area edits remain recommendations, never regulatory clearance. A revision must not erase, override or weaken official airspace restrictions or point-check results. Where a proposed change concerns permission to access private land or fly at a site, require credible supporting context and retain the standard community disclaimer.

### 12.3 Backend and ledger design

- Add a dedicated XP source, proposed name `community_area`, to the `xp_ledger.source` constraint and the internal `award_xp()` allowlist through a new migration. Follow the current `PROGRESSION.md` instructions for introducing a source.
- The approval RPC must validate the submitted reward amount server-side: only 100, 200, 300, 400 or 500 are accepted when the reward checkbox is enabled. Never trust the client slider alone.
- Award only inside the same security-definer transaction that successfully approves and publishes the first revision. Derive the recipient from the server-stored submitter/owner; never accept a target user ID from the client.
- Use a deterministic unique reference per contribution, proposed `area-revision:<revision_id>`, with the existing `(user_id, source, ref)` ledger uniqueness as an idempotency guard. Enforce at most one award per revision, while allowing distinct materially improved revisions to earn separate rewards.
- Add an internal `submitted_by`/contributor identity to each revision (or an equivalent immutable server-side attribution field). The existing area-level `owner_id` alone is insufficient to identify the person who submitted a later improvement. Never expose this identity through public RPCs. Apply the account-deletion anonymization policy to revision-level identities as well.
- Call the existing internal `award_xp()`; do not write `xp_ledger` or `user_xp` directly. Existing ledger triggers must continue to update totals and rank progression.
- Record the actor, recipient, selected amount and area reference in the ledger. Extend the `area.approve` audit event metadata with whether XP was awarded and the amount, without exposing the submitter publicly. The approval, ledger entry and audit event must commit or roll back together.
- Keep `award_xp()` and all direct ledger writes inaccessible to client roles. Only the admin-only approval RPC can request this reward.
- Account deletion retains approved geometry but follows existing progression deletion rules for the contributor's XP account; do not create a separate identity or permanent XP record for anonymized contributors.

### 12.4 Reward amount — owner decision recorded

- **Approved control:** an admin slider from **100 to 500 XP**, stepping by **100 XP**.
- **Approved default:** the `Award contribution XP` checkbox is enabled by default.
- **Initial slider value:** **100 XP**, chosen as the conservative starting value; the admin may select a higher amount up to 500 XP for a particularly useful contribution.
- The amount is chosen per qualifying first approval, is stored in the immutable XP ledger row and cannot be changed by editing or re-approving the area.

### 12.5 Tests

Add/extend database tests to prove:

- Only an administrator can approve and award; guests, submitters and organisers without admin authority cannot.
- Approval without the reward option publishes normally and creates no XP row.
- Initial approval with the reward option creates exactly one `community_area` ledger row for the initial contributor.
- A materially improved revision can earn one separate award for that revision's submitter; two distinct approved revisions may each earn once.
- Repeated RPC calls, concurrent approval attempts, retries and re-approval of the same revision cannot duplicate its reward.
- Rejected, withdrawn, pending, private, self-approved and cosmetic-only revisions do not earn XP.
- The XP ledger trigger updates totals/rank correctly; the admin audit record and ledger amount agree.
- A failed approval transaction cannot leave a published area without its corresponding requested reward, or an XP award for an unapproved area.
- Public RPCs never expose contributor identity, XP award metadata or moderation internals.
- Account/profile deletion follows the existing XP wipe and approved-area retention rules.

### 12.6 UI and documentation

- Show the optional reward control and configured amount only in the admin approval UI.
- Show a neutral confirmation/result to the administrator after success (published; XP awarded or not awarded).
- Do not display contributor XP details on the public map or public area popup. The contributor may see the resulting XP through the existing private progression history; avoid adding a separate reward history UI.
- Update `PROGRESSION.md`, `DATABASE.md`, `DECISIONS.md`, `CURRENT_STATUS.md` and the audit documentation when implementation is approved.

**Approved policy:** the same optional 100–500 XP slider applies to the first accepted contribution and to each materially improved, accepted revision. Each approved revision can receive at most one award. The checkbox is enabled by default; the slider starts at 100 XP. The admin decides whether the improvement merits a reward and selects its amount. The examples and non-qualifying cases above guide that decision; they do not create automatic XP eligibility. No implementation is authorized by this proposed section.

## 13. Proposed flying-spot attributes — OWNER REVIEW
### 13.5 Pilot setup spots — OWNER DECISIONS RECORDED

**Approved name:** **Pilot setup spots**. This describes places where pilots can sit, shelter themselves, lay out equipment and organize their flying session. It does not imply that the point is an approved take-off/landing location or that flying is permitted there.

A community flying area may contain zero or more setup spots. Contributors can add these while drawing or editing the parent area's submission. They are subordinate point annotations inside the parent area, not separate community flying areas and not additional flying-zone polygons.

#### Supported MVP spot types

| Type | Meaning |
|---|---|
| Pavilion / shelter | Covered structure where pilots may sit and set up equipment, subject to access rules. |
| Seating / picnic area | Benches, tables or designated picnic/seating area suitable for organizing equipment. |
| Open setup space | An open, relatively convenient spot within the area where pilots can place chairs and equipment. |
| Other setup spot | Another useful place to organize a session; explain briefly in the optional note. |

Each setup spot contains:
- A WGS-84 point coordinate.
- One required type from the fixed list above.
- An optional short note (bounded text; suggested maximum 120 characters), e.g. “Covered pavilion with picnic tables” or “Open grass beside the path”.
- No contributor identity or XP fields in public output.

#### Authoring and validation

- Allow contributors to add, move and remove multiple setup spots while editing the parent area's private draft.
- Setup spots must be inside or on the boundary of the parent community area. Reject or visibly flag out-of-area points before submission; server-side validation is authoritative.
- Enforce the approved per-area maximum of **10 spots** to avoid clutter and oversized submissions.
- Setup spots are included in the same submitted revision as the parent geometry and attributes. They are reviewed, approved, rejected, withdrawn, versioned, unpublished and deleted with that revision/area; do not create an independent moderation workflow.
- A correction to a setup spot in an existing published area is a new revision. It may qualify as a material improvement under Section 12, but an XP award remains an explicit admin decision and is subject to the per-revision one-time rule.
- Do not require contributors to map every pavilion or seating location. Zero spots is a valid submission; absence of a marker means “not mapped”, not “no shelter or setup facilities exist”.
- Do not infer accessibility, availability, public access or permission from the presence of a spot. Contributors must use the parent area's access attribute and optional note for relevant caveats.

#### Map presentation

- Display setup spots as small, distinct icons inside the parent community area, visually different from the area boundary and from official airspace markers.
- Use a simple fixed icon per type (shelter, seating, open setup, other). The detail view should show the type and optional note.
- Show these markers only at **Leaflet zoom level 13 or higher** (zoom 13 and closer) or when the parent area is selected, to avoid nationwide/regional map clutter. The threshold may be tuned later through mobile testing.
- Selecting a setup spot opens a compact detail card and identifies its parent community area. Do not make it behave as an independent saved POI or trip marker.
- Keep the parent area's community disclaimer available. A setup spot is a practical location hint, not authorization to enter the site, set up equipment or operate an aircraft.

#### Storage and moderation implications

- Store the setup-spot collection within the immutable community-area revision (for example, a bounded JSONB array of typed points and notes), rather than on the parent area, so geometry, attributes and setup locations are reviewed and published atomically.
- Validate count, coordinates, type enum, note length and point-in-parent-polygon on both client and server.
- Include setup-spot additions, removals, moves and note/type changes in the administrator's old-versus-new revision comparison.
- Public RPCs expose only the approved revision's spot coordinates, type and note; never expose contributor/reviewer identity, pending edits or moderation metadata.
- This is separate from the user's existing Saved Places/POI system. Do not write setup spots into `uavzones.v1.pois`, trips, or personal cloud-copy data.

**Approved decisions (2026-11-27):** name “Pilot setup spots”; maximum 10 per area; individual markers shown at Leaflet zoom level 13 or higher; fixed “Other setup spot” category enabled. The optional note maximum remains 120 characters. These decisions do not authorize implementation.


**Design principle:** Geometry answers where the community-recommended area is. A small set of structured attributes should explain what the location is like, what activities it may suit, whether public access or landowner permission is required, what hazards contributors have observed, and how recent the information is. These attributes are community observations, not verified flight permission or regulatory status.

### 13.1 Recommended MVP fields

Keep the existing name (required, 1–80 characters) and description (optional, up to 500 characters). Add the following structured fields to each submitted revision:

| Attribute | Requirement | Suggested values / behavior | Why it matters |
|---|---|---|---|
| Site environment | Required single-select | Open field, park/recreation area, beach/coast, open water, hill/high ground, woodland/green space, built-up/urban space, other, unknown | Gives a quick sense of the physical setting. |
| Suitable activity | Optional multi-select | FPV freestyle, cinematic, cruising/general multirotor, long-range, fixed-wing, other / not sure | Helps users assess whether the space matches their intended type of flying. These are community suitability tags, not legal permission or a safety rating. |
| Access / permission | Required single-select | Public access (subject to local rules), permission required, private/restricted access, unknown / not verified | Prevents a map pin from implying that the public may enter or launch there. Never infer landowner or park permission from the fact that a spot is mapped. |
| Ground / launch surface | Optional single-select | Grass, paved/concrete, dirt, sand, rock, mixed, unknown | Useful for take-off/landing practicality and equipment choice. |
| Known site hazards | Optional multi-select | People/crowds, roads/traffic, power lines, trees/structures, water, wildlife, uneven/obstructed ground, nearby official airspace restrictions, other, none reported, unknown | Surfaces practical hazards. “None reported” must not be presented as “hazard-free”; keep it distinct from “unknown”. |
| Last observed | Optional date | Date the contributor last personally visited or checked the site; do not default it to submission date | Lets users judge freshness instead of treating old observations as current. |

Name and description remain the primary text. If “other” is selected for a categorical field, allow a short bounded clarification in the description rather than adding many free-text columns.

### 13.2 Presentation

- Show the environment and access/permission status prominently in the public area detail.
- Show suitable-activity and ground-surface tags as secondary information.
- Show known hazards clearly, without alarmist styling. If access is “permission required”, “private/restricted” or “unknown”, display that prominently and do not imply walk-in access.
- Show “Last observed [date]” where supplied; otherwise show “Last observation date not provided”. Do not substitute the last edit, approval or publication date.
- Keep the regulatory disclaimer visible: community recommendations do not establish permission to enter land or permission to fly. Users must check current official restrictions and local conditions.
- Public map pins should remain visually subordinate to official airspace layers. Attributes must never change point-check verdicts, airspace colors or legal classifications.
- Public output remains anonymous and must not expose contributor, reviewer or XP information.

### 13.3 Fields deliberately deferred from MVP

Do not add these unless separately approved:

- Videos, comments, ratings, likes, votes or popularity scores. (One optional location photo per revision is proposed separately in Section 13.6.)
- Live weather, wind readings, crowd estimates or live occupancy.
- Detailed frequency/interference reports or claims of RF-clearance.
- Exact opening hours, contact details, landowner names or personal contact information.
- Automatic “safe to fly”, legality, permission or suitability scores.
- Separate amenity inventories (parking, toilets, shops, charging) unless user feedback later demonstrates a clear need.
- Arbitrary user-defined tag systems.

These are prone to becoming stale, require more moderation, can expose personal information, or risk making a community observation look like an authoritative safety assessment.

### 13.4 Data and moderation implications

- Store these attributes with the immutable revision, not only on the parent area, so a revised submission captures the exact attributes the administrator reviewed and approved.
- Validate all enum values and date formats on both client and server. Bound any additional text; render it as text, never HTML.
- The admin review view must compare the currently published revision with the proposed revision's geometry and structured attributes.
- Changes to access status, hazards, environment or activity tags are reviewable revision changes. They may qualify as material improvements under Section 12, but XP remains an explicit admin decision; field changes do not automatically earn XP.
- Missing or unknown attributes must remain unknown. Do not infer “public access”, “no hazards” or activity suitability from geometry, basemap labels or other users' submissions.
- Keep the attribute set intentionally small. Do not introduce a general custom-schema or user-defined taxonomy engine in the MVP.

**Open owner decisions:** confirm the proposed MVP field set and whether “other” should be available for environment, activity and hazard categories. This section is a design proposal and does not authorize implementation.


### 13.6 Optional location photo — APPROVED CONCEPT; IMPLEMENTATION DETAILS TO CONFIRM

Allow each submitted community-area revision to include **zero or one photo** showing the location or its practical setup conditions. This is optional; a submission without a photo remains fully valid.

**Approved concept:** Each community-area revision may include zero or one optional location photo. A submission without a photo remains valid.

**Purpose and scope**
- Show useful context that geometry and structured fields cannot convey (for example, what a pavilion, shelter, seating area or open setup location looks like).
- The photo should depict the site or a relevant setup spot, not serve as a profile picture, promotional gallery or evidence that flight is legally permitted.
- One photo is attached to the revision as a whole. Do not add separate photos for every Pilot setup spot in the MVP.
- Replacing or removing the photo on an already-published area creates a new revision and goes through the same moderation process. The previously approved revision and its photo remain public until the new revision is approved.

**Upload constraints — proposed defaults**
- Maximum **one photo per revision**.
- Accept JPEG, PNG and WebP only; reject SVG, GIF, animated formats and all other file types.
- Maximum original upload size: **5 MB**.
- Client-side resize/compression to a longest edge of approximately **1600 px**, preserving aspect ratio; show a preview and allow removal/replacement before submission.
- Server-side validation of actual file signature, MIME type, dimensions and size; never trust the filename or client-provided content type.
- Strip EXIF and other metadata, especially GPS coordinates, device identifiers and timestamps, before publication. The photo's location is represented by the community-area geometry, not hidden image metadata.
- Generate a random, non-guessable object key. Never use a user-supplied filename as a storage path. Do not expose storage paths containing contributor identity.
- No external image URL or hotlinking; store the image in the project's controlled Supabase Storage.

**Privacy and publication lifecycle**
- Uploads remain private and inaccessible to anonymous users while a submission/revision is pending, rejected or withdrawn.
- Publish the photo only when its parent revision is approved. Public area RPCs return a photo reference only for the currently approved revision.
- Do not use a publicly readable bucket for unmoderated uploads. Use private quarantine storage and an explicit approved-publication path (for example, copying a validated image to a separate public bucket only inside a trusted server-side workflow, or a controlled image-serving function that checks approved revision state). Select the simplest secure implementation after verifying the current Supabase project capabilities; never expose pending/rejected objects through predictable URLs.
- If a new revision is rejected or withdrawn, keep the previously approved photo available. Clean up the unapproved upload according to a bounded retention policy.
- Unpublishing an area removes its photo from fresh public access as well. Cached public image URLs must not bypass the unpublish decision; use versioned objects and a documented cache lifetime/invalidation strategy.
- When the contributor deletes their account, retain a photo belonging to an approved area only if it remains part of the retained approved community content; remove private, pending, rejected and otherwise unapproved uploads. Strip personal metadata and anonymize ownership consistently with Section 6.
- Admin moderation must preview the image before approval and provide a way to reject the photo or remove/unpublish it if it is inappropriate, identifying, unrelated, copyrighted without permission, or unsafe. A photo issue must not silently change geometry approval; the moderator can require a corrected revision or approve the area without a photo if the data model and review workflow support that outcome.
- Warn contributors not to upload images containing faces, vehicle registration plates, private property interiors, personal contact details or other identifying information. Avoid collecting unnecessary personal information.
- Do not send images to third-party recognition, moderation or analytics services in the MVP.

**Implementation and operational implications**
- Supabase Storage is not currently part of the community-area implementation architecture; confirm bucket, object policy, upload and publication design before coding.
- Prefer a private staging/quarantine bucket and a separate approved-public delivery path, with server-side authorization for the transition. Do not assume that a private database row makes an object in a public bucket private.
- The object reference belongs to the immutable community-area revision. Enforce one photo reference per revision and prevent clients from attaching another user's object.
- Submission idempotency must not create duplicate objects. Failed submission or approval must leave no publicly accessible orphan; add cleanup for abandoned uploads.
- Include photo presence and replacement/removal in revision comparison. The photo is optional and must not affect XP eligibility automatically; an admin may consider a genuinely useful photo as supporting evidence when deciding whether a revision merits XP under Section 12.
- Add tests for upload authorization, anonymous denial before approval, approved guest display, rejected/withdrawn cleanup, account deletion, invalid MIME/signature, oversized/dimension-invalid images, EXIF stripping, orphan cleanup and unpublish/cache behavior.

**Owner decisions still required:** confirm the technical upload details (JPEG/PNG/WebP only, 5 MB original limit, approximately 1600 px client resize, metadata stripping and private-until-approved publication strategy). The one-optional-photo-per-revision product decision is approved. This section does not authorize implementation of photo storage or uploads.

### 13.7 Owner decisions recorded — Pilot setup spots

| Decision | Approved value |
|---|---|
| Name | Pilot setup spots |
| Maximum per community area | 10 |
| Map display threshold | Leaflet zoom level 13 or higher; may also display while parent area is selected |
| Other category | Enabled as a fixed category; optional short note can clarify it |

Setup spots remain subordinate point annotations included in the parent area's immutable revision. They are submitted, reviewed, published and unpublished together with the parent revision. No separate moderation, public identity or XP mechanism is introduced.
