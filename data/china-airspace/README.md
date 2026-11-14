# China acquisition metadata

This directory is staging metadata, outside production `data/regions` discovery. It contains no approved airspace layers.

- `inventory.json`: all 31 mainland provincial divisions, official and third-party source leads, formats, acquisition methods, dates, provenance, quality and readiness. Unknown fields remain null/unverified. `hasData` is only a public reference-client claim.
- `pilots/*.json`: disabled Guangdong/Chongqing acquisition plans, approximate query envelopes and unverified provenance. Do not enable live collection without evidenced access and response contracts.
- Raw responses, checkpoints, normalized data, logs and offline previews belong under ignored `planning/china-airspace`, never here or `public`.

[Instructions and review gates](../../docs/china-airspace/README.md). Quality classes: Verified official (`verified-official`), Verified reference (`verified-reference`), Unverified reference (`unverified-reference`). Technical validity never upgrades provenance or establishes production readiness.
