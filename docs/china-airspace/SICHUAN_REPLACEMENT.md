# Sichuan replacement release

[Draft PR #11](https://github.com/muffinMonday/uav-companion/pull/11), implementation `c3abe23` committed and pushed. Merge and deployment deferred.

2026-11-15: validated candidate on `feature/sichuan-replacement`, based on main
`8c802711a3d4ab769d53c5bc5a9b873aa77fd89d`. **Do not merge or deploy while
Claude's Google OAuth work remains active.** The owner explicitly confirmed
“Claude is still active; prepare the PR and defer release”. No authentication,
provider configuration, credentials, migrations or profile/session code is changed.

Production baseline is gh-pages `b9e23786f500f8209287176337e8876b67924ca1`:
eight total regions, including Chengdu's 57 polygons and administrative mask.
PR #10 is closed and merged. Historical candidate-era descriptions remain in
the [Chengdu provenance](../regions/cn-chengdu.md) and earlier release evidence.

The candidate has eight total regions: `cn-sichuan` replaces `cn-chengdu`;
all other registrations and artifacts match production exactly. Source metadata
supplies the Sichuan name and KDji attribution to existing tooltips/explanations.
The retired Chengdu descriptor is preserved in
`evidence/chengdu-source-retired.json`, its boundary remains in the repository,
and its original 57-feature source/captures remain in the rollback package.
The unused mask runtime and tests are removed; builders reject obsolete mask options.

Data, checksums, acquisition limitations and reproduction:
[Sichuan provenance](../regions/cn-sichuan.md),
[acquisition](evidence/sichuan-acquisition.json),
[GEOS](evidence/sichuan-geos.json), [release](evidence/sichuan-release.json).
The generated data/source/capture package is local, not committed:
`.worktrees/sichuan-replacement/planning/sichuan/validated-data.zip`.
Its checksum is recorded in the release evidence after packaging.

## Coordinated release

1. Confirm Claude has finished and the deployment window is clear. Fetch latest
   completed `main`, reconcile this branch without overwriting OAuth work, and use
   the permitted PR review workflow. Keep the two workstreams separate.
2. Refresh the complete current production rollback archive and artifact inventory.
   Archive with `git -c core.autocrlf=false archive` so hashed JSON bytes survive.
3. Restore the validated candidate package in the release worktree; refresh all
   unaffected data from the newest production. Verify every unrelated descriptor
   and artifact against that baseline. Rebuild only Sichuan if inputs changed.
4. Confirm `data/removed-regions.json` approves **only** Chengdu's removal and
   requires `replacementId: cn-sichuan`. Preflight rejects either an absent Sichuan
   replacement or any unrelated loss. Never publish a removal-only intermediate tree.
5. Rerun focused release tests, configured build and
   `node scripts/preflight-data.js dist/data --production <latest-baseline>/data`.
   Run application regression gates required for any newly reconciled code.
6. Merge through review and run **`npm run deploy:live`** with the existing release
   configuration. Publish the complete application and data tree together.
7. Verify live manifest, Sichuan PMTiles SHA-256 and map pixels/point checks beyond
   Chengdu; confirm Chengdu is absent and all seven other regions plus completed
   OAuth behavior remain operational. Record deployed commit and live evidence.
8. After success, archive the completed removal approval in release evidence and
   clear its active entry before the next deploy: the existing guard rejects stale
   approvals for regions no longer present in production.

## Rollback

Full previous production tree:
`.worktrees/sichuan-replacement/planning/sichuan/production-baseline.zip`,
SHA-256 `9ca4d74eb02e562f7c53e01847e98d33a0ccb9909ae2b1fbd795d8a5bf4173a3`.
It includes the matching built application, complete data index/manifests, Chengdu
PMTiles and mask, and every other region. Original Chengdu captures/HTTP metadata
are separately copied into `planning/sichuan/chengdu-capture-network/`, and the
57-feature source into `planning/sichuan/chengdu-source/`.

Before releasing after OAuth, replace this baseline with the latest complete
production state so rollback preserves completed Google OAuth changes. If release
fails, restore that complete matching application/data artifact set; a data-only
rollback to Chengdu also requires its matching mask runtime. Do not combine the
old masked descriptor with this candidate's unmasked application. Preserve original
and latest snapshots rather than overwriting historical evidence.
