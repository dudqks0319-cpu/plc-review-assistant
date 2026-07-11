# Beginner PLC Wizard Design

## Goal

PLC 경험이 없는 사용자도 자연어로 신규 회로 초안을 만들거나 PLC export 파일과 함께 수정 후보를 검토할 수 있게 하되, 실제 PLC에 바로 적용 가능한 결과로 오해하지 않도록 검증 범위와 위험도를 한 화면에서 명확히 보여준다.

## Product modes

### New circuit draft

- PLC 파일 없이 자연어만 입력한다.
- 기본 주소와 신호 의미는 가정으로 표시한다.
- 기존 태그, 주소 충돌, 블록 영향은 `unknown`으로 표시한다.
- 원본이 없으므로 “수정된 프로그램”과 diff 파일을 만들지 않는다.
- GX Works2 명령 리스트, CSV 후보, 변경 계획 JSON만 제공한다.

### Existing project review

- 사용자가 PLC export 파일을 선택한다.
- 주 동작 버튼을 누르면 파일 분석 후 변경 후보를 생성한다.
- 기존 주소와 태그를 분석할 수 있는 경우 확인 상태로 표시한다.
- 원본을 덮어쓰지 않고 별도 candidate 파일과 diff를 제공한다.

## Safety model

- 비상정지나 안전회로 우회 요청은 기존처럼 차단한다.
- 승강기, 크레인, 프레스, 버너, 로봇 등 인명 안전 또는 중대 위험 설비는 `simulation-only`로 분류한다.
- `simulation-only` 결과에는 import 또는 수정 프로그램처럼 보이는 `.lst`, `.csv`, `.diff` 후보를 제공하지 않는다.
- 모든 결과는 `canWriteToPlc: false`이며 컴파일, 시뮬레이션, PLC 담당자 검토가 필수다.
- 정지 입력은 기본적으로 “입력이 ON이면 정지 요청”인 논리 신호로 가정하고 화면과 파일에 명시한다.

## Backend changes

- GX Works2 회로 초안 artifact의 실제 instruction list를 Mitsubishi candidate program에 포함한다.
- 파일 유무에 따라 candidate file 목록을 다르게 만든다.
- 고위험 설비 분류와 `executionScope`, `readiness` 응답을 추가한다.
- 회로 초안마다 `assumptions`를 제공한다.

## UI changes

1. PLC 종류를 선택한다.
2. 만들고 싶은 동작을 자연어로 입력한다.
3. 기존 PLC 파일이 있으면 선택적으로 추가한다.
4. 안전 확인 체크 후 하나의 주 버튼으로 분석과 초안 생성을 실행한다.

- 중복된 vendor 선택기를 제거한다.
- 예시 문장을 누르면 입력란에 채워진다.
- 파일 없음/있음 모드를 즉시 표시한다.
- 결과 상단에 준비 상태와 미확인 항목을 보여준다.
- 고위험 결과는 시뮬레이션 전용으로 명확히 표시한다.

## Error handling

- 요청이 비어 있거나 안전 확인이 없으면 실행하지 않는다.
- 파일 분석 실패와 회로 생성 실패를 한글 오류로 표시한다.
- 파일을 제거하면 이전 분석 상태를 초기화해 오래된 결과가 재사용되지 않게 한다.

## Verification

- Node 통합 테스트로 실제 HTTP API를 실행한다.
- 회귀 테스트로 Mitsubishi candidate instruction 누락을 검증한다.
- 파일 없는 모드에 가짜 수정 프로그램/diff가 없는지 검증한다.
- 고위험 설비의 simulation-only 제한을 검증한다.
- 정적 UI 테스트로 자연어 우선 순서, 예시, 안전 확인, 단일 CTA를 검증한다.
- GitHub Actions에서 전체 `npm test`를 실행한다.
