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

function draftMitsubishiAnalysisWithCpu() {
  return {
    ...draftMitsubishiAnalysis(),
    snapshot: {
      cpuProfileId: {
        id: 'verified-fx3-test-profile',
        addressRadixByDevice: { X: 8, Y: 8, M: 10, T: 10 },
        timerProfiles: [
          {
            deviceType: 'T',
            status: 'verified',
            secondsPerUnit: 0.1,
            start: 0,
            end: 255
          }
        ]
      }
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

test('createChangePlan renders all five additional low-risk templates as GX Works2 candidates', () => {
  const scenarios = [
    {
      requestText: '시작 X0, 정지 X1, 출력 Y0은 시작이 꺼진 뒤 3초 지연 OFF 해줘',
      analysis: draftMitsubishiAnalysisWithCpu(),
      template: 'delay-off',
      circuitType: 'delay-off',
      instructions: ['SET M200', 'OUT T200 K30', 'RST M200', 'OUT Y0']
    },
    {
      requestText: '상승 엣지 X0에서 Y0 one-shot 출력을 만들어줘',
      analysis: draftMitsubishiAnalysis(),
      template: 'edge-one-shot',
      circuitType: 'edge-one-shot',
      instructions: ['LD X0', 'PLS M200', 'LD M200', 'OUT Y0']
    },
    {
      requestText: '알람 X0 발생 시 Y0을 래치하고 리셋 X1이 켜지면 복귀해줘',
      analysis: draftMitsubishiAnalysis(),
      template: 'alarm-latch-reset',
      circuitType: 'alarm-latch-reset',
      instructions: ['LD X0', 'SET Y0', 'LD X1', 'RST Y0']
    },
    {
      requestText: '허가 X0과 X1로 두 출력 Y0 Y1 상호 인터락 회로를 만들어줘',
      analysis: draftMitsubishiAnalysis(),
      template: 'mutual-interlock',
      circuitType: 'mutual-interlock',
      instructions: ['LD X0', 'ANI Y1', 'OUT Y0', 'LD X1', 'ANI Y0', 'OUT Y1']
    },
    {
      requestText: '센서 X0이 0.5초 안정된 뒤 출력 Y0이 켜지는 Debounce 회로, 정지 X1',
      analysis: draftMitsubishiAnalysisWithCpu(),
      template: 'sensor-debounce',
      circuitType: 'sensor-debounce',
      instructions: ['LD X0', 'ANI X1', 'OUT T200 K5', 'LD T200', 'OUT Y0']
    }
  ];

  for (const scenario of scenarios) {
    const changePlan = createChangePlan({
      analysis: scenario.analysis,
      vendor: 'mitsubishi',
      requestText: scenario.requestText
    });

    assert.equal(changePlan.changeCandidateV2.template.id, scenario.template, scenario.requestText);
    assert.equal(changePlan.changeCandidateV2.template.renderer, 'gxworks2', scenario.requestText);
    assert.equal(changePlan.changeCandidateV2.policy.canEmitInstructionCandidate, true, scenario.requestText);
    assert.equal(changePlan.circuitDraft.circuitType, scenario.circuitType, scenario.requestText);
    assert.equal(changePlan.testCases.length >= 3, true, scenario.requestText);
    assert.equal(
      changePlan.testCases.every((testCase) => testCase.status === 'pass'),
      true,
      scenario.requestText
    );
    assert.equal(changePlan.validationLoop.summary.localStatus, 'pass', scenario.requestText);
    assert.equal(changePlan.validationLoop.summary.overallStatus, 'not-run', scenario.requestText);
    assert.equal(
      changePlan.validationLoop.validationRuns.find((run) => run.level === 'V8')
        .status,
      'not-run',
      scenario.requestText
    );
    for (const instruction of scenario.instructions) {
      assert.equal(changePlan.circuitDraft.instructionList.includes(instruction), true, `${scenario.requestText}: ${instruction}`);
    }
    assert.equal(
      changePlan.candidateFiles.some((file) => file.filename === 'draft.instruction-draft.txt'),
      true,
      scenario.requestText
    );
    if (scenario.template === 'edge-one-shot') {
      assert.equal(
        changePlan.circuitDraft.assumptions.some((assumption) =>
          assumption.includes('타이머 시간값')
        ),
        false
      );
    }
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
  const csvFile = changePlan.candidateFiles.find((file) => file.filename === 'draft.review-list.csv');
  assert.equal(csvFile.mimeType, 'text/csv; charset=utf-8');
  assert.equal(csvFile.content.startsWith('\uFEFF'), false);
  assert.equal(csvFile.content.includes('\r\n'), true);
  assert.equal(csvFile.content.replaceAll('\r\n', '').includes('\n'), false);
});

test('candidate filenames preserve readable Unicode while removing path and Windows-forbidden characters', () => {
  const changePlan = createChangePlan({
    analysis: draftMitsubishiAnalysis(),
    vendor: 'mitsubishi',
    requestText: '자기유지회로 만들어줘. 시작 X0 정지 X1 출력 Y0',
    sourceFilename: '../unsafe\\한글 English (검토):A?.txt'
  });

  assert.equal(
    changePlan.candidateFiles.some(
      (file) => file.filename === '한글 English (검토)-A.review-list.csv'
    ),
    true
  );
  assert.equal(
    changePlan.candidateFiles.every((file) => !/[\\/:?*<>|]/.test(file.filename)),
    true
  );
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
