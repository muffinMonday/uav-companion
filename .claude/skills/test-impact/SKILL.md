---
name: test-impact
description: Choose and run the unit suites affected by the current uncommitted changes, instead of picking tests by hand. Use after editing src/, supabase/, scripts/, public/ai/ or tests/, and before saying a change is done.
---

# test-impact

Run from the project root:

```
node .claude/skills/test-impact/impact.mjs            # changed files from git, runs the chosen unit suites
node .claude/skills/test-impact/impact.mjs --dry      # plan only
node .claude/skills/test-impact/impact.mjs src/a.js   # explicit files
node .claude/skills/test-impact/impact.mjs --browser  # also runs all browser suites (app must be on :5173)
```

What it does: maps each changed file to the unit suites in `tests/run.mjs` (suites name their `src/`, `public/ai/`, `scripts/`, `supabase/` files; imports are followed), then runs them through `tests/run.mjs`.

Safety rules built in (do not override them by hand):
- Shared or high-risk file (`poi.js`, `trips.js`, `prefs.js`, `sync/core.js`, `sharedtrip/core.js`, `tests/lib.mjs`, `tests/run.mjs`, `package*.json`, `vite.config.js`) or any code file no suite maps: runs ALL unit suites.
- Only docs and non-code changes run nothing, and it says so.
- Browser suites are never mapped reliably. When `src/`, `index.html` or `public/ai/` changed it prints "full npm test required"; `AGENTS.md` still decides when to run it. The hint list is a hint, not a selection.
- A name can pull in extra suites (substring match in `run.mjs`): more, never fewer.

Report the printed result as is. A `FAIL` line means not done. This skill never commits, pushes or deploys; those need the owner's approval (`AGENTS.md`).
