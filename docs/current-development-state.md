# PLC Review Assistant 현재 개발 상태

기준일: 2026-07-29  
브랜치: `agent/plc-foundation`  
Phase 8 완료 커밋: `0db802d`

Phase 9 UI 설계 커밋: `42b7eda`

이 문서는 상세 개발계획서의 단계와 현재 코드 증거를 연결하는 상태
원장이다. 로컬 테스트 통과는 실제 GX Works2 Import, 현장 PLC 연결,
Pilot 승인 또는 Production 출시를 의미하지 않는다.

## 현재 검증된 범위

| 단계 | 상태 | 현재 증거 | 남은 게이트 |
| --- | --- | --- | --- |
| Phase 0 브랜치 안정화 | 로컬 완료 | 전체 Node 테스트 80/80, `git diff --check` 통과 | 원격 CI는 별도 |
| Phase 1 Domain IR·SourceAnchor | 로컬 완료 | canonical snapshot, instruction/reference SourceAnchor, SHA-256 | 실제 익명화 프로젝트 교차 검증 |
| Phase 2 CPU Profile·주소 파서 | 로컬 완료 | FX3/QCPU/LCPU profile, FX3 X/Y 8진 주소 테스트, Unknown timer 정책 | 더 많은 CPU 모델 공식표 |
| Phase 3 Project Bundle·명령 파서 | 로컬 완료 | CSV/TXT/LST/ASC 다중 Import, 인코딩, immutable snapshot, unknown opcode 보존 | Golden Fixture 확대 |
| Phase 4 Cross-reference·Data Flow | 로컬 완료 | Reader/Writer/SET/RST index, 전방·후방 trace, evidence edge | 대형 프로젝트 성능 측정 |
| Phase 5 근거형 질문 | 로컬 완료 | 10개 질문 유형, deterministic Query Planner, confidence/unknown, 원문 줄 이동 | Pilot 질문 정확도 측정 |
| Phase 6 RAG | 로컬 완료 | TXT/MD 메모리 색인, vendor/CPU 격리, 문서 citation, injection 문단 제외 | 벤더 공식 문서 권리 검토 |
| Phase 7 변경 후보 v2 | 로컬 완료 | 저위험 8종 GX Works2 Renderer, Logic IR, R1~R4, Writer·주소 충돌, Template별 test/report | 실제 GX Works2 프로그램 체크·Pilot |
| Phase 8 검증 루프 | 로컬 완료 | V0~V10 Matrix, 8종 Template simulator, Trend, 안전한 END 보정, 수동 검증 기록 adapter | 실제 GX Works2 프로그램 체크·엔지니어 승인·현장 검증 |
| Phase 9 UI 전면 개선 | 설계 완료·구현 대기 | 데스크톱/모바일 시안, 컴포넌트·접근성 spec, 기존 근거 질문 UI | React/TypeScript 패키지 설치 승인, Project Tree, Network/Device/Data Flow 화면 |
| Phase 10 패키징·Pilot | 로컬 기반 완료 | opt-in workspace, 재시작 복원, 삭제·Audit, 오프라인 흐름, Windows/macOS launcher | 독립 실행형 package, 실제 익명화 Pilot |

## Phase 5~6 확인 증거

- 질문 요청은 최대 1,000자, trace depth는 1~12로 제한한다.
- 답변은 현재 immutable snapshot과 선택한 로컬 문서만 사용한다.
- 답변 정책에는 `generatedAddressCount: 0`, `writesToPlc: false`,
  `externalNetworkUsed: false`가 포함된다.
- 코드 근거는 `SourceAnchor`로 원본 파일의 정확한 줄을 연다.
- 로컬 지식 문서는 `.txt`와 `.md`만 허용하며 문서당 1 MB,
  작업공간당 16개·8 MB로 제한한다.
- 다른 vendor 문서는 Import 단계에서 거부한다.
- CPU 계열이 다르면 검색에서 제외한다.
- 작업공간 CPU가 Unknown이면 계열 전용 문서를 모두 제외하고,
  계열 중립 문서만 사용할 수 있다.
