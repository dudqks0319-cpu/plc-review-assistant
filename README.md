# PLC Review Assistant

Read-only PLC code review, documentation, and change-assistant tool for vendor export files.

## Scope

This MVP analyzes exported project data, not live PLCs and not protected project archives.

Supported inputs:

- Siemens TIA Portal XML exports
- Siemens PLC block/tag XML exports
- Mitsubishi GX Developer/GX Works CSV label exports
- Mitsubishi instruction/listing TXT/LST/ASC exports
- Up to 32 Mitsubishi export files in one in-memory Project Bundle

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
- Groups multiple Mitsubishi exports into a content-addressed, immutable review snapshot
- Lets the reviewer declare the Mitsubishi CPU family and source encoding
- Normalizes exported PLC data into projects, blocks, variables, I/O addresses, and call edges
- Preserves SHA-256 source anchors for parsed instructions and findings
- Builds reader/writer/SET/RST cross-references and bounded forward/backward data-flow traces
- Answers ten deterministic Mitsubishi review-question types from the current immutable snapshot
- Opens every export-based answer at its exact source line and keeps unsupported facts as `Unknown`
- Indexes approved TXT/Markdown manuals, internal rules, and reviewed cases in process memory only
- Filters local knowledge by vendor and CPU family before hybrid lexical retrieval
- Cites document number, revision, section, page, and a short matching excerpt without redistributing source files
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
- Generates vendor-specific review candidates only when the required engineering facts are known:
  - Siemens SCL and SimaticML notes
  - Mitsubishi GX Works2 instruction list, ladder preview notes, and CSV rows
- Generates downloadable candidate files from the Codex app server:
  - modified candidate program text/export
  - vendor patch candidate
  - unified diff
  - change-plan JSON
- Runs a small static timer/stop-priority harness only when the required timer model is known
- Downloads Markdown, Excel-compatible XML, and PDF reports

## Run

```bash
npm install
npm start
```

Codex app-server 자연어 정규화를 포함해 실행하려면:

```bash
npm run start:codex
```

Windows에서는 `start-windows.bat`를 더블 클릭할 수 있습니다. 자세한 내용은 [WINDOWS.md](./WINDOWS.md)를 참고하세요.

Open:

```text
http://127.0.0.1:4173
```

The server binds to the local loopback interface only.

## Test

```bash
npm test
```

## API

### Project Bundle and immutable snapshot (v2)

Create an in-memory Mitsubishi review workspace:

```http
POST /api/v2/workspaces
Content-Type: application/json

{
  "name": "FX3 conveyor review",
  "vendor": "mitsubishi",
  "cpuProfileId": "mitsubishi-fx3"
}
```

Import one or more allowlisted exports (`.csv`, `.txt`, `.lst`, `.asc`):

```http
POST /api/v2/workspaces/{workspaceId}/artifacts
Content-Type: application/json

{
  "artifacts": [
    { "filename": "labels.csv", "contentBase64": "...", "encoding": "cp949" },
    { "filename": "main.lst", "contentBase64": "...", "encoding": "cp949" }
  ]
}
```

The response includes the immutable snapshot, per-artifact parse results, findings, source anchors, and data-flow edges. Identical content reuses the same content-addressed snapshot. Workspaces are memory-only and disappear when the server stops.

Review endpoints:

- `GET /api/v2/snapshots/{snapshotId}`
- `GET /api/v2/snapshots/{snapshotId}/programs`
- `GET /api/v2/snapshots/{snapshotId}/findings`
- `GET /api/v2/snapshots/{snapshotId}/data-flow`
- `GET /api/v2/snapshots/{snapshotId}/devices/{address}?maxTraceDepth=4`
- `POST /api/v2/snapshots/{snapshotId}/questions`

Defensive limits: 32 files per bundle, 2 MB per decoded file, 10 MB per bundle, 8 live workspaces, 10 snapshots per workspace, and 40 snapshots per process. ZIP extraction and path-like filenames are rejected.

Ask a grounded question:

