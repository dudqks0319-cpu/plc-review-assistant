import assert from 'node:assert/strict';
import test from 'node:test';
import {
  LOW_RISK_TEMPLATE_LIBRARY,
  selectLowRiskTemplate
} from '../src/application/changeCandidateV2.js';
import { createChangePlan } from '../src/backend/beginnerChangeAssistant.js';

function existingMitsubishiAnalysis({ duplicateWriters = false } = {}) {
  const writer = (id, lineStart) => ({
    id,
    canonicalAddress: 'Y20',
    access: 'write',
    source: {
      artifactId: 'artifact-main',
      programId: 'program-main',
      networkId: `network-${lineStart}`,
      lineStart,
      lineEnd: lineStart,
      contentHash: `hash-${lineStart}`
    }
  });
  return {
    id: 'analysis-change-v2',
    project: {
      id: 'project-change-v2',
      name: 'FX3 output review',
      vendor: 'mitsubishi',
      source: { filename: 'main.lst', fileType: 'mitsubishi-instruction-list' },
      blocks: [{ id: 'block-main', name: 'MAIN', type: 'PROGRAM', protected: false }],
      variables: [
        { name: 'StartButton', address: 'X0', direction: 'input', comment: '기동 버튼' },
        { name: 'StopButton', address: 'X1', direction: 'input', comment: '정지 버튼' },
        { name: 'ConveyorMotor', address: 'Y20', direction: 'output', comment: '컨베이어 출력' }
      ],
      ioAddresses: [],
      callGraph: [],
      protectedItems: []
    },
    snapshot: {
      devices: [
        { canonicalAddress: 'X0', role: 'input' },
        { canonicalAddress: 'X1', role: 'input' },
        { canonicalAddress: 'Y20', role: 'output' }
      ],
      references: duplicateWriters ? [writer('writer-a', 7), writer('writer-b', 19)] : []
    }
  };
}

test('Phase 7 library recognizes eight low-risk templates', () => {
  const cases = [
    ['자기유지 회로를 만들어줘', 'self-holding'],
    ['시작 X0과 정지 X1로 모터를 제어해줘', 'start-stop'],
    ['센서 입력 후 3초 뒤 켜지는 지연 ON', 'delay-on'],
    ['정지 후 2초 뒤 꺼지는 지연 OFF', 'delay-off'],
    ['X0 상승 엣지 one-shot을 만들어줘', 'edge-one-shot'],
    ['Alarm 발생을 래치하고 Reset으로 복귀', 'alarm-latch-reset'],
    ['두 출력 상호 인터락을 만들어줘', 'mutual-interlock'],
    ['센서 채터링을 막는 Debounce 회로', 'sensor-debounce']
  ];

  assert.equal(LOW_RISK_TEMPLATE_LIBRARY.length, 8);
  for (const [question, expected] of cases) {
    assert.equal(selectLowRiskTemplate(question)?.id, expected);
  }
  assert.equal(
    selectLowRiskTemplate('시작 X0과 정지 X1 조건으로 3초 뒤 켜줘')?.id,
    'delay-on'
  );
});

test('existing-project output review does not invent start, stop, timer, or instruction files', () => {
  const plan = createChangePlan({
    analysis: existingMitsubishiAnalysis(),
    vendor: 'mitsubishi',
    requestText: 'Y20 출력 회로의 현재 조건만 검토해줘.',
    sourceContent: 'PROGRAM MAIN\nLD X0\nANI X1\nOUT Y20\nEND',
    sourceFilename: 'main.lst'
  });

  assert.equal(plan.changeCandidateV2.template, null);
  assert.equal(plan.changeCandidateV2.status, 'needs-review');
  assert.equal(plan.executionScope, 'review-only');
  assert.equal(plan.riskClass, 'R2');
  assert.deepEqual(plan.normalizedRequirement.startConditions, []);
  assert.equal(
    plan.normalizedRequirement.stopConditions.some((item) => item.address === 'Y20'),
    false
  );
  assert.equal(plan.circuitDraft, null);
  assert.equal(plan.simulation.result, 'not-run');
  assert.equal(
    plan.candidateFiles.some((file) => /instruction|before-after\.diff/.test(file.filename)),
    false
  );
  assert.equal(
    plan.candidateFiles.some((file) => file.filename === 'main.test-scenarios.json'),
    true
  );
  assert.equal(
    plan.candidateFiles.some((file) => file.filename === 'main.review-report.md'),
    true
  );
});

