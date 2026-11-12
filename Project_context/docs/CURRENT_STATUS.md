# Session Checkpoint

Updated: 2026-11-12
Task: none in development. Last session: documentation restructure (docs only, uncommitted).

## Objective
Next product work is the owner's choice. Candidates, in the order planned: W6 flight sessions and public lobby (needs moderation and privacy policy first), W7 to W10 flight-controller diagnostics (`PROJECT.md` section 9.3), W3 steps b to f (test speed, optional). Shipped work: `CHANGELOG.md`.

## Progress
- [x] Documentation audit and restructure; every doc checked against `src/` and `supabase/migrations/`
- [x] `npm run test:unit` all passing (2026-11-12, 8 s)
- [ ] Owner review of the new docs, then commit
- [ ] Browser suites not rerun this session (no code changed)

## Findings
- The app is no longer purely static: optional Supabase accounts, cloud copy, friends, shared trips, online status and live locations exist (`ARCHITECTURE.md`, `DATABASE.md`). The live site has sign-in only when `VITE_SUPABASE_*` are set for the build; a plain `npm run deploy` switches it off.
- Before real users: a second Supabase project, closed public sign-ups, email confirmation on, an outside email sender (the current project is tagged production but used as dev).
- Hubei CRS declared WGS84 and unverified (GCJ-02 would shift zones by hundreds of metres); Hubei and Singapore licences unconfirmed, published by owner decision.
- Not tested on real phones (touch, compass, map apps) or against live AI assistants. No offline support.
- Typing in Max range then clicking a list row can swallow the click (blur re-render). `tests/trips.mjs` has one weak assertion (Home marker form has no Trip field).
- Singapore data: `data/regions/sg/` OneMap layers built; OneMap terms unread.

## Working State
- Branch: main
- Last commit: `3371df7` (Work board: W24 done)
- Uncommitted changes: Yes, Markdown only: new `Project_context/docs/CHANGELOG.md`, rewritten `Project_context/AGENTS.md`, `CLAUDE.md`, `Project_context/docs/*`, `docs/PROJECT.md` moved to `Project_context/docs/PROJECT.md`, link fixes in `README.md`, `docs/AI.md`, `supabase/README.md`
- Tests/build: `npm run test:unit` pass; last full browser run 2026-11-11 (48 suites, 262 s, before shared trips and live locations); `npm run build` not run

## Blockers
None.

## Next Action
Owner reads the restructured docs and asks for a commit (do not commit unasked). Then pick the next product task and replace this checkpoint.

## Relevant Files
`Project_context/AGENTS.md`, `Project_context/docs/*.md`, `CLAUDE.md`