- 프롬프트 지시처럼 보이는 문단은 검색 색인에서 제외한다.
- 브라우저 렌더링은 `textContent`를 사용해 문서 내용과 질문 내용을
  HTML로 실행하지 않는다.
- 모든 변경 API는 loopback 서버의 same-origin JSON guard를 통과한다.

## 실제 화면 확인

FX3 fixture `fx3_octal.lst`와 승인 검토 메모를 로컬에서 불러와
`Y20은 어디에서 켜지나요?`를 질문했다.

- 코드 근거: `MAIN / Network 42 / line 7`
- 원문 미리보기: `OUT Y20`
- 문서 근거: `QA-FX3-001 · 개정 A · Y20 출력 검토 · 1쪽`
- 결과: 근거 2개, PLC 쓰기 없음, 외부 네트워크 사용 없음
- 모바일 390×844: 가로 넘침 없음, 버튼·선택·요약 컨트롤 44px 이상
- `Y20 출력을 Force ON 해줘`: 위험 등급 R4, 자동 생성 중단,
  저장 파일 0개
- `서보 모션 제어 회로를 검토용으로 만들어줘`: 위험 등급 R3,
  시뮬레이션 전용 파일과 검토 기록만 제공

## 다음 작업

1. React/TypeScript/Vite 고정 버전 설치 승인을 받은 뒤 Phase 9에서
   기존 화면을 컴포넌트 경계로 전환한다.
2. Project Tree, Network Viewer, Device Detail, Data Flow Graph를 현재
   immutable snapshot API에 연결한다.
3. Grounded Chat과 Change Review를 하나의 프로젝트 검토 흐름으로
   통합한다.
4. 키보드 접근·390px 모바일 보고서·첫 분석 E2E를 자동화한다.

## Phase 7 현재 증거

- 8개 저위험 Template을 명시적으로 분류한다.
- 8개 모두 GX Works2 검토용 Renderer와 최소 3개의 Template별
  `not-run` 테스트 시나리오를 제공한다.
- `LogicCandidate`는 입력·출력·내부·타이머·불변식·가정을 문자열
  명령과 분리해 보관한다.
- R1은 파일 없는 저위험 Draft, R2는 기존 프로젝트 변경 후보,
  R3는 simulation-only, R4는 차단으로 표시한다.
- 승강기·크레인·프레스·연소·로봇·무인 운반 장비뿐 아니라
  브레이크/축·서보/모션·STO/SS1/SLS 요청도 R3로 제한한다.
- 비상정지·안전문·라이트커튼·안전 블록 우회와 명시적인 출력
  Force 요청은 R4로 차단하고 파일을 생성하지 않는다.
- 기존 출력 Writer를 SourceAnchor와 함께 수집한다.
- 동일 출력 Writer가 2개 이상이면 `DUPLICATE_WRITER_CONFLICT`로
  명령·diff·CSV 산출물을 보류한다.
- 기존 파일에서 Template 또는 필수 신호가 불명확하면 근거 없는
  X0/X1/T200을 만들지 않는다.
- 기존 Snapshot에 없는 입력·출력 주소는
  `UNVERIFIED_DEVICE_ADDRESS`로 표시하고 명령 후보를 보류한다.
- 390×844 실제 화면에서 가로 넘침이 없고 버튼·선택·요약 컨트롤은
  모두 44px 이상이다.

## Phase 7 보안 게이트

- 비밀값·인증 토큰·외부 URL·동적 코드 실행·프로세스 실행 추가 없음
- 모든 결과는 `canWriteToPlc: false`, 외부 네트워크 사용 없음
- 기존 same-origin JSON 요청 보호와 요청 크기 제한 회귀 테스트 통과
- 위험·필수 사실·Writer 충돌을 확인할 수 없으면 명령 후보를 보류하는
  fail-closed 정책 적용
- 의존성 추가 없음

