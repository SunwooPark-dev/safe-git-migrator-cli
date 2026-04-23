# Build Registry

이 페이지는 프로젝트에서 실제로 만들어진 것과 그 검증 내용을 기록하는 canonical registry입니다.

## Add priority roadmap
- Recorded at: 2026-04-22T06:57:49.380Z
- Summary: Documented the next priority slices for the wiki system and CLI evolution.
- Files:
  - docs/wiki/Roadmap.md
- Verification:
  - manual roadmap review

## Add CI quality gate and roadmap refresh
- Recorded at: 2026-04-22T07:31:27.135Z
- Summary: Connected GitHub Actions quality checks and updated the CLI wiki roadmap to reflect the new maturity level.
- Files:
  - .github/workflows/quality-gate.yml
  - docs/wiki/Roadmap.md
  - README.md
- Verification:
  - npm test
  - npm run build
  - manual workflow inspection

## Plan wiki-mint Phase 2 Sprint 1
- Recorded at: 2026-04-23T03:48:59.383Z
- Summary: Captured the approved Phase 2 Sprint 1 design, implementation plan, roadmap update, and Cockpit integration handoff after PR #10 merge.
- Files:
  - docs/superpowers/specs/2026-04-23-wiki-mint-phase2-sprint1-design.md
  - docs/superpowers/plans/2026-04-23-wiki-mint-phase2-sprint1.md
  - docs/wiki/Cockpit-Integration-Handoff.md
  - docs/wiki/Roadmap.md
- Verification:
  - npm test
  - npm run build
  - node .\\src\\cli.js wiki-audit . --template cli --report-json

## Implement wiki-mint Phase 2 generators
- Recorded at: 2026-04-23T04:03:52.853Z
- Summary: Added x-thread and substack HTML generators plus inclusive date-range filtering for wiki-mint while preserving readme-showcase safety behavior.
- Files:
  - src/lib/runner.js
  - tests/cli.test.js
  - README.md
  - docs/wiki/Command-Reference.md
  - docs/wiki/Install-and-Run.md
  - docs/wiki/Roadmap.md
- Verification:
  - npm test
  - npm run build
  - node .\\src\\cli.js wiki-audit . --template cli --report-json
  - wiki-mint x-thread/substack smoke on temp docs copy
