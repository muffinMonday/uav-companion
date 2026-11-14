# Flight Sessions 2.0 — Claude Autonomous Execution Handoff

**READ FIRST:** `FLIGHT_SESSIONS_2_PLAN.md`. This file is not permission to start. Follow repository `CLAUDE.md`, `Project_context/AGENTS.md`, `docs/CURRENT_STATUS.md`, `docs/SMALL_FIXES.md` and relevant skills. Inspect `git status` and `git log -3`. Preserve all uncommitted work.

## First response: ask, then wait

Present **one concise batch of the unresolved questions** in Plan section 2, with recommended defaults. Do not repeat settled decisions unless you discover a concrete contradiction. Ask for explicit authorization for **autonomous Flight Sessions 2.0 implementation, commits, pushes, additive hosted migrations and frontend deployment** after all acceptance gates pass. Confirm the target Supabase environment and how to handle existing live data.

If the owner does not clearly answer essential security/XP/migration questions or does not authorize execution, stop at planning.

## Conditional standing permission

**Only after the owner explicitly authorizes this specific scope:** you may implement, test, commit, push and deploy Flight Sessions 2.0 without asking at each phase, overriding the normal `AGENTS.md` per-commit approval requirement for this task alone. Do not infer authorization from the existence of these files.

**Never assume permission** for unrelated changes, Community Flying Areas, secrets, destructive migrations, real-user deletion, irreversible data rewrites, forced Git pushes or load tests that create accounts.

**Stop and ask** if: a material policy remains unclear; ordinary hosts would gain XP-verification power without approval; tests fail unexpectedly; database target is uncertain; a migration is destructive; the public feature lacks reporting/rate limiting/moderation; private data could leak; the change overlaps unrelated uncommitted work; or required deployment credentials are unavailable.

## Workflow

1. Inspect current modules and migrations; source beats plan. Read `docs/MODULES.md` to find HTML/JS ownership. Follow `/change-workflow`, `/supabase-change` and `/test-impact`.
2. After owner answers, record decisions in plan and `DECISIONS.md`, state exact files and phased rollout. Avoid unneeded framework changes.
3. Implement small coherent increments, with targeted tests and updated `CURRENT_STATUS.md`. Commit/push tested increments only after authorization. Keep public lobby feature-gated until the security/moderation package is complete.
4. Before any hosted change, run migration dry-run and confirm exact project/target. Use only additive migrations, never edit applied SQL. No secrets committed.
5. Before release: `npm run test:unit`, full `npm test` (app on :5173), `npm run build`, database security tests and screenshot comparisons; inspect outputs. Do not dismiss a failing test as flaky without reproduction and evidence.
6. Use the repository's prescribed Supabase migration procedure, then `npm run deploy:live` for sign-in-enabled frontend (never plain deploy). Deploy edge functions separately only when needed. Verify guest public and authenticated private behavior with non-destructive smoke tests. Do not create/delete live users without additional approval.
7. Update `CURRENT_STATUS.md`, `CHANGELOG.md` and module/database docs. Report commit SHAs, migrations, deployed bundle, tests, remaining issues and real-device checks. If blocked, stop and provide a handoff rather than claiming completion.

## Initial message to owner

“I've reviewed the Flight Sessions 2.0 plan and current repository. Before implementation, please confirm [grouped unresolved policies and recommended defaults]. I propose [phases and public-release gate]. Do you authorize me to implement, commit, push and deploy this feature autonomously once the tests and security checks pass? I will stop for unexpected data loss, security/XP decisions or deployment uncertainty.”

## Collaboration

One agent owns `CURRENT_STATUS.md` and the working branch at a time. Do not run Community Flying Areas implementation concurrently against the same source files.
