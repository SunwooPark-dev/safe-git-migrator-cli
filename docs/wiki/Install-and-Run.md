# Install and Run

## Prerequisites
- Windows
- Node.js 18+
- git available in PATH

## Local use
```powershell
cd C:\Users\sunwo\safe-git-migrator-cli
npm test
npm run build
node .\src\cli.js help
```

## Core commands
```powershell
node .\src\cli.js inspect <source>
node .\src\cli.js dry-run <source> --targets codex,omx
node .\src\cli.js apply <source> --targets codex,omx,hermes,antigravity
node .\src\cli.js verify <run-id>
node .\src\cli.js rollback <run-id>
```

## Notes
- `inspect` is read-only and records inventory/license state.
- `dry-run` plans and transforms without install.
- `apply` installs into target roots and records backup manifests.
