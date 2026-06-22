import assert from 'node:assert/strict';
import test, { after, before } from 'node:test';

const { createServer } = await import('../src/backend/server.js');

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
  await new Promise((resolve) => server.listen(0, resolve));
  const address = server.address();
  baseUrl = `http://127.0.0.1:${address.port}`;
});

after(async () => {
  if (!server) {
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
