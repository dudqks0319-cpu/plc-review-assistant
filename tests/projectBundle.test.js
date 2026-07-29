import assert from 'node:assert/strict';
import test from 'node:test';
import { createProjectBundleSnapshot } from '../src/application/projectBundle.js';
import {
  buildCrossReferenceIndex,
  traceBackward,
  traceForward
} from '../src/domain/dataFlow.js';

const labelsCsv = `Label,Device,Data Type,Comment,Program
StartSwitch,X0,BIT,Start command,MAIN
StopSwitch,X1,BIT,Stop command,MAIN
RunCoil,Y20,BIT,Conveyor output,MAIN`;

const instructionList = `PROGRAM MAIN
NETWORK 1
LD X0
ANI X1
OUT Y20
NETWORK 2
LD M100
SET Y20
RST Y20
END`;

test('Project Bundle merges label CSV and instruction list into one source-grounded snapshot', () => {
  const result = createProjectBundleSnapshot({
    workspaceId: 'workspace-test',
    vendor: 'mitsubishi',
    cpuProfileId: 'mitsubishi-fx3',
    artifacts: [
      { filename: 'labels.csv', content: labelsCsv, encoding: 'utf-8' },
      { filename: 'main.lst', content: instructionList, encoding: 'utf-8' }
    ]
  });

  assert.equal(result.snapshot.artifacts.length, 2);
  assert.equal(result.snapshot.programs.some((program) => program.name === 'MAIN'), true);
  assert.equal(result.snapshot.devices.some((device) => device.canonicalAddress === 'X0' && device.label === 'StartSwitch'), true);
  assert.equal(
    result.snapshot.references.some((reference) => reference.canonicalAddress === 'Y20' && reference.access === 'write'),
    true
  );
  assert.equal(result.snapshot.dataFlowEdges.some((edge) => edge.fromAddress === 'X0' && edge.toAddress === 'Y20'), true);
  assert.equal(result.snapshot.parseWarnings.some((warning) => warning.code === 'CPU_PROFILE_REQUIRED'), false);
});

test('Cross-reference indexes writers and traces forward/backward device influence', () => {
  const { snapshot } = createProjectBundleSnapshot({
    workspaceId: 'workspace-flow',
    vendor: 'mitsubishi',
    cpuProfileId: 'mitsubishi-fx3',
    artifacts: [{ filename: 'main.lst', content: instructionList }]
  });
  const index = buildCrossReferenceIndex(snapshot);

  assert.equal(index.writersByDevice.get('Y20').length, 3);
  assert.equal(index.readersByDevice.get('X0').length, 1);
  assert.equal(index.settersByDevice.get('Y20').length, 1);
  assert.equal(index.resettersByDevice.get('Y20').length, 1);

  const forward = traceForward(snapshot, 'X0', { maxDepth: 4 });
  const backward = traceBackward(snapshot, 'Y20', { maxDepth: 4 });

  assert.equal(forward.devices.some((device) => device.canonicalAddress === 'Y20'), true);
  assert.equal(backward.devices.some((device) => device.canonicalAddress === 'X0'), true);
  assert.equal(forward.edges.every((edge) => edge.source?.rawSnippetHash), true);
});

test('Project Bundle decodes declared base64 artifacts without sending data externally', () => {
  const contentBase64 = Buffer.from(instructionList, 'utf8').toString('base64');
  const { snapshot } = createProjectBundleSnapshot({
    workspaceId: 'workspace-base64',
    vendor: 'mitsubishi',
    cpuProfileId: 'mitsubishi-fx3',
    artifacts: [{ filename: 'main.asc', contentBase64, encoding: 'utf-8' }]
  });

  assert.equal(snapshot.artifacts[0].encoding, 'utf-8');
  assert.equal(snapshot.programs[0].name, 'MAIN');
});

test('already-decoded text stays intact when its declared source encoding is CP949', () => {
  const { snapshot } = createProjectBundleSnapshot({
    workspaceId: 'workspace-cp949-text',
    vendor: 'mitsubishi',
    cpuProfileId: 'mitsubishi-fx3',
    artifacts: [
      {
        filename: 'labels.csv',
        encoding: 'cp949',
        content: 'Label,Device,Comment,Program\nStart,X0,시작 스위치,MAIN'
      }
    ]
  });

  assert.equal(snapshot.devices.find((device) => device.canonicalAddress === 'X0').comment, '시작 스위치');
});

test('Project Bundle decodes CP949 and Shift-JIS bytes when the source encoding is declared', () => {
  const cp949Bytes = Buffer.concat([
    Buffer.from('Label,Device,Comment,Program\nStart,X0,', 'ascii'),
    Buffer.from([0xbd, 0xc3, 0xc0, 0xdb]),
    Buffer.from(',MAIN', 'ascii')
  ]);
  const shiftJisBytes = Buffer.concat([
    Buffer.from('Label,Device,Comment,Program\nStart,X0,', 'ascii'),
    Buffer.from([0x8a, 0x4a, 0x8e, 0x6e]),
    Buffer.from(',MAIN', 'ascii')
  ]);

  const cp949 = createProjectBundleSnapshot({
    workspaceId: 'workspace-cp949',
    vendor: 'mitsubishi',
    artifacts: [
      {
        filename: 'ko.csv',
        encoding: 'cp949',
        contentBase64: cp949Bytes.toString('base64')
      }
    ]
  });
  const shiftJis = createProjectBundleSnapshot({
    workspaceId: 'workspace-shift-jis',
    vendor: 'mitsubishi',
    artifacts: [
      {
        filename: 'ja.csv',
        encoding: 'shift-jis',
        contentBase64: shiftJisBytes.toString('base64')
      }
    ]
  });

  assert.equal(cp949.snapshot.devices.find((device) => device.canonicalAddress === 'X0').comment, '시작');
  assert.equal(shiftJis.snapshot.devices.find((device) => device.canonicalAddress === 'X0').comment, '開始');
});

test('Project Bundle rejects traversal, archives, and unsupported encodings before parsing', () => {
  assert.throws(
    () =>
      createProjectBundleSnapshot({
        workspaceId: 'workspace-traversal',
        artifacts: [{ filename: '../main.lst', content: instructionList }]
      }),
    /ARTIFACT_FILENAME_INVALID/
  );
  assert.throws(
    () =>
      createProjectBundleSnapshot({
        workspaceId: 'workspace-archive',
        artifacts: [{ filename: 'nested.zip', content: 'not-a-zip' }]
      }),
    /ARCHIVE_EXTRACTION_DISABLED/
  );
  assert.throws(
    () =>
      createProjectBundleSnapshot({
        workspaceId: 'workspace-encoding',
        artifacts: [{ filename: 'main.lst', contentBase64: 'QQ==', encoding: 'utf-32' }]
      }),
    /ARTIFACT_ENCODING_UNSUPPORTED/
  );
  assert.throws(
    () =>
      createProjectBundleSnapshot({
        workspaceId: 'workspace-duplicate',
        artifacts: [
          { filename: 'main.lst', content: instructionList },
          { filename: 'MAIN.LST', content: instructionList }
        ]
      }),
    /ARTIFACT_FILENAME_DUPLICATE/
  );
});
