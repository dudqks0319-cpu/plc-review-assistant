import assert from 'node:assert/strict';
import test, { after, before } from 'node:test';

const { createServer } = await import('../src/backend/beginnerServer.js');

const sampleXml = `<?xml version="1.0"?>
<Document>
  <SW.Blocks.OB Name="MainCycle" ProgrammingLanguage="LAD" />
  <SW.Blocks.FB Name="PumpControl" ProgrammingLanguage="LAD">
    <Member Name="PumpStart" Datatype="Bool" Address="%I1.0" Comment="Pump start" />
    <Member Name="PumpRun" Datatype="Bool" Address="%Q1.0" />
  </SW.Blocks.FB>
</Document>`;

let server;
let baseUrl;

before(async () => {
  server = createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject);
      resolve();
    });
  });
  const address = server.address();
  baseUrl = `http://127.0.0.1:${address.port}`;
});

after(async () => {
  if (!server?.listening) {
    return;
  }

  await new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
    server.closeAllConnections();
  });
});

async function requestJson(pathname, options = {}) {
  const response = await fetch(`${baseUrl}${pathname}`, {
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      ...(options.headers || {})
    },
    ...options
  });
  const body = await response.json();
  return { response, body };
}

test('GET /api/health exposes read-only product scope', async () => {
  const { response, body } = await requestJson('/api/health');

  assert.equal(response.status, 200);
  assert.equal(body.data.product, 'PLC Review Assistant');
  assert.equal(body.data.versions.some((version) => version.id === 'siemens-plc-change-assistant'), true);
  assert.equal(body.data.versions.some((version) => version.id === 'mitsubishi-change-assistant'), true);
  assert.equal(body.data.codexRequirementNormalizer, 'deterministic-fallback');
  assert.equal(body.data.writesToPlc, false);
  assert.equal(body.data.bypassesProtectedBlocks, false);
  assert.equal(response.headers.get('X-Frame-Options'), 'DENY');
  assert.match(response.headers.get('Content-Security-Policy'), /frame-ancestors 'none'/);
  assert.equal(response.headers.get('Permissions-Policy'), 'camera=(), microphone=(), geolocation=()');
});

test('POST /api/v1/analyses returns normalized PLC analysis', async () => {
  const { response, body } = await requestJson('/api/v1/analyses', {
    method: 'POST',
    body: JSON.stringify({
      filename: 'pump.xml',
      vendor: 'siemens',
      content: sampleXml
    })
  });

  assert.equal(response.status, 201);
  assert.equal(body.data.project.vendor, 'siemens');
  assert.equal(body.data.summary.blockCount, 2);
  assert.equal(body.data.summary.ioAddressCount >= 2, true);
  assert.match(body.data.assistantSummary, /Siemens/);
});

test('POST /api/v1/analyses accepts an explicit Mitsubishi CPU profile and returns anchored IR', async () => {
  const { response, body } = await requestJson('/api/v1/analyses', {
    method: 'POST',
    body: JSON.stringify({
      filename: 'main.lst',
      vendor: 'mitsubishi',
      cpuProfileId: 'mitsubishi-fx3',
      content: ['PROGRAM MAIN', 'NETWORK 1', 'LD X7', 'OUT Y10', 'END'].join('\n')
    })
  });

  assert.equal(response.status, 201);
  assert.equal(body.data.snapshot.cpuProfileId, 'mitsubishi-fx3');
  assert.equal(body.data.snapshot.programs[0].name, 'MAIN');
  assert.equal(body.data.snapshot.devices.some((device) => device.canonicalAddress === 'X7' && device.radix === 8), true);
  assert.equal(
    body.data.snapshot.references.every((reference) => /^[a-f0-9]{64}$/.test(reference.source.rawSnippetHash)),
    true
  );
});

