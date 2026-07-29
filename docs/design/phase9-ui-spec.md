# Phase 9 UI 설계 기준

기준 시안:

- `phase9-desktop-concept.png`
- `phase9-mobile-concept.png`

이 문서는 상세 개발계획서 Phase 9의 React/TypeScript 구현 기준이다.
시안의 Mitsubishi 표시는 제품 소유권이나 공식 제휴를 뜻하지 않으며,
실제 제품 UI에서는 텍스트 기반 vendor 표기만 사용한다.

## 정보 구조

### Desktop

1. 상단: 제품명, 읽기 전용 상태, 분석 시작, 검토 보고서
2. 왼쪽: Project Tree와 프로젝트 요약
3. 중앙 상단: Network Viewer
4. 중앙 중단: Data Flow
5. 중앙 하단: Grounded Chat과 Change Review
6. 오른쪽: 선택한 Device Detail, SourceAnchor, 신뢰도, Unknown

### Mobile

1. 읽기 전용 헤더
2. 프로젝트·네트워크 선택
3. 선택한 디바이스 요약
4. `회로`, `근거`, `Data Flow`, `검증` 탭
5. 현재 탭 내용과 원문·보고서 동작

모바일은 보고서 열람을 우선하며 Project Tree와 상세 Inspector를
동시에 강제로 표시하지 않는다.

## Design tokens

| 역할 | 값 |
| --- | --- |
| 배경 | `#ffffff` |
| 보조 배경 | `#f6f7f8` |
| 본문 | `#17191c` |
| 보조 본문 | `#5f646c` |
| 테두리 | `#d8dbe0` |
| 선택 배경 | `#e8f2ff` |
| 제품 강조 | `#c8102e` |
| 통과 | `#168a4a` |
| 미실행·Unknown | `#ad7200` |
| 오류·차단 | `#b42318` |
| 최소 클릭 영역 | `44px × 44px` |
| 패널 radius | `6px` |
| UI 본문 | `14px / 1.45` |
| 주요 제목 | `20px~24px / 1.25` |

그라데이션, 네온, 장식용 카드 그리드, 연료 가격·지도 UI를 사용하지
않는다.

## 컴포넌트 경계

- `AppShell`
- `ImportStart`
- `ProjectTree`
- `NetworkViewer`
- `DeviceDetail`
- `DataFlowGraph`
- `GroundedChat`
- `ChangeReview`
- `ValidationMatrix`
- `MobileReportTabs`
- `SourceAnchorButton`
- `StatusText`

`App`은 데이터와 선택 상태만 조합하고, 각 화면의 표·그래프·폼은
별도 컴포넌트가 소유한다.

## 상태·접근성

- `통과`, `실패`, `경고`, `미실행`, `해당 없음`, `Unknown`을 색상만으로
  구분하지 않는다.
- Project Tree, 탭, 디바이스 목록은 키보드로 이동하고 선택할 수 있다.
- 모든 focus 상태는 2px 이상의 명확한 outline을 표시한다.
- Data Flow edge와 Network instruction은 SourceAnchor로 이동 가능해야 한다.
- 페이지 전체 가로 스크롤은 금지하고 넓은 표만 자체 스크롤한다.
- `미실행`을 `통과`처럼 요약하지 않는다.

## 허용된 핵심 문구

- `PLC Review Assistant`
- `읽기 전용 · PLC에 직접 쓰지 않음`
- `분석 시작`
- `검토 보고서`
- `프로젝트`
- `Network Viewer`
- `Device Detail`
- `Data Flow`
- `근거형 질문`
- `변경 검토`
- `로컬 V0~V6 통과`
- `V8~V10 미실행`
- `미실행은 통과가 아닙니다`
- `원문 줄 열기`

## 구현 게이트

1. React, React DOM, TypeScript, Vite의 고정 버전 설치 승인
2. 기존 Node 테스트 회귀 없음
3. TypeScript `noEmit` 통과
4. production UI build 통과
5. 실제 파일 Import부터 첫 분석까지 E2E 통과
6. 키보드-only 핵심 흐름 통과
7. 390×844 모바일 보고서에서 페이지 가로 넘침 없음
8. 데스크톱·모바일 구현 화면을 기준 시안과 직접 비교
