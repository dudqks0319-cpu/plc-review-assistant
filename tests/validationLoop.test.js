import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createManualValidationRecord,
  createRecordOnlyVendorAdapter
} from '../src/application/vendorValidationAdapters.js';
import { runValidationLoop } from '../src/application/validationLoop.js';

function oneShotFixture({ instructionList = ['LD X0', 'PLS M200', 'LD M200', 'OUT Y0', 'END'] } = {}) {
  const changeCandidate = {
    version: 'change-candidate-v2',
    status: 'candidate',
    template: {
      id: 'edge-one-shot',
      label: 'Rising/Falling one-shot',
      requiredFacts: ['trigger', 'output', 'edge'],
      renderer: 'gxworks2'
    },
    logicIr: {
      version: 'logic-candidate-v2',
      templateId: 'edge-one-shot',
      networks: [
        {
          id: 'network-one-shot',
          name: 'One shot',
          intent: 'one scan pulse',
          operations: instructionList
            .filter((line) => line !== 'END')
            .map((line, index) => ({
              id: `operation-${index}`,
              expression: line,
              evidence: 'candidate'
            })),
          sourceAnchors: []
        }
      ],
      inputs: [
        {
          id: 'signal-x0',
          address: 'X0',
          name: 'Trigger',
          role: 'input',
          evidence: 'candidate-assumption'
        }
      ],
      outputs: [
        {
          id: 'signal-y0',
          address: 'Y0',
          name: 'Pulse output',
          role: 'output',
          evidence: 'candidate-assumption'
        }
      ],
      internals: [
        {
          id: 'signal-m200',
          address: 'M200',
          name: 'Pulse relay',
          role: 'internal',
          evidence: 'candidate-assumption'
        }
      ],
      timers: [],
      invariants: [
        {
          id: 'candidate-read-only',
          expression: 'candidate.writesToPlc == false',
          severity: 'must'
        }
      ],
      assumptions: [],
      writesToPlc: false
    },
    impactAnalysis: {
      targetAddresses: ['Y0'],
      existingWriters: [],
      conflicts: []
    },
    validation: {
      status: 'candidate',
      missingFacts: [],
      reviewReasons: [],
      instructionEmissionAllowed: true
    },
    risk: {
      class: 'R1',
      scope: 'draft-candidate',
      highRiskMachine: null
    },
    policy: {
      canWriteToPlc: false,
      canEmitInstructionCandidate: true,
      externalNetworkUsed: false
    }
  };

  return {
    changeCandidate,
    circuitDraft: {
      targetPlatform: 'GX Works2',
      circuitType: 'edge-one-shot',
      title: 'One shot fixture',
      ioMap: [],
      instructionList,
      ladderPreview: [],
      operationSummary: [],
      gxWorks2Notes: [],
      safetyNotes: []
    },
    testScenarios: [
      {
        id: 'steady',
        name: 'steady input',
        inputs: { previous: false, current: false },
        expectedOutput: false,
        expectedState: { Y0: false },
        status: 'not-run',
        evidence: 'template-generated'
      },
      {
        id: 'edge',
        name: 'rising edge',
        inputs: { previous: false, current: true, scan: 1 },
        expectedOutput: true,
        expectedState: { Y0: true },
        status: 'not-run',
        evidence: 'template-generated'
      },
      {
        id: 'next-scan',
        name: 'next scan',
        inputs: { previous: true, current: true, scan: 2 },
        expectedOutput: false,
        expectedState: { Y0: false },
        status: 'not-run',
        evidence: 'template-generated'
      }
    ]
  };
}

test('validation loop repairs a missing END and then passes local V0-V6 checks', () => {
  const fixture = oneShotFixture({
    instructionList: ['LD X0', 'PLS M200', 'LD M200', 'OUT Y0']
  });
  const result = runValidationLoop({
    ...fixture,
    maxIterations: 2,
    now: '2026-07-29T00:00:00.000Z'
  });

  assert.equal(result.version, 'validation-loop-v1');
  assert.equal(result.iterations.length, 2);
  assert.deepEqual(result.repairs.map((repair) => repair.code), ['APPEND_END']);
  assert.equal(result.circuitDraft.instructionList.at(-1), 'END');
  assert.equal(result.summary.localStatus, 'pass');
  assert.equal(result.summary.overallStatus, 'not-run');
  assert.equal(result.validationRuns.find((run) => run.level === 'V3').status, 'pass');
  assert.equal(result.validationRuns.find((run) => run.level === 'V6').status, 'pass');
  assert.equal(result.validationRuns.find((run) => run.level === 'V8').status, 'not-run');
  assert.equal(result.simulation.result, 'pass');
  assert.equal(result.simulation.scenarios.every((scenario) => scenario.status === 'pass'), true);
  assert.equal(result.trend.rows.length, 3);
  assert.equal(result.policy.canWriteToPlc, false);
});

