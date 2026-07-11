# Beginner PLC Wizard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 자연어 중심 한 번의 실행으로 PLC 회로 초안 또는 기존 export 수정 후보를 만들고, 위험도와 미검증 항목을 초보자도 이해하게 표시한다.

**Architecture:** 기존 Node HTTP 서버와 vanilla HTML/CSS/JS 구조를 유지한다. `plcChangeAssistant.js`가 결과의 안전 범위와 파일 정책을 결정하고, `app.js`는 파일 분석과 변경 계획 생성을 하나의 사용자 흐름으로 묶는다.

**Tech Stack:** Node.js 22, node:test, vanilla JavaScript, HTML, CSS, GitHub Actions

## Global Constraints

- 실제 PLC 연결 또는 쓰기 기능을 추가하지 않는다.
- 원본 업로드 파일을 덮어쓰지 않는다.
- 인명 안전 또는 중대 위험 설비는 시뮬레이션 전용으로 제한한다.
- 기존 의존성 없는 구조를 유지한다.

---

### Task 1: Backend regression tests

**Files:**
- Modify: `tests/plcChangeAssistant.test.js`

- [x] GX Works2 candidate program에 실제 instruction list가 포함되는 실패 테스트를 추가한다.
- [x] 파일 없는 초안에 수정 프로그램과 diff가 생성되지 않는 실패 테스트를 추가한다.
- [x] 엘리베이터 초안이 simulation-only로 제한되는 실패 테스트를 추가한다.
- [ ] GitHub Actions에서 실패 이유가 새 요구사항 때문인지 확인한다.

### Task 2: Candidate file and safety policy

**Files:**
- Modify: `src/backend/plcChangeAssistant.js`
- Test: `tests/plcChangeAssistant.test.js`

- [ ] `detectHighRiskMachine(requestText)`를 추가한다.
- [ ] `executionScope`와 `readiness` 응답을 추가한다.
- [ ] `insertMitsubishiCandidateIntoSource()`가 `GX Works2 IL` artifact를 사용하게 한다.
- [ ] `createCandidateFiles()`에서 파일 없음, 파일 있음, simulation-only 출력을 분리한다.
- [ ] 회로 초안에 신호 및 타이머 가정을 추가한다.
- [ ] 전체 테스트를 실행해 backend 회귀 테스트를 통과시킨다.

### Task 3: Beginner single-flow UI tests

**Files:**
- Create: `tests/ui.test.js`

- [x] 자연어 입력이 파일 선택보다 먼저 나타나는지 검증한다.
- [x] 중복 vendor 선택기가 없는지 검증한다.
- [x] 예시 버튼, 필수 안전 확인, 단일 primary action을 검증한다.
- [x] readiness UI와 접근 가능한 focus 스타일을 검증한다.

### Task 4: Beginner single-flow UI

**Files:**
- Modify: `public/index.html`
- Modify: `public/app.js`
- Modify: `public/styles.css`

- [ ] 자연어 입력을 첫 번째 작업으로 이동한다.
- [ ] 기존 PLC 파일을 선택 항목으로 이동한다.
- [ ] 파일 선택 시 주 버튼이 분석과 변경 계획 생성을 순서대로 실행하게 한다.
- [ ] 안전 확인 없이는 주 버튼이 활성화되지 않게 한다.
- [ ] 예시 버튼과 현재 모드 안내를 추가한다.
- [ ] readiness와 assumptions를 결과 상단에 렌더링한다.
- [ ] 모바일 720px 이하에서 한 열로 정리한다.

### Task 5: API contract and documentation

**Files:**
- Modify: `tests/api.test.js`
- Modify: `README.md`

- [ ] 파일 없는 API가 `.gxworks2.lst`와 JSON을 제공하고 수정 프로그램/diff를 제공하지 않는지 검증한다.
- [ ] `executionScope`, `readiness`, simulation-only 정책을 문서화한다.

### Task 6: Verification and publish

**Files:**
- Create: `.github/workflows/test.yml`

- [x] Node 22 전체 테스트 workflow를 추가한다.
- [ ] PR 최신 commit의 workflow가 성공인지 확인한다.
- [ ] 변경 파일과 diff를 검토한다.
- [ ] Draft PR을 ready 상태로 전환하고 squash merge한다.
- [ ] main의 최종 commit 상태를 다시 확인한다.
