# Windows 실행 안내

## 준비

- Windows 10 또는 11
- Node.js 20 이상
- 선택 사항: 로그인된 Codex CLI

## 실행

1. 저장소 폴더에서 `start-windows.bat`를 더블 클릭합니다.
2. 브라우저에서 `http://localhost:4173`을 엽니다.
3. Mitsubishi 또는 Siemens를 선택합니다.
4. PLC export 파일을 분석하거나, 파일 없이 자연어 회로 요청을 입력합니다.

터미널에서는 다음 명령으로 같은 서버를 실행할 수 있습니다.

```powershell
npm run start:codex
```

Codex CLI를 사용할 수 없거나 호출이 실패하면 앱은 결정론적 규칙 기반 정규화로 자동 전환합니다. 안전 검증과 후보 패치 검증은 항상 결정론적 규칙으로 수행합니다.

## GX Works2 사용 절차

1. 앱에서 생성한 `GX Works2 명령 리스트` 또는 `Ladder CSV 패치 후보`를 내려받습니다.
2. 원본 GX Works2 프로젝트를 백업합니다.
3. 오프라인 복사본에 명령 리스트를 검토해 반영합니다.
4. GX Works2 프로그램 체크와 GX Simulator 검증을 수행합니다.
5. PLC 담당자와 현장 책임자가 승인한 뒤 현장 절차를 진행합니다.

이 도구는 PLC에 직접 접속하거나 쓰지 않으며, 안전회로 우회 요청은 차단합니다.
