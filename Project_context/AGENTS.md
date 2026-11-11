# AGENTS.md: UAV Companion

Read this first in every session. It is short on purpose; the detail lives in `docs/`.

## What this project is
Open-source static web map of drone suitable-flight (适飞) zones for travellers who cannot use the official UOM app. Vite + Leaflet + plain JS ES modules, no backend, no database. Zones are PMTiles built from official shapefiles (Hubei now; Singapore and the rest of China planned). Users keep markers, trips and settings in their own browser (`localStorage`). A planning aid, never flight advice. Repo: `muffinMonday/uav-companion` (MIT).

## Documentation hierarchy
Read only what the task needs.

| File | Consult when |
|---|---|
| `docs/CURRENT_STATUS.md` | Always, at session start (handover: what is done, in progress, next) |
| `docs/ARCHITECTURE.md` | Changing how parts fit together, data flow, external services, constraints |
| `docs/MODULES.md` | Finding where code lives, what a module exports, who depends on whom |
| `docs/DATABASE.md` | Touching stored data: `localStorage` keys and shapes, static data files, migrations |
| `docs/DEVELOPMENT.md` | Setup, running, building, testing, debugging |
| `docs/DECISIONS.md` | Before reversing or questioning a past choice |
| `../docs/PROJECT.md` | Feature requirements (F1 to F19), known issues, glossary. The product spec; not duplicated here |
| `../docs/AI.md`, `../CONTRIBUTING.md`, `../README.md` | AI-itinerary format; adding a region; user-facing overview |

## Conventions and standards
- Plain JavaScript ES modules in `src/`; one concern per module; pure logic (`poi.js`, `trips.js`, `distance.js`, `aiimport.js`, `countries.js`, `units.js`) kept free of DOM so Node tests can import it. UI code lives in `*-ui.js`, `panel.js`, `cards.js`.
- All stored data is validated on load and on import (`sanitize*`); never trust storage, imports, AI replies or share links. Build DOM with `el()`/`textContent`, not HTML strings containing user text.
- Privacy defaults matter: nothing user-specific leaves the browser unless the user opted in. The Home marker is never sent automatically and never in share links.
- Storage keys keep the `uavzones.` prefix (kept on purpose after the rename); change a stored shape only with a version bump and a migration note in `docs/DATABASE.md`.
- Keep changes minimal and root-caused; no speculative features. Match the user's language and register; keep replies and docs concise.
- Data policy (owner, 2026-11-11): geo data we source is published on the public site by default (`"publish": true` in `source.json`; a missing value means local only); mention an unconfirmed licence when adding a region.
- Git: do not run `npm run deploy` (publishes data to the public `gh-pages` branch) without asking. `public/data/`, raw shapefiles, `dist/`, `tests/out/` stay out of git.

## Testing requirements
- `npm run test:unit` (no browser) for logic changes; `npm test` (needs the app on http://localhost:5173) before any commit that touches `src/`, `index.html` or `public/ai/`.
- A change in behaviour updates the test that encodes the old behaviour, and new behaviour gets a test (unit suite if pure logic, browser suite if UI).
- Never mark work done without running the relevant suites and reading the result; report failures verbatim.
- Write every new or changed suite so it can run in parallel with the others (self-contained, its own context and files, waits on conditions rather than timers): the rules are in `docs/DEVELOPMENT.md`, "Writing tests that can run in parallel". Run only the relevant suites while iterating and the full set before every deploy.

## Context management
- Start with `docs/CURRENT_STATUS.md`, then only the docs the task needs. Use `git diff`/`git log --stat` rather than re-reading files. Do not dump large logs; quote the failing lines.
- Source code wins over docs. If a doc is wrong, fix the doc in the same change.
- Do not copy information between docs; link instead.

## Keeping the docs current
- **Work board** (`docs/CURRENT_STATUS.md`): when work on a backlog item starts, set its row to **In progress** with the date and say what is being built; when it is queued, waiting on the owner or planned, say so; when it ships, move it to Done with the commit. Keep it true at every stop, so the owner can see what is queued and what is in progress.
- Update `docs/CURRENT_STATUS.md` at the end of every logical task (recent work, in progress, outstanding, next steps).
- Add a dated entry to `docs/DECISIONS.md` for any decision that constrains future work.
- Update `MODULES.md` when a module is added, removed or changes its interface; `DATABASE.md` when a stored shape or key changes; `DEVELOPMENT.md` when a command changes.
- Finish each session with a handover summary: files modified, tests run and results, outstanding issues, next task.
