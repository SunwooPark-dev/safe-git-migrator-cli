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
node .\src\cli.js wiki-bootstrap <target-root> --template cli
node .\src\cli.js wiki-register <target-root> --title \"...\" --summary \"...\"
node .\src\cli.js wiki-mint <target-root> --format readme-showcase --report-json
node .\src\cli.js wiki-audit <target-root> --template cli
node .\src\cli.js wiki-finalize <target-root> --template cli --summary \"...\"
node .\src\cli.js wiki-handoff <target-root> --template adapter --consumers codex,antigravity,gemini
node .\src\cli.js recommend <target-root> --task \"이제 뭘 해야 하지?\" --template adapter
```

## Notes
- `inspect` is read-only and records inventory/license state.
- `dry-run` plans and transforms without install.
- `apply` installs into target roots and records backup manifests.
- `wiki-bootstrap` scaffolds `docs/wiki/` in a target project and is useful at project start.
- `wiki-register` records what was built and how it was verified so implementation knowledge stays in the repo.
- `wiki-mint` writes `docs/wiki/BUILD_SHOWCASE.md` by default, blocks sensitive content, and auto-registers the generated showcase when it produces output.
- `readme-showcase` generates output today; `x-thread` and `substack` are accepted for dry-run, scan-only, and report paths until dedicated generators are added.
- `--dry-run` keeps `wiki-mint` read-only and only reports what would be minted.
- `--scan-only` stops after scanning and sensitive-content checks without creating the showcase file.
- `wiki-audit` checks for wiki gaps before handoff or release.
- `wiki-audit` is read-only and should be safe to run before release or cross-tool onboarding.
- `wiki-finalize` is the finish-phase companion command for writing release/handoff-ready wiki state.
- `wiki-handoff` is the consumer-facing companion command for refreshing Codex / AG / Gemini handoff pages.
- `recommend` is the task-aware next-best-action helper when you are unsure which command or skill to use next.

## CI
GitHub Actions runs the current quality gate on:
- pull requests targeting `main`
- pushes to `main`

Current checks:
- `npm test`
- `npm run build`
- `node .\src\cli.js wiki-audit . --template cli --report-json`
