# PLC 백엔드·검증 게이트 재감사

기준일: 2026-08-03  
대상: `agent/plc-foundation` 로컬 worktree

이 문서는 로컬 테스트, 운영체제 실행, 벤더 도구 결과, 사람의 승인,
배포 기반을 서로 다른 증거 표면으로 유지한다. 한 표면의 성공은 다른
표면의 성공으로 승격되지 않는다.

## A/B/C/D 정의

| 계층 | 증거 표면 | 현재 판정 | 현재 증거 | 다음 게이트 |
| --- | --- | --- | --- | --- |
| A1 | 로컬 export 바이트·파일명 계약 | LOCAL PASS | UTF-8 BOM/CRLF/escaping, 0건·20,000건·경로 주입 fixture | 실제 Windows Excel 왕복은 B1 |
| A2 | 로컬 V0~V6 정적 규칙·결정론적 simulator | LOCAL PASS | `validationLoop`과 음성 테스트, 외부 실행·PLC 쓰기 없음 | 벤더 compile/simulator는 C |
| B1 | 실제 Windows 10/11 실행과 Excel 열기·재저장 | NOT RUN | Windows 안내와 `.bat`만 존재 | Windows 실기기 QA |
| B2 | Windows 독립 실행형 packaging | MISSING | 런타임 번들·installer·서명 산출물 없음 | packaging 방식·서명 정책 결정 |
| B3 | Windows CI | MISSING | 로컬 workflow는 Ubuntu Node 테스트만 정의 | `windows-latest` job과 산출물 검증 |
| C1 | GX Works2 Import·Program Check·GX Simulator | NOT RUN | V8은 record-only adapter이며 프로세스를 실행하지 않음 | 익명화 fixture를 벤더 툴에서 수동 검증 |
| C2 | TIA Portal compile·S7-PLCSIM | NOT RUN | SCL 후보·시나리오만 생성, TIA/PLCSIM 실행 통합 없음 | TIA compile 결과와 simulator 증거 수집 |
| D1 | 자격 있는 PLC/안전 엔지니어 승인 | RECORDED, NOT VERIFIED | V9 역할·증거 ID를 기록할 수 있으나 자격·신원 인증은 하지 않음 | 조직 승인 시스템 또는 서명된 검토 기록 |
| D2 | 현장·안전 시스템 검증 | NOT RUN | V10은 외부 결과 기록 전용이며 현장 동작을 보장하지 않음 | 안전 담당자·PLC 담당자·현장 책임자 절차 |

## 이번에 닫은 A 조각

상위 수동 게이트의 fail-closed 기록 계약만 보강했다.

- `pass` 수동 기록은 최소 한 개의 evidence ID가 없으면 거부한다.
- V9 `pass`는 `plc-engineer`, `safety-engineer`, `site-owner` 중 하나의
  역할 기록이 없으면 거부한다.
- V8~V10을 `not-applicable`로 생략할 수 없다.
- 역할 문자열은 자격 인증이 아니라 기록일 뿐이며
  `qualificationVerified: false`로 고정한다.
- 모든 외부 기록이 입력되어도 전체 상태는 `pass`가 아니라 `recorded`,
  외부 상태는 `recorded-not-independently-verified`로 표시한다.
- `fieldBehaviorGuaranteed`와 `safetySystemSuccessClaimed`는 항상 `false`다.

## 확인이 필요한 증거

1. 실제 Windows에서 한글 CSV와 SpreadsheetML을 Excel로 열고 재저장한
   바이트·스크린샷·버전 기록
2. GX Works2와 TIA Portal의 정확한 버전, compile/program-check 로그,
   simulator 시나리오와 결과
3. 승인자의 조직상 자격과 승인 범위를 검증할 수 있는 외부 기록
4. Windows package 형식, 코드 서명, 설치·삭제·업데이트·오프라인 동작
5. Windows CI job의 실제 성공 run과 생성 산출물 hash

## 금지된 결론

- 로컬 V0~V6 통과를 GX Works2/TIA compile 성공으로 표현하지 않는다.
- simulator 기록을 실제 설비 또는 안전 시스템 성공으로 표현하지 않는다.
- 역할 문자열 입력을 자격 있는 엔지니어의 신원·자격 검증으로 표현하지 않는다.
- `.bat` 실행 파일을 Windows package 또는 CI 증거로 표현하지 않는다.
