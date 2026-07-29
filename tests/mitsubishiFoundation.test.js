import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { analyzePlcProject } from '../src/backend/plcAnalyzer.js';
import {
  calculateTimerDuration,
  getCpuProfile,
  nextDeviceAddress,
  parseDeviceAddress
} from '../src/adapters/mitsubishi/deviceAddress.js';
import { parseInstructionList } from '../src/adapters/mitsubishi/instructionListAdapter.js';

const fx3Fixture = readFileSync(new URL('./fixtures/mitsubishi/fx3_octal.lst', import.meta.url), 'utf8');

test('FX3 input and output addresses use octal numbering', () => {
  const profile = getCpuProfile('mitsubishi-fx3');
  const x7 = parseDeviceAddress('X7', profile);
  const y7 = parseDeviceAddress('Y7', profile);

  assert.equal(x7.valid, true);
  assert.equal(x7.numericPart, 7);
  assert.equal(x7.radix, 8);
  assert.equal(nextDeviceAddress(x7, profile).canonical, 'X10');
  assert.equal(nextDeviceAddress(y7, profile).canonical, 'Y10');
});

test('FX3 rejects decimal-only digits in octal X/Y addresses', () => {
  for (const address of ['X8', 'X9', 'Y8', 'Y9']) {
    const parsed = parseDeviceAddress(address, getCpuProfile('mitsubishi-fx3'));
    assert.equal(parsed.valid, false, address);
    assert.equal(parsed.profileStatus, 'invalid-radix', address);
  }
});

test('unknown CPU facts remain unknown and do not produce timer seconds', () => {
  const parsed = parseDeviceAddress('T200', null);
  const duration = calculateTimerDuration({
    timerAddress: parsed,
    preset: 'K30',
    cpuProfile: null
  });

  assert.equal(parsed.valid, null);
  assert.equal(parsed.radix, 'unknown');
  assert.equal(parsed.profileStatus, 'unknown-profile');
  assert.deepEqual(duration, {
    status: 'unknown',
    seconds: null,
    reason: 'CPU_PROFILE_REQUIRED'
  });
});

test('instruction-list parsing produces source-anchored IR and preserves unknown instructions', () => {
  const result = parseInstructionList({
    artifactId: 'artifact-fixture',
    filename: 'fx3_octal.lst',
    content: fx3Fixture,
    cpuProfile: getCpuProfile('mitsubishi-fx3')
  });

  assert.equal(result.programs.length, 1);
  assert.equal(result.programs[0].name, 'MAIN');
  assert.equal(result.programs[0].networks[0].ordinal, 42);
  assert.equal(result.programs[0].networks[0].instructions.some((item) => item.opcode === 'OUT'), true);
  assert.equal(result.unknownInstructions.some((item) => item.opcode === 'VENDOR_UNKNOWN'), true);

  const outputReference = result.references.find((item) => item.canonicalAddress === 'Y20');
  assert.equal(outputReference.access, 'write');
  assert.equal(outputReference.source.lineStart, 7);
  assert.equal(outputReference.source.programId, result.programs[0].id);
  assert.equal(outputReference.source.networkId, result.programs[0].networks[0].id);
  assert.match(outputReference.source.rawSnippetHash, /^[a-f0-9]{64}$/);
});

test('Mitsubishi analysis exposes a canonical snapshot and source-anchored findings', () => {
  const analysis = analyzePlcProject({
    filename: 'fx3_octal.lst',
    vendor: 'mitsubishi',
    cpuProfileId: 'mitsubishi-fx3',
    content: fx3Fixture
  });

  assert.equal(analysis.snapshot.cpuProfileId, 'mitsubishi-fx3');
  assert.equal(analysis.snapshot.programs[0].name, 'MAIN');
  assert.equal(analysis.snapshot.devices.some((item) => item.canonicalAddress === 'X7' && item.radix === 8), true);
  assert.equal(analysis.snapshot.references.some((item) => item.canonicalAddress === 'Y20' && item.access === 'write'), true);
  assert.equal(analysis.snapshot.parseWarnings.some((item) => item.code === 'UNKNOWN_INSTRUCTION'), true);
  assert.equal(
    analysis.findings.every(
      (finding) =>
        Array.isArray(finding.evidenceAnchors) &&
        finding.evidenceAnchors.length > 0 &&
        finding.evidenceAnchors.every((anchor) => /^[a-f0-9]{64}$/.test(anchor.rawSnippetHash))
    ),
    true
  );
});
