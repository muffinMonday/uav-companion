# Community Flying Areas — Approved Product Specification and Implementation Backlog

**Status:** PLANNED — NOT IMPLEMENTED; active design discussion on `docs/community-areas-design`.  
**Decision date:** 2026-11-13; discussion baseline refreshed 2026-11-27.  
**Review baseline:** `main` at `91df30d65562b32c63c051babfd0a34e9707b17c` (PR #15 merge).  
**Authorization:** Backlog/design edits only on this branch. Feature implementation, hosted migrations, implementation commits/merges and production deployment require separate explicit owner approval.  
**Architecture dependency:** The HTML/main.js refactor is complete. Before implementation, reconcile proposed paths and initialization seams against the current `src/components/`, `src/app/`, `Project_context/docs/MODULES.md` and source code.

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
| MVP exclusions | Ratings, comments, votes, photos, XP rewards, offline public snapshot, automated regulatory approval |

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

## 12. Contribution XP for accepted community areas — PROPOSED, NOT YET APPROVED

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

- Photos, videos, comments, ratings, likes, votes or popularity scores.
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
