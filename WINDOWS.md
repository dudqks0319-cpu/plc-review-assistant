# Windows 실행 안내

## 준비

- Windows 10 또는 11
- Node.js 20 이상
- 선택 사항: 로그인된 Codex CLI

## 실행

1. 저장소 폴더에서 `start-windows.bat`를 더블 클릭합니다.
2. 브라우저에서 `http://127.0.0.1:4173`을 엽니다.
3. Mitsubishi 또는 Siemens를 선택합니다.
4. PLC export 파일을 분석하거나, 파일 없이 자연어 회로 요청을 입력합니다.

터미널에서는 다음 명령으로 같은 서버를 실행할 수 있습니다.

```powershell
npm start
```

기본 실행은 외부 AI 호출이 없는 결정론적 오프라인 모드입니다.
Codex 요구사항 정규화를 사용하려는 경우에만 실행 전에
`PLC_USE_CODEX=1`을 설정합니다. Codex CLI를 사용할 수 없거나 호출이
실패하면 결정론적 규칙 기반 정규화로 전환합니다. 안전 검증과 후보
패치 검증은 항상 결정론적 규칙으로 수행합니다.

## 로컬 작업공간

- 기본 위치: `%USERPROFILE%\.plc-review-assistant\workspaces`
- 원본 PLC 파일 내용은 기본 저장하지 않습니다.
- 저장 Workspace에는 정규화 Snapshot, SourceAnchor, 해시, Validation,
  최소화된 Audit만 기록합니다.
- Workspace를 삭제하면 관련 Snapshot, Proposal, Validation, Report,
  Index, Audit 디렉터리를 함께 삭제합니다.
- 저장 위치 변경이 필요하면 실행 전에 `PLC_WORKSPACE_DIR` 환경 변수를
  로컬 전용 경로로 설정합니다.

## 다운로드 호환성

- 한글·영문·공백·괄호는 파일명에 유지하고, 경로 구분자와 Windows 금지
  문자는 제거합니다.
- GX Works2 검토용 `.csv` 다운로드 바이트는 UTF-8 BOM으로 시작하며
  행과 필드 내부 개행을 CRLF로 정규화합니다. 쉼표·따옴표·개행이 있는
  필드는 RFC 4180 방식으로 따옴표 처리합니다.
- 상단의 `엑셀` 보고서는 CSV가 아니라 UTF-8 SpreadsheetML `.xls`이므로
  XML 인코딩 선언을 사용하고 CSV BOM은 붙이지 않습니다.
- 이 계약은 로컬 자동 테스트 기준입니다. 실제 Windows 10/11과 설치된
  Excel에서의 열기·저장 왕복 검증은 Pilot 전 별도 게이트입니다.

## GX Works2 사용 절차

1. 앱에서 생성한 `GX Works2 명령 리스트` 또는 `Ladder CSV 패치 후보`를 내려받습니다.
2. 원본 GX Works2 프로젝트를 백업합니다.
3. 오프라인 복사본에 명령 리스트를 검토해 반영합니다.
4. GX Works2 프로그램 체크와 GX Simulator 검증을 수행합니다.
5. PLC 담당자와 현장 책임자가 승인한 뒤 현장 절차를 진행합니다.

이 도구는 PLC에 직접 접속하거나 쓰지 않으며, 안전회로 우회 요청은 차단합니다.