test('start-stop candidate keeps X0 and X1 roles separate and omits an unused timer', () => {
  const plan = createChangePlan({
    analysis: existingMitsubishiAnalysis(),
    vendor: 'mitsubishi',
    requestText: '시작 X0, 정지 X1, 출력 Y20으로 시작/정지 회로를 변경해줘.',
    sourceContent: 'PROGRAM MAIN\nLD X0\nANI X1\nOUT Y20\nEND',
    sourceFilename: 'main.lst'
  });

  assert.equal(plan.changeCandidateV2.template.id, 'start-stop');
  assert.equal(plan.changeCandidateV2.status, 'candidate');
  assert.equal(plan.riskClass, 'R2');
  assert.deepEqual(
    plan.normalizedRequirement.startConditions.map((item) => item.address),
    ['X0']
  );
  assert.deepEqual(
    plan.normalizedRequirement.stopConditions.map((item) => item.address),
    ['X1']
  );
  assert.equal(plan.circuitDraft.ioMap.some((item) => /^T/.test(item.device)), false);
  assert.equal(
    plan.candidateFiles.some((file) => file.filename === 'main.instruction-candidate.txt'),
    true
  );
});

test('duplicate existing writers hold instruction emission for engineer review', () => {
  const plan = createChangePlan({
    analysis: existingMitsubishiAnalysis({ duplicateWriters: true }),
    vendor: 'mitsubishi',
    requestText: '시작 X0, 정지 X1, 출력 Y20으로 시작/정지 회로를 변경해줘.',
    sourceContent: 'PROGRAM MAIN\nLD X0\nANI X1\nOUT Y20\nEND',
    sourceFilename: 'main.lst'
  });

  assert.equal(plan.changeCandidateV2.status, 'needs-review');
  assert.equal(plan.executionScope, 'review-only');
  assert.equal(
    plan.changeCandidateV2.impactAnalysis.conflicts.some(
      (conflict) =>
        conflict.code === 'DUPLICATE_WRITER_CONFLICT' &&
        conflict.address === 'Y20'
    ),
    true
  );
  assert.equal(plan.changeCandidateV2.policy.canEmitInstructionCandidate, false);
  assert.equal(
    plan.candidateFiles.some((file) => /instruction|before-after\.diff/.test(file.filename)),
    false
  );
});

test('existing-project candidates hold explicit input or output addresses missing from the snapshot', () => {
  const plan = createChangePlan({
    analysis: existingMitsubishiAnalysis(),
    vendor: 'mitsubishi',
    requestText: '허가 X0과 X1로 두 출력 Y20 Y21 상호 인터락 회로를 변경해줘.',
    sourceContent: 'PROGRAM MAIN\nLD X0\nANI X1\nOUT Y20\nEND',
    sourceFilename: 'main.lst'
  });

  assert.equal(plan.changeCandidateV2.template.id, 'mutual-interlock');
  assert.equal(plan.changeCandidateV2.status, 'needs-review');
  assert.equal(plan.executionScope, 'review-only');
  assert.equal(
    plan.changeCandidateV2.impactAnalysis.conflicts.some(
      (conflict) =>
        conflict.code === 'UNVERIFIED_DEVICE_ADDRESS' &&
        conflict.address === 'Y21'
    ),
    true
  );
  assert.equal(plan.changeCandidateV2.policy.canEmitInstructionCandidate, false);
  assert.equal(
    plan.candidateFiles.some((file) => /instruction|before-after\.diff/.test(file.filename)),
    false
  );
});