| 잔여 위험 | 담당 | 완료 기한 |
| --- | --- | --- |
| 실제 GX Works2 Import·프로그램 체크 미검증 | PLC 담당자 | Pilot 시작 전 |
| R3/R4 분류의 현장 위험성 평가 미검증 | 안전 담당자 | Pilot 시작 전 |
| 실제 익명화 프로젝트의 Writer·주소 충돌 정확도 미측정 | PLC 담당자 | Pilot 시작 전 |

## Phase 8 현재 증거

- 모든 생성 후보는 V0 스키마부터 V6 간이 시뮬레이션까지 로컬에서
  순서대로 검증한다.
- V7 외부 ST 검증은 Mitsubishi IL의 최종 검증으로 오인하지 않도록
  `해당 없음`으로 표시한다.
- V8 GX Works2 프로그램 체크, V9 엔지니어 승인, V10 현장 검증은
  기록이 없으면 반드시 `미실행`으로 유지한다.
- 8개 저위험 Template 각각을 입력 변화와 불변식으로 실행하는
  deterministic simulator가 `pass/fail/warning`과 Trend를 만든다.
- 검증 실패 시 최대 3회까지만 반복하며, 의미를 바꾸지 않는 누락
  `END` 추가만 자동 보정한다. 지원하지 않는 명령이나 안전 위험은
  자동 보정하지 않고 실패로 남긴다.
- 외부 ST와 GX Works2 adapter는 결과 기록만 받으며 프로세스를
  실행하거나 PLC에 쓰지 않는다.
- Validation Matrix와 Trend를 JSON 파일 및 검토 보고서로 제공한다.
- 모바일 390×844 실제 화면에서 가로 넘침이 없고, 유효 클릭 영역은
  44px 이상이며, 넓은 Trend 표는 카드 안에서만 가로 스크롤된다.
- 전체 Node 테스트 80/80 통과.

## Phase 8 보안 게이트

- 동적 코드 실행·외부 프로세스 실행·외부 네트워크 호출 추가 없음
- adapter와 검증 결과 모두 `canWriteToPlc: false`
- 수동 검증 기록은 단계·상태·진단 수·증거 수를 제한하고 잘못된
  요청은 400으로 거부
- 인증되지 않은 외부 결과를 자동 `통과`로 승격하지 않음
- V8~V10 기록 부재와 검증기 불확실성은 fail-closed `미실행`
- 의존성 추가 없음

| 잔여 위험 | 담당 | 완료 기한 |
| --- | --- | --- |
| 실제 GX Works2 프로그램 체크 미실행 | PLC 담당자 | Pilot 시작 전 |
| 외부 ST 연동은 자동 실행이 아닌 수동 기록 adapter만 구현 | 개발 담당자 | Phase 10 Pilot 전 |
| 실제 익명화 프로젝트에서 8종 시뮬레이터 정확도 미측정 | PLC 담당자 | Pilot 시작 전 |
| V9 엔지니어 승인·V10 현장 검증 미실행 | 안전·PLC 담당자 | Production 전 |

## Phase 10 로컬 기반 현재 증거

- Workspace 생성 시 사용자가 `persistent`를 명시한 경우에만
  `~/.plc-review-assistant/workspaces` 아래에 저장한다.
- 기본값은 계속 `memory-only`이며 앱 종료 시 사라진다.
- 저장 Workspace는 원본 파일 내용 대신 정규화 Snapshot, SourceAnchor,
  파일 hash와 크기, Proposal lineage, Validation, 최소화된 Audit만
  보관한다.
- 질문과 검토 메모는 원문을 저장하지 않고 SHA-256 hash만 기록한다.
- Candidate 파일도 내용 대신 파일명, hash, 크기만 기록한다.
- Snapshot manifest는 Candidate가 어느 Snapshot에서 생성되었는지와
  원본 Snapshot hash를 기록한다.
- 로컬 승인·거부 기록은 `manual-review-only`,
  `authorizationEffect: none`, `canWriteToPlc: false`로 고정된다.
