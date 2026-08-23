import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { createExportWorkflow } from '../public/exportWorkflow.js';

const indexHtml = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
const appJs = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
const stylesCss = readFileSync(new URL('../public/styles.css', import.meta.url), 'utf8');

test('beginner workflow asks for the desired behavior before the optional PLC file', () => {
  const requestPosition = indexHtml.indexOf('id="change-request"');
  const filePosition = indexHtml.indexOf('id="project-file"');

  assert.notEqual(requestPosition, -1);
  assert.notEqual(filePosition, -1);
  assert.equal(requestPosition < filePosition, true);
  assert.match(indexHtml, /기존 PLC 파일이 있으면 추가/);
  assert.doesNotMatch(indexHtml, /name="vendor"/);
});

test('beginner workflow has examples, a required safety acknowledgement, and one obvious primary action', () => {
  const examples = indexHtml.match(/data-example=/g) || [];

  assert.equal(examples.length >= 3, true);
  assert.match(indexHtml, /id="safety-ack"[^>]*required/);
  assert.match(indexHtml, /id="change-button"[^>]*>안전한 회로 초안 만들기</);
  assert.match(appJs, /safetyAck/);
  assert.match(appJs, /updateModeHint/);
});

test('results UI exposes readiness checks and accessible focus styles', () => {
  assert.match(appJs, /readiness-banner/);
  assert.match(appJs, /readiness-check-list/);
  assert.match(stylesCss, /:focus-visible/);
  assert.match(stylesCss, /@media \(max-width: 720px\)/);
});

test('Mitsubishi Project Bundle UI accepts multiple files and explicit CPU and encoding choices', () => {
  assert.match(indexHtml, /id="project-file"[\s\S]*multiple/);
  assert.match(indexHtml, /id="cpu-profile"/);
  assert.match(indexHtml, /value="mitsubishi-fx3"/);
  assert.match(indexHtml, /id="file-encoding"/);
  assert.match(indexHtml, /value="cp949"/);
  assert.match(indexHtml, /id="import-review"/);
  assert.match(appJs, /\/api\/v2\/workspaces/);
  assert.match(appJs, /contentBase64/);
  assert.match(appJs, /bundleRecordToAnalysis/);
});

test('review UI explains unverified timer profiles instead of presenting executable values', () => {
  assert.match(appJs, /needs-profile/);
  assert.match(appJs, /review-only/);
  assert.match(appJs, /CPU·타이머 기준/);
});

test('change review UI shows Phase 7 risk class, template, Logic IR, and conflicts', () => {
  assert.match(appJs, /위험 등급/);
  assert.match(appJs, /Template ·/);
  assert.match(appJs, /Logic IR·영향 검토/);
  assert.match(appJs, /Writer·주소 충돌/);
  assert.match(appJs, /canEmitInstructionCandidate/);
});

test('change review UI separates Phase 8 local, GX Works, approval, and field validation states', () => {
  assert.match(appJs, /Validation Matrix/);
  assert.match(appJs, /로컬 V0~V6/);
  assert.match(appJs, /전체 V0~V10/);
  assert.match(appJs, /실패·경고 이유/);
  assert.match(appJs, /시뮬레이션 Trend/);
  assert.match(appJs, /validationStatusLabel/);
  assert.match(appJs, /외부 기록됨/);
  assert.match(appJs, /안전 성공을 독립 검증한 것은 아닙니다/);
  assert.match(stylesCss, /\.validation-matrix/);
  assert.match(stylesCss, /\.trend-table-wrap/);
});

test('grounded question UI exposes recommended questions, confidence, evidence, and original source navigation', () => {
  const examples = indexHtml.match(/data-question-example=/g) || [];

  assert.equal(examples.length >= 5, true);
  assert.match(indexHtml, /data-tab="question"/);
  assert.match(indexHtml, /id="question-input"[\s\S]*maxlength="1000"/);
  assert.match(indexHtml, /id="question-answer"/);
  assert.match(indexHtml, /id="source-preview-code"/);
  assert.match(appJs, /\/api\/v2\/snapshots\/\$\{encodeURIComponent\(currentSnapshotId\)\}\/questions/);
  assert.match(appJs, /function renderGroundedAnswer/);
  assert.match(appJs, /function openSourceAnchor/);
  assert.match(appJs, /currentArtifactTexts/);
  assert.doesNotMatch(appJs, /\.innerHTML\s*=/);
  assert.match(stylesCss, /\.grounded-question-layout/);
  assert.match(stylesCss, /\.confidence-box/);
});

test('local knowledge UI keeps approved documents workspace-scoped and memory-only', () => {
  assert.match(indexHtml, /id="knowledge-form"/);
  assert.match(indexHtml, /accept="\.txt,\.md"/);
  assert.match(indexHtml, /value="local-index-only"/);
  assert.match(indexHtml, /외부 AI나 검색 서비스로 전송하지 않습니다/);
  assert.match(appJs, /\/knowledge-documents/);
  assert.match(appJs, /file\.size > 1_000_000/);
  assert.match(appJs, /engineeringTool: 'GX Works2'/);
});

