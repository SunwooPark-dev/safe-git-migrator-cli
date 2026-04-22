# Roadmap

## Completed foundation
- `wiki-bootstrap`
- `wiki-register`
- `wiki-audit`
- `wiki-finalize`
- `wiki-handoff`
- `recommend`
- GitHub Actions quality gate on `main`

## P1 — 바로 해야 할 것
1. source acquisition fidelity 강화
   - 실제 GitHub/Hugging Face 입력을 더 많이 검증
2. wiki 관련 코드 모듈 분리
   - `runner.js`에서 wiki 기능을 모듈 단위로 분리
3. template 확장
   - app / research / internal-ops 등 추가

## P2 — 다음 단계
1. report schema 정리
   - 각 명령의 출력 구조를 더 일관되게 만들기
2. smarter recommendation rules
   - repo state와 task wording을 더 세밀하게 반영
3. GitHub Wiki mirror 지원
   - repo 내부 wiki를 보조 채널로 복제하는 흐름 정리

## P3 — 장기 과제
1. broader OS support
2. richer adapter fidelity and release automation
3. telemetry or usage-informed recommendation tuning