test('API v2 creates an in-memory workspace, imports a bundle, and exposes device data flow', async () => {
  const workspaceResponse = await requestJson('/api/v2/workspaces', {
    method: 'POST',
    body: JSON.stringify({
      name: 'FX3 conveyor review',
      vendor: 'mitsubishi',
      cpuProfileId: 'mitsubishi-fx3'
    })
  });
  assert.equal(workspaceResponse.response.status, 201);
  assert.match(workspaceResponse.body.requestId, /^req-/);
  const workspaceId = workspaceResponse.body.data.id;

  const importResponse = await requestJson(`/api/v2/workspaces/${workspaceId}/artifacts`, {
    method: 'POST',
    body: JSON.stringify({
      artifacts: [
        {
          filename: 'labels.csv',
          content: 'Label,Device,Comment,Program\nStart,X0,Start command,MAIN\nRun,Y20,Run output,MAIN'
        },
        {
          filename: 'main.lst',
          content: 'PROGRAM MAIN\nNETWORK 1\nLD X0\nOUT Y20\nEND'
        }
      ]
    })
  });
  assert.equal(importResponse.response.status, 201);
  assert.equal(importResponse.body.data.snapshot.artifacts.length, 2);
  const snapshotId = importResponse.body.data.snapshot.id;

  const repeatedImport = await requestJson(`/api/v2/workspaces/${workspaceId}/artifacts`, {
    method: 'POST',
    body: JSON.stringify({
      artifacts: [
        {
          filename: 'labels.csv',
          content: 'Label,Device,Comment,Program\nStart,X0,Start command,MAIN\nRun,Y20,Run output,MAIN'
        },
        {
          filename: 'main.lst',
          content: 'PROGRAM MAIN\nNETWORK 1\nLD X0\nOUT Y20\nEND'
        }
      ]
    })
  });
  assert.equal(repeatedImport.response.status, 201);
  assert.equal(repeatedImport.body.data.reused, true);

  const deviceResponse = await requestJson(
    `/api/v2/snapshots/${snapshotId}/devices/Y20?maxTraceDepth=4`
  );
  assert.equal(deviceResponse.response.status, 200);
  assert.equal(deviceResponse.body.data.device.canonicalAddress, 'Y20');
  assert.equal(deviceResponse.body.data.writers.length, 1);
  assert.equal(
    deviceResponse.body.data.backwardTrace.devices.some(
      (device) => device.canonicalAddress === 'X0'
    ),
    true
  );

  const dataFlowResponse = await requestJson(`/api/v2/snapshots/${snapshotId}/data-flow`);
  assert.equal(dataFlowResponse.response.status, 200);
  assert.equal(
    dataFlowResponse.body.data.edges.some(
      (edge) => edge.fromAddress === 'X0' && edge.toAddress === 'Y20'
    ),
    true
  );
});

test('API v2 answers grounded questions and cites CPU-filtered local knowledge', async () => {
  const workspaceResponse = await requestJson('/api/v2/workspaces', {
    method: 'POST',
    body: JSON.stringify({
      name: 'Grounded FX3 review',
      vendor: 'mitsubishi',
      cpuProfileId: 'mitsubishi-fx3'
    })
  });
  const workspaceId = workspaceResponse.body.data.id;

  const fxManual = await requestJson(
    `/api/v2/workspaces/${workspaceId}/knowledge-documents`,
    {
      method: 'POST',
      body: JSON.stringify({
        filename: 'fx3-local-manual.md',
        sourceType: 'vendor-manual',
        vendor: 'mitsubishi',
        family: 'FX3',
        documentNumber: 'FX3-LOCAL-001',
        section: 'Output control',
        page: 18,
        licensePolicy: 'local-index-only',
        content: 'Y output writer conditions and stop interlocks must be reviewed together.'
      })
    }
  );
  assert.equal(fxManual.response.status, 201);

  await requestJson(`/api/v2/workspaces/${workspaceId}/knowledge-documents`, {
    method: 'POST',
    body: JSON.stringify({
      filename: 'qcpu-local-manual.md',
      sourceType: 'vendor-manual',
      vendor: 'mitsubishi',
      family: 'QCPU',
      licensePolicy: 'local-index-only',
      content: 'Y output writer conditions for QCPU use a family-specific reference.'
    })
  });

  const imported = await requestJson(`/api/v2/workspaces/${workspaceId}/artifacts`, {
    method: 'POST',
    body: JSON.stringify({
      artifacts: [
        {
          filename: 'labels.csv',
          content:
            'Label,Device,Comment,Program\nStartSwitch,X0,Start command,MAIN\nStopSwitch,X1,Stop command,MAIN\nRun,Y20,Conveyor output,MAIN'
        },
        {
          filename: 'main.lst',
          content: 'PROGRAM MAIN\nNETWORK 1\nLD X0\nANI X1\nOUT Y20\nEND'
        }
      ]
    })
  });
  const snapshotId = imported.body.data.snapshot.id;

  const question = await requestJson(`/api/v2/snapshots/${snapshotId}/questions`, {
    method: 'POST',
    body: JSON.stringify({
      question: '왜 Y20이 안 켜질 수 있어?',
      mode: 'grounded',
      maxTraceDepth: 4,
      includeManualEvidence: true
    })
  });

  assert.equal(question.response.status, 201);
  assert.match(question.body.requestId, /^req-/);
  assert.equal(question.body.data.questionType, 'why-output-not-on');
  assert.equal(question.body.data.answer.conclusion.some((item) => item.includes('Y20')), true);
  assert.equal(question.body.data.answer.evidenceIds.length > 0, true);
  assert.equal(
    question.body.data.answer.evidenceIds.every((id) =>
      question.body.data.evidence.some((entry) => entry.id === id)
    ),
    true
  );
  assert.equal(
    question.body.data.evidence.some(
      (entry) => entry.kind === 'knowledge' && entry.citation.filename === 'fx3-local-manual.md'
    ),
    true
  );
  assert.equal(
    question.body.data.evidence.some(
      (entry) => entry.kind === 'knowledge' && entry.citation.filename === 'qcpu-local-manual.md'
    ),
    false
  );
  assert.equal(
    question.body.data.knowledgeSearch.warnings.some(
      (warning) => warning.code === 'KNOWLEDGE_CPU_FAMILY_FILTERED'
    ),
    true
  );
  assert.equal(question.body.data.policy.externalNetworkUsed, false);

  const listed = await requestJson(
    `/api/v2/workspaces/${workspaceId}/knowledge-documents`
  );
  assert.equal(listed.response.status, 200);
  assert.equal(listed.body.data.length, 2);

  const deleted = await requestJson(
    `/api/v2/workspaces/${workspaceId}/knowledge-documents/${fxManual.body.data.id}`,
    { method: 'DELETE' }
  );
  assert.equal(deleted.response.status, 200);
  assert.equal(deleted.body.data.storage, 'memory-only');
});

