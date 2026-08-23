# macOS 실행 안내

## 준비

- macOS 13 이상
- Node.js 20 이상
- 선택 사항: 로그인된 Codex CLI

## 실행

1. Finder에서 `start-macos.command`를 더블 클릭합니다.
2. 브라우저에서 `http://127.0.0.1:4173`을 엽니다.
3. 기본 실행은 외부 AI 호출이 없는 결정론적 오프라인 모드입니다.
4. 선택한 작업공간을 재시작 후에도 남기려면 UI/API에서 저장 방식을
   `persistent`로 선택합니다.

macOS가 처음 실행을 막으면 파일을 Control-클릭한 뒤 `열기`를 한 번
선택합니다.

터미널에서는 다음 명령으로 같은 서버를 실행할 수 있습니다.

```zsh
npm start
```

Codex 요구사항 정규화가 필요한 경우에만 다음처럼 명시적으로 켭니다.

```zsh
PLC_USE_CODEX=1 ./start-macos.command
```

## 로컬 작업공간

- 기본 위치: `~/.plc-review-assistant/workspaces`
- 원본 PLC 파일 내용: 기본 저장 안 함
- 저장 항목: 정규화 Snapshot, SourceAnchor, 파일·Candidate 해시,
  Validation 결과, 최소화된 Audit
- 질문과 검토 메모: 원문 대신 SHA-256 해시 기록
- Workspace 삭제: Snapshot, Proposal, Validation, Report, Index,
  Audit 디렉터리를 함께 삭제

다른 로컬 위치를 사용하려면 실행 전에 `PLC_WORKSPACE_DIR`을 설정합니다.

```zsh
PLC_WORKSPACE_DIR="/Volumes/Secure/PLC Review" ./start-macos.command
```

작업공간 경로는 로컬 전용 위치를 사용하고 네트워크 공유 폴더나 제어망
연결 드라이브를 사용하지 않는 것을 권장합니다.

## 안전 경계

- 서버는 `127.0.0.1`에만 연결됩니다.
- PLC 장치 검색, 접속, 쓰기, 다운로드를 하지 않습니다.
- 로컬 승인 기록은 GX Works2 프로그램 체크, V9 엔지니어 승인 또는
  V10 현장 검증을 대신하지 않습니다.
