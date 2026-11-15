# UAV Companion — Mascot & Personality Integration Backlog

**Status (2026-11-15):** In progress. Owner approved the reviewed plan (Phases 0 to 2) and authorized commit, push and one `deploy:live` for this work only; Phase 3 is deferred (below). Phase 1 scope was merged and trimmed in review: splash, dashboard greeting and Help intro only (no What's New art); Phase 2 covers Trips, Saved Places and Discover only (Friends and My sessions held). Tinkering and thumbs-up ship nothing yet. Evidence: section 11.  
**Target repository:** `muffinMonday/uav-companion`  
**Backlog location:** `Project_context/docs/backlogs/in-progress/MASCOT_PERSONALITY_INTEGRATION.md`  
**Scope:** Static assets, frontend presentation, app icon/manifest, targeted tests and documentation. No backend, database, permission or deployment changes authorized.  
**Asset source of truth:** Existing locally supplied files in `public/mascots/` (see below). Treat them as owner-approved artwork, not generation prompts.

## 0. Preflight and repository conventions

Before making changes, Claude must:

1. Read `CLAUDE.md`, `Project_context/AGENTS.md`, and the on-demand project docs specified there (`Project_context/docs/CURRENT_STATUS.md`, `SMALL_FIXES.md`, `MODULES.md`, `DESIGN.md`); inspect `git status`, `git log -3`, and latest actual code before planning implementation.
2. Check for uncommitted work. The mascot PNG files may appear as **untracked** (`U`) in the local editor; **do not discard, overwrite or ignore them**.
3. Confirm these exact case-sensitive paths exist **locally** before touching code. They may not be visible on GitHub until added and committed. Work from the local checkout; do not substitute images from remote, web search, or AI generation.
4. Run file/type/dimension/transparency checks on each PNG and visually inspect composition before optimizing. Do not assume all five have transparent backgrounds: `icon.png` is the full square artwork with a dark navy topographic background; other PNGs are intended to be transparent character illustrations, but verify alpha channels.
5. Compare with any newly changed source and existing tests. Source code prevails over older documentation.
6. Obtain explicit owner permission before implementing, committing, pushing, or deploying. Approval for one step does not authorize other steps.

## 1. Exact asset inventory and usage mapping

**Existing asset directory: `public/mascots/`**

| Exact existing path | Variant | Intended use | Notes |
|---|---|---|---|
| `public/mascots/icon.png` | Full square FPV pilot against dark navy topographic map background | **Application icon**: favicon derivatives, Apple touch icon, web manifest icons, future Android branding | Do not treat as a transparent inline mascot; preserve designed background. |
| `public/mascots/thinking.png` | Thinking pilot | Dashboard Help introduction; Trips, POI, Sessions and Friends empty states | Decorative, never shown in warnings or errors demanding immediate action. |
| `public/mascots/thumbsup.png` | Pilot giving thumbs-up | Achievement unlocks and genuine rank promotions | **Use `thumbsup.png`, not `celebrating.png`.** Only confirmed progression milestones. |
| `public/mascots/tinkering.png` | Pilot soldering electronics | Reserve for future troubleshooting/FPV hardware guidance | Do not force into current UI; include as an available supported asset variant. |
| `public/mascots/waving.png` | Waving pilot | First-run Quick Setup, dashboard welcome, What's New | Main warm branding pose. |

**Asset rules:** These exact filenames and relative paths are canonical. No files named `welcome.webp`, `celebrating.webp`, or `exploring.webp` currently exist. Do not reference nonexistent filenames in code. Do not regenerate any mascots. If optimizing images, keep original PNGs intact and produce optional derived files with explicit source mapping and visual QA; prefer using the existing PNGs in the first implementation unless a measured performance issue warrants derivatives. Vite's `base: './'` and static-host subpath must be respected for runtime URLs and manifest paths. Keep names and capitalization exact.

## 2. Product and UX intent

Introduce personality without weakening the application's technical reliability. The mascot is a **decorative guide and brand character**, not a chatbot or assistant. It can welcome, orient, explain empty states, and celebrate real milestones. Maps, flight-safety verdicts, regulatory disclaimers, precise values, functional controls, and location privacy always take visual priority.

Design constraints:

- Use existing design tokens and 4-px spacing rhythm from `Project_context/docs/DESIGN.md`; do not redesign navigation, dashboard structure, side panel, or themes as part of mascot integration.
- No persistent mascot overlay on Leaflet, marker popups, airspace verdicts, regulatory warnings, check-in/location notification surfaces, destructive confirmations or dense lists.
- Each screen has at most one primary mascot illustration in its active content. Do not put it inside each dashboard card or every Help hint.
- Images are decorative (`alt=""`, not keyboard-focusable); surrounding text communicates the intended message. Preserve screen-reader focus, keyboard flow, accessible labels and 44px touch targets where required.
- Responsive: avoid overlap, crop, layout jumps, undue scroll or obscured controls on narrow/short phones, tablet and landscape. Preview at small dimensions and 200% text zoom. Respect reduced motion; static preferred.
- Image contrast against both light/dark themes. Avoid heavy backgrounds or shadows that compete with original art.

## 3. Phase 0 — Application icon and brand identity (P0)

**Source:** `public/mascots/icon.png` — **not** `waving.png` or other transparent variants.  
**Relevant files:** `index.html` currently has an inline teal-circle SVG favicon; `vite.config.js` has `base: './'`; `public/` contains no established icon set or web manifest at the reviewed HEAD.

Implementation:

1. Use the source `icon.png` to create appropriately optimized favicon/app-icon derivatives under `public/icons/`, e.g. `favicon.ico` (16, 32, 48 embedded), `favicon-32.png`, `apple-touch-icon.png` (180), `icon-192.png`, `icon-512.png`, and an explicitly re-composed `icon-maskable-512.png` if a safe margin can be achieved. Do not claim an unmodified full-bleed source image is maskable without verification.
2. Review 16/32/48 px renderings: the existing full-body composition may lose readability. If needed, create a head/goggles-focused **crop of the provided icon only** for small favicon sizes, keeping the owner-approved style. Do not replace source art with a newly generated drawing.
3. Replace the `<link rel="icon" ...>` inline SVG in `index.html`; add suitable `apple-touch-icon` and a manifest reference.
4. Create minimal `public/manifest.webmanifest` with app name, short name, icons, theme/background/display, **deployment-compatible relative paths and start URL**. Verify behavior on GitHub Pages subpaths; do not assume an origin-root `/` icon URL works. Do not add a service worker or promise full offline PWA capability.
5. Preserve `meta[name="theme-color"]` unless there is a deliberate, reviewed reason to change it; do not change existing startup theme logic.
6. Check generated assets and their URLs in the local build output and deployed-path simulation. Native Android packaging is out of scope.

Acceptance: browser favicon is no longer the generic teal circle; shortcut and manifest icons use the intended icon with no important feature clipped; paths survive Vite build/static subpath; no functional regression.

## 4. Phase 1 — Core mascot touchpoints (P0)

### 1.1 First-run Quick Setup

- **Source:** `public/mascots/waving.png`
- **Owner:** `src/splash.js` (`choose()`), dashboard-linked Quick Setup flow; styling in `src/styles.css`.
- Place a modest greeting illustration beside/above the existing first question. Preserve Plan a trip, Plan a flight, guest/profile choices, Learn the map, Skip, and orientation behavior.
- Prefer existing question wording or a short optional line like “Welcome aboard!”; no new step. On short phones keep both primary choices reachable without oversized scroll.

### 1.2 Dashboard greeting

- **Source:** `public/mascots/waving.png`
- **Owner:** `src/dashboard.js` → `welcomeLine()` / `.dash-welcome`.
- Put a compact character at the right of the greeting, with the existing text/trip information on the left. Suggested height 64–88px on roomy screens, reduced (or hidden if spatially necessary) on tight mobile layouts. No new card; none in peek strip or hidden tab.
- Preserve `startState` logic, store-driven greeting, and mobile panel/dashboard coexistence.

### 1.3 Dashboard Help introduction

- **Source:** `public/mascots/thinking.png`
- **Owner:** `src/dashboard.js` → `helpView()`.
- One modest illustration in the Help header/introduction; keep existing six `details` Help topics, topic state, hint replay, Back focus, and Quick Setup entry.
- Do not put images into once-only contextual popups implemented in `src/help-ui.js`.

### 1.4 What's New card

- **Source:** `public/mascots/waving.png`
- **Owner:** `src/dashboard.js` → `whatsNewCard()`, not a rewrite of `src/whatsnew.js` content.
- Small right-aligned graphic in the existing announcement card. Do not change unseen-entry detection, marking as seen, opening behavior, or MAX_NEW.

Phase 1 acceptance: existing dashboard and splash flows unchanged; no overflow/obscured controls; only the intended first-run, Help and announcement contexts show the appropriate art.

## 5. Phase 2 — Meaningful empty states (P1)

Reuse `thinking.png` and a lightweight empty-state layout. Preserve exact empty-data semantics and existing actions.

| Screen | Owner / integration point | Condition | Behavior |
|---|---|---|---|
| Trips | `src/components/trips-panel.html` `#trips-empty`; `src/trips-ui.js` | No trips | Thinking mascot + concise encouragement; preserve existing `#trip-new` button and create flow. |
| Saved Places | `src/components/poi-panel.html` `#poi-empty`; `src/poi-ui.js` | No saved markers | Thinking mascot; retain Add a marker affordance. **Do not confuse zero filtered results with zero saved markers.** |
| Flight Sessions Discover | `src/sessions-hub.js` `drawDiscover()` | Loaded successfully with no matching sessions | Small thinking illustration; suggest adjusting filter or planning a session. No image while loading/error. |
| Flight Sessions My/Joined | `src/sessions-hub.js` `drawMine()` | Truly empty joined/hosted grouping | Apply only if visual review shows benefit; avoid repeated image per empty subheading. |
| Friends | `src/friends-ui.js` (verify exact renderer) | No connections | A single thinking illustration + a real actionable next step; do not add to blocked lists/permission prompts. |

Acceptance: every empty-state illustration disappears when data arrives; no extra full-height cards or modal interruptions; controls still work; no illogical empty artwork on loading/error results.

## 6. Phase 3 — Progression and achievement celebration (P1/P2)

**Source:** `public/mascots/thumbsup.png`.  
**Inspect first:** `src/progression-ui.js`, `src/progression.js`, `src/progression-api.js`, `src/account-ui.js`, and any session XP refresh/change flows.

- Use only for **confirmed** rank promotions or newly unlocked achievements for the signed-in user. No generic celebration on profile load, on opening another player's profile, or for every XP increment.
- A user-friendly, dismissible, accessible presentation may reuse an existing dialog/card rather than introducing a new permanent overlay; avoid interrupting map point selection or critical workflows.
- Determine server-authoritative change signals before implementing. If no reliable event is available, **do not invent client-side unlock detection or localStorage semantics**: document the blocker and obtain approval for a follow-up design.
- Prevent duplicates across refresh/reload and repeated requests; handle first sync, stale data, offline recovery and multiple unlocks coherently. Avoid falsely congratulating users for previously attained ranks.
- No confetti, sound, new trophies or animated decorations. Text must make the milestone clear independently of the image.

Acceptance: celebration occurs only once per genuinely new milestone, at a suitable non-disruptive moment, with explicit close/focus behavior and no regression to progression privacy or API behavior.

## 7. Shared implementation strategy

- Consider a minimal `src/mascot-ui.js` exposing e.g. `mascotEl('waving' | 'thinking' | 'thumbsup' | 'tinkering', options)` with a **literal, centralized** mapping to the existing PNG names. `icon.png` belongs to static branding assets, not the inline mascot API.
- Reuse current DOM `el()`/`textContent` patterns and `src/styles.css` tokens. Do not add a UI framework or generic component architecture.
- Maintain meaningful intrinsic size and CSS aspect-ratio/object-fit; apply `loading="lazy"` to below-fold images, but not to primary first-run artwork. Avoid re-downloading/regressing layout with dashboard redraws (browser cache and bounded sizing).
- For deployment subpaths, resolve static URLs using project-supported Vite base-aware patterns; don't blindly hardcode root-relative `/mascots/...` in HTML/JS if hosted under `/uav-companion/`.
- Keep existing PNG filenames unchanged. Derived/compressed images are optional, with source traceability and appearance verification.

## 8. Tests and QA

Before/after screenshot comparisons following existing `scripts/ui-baseline.mjs` and `Project_context/docs/DESIGN.md` conventions:

- 390x844, 412x915, 700x850, 850x700, 768x1024, 1440x900 and short landscape where supported; both light/dark themes.
- First run, returning visit, dashboard expanded/peek/hidden, Help, What's New unread/seen, no trips, no markers, filtered-out marker list, empty Sessions, Friends empty, signed-in progression with/without new milestone.
- Validate accessibility (decorative image alt, keyboard/focus, text zoom), responsiveness, SVG/icon sizes, image clipping and loading speed; ensure no map controls are covered.
- Functional suites: `tests/dashboard.mjs`, splash/onboarding/discover/help, POI/trips, sessions, progression as applicable (discover actual test names from repo). Use `npm run test:unit`, `npm test`, `npm run build` before declaring release-ready. Record test limits honestly.
- Test manifest and favicon requests with the actual deployment base path; check `dist/` contents and avoid missing asset 404s.

## 9. Non-goals, safety, and release gates

**Out of scope:** backend/Supabase/schema/migrations, new permissions/analytics, animation, chatbot, persistent map helper, native Android port, app-store assets, changes to map zones/flight advice, unrelated navigation redesign.

**Gates:**

1. **Phase 0:** Owner visual approval of favicon small-size crop and maskable variant.
2. **Phase 1:** Owner approval of 4 core placements after screenshots at representative widths.
3. **Phase 2:** Owner approval of each empty-state pattern, avoiding over-decoration.
4. **Phase 3:** Confirmed event semantics and owner approval before milestone celebrations.
5. **Release:** Tests, visual QA, documentation, and explicit authorization for commit/push/deploy.

Follow `Project_context/AGENTS.md` backlog lifecycle; keep this proposed file under `for-review/` until authorized, update references/checkpoint when moved to `in-progress/` and later `completed/`. Maintain a separate handoff file under `Project_context/docs/handoffs/active/` only when needed and archive it when no longer actionable. Do not silently mark complete or deploy.

## 10. Implementation instruction for Claude

> Review and reconcile `Project_context/docs/backlogs/for-review/MASCOT_PERSONALITY_INTEGRATION.md` against the current local repository. **The owner has already placed the five PNG files at `public/mascots/icon.png`, `public/mascots/thinking.png`, `public/mascots/thumbsup.png`, `public/mascots/tinkering.png`, and `public/mascots/waving.png`.** Use those exact filenames and inspect the actual local files. They may be untracked and not yet visible on GitHub. Do not regenerate images, look for a nonexistent `celebrating.png`, rename or discard these PNGs, or substitute arbitrary imagery. Review Phase 0–3 scope, actual module owners, path handling for Vite/GitHub Pages, test impact, and any gaps or design choices. **Planning/review only. Do not edit application code, commit, push, or deploy.** Present a concise implementation approach, phase gates, risks and questions for owner approval.

## 11. Implementation record (2026-11-15)

- **Review findings:** `icon.png` is a JPEG (1536 px, no alpha) with a `.png` name; the four mascots are 1254 px RGBA PNGs of 1.2 to 1.6 MB (5.7 MB), so they are sources only. Originals stay in `public/mascots/` untouched and `scripts/strip-local.js` removes `dist/mascots`. `scripts/make-mascots.mjs` (installed browser canvas, no new dependency) writes 256 px WebP (waving 17 KB, thinking 15 KB) to `src/assets/mascots/` and the icon set to `public/icons/`.
- **Phase 0:** favicon 32 and 48 px from a head-and-goggles crop; apple-touch 180; manifest icons 192 and 512 (`purpose any`; no maskable: the picture is full-bleed); `public/manifest.webmanifest` with relative `start_url`/`scope`/icons; head links (Vite rewrites them relative to `base './'`). No service worker. `theme-color` unchanged.
- **Phase 1:** `src/mascot-ui.js` (`mascotEl`, literal pose map). Splash first question: waving beside the heading (56 px, 48 phone). Dashboard greeting: waving as a grid cell beside the two existing text elements (64 px, 48 phone, hidden under 341 px; DOM of the text unchanged). Help header: thinking, 40 px.
- **Phase 2:** thinking at 56 px inside the existing `#trips-empty` and `#poi-empty` paragraphs (so `hidden` hides both) and 48 px in the Discover no-match line. Not on loading or error states.
- **Phase 3 (thumbs-up) deferred, blocker:** the database exposes no new-milestone signal (`my_progression` has ranks and `unlocked_at` only; no acknowledged marker). Client-side detection would need an invented localStorage baseline (forbidden here, double-celebrates across devices). A reliable version needs a server-side acknowledged marker and RPC (migration, hosted `db push`): a separate backlog, owner decision. `auto_attendance_enabled` is 0 and manual verification is the only active XP source.
- **Tests:** new unit `mascot-unit`, new browser `mascots` (173 checks: splash at 360x640, 320x568, 180x320 (200% zoom), desktop, light and dark; greeting and Help sizes; reachability; one mascot per screen; empty pictures gone with data; no failed image request). See Project_context/docs/CURRENT_STATUS.md for the full-run result.
