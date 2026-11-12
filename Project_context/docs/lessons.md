# Lessons

Patterns learned from corrections. One line each: what went wrong, the rule that prevents it. Review at session start; not part of the default reads in `AGENTS.md`.

- `tests/run.mjs` filters suites by substring: `trip-unit` also runs `sharedtrip-unit`. Fine for safety, but expect more suites than named.
- A standing "commit and deploy each phase" permission (memory) does not carry over to unrelated tasks; for tooling work the owner asked for explicit approval.
- Very long shell commands with a heredoc (many lines, quotes) failed with "unexpected EOF" and wrote nothing: write files with the Write tool and keep shell commands short.
- Several source files have mixed CRLF and LF endings. A scripted replace of a multi-line string silently did nothing on CRLF text: convert CRLF to LF before replacing and restore afterwards (a small node script), and grep to confirm the change landed.
- In a timing-sensitive browser suite (`live`, pin-moves check) add new checks after the existing timing checks, never in the middle: a check inserted earlier shifted the timing and failed only under the parallel runner. Run the suite alone and grouped (`node tests/run.mjs live party friends`) before trusting it.
- A new What's new entry pushes the oldest of the three shown entries out; update the `dashboard` suite's "announced" assertion in the same change (or append to the newest entry).
- The Supabase CLI asks for `--yes` on hosted `db push` and `functions deploy` in agent runs; use it only under the owner's standing phase-deploy choice, and dry-run first.
- A browser mock that runs the real handler (`handleManual`) or real SQL (PGlite) behind the HTTP route finds more than hand-written fake replies; reuse the pattern in `tests/progression.mjs`, `sessions.mjs`, `steam.mjs`.
