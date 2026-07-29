import assert from 'node:assert/strict';
import test from 'node:test';
import { createWorkspaceService } from '../src/application/workspaceService.js';

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