test('API mutations reject cross-site and non-JSON requests', async () => {
  const crossSite = await fetch(`${baseUrl}/api/v2/workspaces`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Origin: 'https://attacker.example',
      'Sec-Fetch-Site': 'cross-site'
    },
    body: JSON.stringify({ name: 'blocked' })
  });
  assert.equal(crossSite.status, 403);
  const crossSiteBody = await crossSite.json();
  assert.equal(crossSiteBody.error.code, 'CROSS_SITE_REQUEST_BLOCKED');

  const wrongContentType = await fetch(`${baseUrl}/api/v2/workspaces`, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain' },
    body: JSON.stringify({ name: 'blocked' })
  });
  assert.equal(wrongContentType.status, 415);
  const wrongContentTypeBody = await wrongContentType.json();
  assert.equal(wrongContentTypeBody.error.code, 'CONTENT_TYPE_UNSUPPORTED');
});

test('API rejects oversized JSON before parsing or analysis work begins', async () => {
  const response = await fetch(`${baseUrl}/api/v2/workspaces`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'x'.repeat(6_000_100) })
  });

  assert.equal(response.status, 413);
  const body = await response.json();
  assert.equal(body.error.code, 'PAYLOAD_TOO_LARGE');
  assert.equal(body.error.retryable, false);
});

test('POST /api/v1/reports returns markdown, excel, and pdf downloads', async () => {
  const analysisResponse = await requestJson('/api/v1/analyses', {
    method: 'POST',
    body: JSON.stringify({
      filename: 'pump.xml',
      vendor: 'siemens',
      content: sampleXml
    })
  });
  const analysis = analysisResponse.body.data;
  const changePlanResponse = await requestJson('/api/v1/change-plans', {
    method: 'POST',
    body: JSON.stringify({
      analysis,
      vendor: 'siemens',
      requestText: 'PumpRun Q1.0을 PumpStart 조건이 3초 유지된 뒤 켜고 정지 조건은 우선 적용',
      sourceContent: sampleXml,
      sourceFilename: 'pump.xml'
    })
  });
  assert.equal(changePlanResponse.response.status, 201);
  assert.equal(changePlanResponse.body.data.version, 'siemens-plc-change-assistant');
  assert.equal(changePlanResponse.body.data.candidateFiles.some((file) => file.filename === 'pump.candidate.xml'), true);
  assert.equal(changePlanResponse.body.data.candidateFiles.some((file) => file.filename === 'pump.candidate.scl'), true);
  assert.equal(changePlanResponse.body.data.readiness.mode, 'existing-project-review');
  const changePlan = changePlanResponse.body.data;

  const markdown = await fetch(`${baseUrl}/api/v1/reports`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify({ format: 'markdown', analysis, changePlan })
  });
  assert.equal(markdown.status, 200);
  assert.equal(markdown.headers.get('Content-Type').startsWith('text/markdown'), true);
  const markdownText = await markdown.text();
  assert.match(markdownText, /PLC Review Assistant Report/);
  assert.match(markdownText, /회로수정 후보/);

  const excel = await fetch(`${baseUrl}/api/v1/reports`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify({ format: 'excel', analysis, changePlan })
  });
  assert.equal(excel.status, 200);
  assert.equal(excel.headers.get('Content-Type').startsWith('application/vnd.ms-excel'), true);
  const excelText = await excel.text();
  assert.match(excelText, /<Workbook/);
  assert.match(excelText, /ChangePlan/);

  const pdf = await fetch(`${baseUrl}/api/v1/reports`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify({ format: 'pdf', analysis, changePlan })
  });
  assert.equal(pdf.status, 200);
  assert.equal(pdf.headers.get('Content-Type'), 'application/pdf');
  const pdfBytes = Buffer.from(await pdf.arrayBuffer());
  assert.equal(pdfBytes.subarray(0, 5).toString('utf8'), '%PDF-');
});