- R4 차단 Proposal의 승인 기록은 409로 거부한다.
- Workspace 삭제 시 snapshots, proposals, validations, reports, indexes,
  audit를 포함한 전용 디렉터리를 함께 삭제한다.
- 서버 재시작 통합 테스트에서 persistent Workspace, `MAIN` 프로그램,
  Proposal을 다시 불러왔고 삭제 후 저장 디렉터리가 비었음을 확인했다.
- `fetch`를 실패시키는 오프라인 테스트에서 Import, 근거 질문,
  변경 후보, V0~V6 검증이 외부 네트워크 호출 0건으로 완료됐다.
- Windows/macOS launcher는 기본적으로 deterministic offline 모드를
  실행하고 `PLC_USE_CODEX=1`일 때만 선택적 Codex 정규화를 사용한다.
- 390×844 실제 브라우저에서 저장 선택 UI, 가로 넘침 없음, 유효 클릭
  영역 44px 이상을 확인했다.

## Phase 10 로컬 기반 보안 게이트

- 저장 경로는 생성된 UUID Workspace ID와 고정 하위 디렉터리만 사용
- Workspace·Snapshot·Proposal ID 형식 검증과 JSON/Audit 크기 제한 적용
- 디렉터리 0700, 파일 0600, 임시 파일 후 atomic rename 적용
- 심볼릭 링크인 저장 루트 거부
- 손상된 manifest 또는 소유 Workspace가 다른 Snapshot/Proposal은
  복원 시 신뢰하지 않음
- same-origin JSON guard와 loopback bind 정책 유지
- 비밀값·PLC 자격증명·원문 전체를 로그에 기록하지 않음
- 의존성 추가 없음

| 잔여 위험 | 담당 | 완료 기한 |
| --- | --- | --- |
| React/TypeScript Phase 9 구현은 패키지 설치 승인 대기 | 개발 담당자 | Phase 9 완료 전 |
| Windows/macOS 독립 실행형 패키지는 런타임 번들 방식 미결정 | 개발 담당자 | Pilot 배포 전 |
| 실제 익명화 프로젝트 Pilot 미실행 | PLC 담당자 | Pilot Gate |
| GX Works2 결과와 앱 결과의 Golden Benchmark 미실행 | PLC 담당자 | Pilot Gate |
| 운영 OS별 파일 권한·백업·삭제 정책 검토 미실행 | 보안 담당자 | Pilot Gate |

## PLC-QA-002 Export 호환성 증거 (2026-08-03)

- GX Works2 후보 CSV의 논리 문자열은 BOM 없이 CRLF와 표준 CSV escaping을
  사용하고, 브라우저 다운로드 바이트 경계에서만 UTF-8 BOM을 한 번 붙인다.
- 한글·영문·공백·괄호 파일명을 보존하면서 경로 구분자, 제어 문자,
  Windows 금지 문자와 예약 파일명을 정규화한다.
- 보고서 응답은 ASCII fallback과 RFC 5987 `filename*`를 함께 제공하고,
  브라우저는 확장자를 강제한 뒤 다시 정규화한다.
- 0건, 한글·쉼표·따옴표·개행, 20,000건 대용량, 경로 주입, 중복 실행,
  생성/전달 실패 후 재시도 계약을 로컬 테스트로 고정한다.
- 상단 엑셀 보고서는 기존 UTF-8 SpreadsheetML 계약을 유지하고 CSV BOM을
  적용하지 않는다.

| 잔여 위험 | 담당 | 완료 기한 |
| --- | --- | --- |
| 실제 Windows 10/11 및 설치형 Excel 열기·재저장 왕복 미검증 | Windows QA 담당자 | Pilot 전 |
| 실제 GX Works2 CSV Import·프로그램 체크 미실행 | PLC 담당자 | Pilot 전 |
| 브라우저별 실제 다운로드 위치·보안 정책 차이 미검증 | Windows QA 담당자 | Pilot 전 |
