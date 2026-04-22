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
