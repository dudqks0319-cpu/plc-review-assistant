# PLC Review Assistant

Read-only PLC code review, documentation, and change-assistant tool for vendor export files.

## Scope

This MVP analyzes exported project data, not live PLCs and not protected project archives.

Supported inputs:

- Siemens TIA Portal XML exports
- Siemens PLC block/tag XML exports
- Mitsubishi GX Developer/GX Works CSV label exports
- Mitsubishi project listing TXT/LST exports

Two product versions are exposed in the app:

- **Mitsubishi GX Works2 분석 및 회로수정**: GX Works2/GX Works CSV/TXT analysis, ladder instruction/listing patch candidates, GX Works2/GX Simulator scenario candidates
- **Siemens PLC 분석 및 회로수정**: TIA XML/SCL analysis, SCL/SimaticML patch candidates, S7-PLCSIM Advanced scenario candidates

Explicitly out of scope:

- Direct parsing of `.zap20`, `.gx3`, or other original project containers
- Password removal, protected-block bypass, or encrypted-block interpretation
- Online PLC connection
- PLC writes, downloads, or automatic logic modification
- Safety certification or field commissioning replacement

## What It Does

- Detects supported file type from filename and content
- Normalizes exported PLC data into projects, blocks, variables, I/O addresses, and call edges
- Flags static review candidates:
  - duplicate I/O address usage
  - missing block/tag comments
  - weak unused-tag candidates
  - naming-rule violations
  - repeated Set/Reset target candidates
  - protected content markers
- Generates a Korean rule-based review summary from deterministic analysis data
- Optionally uses server-side Codex app-server normalization for ambiguous natural-language change requests
- Converts a natural-language change request into a structured change plan
- Can generate a file-less natural-language draft plan when no PLC export has been uploaded
- Generates GX Works2-oriented ladder instruction drafts and visible ladder previews for basic natural-language requests such as self-holding circuits and simple two-floor elevator training circuits
- Finds target output, start conditions, stop/interlock candidates, and likely affected blocks
- Generates vendor-specific patch candidates:
  - Siemens SCL and SimaticML notes
  - Mitsubishi GX Works2 instruction list, ladder preview notes, and CSV rows
- Generates downloadable candidate files from the Codex app server:
  - modified candidate program text/export
  - vendor patch candidate
  - unified diff
  - change-plan JSON
- Runs a built-in static timer/stop-priority harness for expected-output checks
- Downloads Markdown, Excel-compatible XML, and PDF reports

## Run

```bash
npm install
npm start
```

Open:

```text
http://localhost:4173
```

## Test

```bash
npm test
```

## API

Create an analysis:

```http
POST /api/v1/analyses
Content-Type: application/json

{
  "filename": "project.xml",
  "vendor": "auto",
  "content": "<Document>...</Document>"
}
```

Create a report:

```http
POST /api/v1/reports
Content-Type: application/json

{
  "format": "markdown",
  "analysis": { "...": "analysis response data" }
}
```

Supported report formats are `markdown`, `excel`, and `pdf`.

Normalize a natural-language change request:

```http
POST /api/v1/codex/change-requirements
Content-Type: application/json

{
  "vendor": "siemens",
  "requestText": "제품 감지 후 컨베이어 모터를 3초 뒤 켜고 정지 조건은 우선 적용",
  "analysis": { "...": "analysis response data" }
}
```

By default this endpoint returns a deterministic fallback result. Set `PLC_CODEX_REQUIREMENT_NORMALIZER=app-server` on the server to let the backend try `codex app-server` first. Codex output is treated only as a requirement-normalization hint and is always passed through deterministic safety validation before patch candidates are generated.

Create a circuit-change plan:

```http
POST /api/v1/change-plans
Content-Type: application/json

{
  "vendor": "siemens",
  "requestText": "제품 감지 후 컨베이어 모터를 3초 뒤 켜고 정지 조건은 우선 적용",
  "sourceFilename": "project.xml",
  "sourceContent": "<Document>...</Document>",
  "analysis": { "...": "analysis response data" }
}
```

The response includes:

- normalized requirement
- affected elements
- candidate modification locations
- before/after diff
- expected behavior
- test cases
- built-in harness result
- vendor-specific patch candidates
- GX Works2 circuit preview when the request is a supported natural-language draft
- downloadable candidate files
- required approvals and warnings

For early ideation, `analysis`, `sourceFilename`, and `sourceContent` may be omitted. In that mode the server creates a `natural-language-draft` context and returns a draft candidate only. It cannot check existing tags, addresses, blocks, or collisions until a real vendor export is uploaded.

Supported file-less GX Works2 draft examples:

- `자기유지회로 만들어줘`
- `2층 엘리베이터 회로 만들어줘`
- `제품 감지 후 컨베이어 모터를 3초 뒤 켜줘`

These produce a visible I/O map, ASCII ladder preview, GX Works2 instruction-list candidate, CSV row candidate, and downloadable `.gxworks2.lst` file. They are engineering review drafts, not certified field logic.

## Security Notes

- Uploaded content is analyzed in memory and is not written to disk by the app.
- Candidate modified files are generated in the server response and downloaded by the browser; the app does not overwrite the original uploaded file.
- No secrets are required for the default deterministic MVP.
- If Codex app-server normalization is enabled, Codex credentials must stay server-side through environment variables or Codex local auth. Browser JavaScript never receives Codex tokens.
- No LLM training or external model call is performed unless the optional server-side Codex normalizer is explicitly enabled.
- Protected or password-related markers are reported as excluded items, not bypassed.
- Unsafe requests that bypass, remove, or ignore emergency/safety logic are blocked before patch generation.

## Optional Codex Normalizer

Create a local `.env` from `.env.example` or set environment variables directly:

```bash
export PLC_CODEX_REQUIREMENT_NORMALIZER=app-server
export PLC_CODEX_BIN=codex
export PLC_CODEX_TIMEOUT_MS=20000
```

Use a Codex access token only on trusted server-side runners:

```bash
export CODEX_ACCESS_TOKEN="..."
```

The app does not require the Codex normalizer to run. If Codex is unavailable, times out, or returns invalid JSON, `/api/v1/change-plans` continues with deterministic fallback parsing.

## Accuracy Notes

PLC logic is context-dependent. Static analysis can highlight review candidates, but it cannot prove live equipment behavior. HMI references, drives, field wiring, scan-cycle timing, and safety validation must be checked through the owner’s normal engineering process.

The built-in harness is intentionally small. It validates timer delay and stop-priority expectations for the generated candidate, then produces vendor-simulator scenarios for qualified engineers to run in TIA Portal/S7-PLCSIM Advanced or GX Works2/GX Simulator.
