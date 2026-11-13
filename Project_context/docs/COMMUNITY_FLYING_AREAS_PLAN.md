# Community Flying Areas — Approved Product Specification and Implementation Backlog

**Status:** PLANNED — NOT IMPLEMENTED.  
**Decision date:** 2026-11-13.  
**Authorization:** Planning only; owner must explicitly approve implementation, migrations, commits, pushes and deployments.  
**Dependency:** Revisit file paths and UI ownership after the HTML/main.js refactor.

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

Before implementing Community Flying Areas, read `HTML_MAIN_REFACTOR_BACKLOG.md`. Once that refactor is complete, revise this plan's component paths and initialization seams, without reopening approved product policy unless the owner requests it.