test('POST /api/v1/codex/change-requirements falls back when Codex normalizer is disabled', async () => {
  const analysisResponse = await requestJson('/api/v1/analyses', {
    method: 'POST',
    body: JSON.stringify({
      filename: 'pump.xml',
      vendor: 'siemens',
      content: sampleXml
    })
  });

  const { response, body } = await requestJson('/api/v1/codex/change-requirements', {
    method: 'POST',
    body: JSON.stringify({
      analysis: analysisResponse.body.data,
      vendor: 'siemens',
      requestText: 'PumpRun을 3초 뒤 켜고 정지 조건은 우선 적용'
    })
  });

  assert.equal(response.status, 200);
  assert.equal(body.data.source, 'deterministic-fallback');
  assert.equal(body.data.requirement.delaySeconds, 3);
  assert.equal(body.data.validation.ok, true);
});

test('POST /api/v1/change-plans requires a verified timer profile before a Mitsubishi timed draft', async () => {
  const { response, body } = await requestJson('/api/v1/change-plans', {
    method: 'POST',
    body: JSON.stringify({
      vendor: 'mitsubishi',
      requestText: '컨베이어 모터를 3초 뒤 켜고 정지 조건은 우선 적용'
    })
  });

  assert.equal(response.status, 201);
  assert.equal(body.data.version, 'mitsubishi-change-assistant');
  assert.equal(body.data.normalizedRequirement.delaySeconds, 3);
  assert.equal(body.data.timerValidation.status, 'unknown');
  assert.equal(body.data.timerValidation.reason, 'CPU_PROFILE_REQUIRED');
  assert.equal(body.data.recommendedPatch.status, 'needs-verification');
  assert.equal(body.data.recommendedPatch.patchArtifacts.length, 0);
  assert.equal(body.data.simulation.result, 'not-run');
  assert.deepEqual(body.data.simulation.timeline, []);
  assert.deepEqual(body.data.testCases, []);
  assert.equal(body.data.executionScope, 'review-only');
  assert.equal(body.data.readiness.mode, 'new-circuit-draft');
  assert.equal(body.data.readiness.level, 'needs-profile');
  assert.equal(body.data.readiness.canWriteToPlc, false);
  assert.equal(
    body.data.candidateFiles.some(
      (file) => file.filename === 'mitsubishi-natural-language-draft.instruction-draft.txt'
    ),
    false
  );
  assert.equal(
    body.data.candidateFiles.some((file) => file.filename === 'mitsubishi-natural-language-draft.logic-draft.json'),
    true
  );
  assert.equal(body.data.candidateFiles.some((file) => file.filename.endsWith('.candidate.lst')), false);
  assert.equal(body.data.candidateFiles.some((file) => file.filename.endsWith('.candidate.diff')), false);
  assert.equal(
    body.data.candidateFiles.some((file) => /OUT\s+T\d+\s+K\d+/i.test(file.content)),
    false
  );
});

test('POST /api/v1/change-plans returns simulation-only files for elevator drafts', async () => {
  const { response, body } = await requestJson('/api/v1/change-plans', {
    method: 'POST',
    body: JSON.stringify({
      vendor: 'mitsubishi',
      requestText: '2층 엘리베이터 교육용 회로. 호출 X0 X1, 도착 X2 X3, 문닫힘 X4, 상승 Y0, 하강 Y1, 문열림 Y2'
    })
  });

  assert.equal(response.status, 201);
  assert.equal(body.data.riskLevel, 'high');
  assert.equal(body.data.executionScope, 'simulation-only');
  assert.equal(body.data.recommendedPatch.status, 'simulation-only');
  assert.equal(
    body.data.candidateFiles.some((file) => file.filename === 'mitsubishi-natural-language-draft.simulation-draft.txt'),
    true
  );
  assert.equal(body.data.candidateFiles.some((file) => /candidate\.(lst|csv|diff)$/.test(file.filename)), false);
});
