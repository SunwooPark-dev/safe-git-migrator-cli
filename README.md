# safe-git-migrator-cli

Windows-first npm CLI for safely ingesting MIT-licensed GitHub or Hugging Face repositories and migrating agent-oriented assets into:

- OMX
- Codex App
- Hermes agent
- Antigravity

## Features

- safe source acquisition via clone/fetch-or-local-copy
- MIT-only license gate for v1
- artifact inventory and classification
- target-platform output generation
- transactional install with backup manifest
- verify and rollback commands
- machine-readable reports for every run
- cached git acquisition with per-run source snapshots

## Commands

```bash
safe-git-migrator inspect <source>
safe-git-migrator dry-run <source> --targets omx,codex,hermes,antigravity
safe-git-migrator apply <source> --targets omx,codex,hermes,antigravity
safe-git-migrator verify <run-id>
safe-git-migrator rollback <run-id>
safe-git-migrator wiki-bootstrap <target-root> --template cli
safe-git-migrator wiki-register <target-root> --title "..." --summary "..."
safe-git-migrator wiki-audit <target-root> --template cli --consumers codex,antigravity
safe-git-migrator wiki-finalize <target-root> --template cli --summary "..." --verification "npm test; npm run build"
```

## Notes

- v1 is **Windows only**
- v1 accepts **MIT-licensed sources only**
- billed or paid API actions are intentionally unsupported
- official platform conventions are used first when known; otherwise the CLI falls back to conservative local import locations and reports that fact
- `wiki-bootstrap` creates canonical `docs/wiki/` scaffolds so new projects can satisfy the wiki lifecycle policy early
- `wiki-register` appends implementation/verification notes into `docs/wiki/Build-Registry.md` so future work is not lost to chat history
- `wiki-audit` checks for missing wiki pages, README links, build registry presence, and consumer handoff gaps
- `wiki-audit` is read-only and fails cleanly on missing target roots or unknown consumer names
- `wiki-finalize` writes a release checklist, links it from the wiki, and appends a finalization record to the build registry

## Useful flags

```bash
--workspace C:\path\to\workspace
--targets omx,codex
--no-install
--report-json
--install-root-codex C:\temp\codex
--install-root-omx C:\temp\omx
--install-root-hermes C:\temp\hermes
--install-root-antigravity C:\temp\antigravity
```

## Run artifacts

Each run writes machine-readable artifacts inside the selected workspace, including:

- `source-manifest.json`
- `<command>-report.json`
- `install-manifest.json` for apply runs
- `verify-report.json`
- `rollback-report.json`


## Wiki
See docs/wiki/Home.md for the canonical project wiki.

