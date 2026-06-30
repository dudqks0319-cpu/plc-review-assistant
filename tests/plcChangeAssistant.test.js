import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { analyzePlcProject } from '../src/backend/plcAnalyzer.js';
import { createChangePlan } from '../src/backend/plcChangeAssistant.js';

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
});

test('createChangePlan builds Mitsubishi ladder listing patch candidates', () => {
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
  assert.equal(changePlan.recommendedPatch.status, 'candidate');
  assert.equal(changePlan.recommendedPatch.patchArtifacts.some((artifact) => artifact.content.includes('OUT T201 K30')), true);
  assert.equal(changePlan.candidateFiles.some((file) => file.filename === 'labels.candidate.lst'), true);
  assert.equal(changePlan.candidateFiles.some((file) => file.filename === 'labels.candidate.csv'), true);
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
  assert.equal(changePlan.recommendedPatch.status, 'blocked');
  assert.equal(changePlan.recommendedPatch.patchArtifacts.length, 0);
  assert.equal(changePlan.candidateFiles.length, 0);
  assert.equal(changePlan.simulation.result, 'blocked');
});

test('createChangePlan builds GX Works2 self-holding circuit drafts from natural language', () => {
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
  assert.equal(changePlan.candidateFiles.some((file) => file.filename === 'draft.gxworks2.lst'), true);
});

test('createChangePlan builds GX Works2 two-floor elevator circuit drafts from natural language', () => {
  const changePlan = createChangePlan({
    analysis: draftMitsubishiAnalysis(),
    vendor: 'mitsubishi',
    requestText: '엘리베이터 회로 만들어줘. 1층 호출 X0 2층 호출 X1 1층 리미트 X2 2층 리미트 X3 문닫힘 X4 비상정지 X5 상승 Y0 하강 Y1 문열림 Y2'
  });

  assert.equal(changePlan.circuitDraft.targetPlatform, 'GX Works2');
  assert.equal(changePlan.circuitDraft.circuitType, 'two-floor-elevator');
  assert.equal(changePlan.circuitDraft.instructionList.includes('SET M0'), true);
  assert.equal(changePlan.circuitDraft.instructionList.includes('RST M0'), true);
  assert.equal(changePlan.circuitDraft.instructionList.includes('OUT Y0'), true);
  assert.equal(changePlan.circuitDraft.instructionList.includes('OUT Y1'), true);
  assert.equal(changePlan.circuitDraft.ladderPreview.some((network) => network.ascii.includes('2F CALL')), true);
  assert.equal(changePlan.candidateFiles.some((file) => file.filename === 'draft.gxworks2.lst'), true);
});
