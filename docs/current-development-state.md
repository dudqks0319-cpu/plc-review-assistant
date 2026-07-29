# PLC Review Assistant 현재 개발 상태

기준일: 2026-07-29  
브랜치: `agent/plc-foundation`  
Phase 5~6 완료 커밋: `c44e79e`

이 문서는 상세 개발계획서의 단계와 현재 코드 증거를 연결하는 상태
원장이다. 로컬 테스트 통과는 실제 GX Works2 Import, 현장 PLC 연결,
Pilot 승인 또는 Production 출시를 의미하지 않는다.

## 현재 검증된 범위

| 단계 | 상태 | 현재 증거 | 남은 게이트 |
| --- | --- | --- | --- |
| Phase 0 브랜치 안정화 | 로컬 완료 | 전체 Node 테스트 64/64, `git diff --check` 통과 | 원격 CI는 별도 |
| Phase 1 Domain IR·SourceAnchor | 로컬 완료 | canonical snapshot, instruction/reference SourceAnchor, SHA-256 | 실제 익명화 프로젝트 교차 검증 |
| Phase 2 CPU Profile·주소 파서 | 로컬 완료 | FX3/QCPU/LCPU profile, FX3 X/Y 8진 주소 테스트, Unknown timer 정책 | 더 많은 CPU 모델 공식표 |
| Phase 3 Project Bundle·명령 파서 | 로컬 완료 | CSV/TXT/LST/ASC 다중 Import, 인코딩, immutable snapshot, unknown opcode 보존 | Golden Fixture 확대 |
| Phase 4 Cross-reference·Data Flow | 로컬 완료 | Reader/Writer/SET/RST index, 전방·후방 trace, evidence edge | 대형 프로젝트 성능 측정 |
| Phase 5 근거형 질문 | 로컬 완료 | 10개 질문 유형, deterministic Query Planner, confidence/unknown, 원문 줄 이동 | Pilot 질문 정확도 측정 |
| Phase 6 RAG | 로컬 완료 | TXT/MD 메모리 색인, vendor/CPU 격리, 문서 citation, injection 문단 제외 | 벤더 공식 문서 권리 검토 |
| Phase 7 변경 후보 v2 | 로컬 완료 | 저위험 8종 GX Works2 Renderer, Logic IR, R1~R4, Writer·주소 충돌, Template별 test/report | 실제 GX Works2 프로그램 체크·Pilot |
| Phase 8 검증 루프 | 일부 존재 | 제한된 timer/stop-priority harness | 반복 수정, Validation Matrix, Trend, 외부 adapter |
| Phase 9 UI 전면 개선 | 일부 존재 | 근거 질문 UI, 키보드 focus, 44px 터치, 390px 가로 넘침 없음 | React/TypeScript, Project Tree, Network/Device/Data Flow 화면 |
| Phase 10 패키징·Pilot | 일부 존재 | loopback 서버, Windows launcher | 재시작 복원, 삭제/로그 정책, macOS package, Pilot |

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

1. Phase 8 Validation Matrix와 생성→검증→수정 반복을 구현한다.
2. Template별 `not-run` 시나리오를 간이 Simulator의 실제
   `pass/fail/warning` 결과와 Trend로 연결한다.
3. 기존 Writer 1개는 정확한 SourceAnchor 위치 수정 후보로 연결하고,
   Writer 2개 이상은 계속 명령 후보를 보류한다.
4. 외부 ST Tool과 GX Works2 수동 프로그램 체크 결과를 기록할
   Adapter 계약을 구현한다.

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
