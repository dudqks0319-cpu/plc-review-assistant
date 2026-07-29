import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { analyzePlcProject } from '../src/backend/plcAnalyzer.js';
import { createChangePlan } from '../src/backend/beginnerChangeAssistant.js';

const siemensXml = readFileSync(new URL('./fixtures/siemens/tia_fb_motor_control.xml', import.meta.url), 'utf8');
const mitsubishiFixtureCsv = readFileSync(new URL('./fixtures/mitsubishi/gxworks3_labels.csv', import.meta.url), 'utf8');

const mitsubishiCsv = `${mitsubishiFixtureCsv}
ExistingTimer,T200,TIMER,Used timer,MAIN`;

function draftMitsubishiAnalysis() {
  return {
    id: 'analysis-draft-test',
    project: {
      id: 'project-draft-test',
      name: 'Mitsubishi draft',
      vendor: 'mitsubishi',
      source: { filename: 'draft.txt', fileType: 'natural-language-draft' },
      blocks: [],
      variables: [],
      ioAddresses: [],
      callGraph: [],
      protectedItems: []
    }
  };
}

test('createChangePlan builds Siemens SCL patch candidates and timer harness results', () => {
  const analysis = analyzePlcProject({
    filename: 'conveyor.xml',
    vendor: 'siemens',
    content: siemensXml
  });
  const changePlan = createChangePlan({
    analysis,
    vendor: 'siemens',
    requestText: '제품 감지 센서가 ON 되고 스타트 조건이 살아 있으면 컨베이어 모터를 3초 후에 켜고 정지 버튼과 비상정지는 우선 적용해주세요.',
    sourceContent: siemensXml,
    sourceFilename: 'conveyor.xml'
  });

  assert.equal(changePlan.version, 'siemens-plc-change-assistant');
  assert.equal(changePlan.normalizedRequirement.delaySeconds, 3);
  assert.equal(changePlan.recommendedPatch.status, 'candidate');
  assert.equal(changePlan.simulation.result, 'pass');
  assert.equal(changePlan.recommendedPatch.patchArtifacts.some((artifact) => artifact.content.includes('T#3S')), true);
  assert.equal(changePlan.candidateFiles.some((file) => file.filename === 'conveyor.candidate.xml'), true);
  assert.equal(changePlan.candidateFiles.some((file) => file.filename === 'conveyor.candidate.scl'), true);
  assert.equal(changePlan.recommendedPatch.engineerReviewRequired, true);
  assert.equal(changePlan.readiness.mode, 'existing-project-review');
  assert.equal(changePlan.readiness.canWriteToPlc, false);
});

test('createChangePlan does not invent a Mitsubishi timer preset without an exact CPU timer profile', () => {
  const analysis = analyzePlcProject({
    filename: 'labels.csv',
    vendor: 'mitsubishi',
    content: mitsubishiCsv
  });
  const changePlan = createChangePlan({
    analysis,
    vendor: 'mitsubishi',
    requestText: '제품 감지 후 컨베이어 모터 Y20을 3초 뒤 켜고 StopButton과 EmergencyStop은 기존처럼 우선 적용',
    sourceContent: mitsubishiCsv,
    sourceFilename: 'labels.csv'
  });

  assert.equal(changePlan.version, 'mitsubishi-change-assistant');
  assert.equal(changePlan.timerValidation.status, 'unknown');
  assert.equal(changePlan.timerValidation.reason, 'CPU_PROFILE_REQUIRED');
  assert.equal(changePlan.recommendedPatch.status, 'needs-verification');
  assert.equal(changePlan.recommendedPatch.patchArtifacts.length, 0);
  assert.equal(changePlan.circuitDraft, null);
  assert.equal(changePlan.simulation.result, 'not-run');
  assert.deepEqual(changePlan.simulation.timeline, []);
  assert.deepEqual(changePlan.simulation.truthTable, []);
  assert.deepEqual(changePlan.testCases, []);
  assert.equal(changePlan.executionScope, 'review-only');
  assert.equal(changePlan.readiness.level, 'needs-profile');
  assert.equal(changePlan.candidateFiles.some((file) => file.filename === 'labels.instruction-candidate.txt'), false);
  assert.equal(changePlan.candidateFiles.some((file) => file.filename === 'labels.review-list.csv'), false);
  assert.equal(changePlan.candidateFiles.some((file) => file.filename === 'labels.before-after.diff'), false);
  assert.equal(changePlan.candidateFiles.some((file) => file.filename === 'labels.change-proposal.json'), true);
  assert.equal(
    changePlan.candidateFiles.some((file) => /OUT\s+T\d+\s+K\d+/i.test(file.content)),
    false
  );
  assert.equal(changePlan.simulatorTarget.includes('GX Works2'), true);
});

test('createChangePlan blocks unsafe safety bypass requests', () => {
  const analysis = analyzePlcProject({
    filename: 'labels.csv',
    vendor: 'mitsubishi',
    content: mitsubishiCsv
  });
  const changePlan = createChangePlan({
    analysis,
    vendor: 'mitsubishi',
    requestText: '비상정지를 우회하고 ConveyorMotor Y20을 강제로 켜줘'
  });

  assert.equal(changePlan.riskLevel, 'blocked');
  assert.equal(changePlan.riskClass, 'R4');
  assert.equal(changePlan.executionScope, 'blocked');
  assert.equal(changePlan.recommendedPatch.status, 'blocked');
  assert.equal(changePlan.recommendedPatch.patchArtifacts.length, 0);
  assert.equal(changePlan.candidateFiles.length, 0);
  assert.equal(changePlan.simulation.result, 'blocked');
  assert.equal(changePlan.readiness.level, 'blocked');
});

