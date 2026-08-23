import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createLocalWorkspaceStore } from '../src/application/localWorkspaceStore.js';
import { createWorkspaceService } from '../src/application/workspaceService.js';

function readTreeText(directory) {
  return readdirSync(directory, { withFileTypes: true })
    .flatMap((entry) => {
      const path = join(directory, entry.name);
      return entry.isDirectory() ? [readTreeText(path)] : [readFileSync(path, 'utf8')];
    })
    .join('\n');
}

test('workspace service bounds active in-memory workspaces and releases capacity on delete', () => {
  const service = createWorkspaceService();
  const workspaces = Array.from({ length: 8 }, (_, index) =>
    service.createWorkspace({ name: `workspace-${index}`, vendor: 'mitsubishi' })
  );

  assert.throws(
    () => service.createWorkspace({ name: 'workspace-overflow' }),
    (error) => error.code === 'WORKSPACE_LIMIT_EXCEEDED' && error.statusCode === 429
  );

  service.deleteWorkspace(workspaces[0].id);
  assert.equal(service.createWorkspace({ name: 'workspace-replacement' }).storage, 'memory-only');
});

test('workspace service bounds snapshots before unbounded in-memory growth', () => {
  const service = createWorkspaceService();
  const workspace = service.createWorkspace({
    name: 'snapshot-limit',
    vendor: 'mitsubishi',
    cpuProfileId: 'mitsubishi-fx3'
  });

  for (let index = 0; index < 10; index += 1) {
    service.importArtifacts(workspace.id, {
      artifacts: [
        {
          filename: `main-${index}.lst`,
          content: `PROGRAM MAIN_${index}\nNETWORK 1\nLD X0\nOUT Y${index.toString(8)}\nEND`
        }
      ]
    });
  }

  assert.throws(
    () =>
      service.importArtifacts(workspace.id, {
        artifacts: [{ filename: 'overflow.lst', content: 'PROGRAM OVERFLOW\nEND' }]
      }),
    (error) => error.code === 'SNAPSHOT_LIMIT_EXCEEDED' && error.statusCode === 429
  );
});

test('persistent workspaces restore normalized snapshots after an app restart', () => {
  const rootDirectory = mkdtempSync(join(tmpdir(), 'plc-workspace-restore-'));

  try {
    const firstService = createWorkspaceService({
      persistenceStore: createLocalWorkspaceStore({ rootDirectory })
    });
    const workspace = firstService.createWorkspace({
      name: 'restart-safe workspace',
      vendor: 'mitsubishi',
      cpuProfileId: 'mitsubishi-fx3',
      storage: 'persistent'
    });
    const imported = firstService.importArtifacts(workspace.id, {
      artifacts: [
        {
          filename: 'main.lst',
          content: 'PROGRAM MAIN\nNETWORK 1\nLD X0\nOUT Y20\nEND'
        }
      ]
    });
    const answer = firstService.askQuestion(imported.snapshot.id, {
      question: 'Y20은 어디에서 켜지나요?'
    });
    const recorded = firstService.recordChangeProposal({
      workspaceId: workspace.id,
      snapshotId: imported.snapshot.id,
      requestText: 'X0 조건으로 Y20 출력을 검토해줘',
      changePlan: {
        riskClass: 'R2',
        executionScope: 'review-only',
        recommendedPatch: { status: 'candidate' },
        candidateFiles: [
          {
            id: 'candidate-1',
            filename: 'main.candidate.lst',
            content: 'LD X0\nOUT Y20\nEND'
          }
        ],
        validationLoop: {
          summary: { localStatus: 'pass', overallStatus: 'not-run' },
          validationRuns: [
            { level: 'V0', status: 'pass' },
            { level: 'V8', status: 'not-run' }
          ]
        }
      }
    });

    const restoredService = createWorkspaceService({
      persistenceStore: createLocalWorkspaceStore({ rootDirectory })
    });
    const restoredWorkspace = restoredService.getWorkspace(workspace.id);
    const restoredSnapshot = restoredService.getSnapshot(imported.snapshot.id);
    const audit = restoredService.getAudit(workspace.id);
    const proposals = restoredService.listProposals(workspace.id);
    const validations = restoredService.listValidations(workspace.id);

    assert.equal(restoredWorkspace.storage, 'persistent');
    assert.equal(restoredSnapshot.contentHash, imported.snapshot.contentHash);
    assert.equal(restoredSnapshot.programs[0].networks[0].instructions[0].opcode, 'LD');
    assert.equal(restoredService.listWorkspaces().length, 1);
    assert.equal(audit.some((event) => event.event === 'workspace.imported'), true);
    assert.equal(
      audit.some(
        (event) =>
          event.event === 'question.answered' &&
          event.questionHash &&
          event.questionType === answer.questionType &&
          !Object.hasOwn(event, 'question')
      ),
      true
    );
    assert.equal(proposals[0].id, recorded.proposal.id);
    assert.equal(proposals[0].snapshotHash, imported.snapshot.contentHash);
    assert.equal(proposals[0].storesCandidateContent, false);
    assert.equal(proposals[0].candidateFiles[0].content, undefined);
    assert.match(proposals[0].candidateFiles[0].contentHash, /^[a-f0-9]{64}$/);
    assert.equal(validations[0].summary.localStatus, 'pass');
    assert.equal(
      audit.some(
        (event) =>
          event.event === 'change-proposal.generated' &&
          event.proposalId === recorded.proposal.id
      ),
      true
    );

    const storedText = readTreeText(rootDirectory);
    assert.doesNotMatch(storedText, /PROGRAM MAIN\\nNETWORK 1\\nLD X0/);
    assert.doesNotMatch(storedText, /Y20은 어디에서 켜지나요/);
    assert.doesNotMatch(storedText, /X0 조건으로 Y20 출력을 검토해줘/);
    assert.doesNotMatch(storedText, /LD X0\\nOUT Y20\\nEND/);

    restoredService.deleteWorkspace(workspace.id);
    assert.equal(restoredService.listWorkspaces().length, 0);
    assert.equal(readdirSync(join(rootDirectory, 'workspaces')).length, 0);
  } finally {
    rmSync(rootDirectory, { recursive: true, force: true });
  }
});

