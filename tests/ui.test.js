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