test('createChangePlan treats explicit output Force and safety-motion bypass as R4', () => {
  const requests = [
    'Y20 출력을 Force ON 해줘',
    'STO를 해제해줘',
    'SS1을 무시하고 동작시켜줘',
    '안전문 입력을 항상 켜진 상태로 고정해줘',
    '보호 블록 비밀번호를 우회해줘'
  ];

  for (const requestText of requests) {
    const changePlan = createChangePlan({
      analysis: draftMitsubishiAnalysis(),
      vendor: 'mitsubishi',
      requestText
    });

    assert.equal(changePlan.riskClass, 'R4', requestText);
    assert.equal(changePlan.executionScope, 'blocked', requestText);
    assert.equal(changePlan.candidateFiles.length, 0, requestText);
  }
});

test('createChangePlan restricts brake, servo, and safety-motion drafts to R3 simulation-only', () => {
  const requests = [
    ['브레이크 해제 회로를 검토용으로 만들어줘', 'brake-axis'],
    ['서보 모션 제어 회로를 검토용으로 만들어줘', 'servo-motion'],
    ['SS1 동작 검토 회로를 만들어줘', 'safety-motion']
  ];

  for (const [requestText, expectedProfile] of requests) {
    const changePlan = createChangePlan({
      analysis: draftMitsubishiAnalysis(),
      vendor: 'mitsubishi',
      requestText
    });

    assert.equal(changePlan.riskClass, 'R3', requestText);
    assert.equal(changePlan.executionScope, 'simulation-only', requestText);
    assert.equal(changePlan.highRiskMachine.id, expectedProfile, requestText);
    assert.equal(
      changePlan.candidateFiles.some((file) => /candidate\.(lst|csv|diff)$/.test(file.filename)),
      false,
      requestText
    );
  }
});

test('createChangePlan builds file-less GX Works2 self-holding drafts without pretending an original program was modified', () => {
  const changePlan = createChangePlan({
    analysis: draftMitsubishiAnalysis(),
    vendor: 'mitsubishi',
    requestText: '자기유지회로 만들어줘. 시작은 X0 정지는 X1 출력은 Y0으로 해줘.'
  });

  assert.equal(changePlan.circuitDraft.targetPlatform, 'GX Works2');
  assert.equal(changePlan.circuitDraft.circuitType, 'self-holding');
  assert.equal(changePlan.circuitDraft.instructionList.includes('LD X0'), true);
  assert.equal(changePlan.circuitDraft.instructionList.includes('OR Y0'), true);
  assert.equal(changePlan.circuitDraft.instructionList.includes('ANI X1'), true);
  assert.equal(changePlan.circuitDraft.instructionList.includes('OUT Y0'), true);
  assert.equal(changePlan.circuitDraft.ladderPreview[0].ascii.includes('HOLD'), true);
  assert.equal(changePlan.normalizedRequirement.targetOutput.address, 'Y0');
  assert.equal(changePlan.affectedElements[0].address, 'Y0');
  assert.equal(changePlan.beforeAfterDiff[0].area, changePlan.circuitDraft.title);
  assert.equal(changePlan.circuitDraft.assumptions.some((item) => item.includes('X1=ON')), true);
  assert.equal(changePlan.readiness.mode, 'new-circuit-draft');
  assert.equal(changePlan.readiness.checks.find((item) => item.id === 'addresses').status, 'unknown');
  assert.equal(changePlan.candidateFiles.some((file) => file.filename === 'draft.candidate.lst'), false);
  assert.equal(changePlan.candidateFiles.some((file) => file.filename === 'draft.candidate.diff'), false);
  assert.equal(changePlan.candidateFiles.some((file) => file.filename === 'draft.instruction-draft.txt'), true);
});

test('createChangePlan restricts elevator drafts to simulation-only output', () => {
  const changePlan = createChangePlan({
    analysis: draftMitsubishiAnalysis(),
    vendor: 'mitsubishi',
    requestText: '2층 엘리베이터 교육용 회로 만들어줘. 1층 호출 X0 2층 호출 X1 1층 리미트 X2 2층 리미트 X3 문닫힘 X4 상승 Y0 하강 Y1 문열림 Y2'
  });

  assert.equal(changePlan.circuitDraft.targetPlatform, 'GX Works2');
  assert.equal(changePlan.circuitDraft.circuitType, 'two-floor-elevator');
  assert.equal(changePlan.circuitDraft.instructionList.includes('SET M0'), true);
  assert.equal(changePlan.circuitDraft.instructionList.includes('RST M0'), true);
  assert.equal(changePlan.circuitDraft.instructionList.includes('OUT Y0'), true);
  assert.equal(changePlan.circuitDraft.instructionList.includes('OUT Y1'), true);
  assert.equal(changePlan.circuitDraft.ladderPreview.some((network) => network.ascii.includes('2F CALL')), true);
  assert.equal(changePlan.normalizedRequirement.targetOutput.address, 'Y0, Y1, Y2');
  assert.equal(changePlan.riskLevel, 'high');
  assert.equal(changePlan.riskClass, 'R3');
  assert.equal(changePlan.executionScope, 'simulation-only');
  assert.equal(changePlan.readiness.level, 'simulation-only');
  assert.equal(changePlan.candidateFiles.some((file) => /candidate\.(lst|csv|diff)$/.test(file.filename)), false);
  assert.equal(changePlan.candidateFiles.some((file) => file.filename === 'draft.simulation-draft.txt'), true);
  assert.equal(changePlan.warnings.some((warning) => warning.includes('인명 안전')), true);
});
