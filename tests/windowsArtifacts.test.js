import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

function readProjectFile(path) {
  return readFileSync(new URL(path, import.meta.url), 'utf8');
}

test('Windows launcher starts the Codex-enabled local server', () => {
  const launcher = readProjectFile('../start-windows.bat');

  assert.match(launcher, /where node/);
  assert.match(launcher, /npm run start:codex/);
  assert.match(launcher, /http:\/\/localhost:4173/);
});

test('Codex startup uses supported normalization defaults', () => {
  const packageJson = JSON.parse(readProjectFile('../package.json'));
  const startup = readProjectFile('../src/backend/startCodexServer.js');

  assert.equal(packageJson.scripts['start:codex'], 'node src/backend/startCodexServer.js');
  assert.match(startup, /PLC_CODEX_REQUIREMENT_NORMALIZER/);
  assert.match(startup, /gpt-5\.5/);
  assert.match(startup, /PLC_CODEX_REASONING_EFFORT/);
});
