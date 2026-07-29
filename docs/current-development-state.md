# PLC Review Assistant 현재 개발 상태

기준일: 2026-07-29  
브랜치: `agent/plc-foundation`  
Phase 5~6 작업 전 기준 커밋: `a719f63`

이 문서는 상세 개발계획서의 단계와 현재 코드 증거를 연결하는 상태
원장이다. 로컬 테스트 통과는 실제 GX Works2 Import, 현장 PLC 연결,
Pilot 승인 또는 Production 출시를 의미하지 않는다.

## 현재 검증된 범위

| 단계 | 상태 | 현재 증거 | 남은 게이트 |
| --- | --- | --- | --- |
| Phase 0 브랜치 안정화 | 로컬 완료 | 전체 Node 테스트 55/55, `git diff --check` 통과 | 원격 CI는 별도 |
| Phase 1 Domain IR·SourceAnchor | 로컬 완료 | canonical snapshot, instruction/reference SourceAnchor, SHA-256 | 실제 익명화 프로젝트 교차 검증 |
| Phase 2 CPU Profile·주소 파서 | 로컬 완료 | FX3/QCPU/LCPU profile, FX3 X/Y 8진 주소 테스트, Unknown timer 정책 | 더 많은 CPU 모델 공식표 |
| Phase 3 Project Bundle·명령 파서 | 로컬 완료 | CSV/TXT/LST/ASC 다중 Import, 인코딩, immutable snapshot, unknown opcode 보존 | Golden Fixture 확대 |
| Phase 4 Cross-reference·Data Flow | 로컬 완료 | Reader/Writer/SET/RST index, 전방·후방 trace, evidence edge | 대형 프로젝트 성능 측정 |
| Phase 5 근거형 질문 | 로컬 완료 | 10개 질문 유형, deterministic Query Planner, confidence/unknown, 원문 줄 이동 | Pilot 질문 정확도 측정 |
| Phase 6 RAG | 로컬 완료 | TXT/MD 메모리 색인, vendor/CPU 격리, 문서 citation, injection 문단 제외 | 벤더 공식 문서 권리 검토 |
| Phase 7 변경 후보 v2 | 진행 전 | 기존 v1 change-plan과 일부 초안 template만 존재 | Logic IR, 저위험 8종, writer 충돌, Risk Class |
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

## 다음 작업

1. 기존 change-plan을 상세 개발계획서의 중립 `Logic IR`과 Risk Class로
   분리한다.
2. 저위험 Template 8종을 명시적으로 등록하고 각 Template의 필수
   입력·금지 조건·검증 시나리오를 고정한다.
3. 기존 Export에서 Writer 또는 주소 충돌이 발견되면 후보 생성 전에
   사용자에게 표시하고 실행 가능한 산출물을 보류한다.
4. R3는 review/simulation-only, R4는 차단하도록 음성 테스트를 먼저
   추가한다.
