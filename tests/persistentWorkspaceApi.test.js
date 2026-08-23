import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createLocalWorkspaceStore } from '../src/application/localWorkspaceStore.js';
import { createWorkspaceService } from '../src/application/workspaceService.js';
import { createServer } from '../src/backend/beginnerServer.js';

async function startPersistentServer(rootDirectory) {
  const server = createServer({
    workspaceService: createWorkspaceService({
      persistenceStore: createLocalWorkspaceStore({ rootDirectory })
    })
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject);
      resolve();
    });
  });
  const address = server.address();
  return { server, baseUrl: `http://127.0.0.1:${address.port}` };
}

async function stopServer(server) {
  if (!server.listening) return;
  await new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
    server.closeAllConnections();
  });
}

async function requestJson(baseUrl, pathname, options = {}) {
  const response = await fetch(`${baseUrl}${pathname}`, {
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      ...(options.headers || {})
    },
    ...options
  });
  return { response, body: await response.json() };
}

test('persistent workspace remains available through an HTTP server restart and deletes cleanly', async () => {
  const rootDirectory = mkdtempSync(join(tmpdir(), 'plc-persistent-api-'));
  let firstServer;
  let secondServer;

  try {
    const first = await startPersistentServer(rootDirectory);
    firstServer = first.server;
    const created = await requestJson(first.baseUrl, '/api/v2/workspaces', {
      method: 'POST',
      body: JSON.stringify({
        name: 'restart integration',
        vendor: 'mitsubishi',
        cpuProfileId: 'mitsubishi-fx3',
        storage: 'persistent'
      })
    });
    const workspaceId = created.body.data.id;
    const imported = await requestJson(
      first.baseUrl,
      `/api/v2/workspaces/${workspaceId}/artifacts`,
      {
        method: 'POST',
        body: JSON.stringify({
          artifacts: [
            {
              filename: 'restart.lst',
              content: 'PROGRAM MAIN\nNETWORK 1\nLD X0\nOUT Y20\nEND'
            }
          ]
        })
      }
    );
    const snapshotId = imported.body.data.snapshot.id;
    await stopServer(firstServer);

    const second = await startPersistentServer(rootDirectory);
    secondServer = second.server;
    const listed = await requestJson(second.baseUrl, '/api/v2/workspaces');
    const restored = await requestJson(
      second.baseUrl,
      `/api/v2/snapshots/${snapshotId}`
    );

    assert.equal(
      listed.body.data.some(
        (workspace) =>
          workspace.id === workspaceId &&
          workspace.storage === 'persistent' &&
          workspace.snapshotIds.includes(snapshotId)
      ),
      true
    );
    assert.equal(restored.response.status, 200);
    assert.equal(restored.body.data.programs[0].name, 'MAIN');

    const deleted = await requestJson(
      second.baseUrl,
      `/api/v2/workspaces/${workspaceId}`,
      { method: 'DELETE' }
    );
    assert.equal(deleted.response.status, 200);
    assert.equal(deleted.body.data.storage, 'persistent');
    assert.equal(readdirSync(join(rootDirectory, 'workspaces')).length, 0);
  } finally {
    if (firstServer?.listening) await stopServer(firstServer);
    if (secondServer?.listening) await stopServer(secondServer);
    rmSync(rootDirectory, { recursive: true, force: true });
  }
});
