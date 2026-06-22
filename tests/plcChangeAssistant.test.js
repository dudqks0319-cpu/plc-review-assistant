import assert from 'node:assert/strict';
import test from 'node:test';
import { analyzePlcProject } from '../src/backend/plcAnalyzer.js';
import { createChangePlan } from '../src/backend/plcChangeAssistant.js';

const siemensXml = `<?xml version="1.0"?>
<Document>
  <SW.Blocks.FB Name="ConveyorControl" ProgrammingLanguage="LAD" Comment="Conveyor motor logic">
    <Member Name="Product_Detected" Datatype="Bool" Address="%I0.4" Comment="Product sensor" />
    <Member Name="Start_Enable" Datatype="Bool" Address="%M100.0" Comment="Start enable" />
    <Member Name="Stop_Button" Datatype="Bool" Address="%I0.5" Comment="Stop button" />
    <Member Name="Emergency_Stop" Datatype="Bool" Address="%I0.6" Comment="Emergency stop" />
    <Member Name="Conveyor_Motor" Datatype="Bool" Address="%Q0.2" Comment="Conveyor motor" />
  </SW.Blocks.FB>
</Document>`;

const mitsubishiCsv = `Label,Device,Data Type,Comment,Program
ProductSensor,X10,BIT,Product sensor,MAIN
StartEnable,M100,BIT,Start enable,MAIN
StopButton,X11,BIT,Stop button,MAIN
EmergencyStop,X12,BIT,Emergency stop,MAIN
ConveyorMotor,Y20,BIT,Conveyor motor,MAIN`;

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
  assert.equal(changePlan.recommendedPatch.patchArtifacts.some((artifact) => artifact.content.includes('OUT T200 K30')), true);
  assert.equal(changePlan.candidateFiles.some((file) => file.filename === 'labels.candidate.lst'), true);
  assert.equal(changePlan.candidateFiles.some((file) => file.filename === 'labels.candidate.csv'), true);
  assert.equal(changePlan.simulatorTarget.includes('GX Works3'), true);
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
