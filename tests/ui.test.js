import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

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
