# Roadmap

## P1 — 바로 해야 할 것
1. `wiki-handoff` command 추가
   - Codex / Antigravity / Gemini handoff 페이지 자동 생성 또는 갱신
2. CI gate 연결
   - `npm test`, `npm run build`, `wiki-audit`를 PR 단계에서 자동 실행
3. source acquisition fidelity 강화
   - 실제 GitHub/Hugging Face 입력을 더 많이 검증

## P2 — 다음 단계
1. wiki 관련 코드 모듈 분리
   - `runner.js`에서 wiki 기능을 모듈 단위로 분리
2. template 확장
   - app / research / internal-ops 등 추가
3. report schema 정리
   - 각 명령의 출력 구조를 더 일관되게 만들기

## P3 — 장기 과제
1. GitHub Wiki mirror 지원
2. broader OS support
3. richer adapter fidelity and release automation
