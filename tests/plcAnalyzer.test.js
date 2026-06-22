import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  analyzePlcProject,
  createExcelReport,
  createMarkdownReport,
  createPdfReport
} from '../src/backend/plcAnalyzer.js';

const siemensXml = `<?xml version="1.0" encoding="utf-8"?>
<Document>
  <SW.Blocks.FB Name="MotorControl" ProgrammingLanguage="LAD" Comment="Motor sequence">
    <Member Name="StartButton" Datatype="Bool" Address="%I0.0" Comment="Start pushbutton" />
    <Member Name="MotorCoil" Datatype="Bool" Address="%Q0.0" />
    <Call Name="SafetyCheck" />
    <Network>
      SET %Q0.0
      R %Q0.0
    </Network>
  </SW.Blocks.FB>
  <SW.Blocks.FC Name="SafetyCheck" ProgrammingLanguage="SCL" />
  <SW.Blocks.DB Name="RecipeDb" ProgrammingLanguage="DB" />
</Document>`;

const mitsubishiCsv = `Label,Device,Data Type,Comment,Program
StartSwitch,X0,BIT,Start switch,MAIN
StartAlias,X0,BIT,,MAIN
RunCoil,Y10,BIT,Motor run,MAIN
UnusedFlag,M10,BIT,,MAIN
Bad Name,D20,INT,,MAIN
ExistingTimer,T200,TIMER,Timer already used,MAIN`;

const siemensFixture = readFileSync(new URL('./fixtures/siemens/tia_fb_motor_control.xml', import.meta.url), 'utf8');

test('analyzePlcProject parses Siemens TIA XML exports into normalized review data', () => {
  const analysis = analyzePlcProject({
    filename: 'line1.xml',
    vendor: 'siemens',
    content: siemensXml
  });

  assert.equal(analysis.project.vendor, 'siemens');
  assert.equal(analysis.project.source.fileType, 'siemens-tia-xml');
  assert.equal(analysis.summary.blockCount, 3);
  assert.equal(analysis.project.blocks.some((block) => block.name === 'MotorControl' && block.type === 'FB'), true);
  assert.equal(analysis.project.variables.some((variable) => variable.name === 'StartButton' && variable.address === 'I0.0'), true);
  assert.equal(analysis.project.ioAddresses.some((item) => item.address === 'Q0.0'), true);
  assert.equal(analysis.findings.some((finding) => finding.category === 'set-reset'), true);
  assert.match(analysis.assistantSummary, /정적 분석 기반 후보/);
});

test('analyzePlcProject parses Mitsubishi CSV exports and detects review candidates', () => {
  const analysis = analyzePlcProject({
    filename: 'main_labels.csv',
    vendor: 'mitsubishi',
    content: mitsubishiCsv
  });

  assert.equal(analysis.project.vendor, 'mitsubishi');
  assert.equal(analysis.project.source.fileType, 'mitsubishi-csv');
  assert.equal(analysis.summary.variableCount, 6);
  assert.equal(analysis.project.ioAddresses.some((item) => item.address === 'T200'), true);
  assert.equal(analysis.project.blocks.some((block) => block.name === 'MAIN'), true);
  assert.equal(analysis.findings.some((finding) => finding.category === 'duplicate-address' && finding.title.includes('X0')), true);
  assert.equal(analysis.findings.some((finding) => finding.category === 'naming'), true);
});

test('fixture Siemens export remains parseable', () => {
  const analysis = analyzePlcProject({
    filename: 'tia_fb_motor_control.xml',
    vendor: 'siemens',
    content: siemensFixture
  });

  assert.equal(analysis.summary.blockCount, 2);
  assert.equal(analysis.project.variables.some((variable) => variable.name === 'Conveyor_Motor'), true);
});

test('report generators create Markdown, Excel-compatible XML, and PDF outputs', () => {
  const analysis = analyzePlcProject({
    filename: 'main_labels.csv',
    vendor: 'mitsubishi',
    content: mitsubishiCsv
  });

  const markdown = createMarkdownReport(analysis);
  const excel = createExcelReport(analysis);
  const pdf = createPdfReport(analysis);

  assert.match(markdown, /PLC Review Assistant Report/);
  assert.match(markdown, /분석 한계/);
  assert.match(excel, /<Workbook/);
  assert.match(excel, /<Worksheet ss:Name="Findings"/);
  assert.equal(Buffer.isBuffer(pdf), true);
  assert.equal(pdf.subarray(0, 5).toString('utf8'), '%PDF-');
});