test('validation loop reports an unrepairable instruction failure without claiming simulation passed', () => {
  const fixture = oneShotFixture({
    instructionList: ['LD X0', 'FORCE Y0', 'END']
  });
  const result = runValidationLoop({
    ...fixture,
    maxIterations: 2,
    now: '2026-07-29T00:00:00.000Z'
  });

  assert.equal(result.summary.localStatus, 'fail');
  assert.equal(result.summary.overallStatus, 'fail');
  assert.equal(result.iterations.length, 1);
  assert.equal(result.repairs.length, 0);
  assert.equal(
    result.validationRuns
      .find((run) => run.level === 'V3')
      .diagnostics.some((diagnostic) => diagnostic.code === 'UNSUPPORTED_INSTRUCTION'),
    true
  );
  assert.equal(result.validationRuns.find((run) => run.level === 'V6').status, 'not-run');
  assert.equal(result.simulation.result, 'not-run');
});

test('manual validation records keep GX Works, approval, and field gates separate', () => {
  const fixture = oneShotFixture();
  const manualValidationRecords = [
    createManualValidationRecord({
      level: 'V8',
      status: 'pass',
      tool: 'GX Works2',
      toolVersion: 'manual-check',
      diagnostics: [],
      evidenceIds: ['gx-check-001'],
      startedAt: '2026-07-29T00:00:00.000Z',
      finishedAt: '2026-07-29T00:01:00.000Z'
    })
  ];
  const result = runValidationLoop({
    ...fixture,
    manualValidationRecords,
    now: '2026-07-29T00:02:00.000Z'
  });

  assert.equal(result.validationRuns.find((run) => run.level === 'V8').status, 'pass');
  assert.equal(result.validationRuns.find((run) => run.level === 'V9').status, 'not-run');
  assert.equal(result.validationRuns.find((run) => run.level === 'V10').status, 'not-run');
  assert.equal(result.summary.overallStatus, 'not-run');
});

test('manual pass records require evidence and V9 approval role', () => {
  assert.throws(
    () =>
      createManualValidationRecord({
        level: 'V8',
        status: 'pass',
        tool: 'GX Works2'
      }),
    (error) =>
      error.code === 'INVALID_VALIDATION_RECORD' &&
      /evidence/i.test(error.message)
  );
  assert.throws(
    () =>
      createManualValidationRecord({
        level: 'V9',
        status: 'pass',
        tool: 'Engineer approval record',
        evidenceIds: ['approval-001']
      }),
    (error) =>
      error.code === 'INVALID_VALIDATION_RECORD' &&
      /reviewer role/i.test(error.message)
  );
  assert.throws(
    () =>
      createManualValidationRecord({
        level: 'V10',
        status: 'not-applicable',
        tool: 'Field validation'
      }),
    (error) =>
      error.code === 'INVALID_VALIDATION_RECORD' &&
      /cannot be marked not-applicable/i.test(error.message)
  );
});

test('complete manual upper-gate records never claim independently verified field success', () => {
  const fixture = oneShotFixture();
  const result = runValidationLoop({
    ...fixture,
    manualValidationRecords: [
      {
        level: 'V8',
        status: 'pass',
        tool: 'GX Works2 program check record',
        evidenceIds: ['gx-check-001']
      },
      {
        level: 'V9',
        status: 'pass',
        tool: 'Engineer approval record',
        reviewerRole: 'plc-engineer',
        evidenceIds: ['approval-001']
      },
      {
        level: 'V10',
        status: 'pass',
        tool: 'Field validation record',
        evidenceIds: ['field-check-001']
      }
    ],
    now: '2026-08-03T00:00:00.000Z'
  });
  const approval = result.validationRuns.find((run) => run.level === 'V9');

  assert.equal(result.summary.overallStatus, 'recorded');
  assert.equal(
    result.summary.externalEvidenceStatus,
    'recorded-not-independently-verified'
  );
  assert.equal(result.summary.fieldBehaviorGuaranteed, false);
  assert.equal(result.summary.safetySystemSuccessClaimed, false);
  assert.equal(approval.reviewerRole, 'plc-engineer');
  assert.equal(approval.qualificationVerified, false);
  assert.equal(approval.claimScope, 'external-result-record-only');
  assert.equal(result.policy.canWriteToPlc, false);
});

test('record-only external and GX Works adapters never execute tools or write to a PLC', async () => {
  const adapter = createRecordOnlyVendorAdapter({
    id: 'gxworks2-manual',
    label: 'GX Works2 manual program check',
    level: 'V8'
  });

  assert.equal(adapter.canWriteToPlc, false);
  assert.equal(adapter.executesExternalProcess, false);
  assert.equal((await adapter.detectInstallation()).status, 'not-run');
  assert.equal((await adapter.validate({ filename: 'candidate.lst' })).status, 'not-run');
});
