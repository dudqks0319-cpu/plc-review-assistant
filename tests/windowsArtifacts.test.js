import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

function readProjectFile(path) {
  return readFileSync(new URL(path, import.meta.url), 'utf8');
}

test('Windows launcher defaults to loopback-only deterministic offline mode', () => {
  const launcher = readProjectFile('../start-windows.bat');

  assert.match(launcher, /where node/);
  assert.match(launcher, /npm start/);
  assert.match(launcher, /npm run start:codex/);
  assert.match(launcher, /PLC_USE_CODEX/);
  assert.match(launcher, /http:\/\/127\.0\.0\.1:4173/);
});

test('macOS launcher defaults to loopback-only deterministic offline mode', () => {
  const launcher = readProjectFile('../start-macos.command');

  assert.match(launcher, /command -v node/);
  assert.match(launcher, /npm start/);
  assert.match(launcher, /npm run start:codex/);
  assert.match(launcher, /PLC_USE_CODEX/);
  assert.match(launcher, /http:\/\/127\.0\.0\.1:4173/);
});

test('Codex startup uses supported normalization defaults', () => {
  const packageJson = JSON.parse(readProjectFile('../package.json'));
  const startup = readProjectFile('../src/backend/startCodexServer.js');

  assert.equal(packageJson.scripts['start:codex'], 'node src/backend/startCodexServer.js');
  assert.match(startup, /PLC_CODEX_REQUIREMENT_NORMALIZER/);
  assert.match(startup, /gpt-5\.5/);
  assert.match(startup, /PLC_CODEX_REASONING_EFFORT/);
});
