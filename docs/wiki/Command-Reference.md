# Command Reference

## inspect
Purpose:
- inventory source artifacts
- verify license gate
- avoid install/transform side effects

## dry-run
Purpose:
- classify artifacts
- generate target outputs
- skip installation

## apply
Purpose:
- acquire source
- classify and transform
- install outputs
- generate backup and install manifests

## verify
Purpose:
- confirm installed outputs exist according to the install manifest

## rollback
Purpose:
- restore from install manifest and backups

## wiki-bootstrap
Purpose:
- create a starter `docs/wiki/` structure inside a target repository or folder
- update README with a canonical wiki pointer when needed

Example:
```powershell
node .\src\cli.js wiki-bootstrap C:\path\to\repo --template cli
node .\src\cli.js wiki-bootstrap C:\path\to\repo --template adapter
```

## wiki-register
Purpose:
- append a durable entry into `docs/wiki/Build-Registry.md`
- capture what was built, what files changed, and how it was verified
- reduce knowledge leakage after implementation

Example:
```powershell
node .\src\cli.js wiki-register C:\path\to\repo `
  --title "Add homepage analytics" `
  --summary "Tracked homepage usage and documented the verification flow." `
  --files "src/index.ts,docs/wiki/Home.md" `
  --verification "npm test; npm run build"
```

## wiki-audit
Purpose:
- inspect whether a project wiki is complete enough to prevent knowledge leakage
- flag missing canonical wiki pages
- check README wiki pointer presence
- check whether `Build-Registry.md` exists
- optionally check missing consumer handoff pages
- stay read-only; do not create missing target roots during audit
- fail on unknown consumer values instead of silently ignoring them

Example:
```powershell
node .\src\cli.js wiki-audit C:\path\to\repo --template cli
node .\src\cli.js wiki-audit C:\path\to\repo --template adapter --consumers codex,antigravity,gemini
```

## wiki-finalize
Purpose:
- write or refresh `docs/wiki/Release-Checklist.md`
- capture final verification, remaining risks, and manual follow-up
- link the release checklist from the wiki home page
- append a finalization record into `docs/wiki/Build-Registry.md`

Example:
```powershell
node .\src\cli.js wiki-finalize C:\path\to\repo `
  --template cli `
  --summary "Internal beta is ready." `
  --verification "npm test; npm run build" `
  --risks "No GitHub Wiki sync automation yet." `
  --manual-steps "Review PR before release."
```
