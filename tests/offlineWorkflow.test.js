import assert from 'node:assert/strict';
import test from 'node:test';
import { createWorkspaceService } from '../src/application/workspaceService.js';
import { createChangePlan } from '../src/backend/beginnerChangeAssistant.js';

test('Mitsubishi import, grounded question, and validation run without an external network call', () => {
  const originalFetch = globalThis.fetch;
  const externalCalls = [];
  globalThis.fetch = async (...args) => {
    externalCalls.push(args);
    throw new Error('External network access is disabled for this test.');
  };

  try {
    const service = createWorkspaceService();
    const workspace = service.createWorkspace({
      name: 'offline review',
      vendor: 'mitsubishi',
      cpuProfileId: 'mitsubishi-fx3'
    });
    const imported = service.importArtifacts(workspace.id, {
      artifacts: [
        {
          filename: 'offline.lst',
          content: 'PROGRAM MAIN\nNETWORK 1\nLD X0\nOUT Y20\nEND'
        }
      ]
    });
    const answer = service.askQuestion(imported.snapshot.id, {
      question: 'Y20은 어디에서 켜지나요?',
      mode: 'grounded'
    });
    const changePlan = createChangePlan({
      vendor: 'mitsubishi',
      requestText: '상승 엣지 X0에서 Y20 one-shot 출력을 만들어줘',
      analysis: {
        snapshot: imported.snapshot,
        project: {
          id: imported.snapshot.id,
          name: 'offline review',
          vendor: 'mitsubishi',
          source: { filename: 'offline.lst' },
          blocks: [],
          variables: [],
          ioAddresses: [],
          callGraph: [],
          protectedItems: [],
          parserWarnings: []
        },
        summary: imported.artifactResults[0].summary,
        findings: imported.findings,
        limitations: []
      }
    });

    assert.equal(externalCalls.length, 0);
    assert.equal(answer.policy.externalNetworkUsed, false);
    assert.equal(answer.policy.writesToPlc, false);
    assert.equal(changePlan.readiness.canWriteToPlc, false);
    assert.equal(changePlan.validationLoop.summary.localStatus, 'pass');
    assert.equal(changePlan.validationLoop.summary.overallStatus, 'not-run');
  } finally {
    globalThis.fetch = originalFetch;
  }
});
