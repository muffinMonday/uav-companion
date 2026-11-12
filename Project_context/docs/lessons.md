# Lessons

Patterns learned from corrections. One line each: what went wrong, the rule that prevents it. Review at session start; not part of the default reads in `AGENTS.md`.

- `tests/run.mjs` filters suites by substring: `trip-unit` also runs `sharedtrip-unit`. Fine for safety, but expect more suites than named.
- A standing "commit and deploy each phase" permission (memory) does not carry over to unrelated tasks; for tooling work the owner asked for explicit approval.
