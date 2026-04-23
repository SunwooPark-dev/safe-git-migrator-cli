# wiki-mint Phase 2 Sprint 1 Design

## Goal

Extend `wiki-mint` from a single `readme-showcase` publisher into a small, safe publishing pipeline for sprint review, social thread, newsletter HTML, and SIH Cockpit consumption.

## Inputs

- AG brainstorm artifact summarized in this session:
  - PM / Designer / Engineer idea set, top 5 selection, OST, hypotheses, and estimates
- AG audit artifact summarized in this session:
  - 2026-04-22 session audit for wiki-mint CLI and SIH Cockpit design v2 work
- Merged baseline:
  - PR #10, `wiki-mint` readme-showcase implementation

## Selected Sprint 1 scope

| Priority | Item | Estimate | Purpose |
|---|---:|---:|---|
| 1 | x-thread generator | 3 | Social distribution from Build-Registry entries |
| 2 | substack HTML generator | 5 | Newsletter / long-form paste-ready output |
| 3 | date-range filter | 2 | Sprint-window publishing and review automation |
| 4 | Cockpit integration starter | 5 | Connect generated wiki-mint assets to SIH Cockpit |

## Non-goals

- Do not implement template plugin support in Sprint 1.
- Do not add external rendering dependencies.
- Do not add a scheduled runner.
- Do not make Cockpit registration mandatory for local generation.
- Do not broaden secret scanning rules without explicit regression tests.

## Architecture

The existing `wiki-mint` pipeline already has the correct safety spine:

1. read `docs/wiki/Build-Registry.md`
2. parse entries
3. scan for sensitive content
4. render selected format
5. write output
6. auto-register mint audit entry

Sprint 1 should preserve that spine and add two small abstractions:

1. **entry selection**
   - excludes auto-generated mint audit entries
   - applies `--from` / `--to` filters
   - returns both parsed and rendered counts
2. **format renderer dispatch**
   - `readme-showcase`
   - `x-thread`
   - `substack`

## CLI behavior changes

### Date range

Add:

```powershell
--from YYYY-MM-DD
--to YYYY-MM-DD
```

Rules:

- date bounds are inclusive
- compare against `entry.recordedAt`
- invalid date strings fail before writing
- entries with missing/invalid `recordedAt` are excluded only when a date filter is active

### x-thread

Generate `BUILD_THREAD.md` by default.

Rules:

- one thread block per selected entry
- include `n/N`
- include concise title and summary
- include important file references when they fit
- warn for blocks longer than 280 chars
- do not block generation on over-280 warnings in Sprint 1

### substack

Generate `BUILD_SUBSTACK.html` by default.

Rules:

- dependency-free HTML
- escaped content for title, summary, files, verification
- paste-ready structure:
  - `<h1>`
  - metadata block
  - per-entry `<section>`
  - `<h2>`, `<blockquote>` / `<p>`, `<ul>`

### Cockpit integration

Keep Cockpit integration opt-in and separate from basic minting.

Recommended future CLI surface:

```powershell
safe-git-migrator wiki-mint <target-root> --format readme-showcase --cockpit-register
```

Minimum starter behavior:

- local generation still succeeds even if Cockpit registration is unavailable
- missing Cockpit config produces warning, not destructive failure
- report includes Cockpit status fields

## Cockpit integration finding

The AG artifacts establish that Cockpit integration is a Sprint 1 priority. A separate read-only inspection of the current `sih-core` working copy found that Cockpit already has partial integration:

- `BUILD_SHOWCASE.md` mock asset exists
- `badge--mint` CSS exists
- minted badge rendering exists
- Supabase insert paths exist

The main issue appears to be fragmentation, pending implementation-time confirmation:

- duplicate `registerMintedAsset()` definitions in `app.js`
- metadata count mismatch in seed/mock data
- runtime insert is not idempotent

Sprint 1 Cockpit work should therefore canonicalize one `registerMintedAsset()` path rather than add a third path.

## Risks

- `runner.js` is already large; keep Sprint 1 additive and avoid broad module extraction.
- x-thread 280-char validation can become subjective; warnings are safer than hard failures.
- Substack HTML must escape registry content.
- Cockpit Supabase writes should not rely on broad anon write access for production.

## Success criteria

- `x-thread` can generate a file from a registry.
- `substack` can generate paste-ready HTML from a registry.
- `--from` / `--to` can select sprint windows.
- `wiki-mint` reports parsed count and rendered count separately.
- Existing `readme-showcase` behavior remains stable.
- Cockpit integration starter plan is clear enough for AG to implement without redefining product behavior.