```http
POST /api/v2/snapshots/{snapshotId}/questions
Content-Type: application/json

{
  "question": "왜 Y20이 안 켜질 수 있어?",
  "mode": "grounded",
  "maxTraceDepth": 4,
  "includeManualEvidence": true
}
```

The response contains a deterministic query plan, conclusion, verification
steps, explicit unknowns, confidence, policy flags, and evidence records.
Export evidence includes a `SourceAnchor`; local-document evidence includes a
license-aware citation. The endpoint never invents an address and never writes
to a PLC.

Add an approved local document to the workspace:

```http
POST /api/v2/workspaces/{workspaceId}/knowledge-documents
Content-Type: application/json

{
  "filename": "fx3-approved-note.md",
  "sourceType": "approved-case",
  "vendor": "mitsubishi",
  "family": "FX3",
  "documentNumber": "QA-FX3-001",
  "revision": "A",
  "section": "Y20 output review",
  "page": 1,
  "licensePolicy": "local-index-only",
  "content": "Review the upstream conditions of the OUT instruction."
}
```

Knowledge endpoints:

- `GET /api/v2/workspaces/{workspaceId}/knowledge-documents`
- `POST /api/v2/workspaces/{workspaceId}/knowledge-documents`
- `DELETE /api/v2/workspaces/{workspaceId}/knowledge-documents/{documentId}`

Only `.txt` and `.md` documents are accepted. A document is limited to 1 MB;
each workspace is limited to 16 documents and 8 MB. The current implementation
uses deterministic BM25-style lexical retrieval and a lexical reranker. It
does not claim vector embeddings. Paragraphs that resemble prompt injection
instructions are excluded from the searchable index. The entire knowledge
index is memory-only and disappears when the local server stops.

### Compatibility API (v1)

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

`npm start`는 결정론적 fallback을 사용하고, `npm run start:codex`는 `codex app-server`를 먼저 시도합니다. Codex output is treated only as a requirement-normalization hint and is always passed through deterministic safety validation before patch candidates are generated.

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

Requests that do not need a timer can produce a visible I/O map, ASCII ladder
preview, a downloadable `.instruction-draft.txt`, and a `.logic-draft.json`.
For an uploaded Mitsubishi export, the app may use
`.instruction-candidate.txt`, `.before-after.diff`, and `.review-list.csv`.
These are engineering review artifacts only; they are not verified GX Works2
import formats.

Mitsubishi timed requests are fail-closed. If the exact CPU model, timer
device number, instruction, and time base are not backed by a verified timer
profile, the response is `review-only`: no `K` preset, instruction candidate,
diff, CSV, or simulation pass is generated. The JSON record explains which
facts must be verified first.

## Security Notes

- Uploaded content is analyzed in memory and is not written to disk by the app.
- Local knowledge documents are indexed in process memory only; the UI sends them only to the same loopback server.
- Mutating API requests accept local same-origin JSON only; cross-site and non-JSON requests are rejected.
- Filenames, extensions, declared encodings, decoded sizes, bundle totals, and in-memory object counts are bounded before parsing.
- Knowledge searches reject cross-vendor and cross-CPU-family evidence and exclude prompt-like instruction paragraphs.
- Raw IP addresses are not stored or logged.
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
export PLC_CODEX_MODEL=gpt-5.5
export PLC_CODEX_REASONING_EFFORT=low
export PLC_CODEX_TIMEOUT_MS=60000
```

Use a Codex access token only on trusted server-side runners:

```bash
export CODEX_ACCESS_TOKEN="..."
```

The app does not require the Codex normalizer to run. If Codex is unavailable, times out, or returns invalid JSON, `/api/v1/change-plans` continues with deterministic fallback parsing.

## Accuracy Notes

PLC logic is context-dependent. Static analysis can highlight review candidates, but it cannot prove live equipment behavior. HMI references, drives, field wiring, scan-cycle timing, and safety validation must be checked through the owner’s normal engineering process.

The built-in harness is intentionally small. It validates only candidates for
which the required timing facts are known, then produces vendor-simulator
scenarios for qualified engineers to run in TIA Portal/S7-PLCSIM Advanced or
GX Works2/GX Simulator. Unknown timer facts remain unknown.