test('memory-only workspaces never create persistent records', () => {
  const rootDirectory = mkdtempSync(join(tmpdir(), 'plc-workspace-memory-'));

  try {
    const service = createWorkspaceService({
      persistenceStore: createLocalWorkspaceStore({ rootDirectory })
    });
    service.createWorkspace({ name: 'temporary review', vendor: 'mitsubishi' });

    assert.equal(service.listWorkspaces()[0].storage, 'memory-only');
    assert.equal(readdirSync(join(rootDirectory, 'workspaces')).length, 0);
  } finally {
    rmSync(rootDirectory, { recursive: true, force: true });
  }
});

test('R4 blocked proposals cannot be approved and decisions never authorize PLC writes', () => {
  const service = createWorkspaceService();
  const workspace = service.createWorkspace({
    name: 'blocked decision',
    vendor: 'mitsubishi',
    cpuProfileId: 'mitsubishi-fx3'
  });
  const imported = service.importArtifacts(workspace.id, {
    artifacts: [
      {
        filename: 'blocked.lst',
        content: 'PROGRAM MAIN\nNETWORK 1\nLD X0\nOUT Y20\nEND'
      }
    ]
  });
  const { proposal } = service.recordChangeProposal({
    workspaceId: workspace.id,
    snapshotId: imported.snapshot.id,
    requestText: 'Y20 Force ON',
    changePlan: {
      riskClass: 'R4',
      executionScope: 'blocked',
      recommendedPatch: { status: 'blocked' },
      candidateFiles: [],
      validationLoop: {
        summary: { localStatus: 'blocked', overallStatus: 'blocked' },
        validationRuns: []
      }
    }
  });

  assert.throws(
    () =>
      service.recordProposalDecision({
        workspaceId: workspace.id,
        proposalId: proposal.id,
        status: 'approved',
        reviewerRole: 'plc-engineer'
      }),
    (error) =>
      error.code === 'BLOCKED_PROPOSAL_CANNOT_BE_APPROVED' &&
      error.statusCode === 409
  );

  const rejected = service.recordProposalDecision({
    workspaceId: workspace.id,
    proposalId: proposal.id,
    status: 'rejected',
    reviewerRole: 'safety-reviewer'
  });
  assert.equal(rejected.scope, 'manual-review-only');
  assert.equal(rejected.authorizationEffect, 'none');
  assert.equal(rejected.canWriteToPlc, false);
});