test('workspace persistence is an explicit opt-in and explains data minimization', () => {
  assert.match(indexHtml, /id="persist-workspace"/);
  assert.match(indexHtml, /분석 결과를 이 컴퓨터에 저장/);
  assert.match(indexHtml, /원본 파일 내용과 질문 문장은 저장하지 않고/);
  assert.match(appJs, /storage: elements\.persistWorkspace\.checked \? 'persistent' : 'memory-only'/);
  assert.match(stylesCss, /\.workspace-storage-option/);
});

test('report export UI exposes progress, completion detail, failure feedback, and retry', () => {
  assert.match(indexHtml, /id="export-feedback"[\s\S]*aria-live="polite"/);
  assert.match(indexHtml, /id="export-status-title"/);
  assert.match(indexHtml, /id="export-status-detail"/);
  assert.match(indexHtml, /id="export-retry"[\s\S]*다시 시도/);
  assert.match(appJs, /createExportWorkflow/);
  assert.match(appJs, /브라우저 다운로드 위치/);
  assert.match(appJs, /완료되기 전에는 다운로드 완료로 표시하지 않습니다/);
  assert.match(appJs, /createDownloadArtifact/);
  assert.match(appJs, /parseContentDispositionFilename/);
  assert.match(stylesCss, /\.export-feedback\[data-state='running'\]/);
  assert.match(stylesCss, /\.export-feedback\[data-state='failed'\]/);
});

test('large report export prevents duplicate work and does not complete before delivery', async () => {
  let resolveArtifact;
  let deliveryCount = 0;
  const states = [];
  const artifactPromise = new Promise((resolve) => {
    resolveArtifact = resolve;
  });
  const workflow = createExportWorkflow({
    createArtifact: () => artifactPromise,
    deliverArtifact: () => {
      deliveryCount += 1;
    },
    onStateChange: (state) => states.push(state)
  });

  const firstRun = workflow.run('excel');
  const duplicate = await workflow.run('pdf');

  assert.deepEqual(states.map((state) => state.state), ['running']);
  assert.equal(workflow.isRunning(), true);
  assert.equal(duplicate.accepted, false);
  assert.equal(duplicate.reason, 'busy');
  assert.equal(deliveryCount, 0);

  resolveArtifact({
    filename: 'large-review.xls',
    blob: { size: 4_500_000 },
    location: '브라우저 다운로드 위치'
  });
  const completed = await firstRun;

  assert.equal(completed.ok, true);
  assert.equal(deliveryCount, 1);
  assert.deepEqual(states.map((state) => state.state), ['running', 'complete']);
  assert.equal(states[1].filename, 'large-review.xls');
  assert.equal(states[1].sizeBytes, 4_500_000);
  assert.equal(workflow.isRunning(), false);
});

test('failed report export exposes an error and allows a successful retry', async () => {
  let attempt = 0;
  const states = [];
  const workflow = createExportWorkflow({
    createArtifact: async () => {
      attempt += 1;
      if (attempt === 1) throw new Error('로컬 보고서 생성 오류');
      return { filename: 'retry.pdf', blob: { size: 512 } };
    },
    deliverArtifact: () => {},
    onStateChange: (state) => states.push(state)
  });

  const failed = await workflow.run('pdf');
  assert.equal(failed.ok, false);
  assert.equal(failed.message, '로컬 보고서 생성 오류');
  assert.equal(failed.canRetry, true);
  assert.equal(workflow.isRunning(), false);

  const retried = await workflow.run('pdf');
  assert.equal(retried.ok, true);
  assert.deepEqual(
    states.map((state) => state.state),
    ['running', 'failed', 'running', 'complete']
  );
});

test('delivery failure remains failed until retry completes the browser handoff', async () => {
  let deliveryAttempt = 0;
  const states = [];
  const workflow = createExportWorkflow({
    createArtifact: async () => ({
      filename: '재시도 검토 (A).xls',
      blob: { size: 1_024 }
    }),
    deliverArtifact: async () => {
      deliveryAttempt += 1;
      if (deliveryAttempt === 1) throw new Error('브라우저 다운로드 전달 실패');
    },
    onStateChange: (state) => states.push(state)
  });

  const failed = await workflow.run('excel');
  const retried = await workflow.run('excel');

  assert.equal(failed.ok, false);
  assert.equal(failed.canRetry, true);
  assert.equal(retried.ok, true);
  assert.equal(deliveryAttempt, 2);
  assert.deepEqual(
    states.map((state) => state.state),
    ['running', 'failed', 'running', 'complete']
  );
});
