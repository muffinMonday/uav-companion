---
name: change-workflow
description: Compact loop for a feature or a regression fix with minimal, targeted inspection. Use for any code change beyond a one-line edit, including "fix this bug" or "add this feature".
---

# change-workflow

Project rules stay in `Project_context/AGENTS.md`; this only fixes the order of work.

1. **Locate, don't sweep.** `Project_context/docs/MODULES.md` is the code map; grep the symbol or the feature id in `PROJECT.md` (large: never read it whole). Read only the files involved. Never load `CHANGELOG.md`.
2. **Regression?** Reproduce first with the smallest check: an existing suite (`node tests/run.mjs <word>`) or a new assertion in the matching `*-unit.mjs` that fails now. Find the root cause (`git log -S<symbol> -- <file>` helps); no workaround.
3. **Plan** if it takes 3+ steps: state the approach and files, get the owner's go-ahead.
4. **Change the minimum.** Reuse existing helpers. Fix a wrong doc in the same change (`AGENTS.md` rule).
5. **Verify.** Run `/test-impact`; before commit also the browser suites per `AGENTS.md`. Read the results.
6. **Hand over** with the final-message format from `AGENTS.md`. Commit, push, deploy only on the owner's approval (or the standing rule they gave for that feature); deploy with `npm run deploy:live`, never plain `deploy`.
