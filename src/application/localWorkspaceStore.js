import {
  appendFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync
} from 'node:fs';
import { basename, dirname, resolve } from 'node:path';

const WORKSPACE_ID_PATTERN = /^workspace-[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SNAPSHOT_ID_PATTERN = /^snapshot-[a-f0-9]{20}$/;
const PROPOSAL_ID_PATTERN = /^proposal-[a-f0-9]{20}$/;
const MAX_JSON_BYTES = 12_000_000;
const MAX_AUDIT_BYTES = 2_000_000;

function storageError(code, message) {
  const error = new Error(message);
  error.code = code;
  error.statusCode = 500;
  return error;
}

function assertSafeId(value, pattern, label) {
  if (typeof value !== 'string' || !pattern.test(value)) {
    throw storageError('INVALID_STORAGE_ID', `Invalid ${label} storage identifier.`);
  }
  return value;
}

function ensurePrivateDirectory(path) {
  mkdirSync(path, { recursive: true, mode: 0o700 });
  const stat = lstatSync(path);
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw storageError('UNSAFE_STORAGE_PATH', 'Workspace storage path must be a real directory.');
  }
}

function writeJsonAtomic(path, value) {
  const body = `${JSON.stringify(value, null, 2)}\n`;
  if (Buffer.byteLength(body) > MAX_JSON_BYTES) {
    throw storageError('STORAGE_RECORD_TOO_LARGE', 'Workspace storage record is too large.');
  }
  ensurePrivateDirectory(dirname(path));
  const temporaryPath = resolve(
    dirname(path),
    `.${basename(path)}.${process.pid}.${Date.now()}.tmp`
  );
  writeFileSync(temporaryPath, body, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
  renameSync(temporaryPath, path);
}

function readJson(path) {
  const body = readFileSync(path, 'utf8');
  if (Buffer.byteLength(body) > MAX_JSON_BYTES) {
    throw storageError('STORAGE_RECORD_TOO_LARGE', 'Workspace storage record is too large.');
  }
  return JSON.parse(body);
}

export function createLocalWorkspaceStore({ rootDirectory }) {
  const storageRoot = resolve(rootDirectory);
  const workspacesDirectory = resolve(storageRoot, 'workspaces');
  ensurePrivateDirectory(workspacesDirectory);

  function workspaceDirectory(workspaceId) {
    assertSafeId(workspaceId, WORKSPACE_ID_PATTERN, 'workspace');
    return resolve(workspacesDirectory, workspaceId);
  }

  function snapshotPath(workspaceId, snapshotId) {
    assertSafeId(snapshotId, SNAPSHOT_ID_PATTERN, 'snapshot');
    return resolve(workspaceDirectory(workspaceId), 'snapshots', `${snapshotId}.json`);
  }

  function auditPath(workspaceId) {
    return resolve(workspaceDirectory(workspaceId), 'audit', 'events.jsonl');
  }

  return {
    rootDirectory: storageRoot,

    saveWorkspace(workspace) {
      const directory = workspaceDirectory(workspace.id);
      ensurePrivateDirectory(directory);
      for (const child of [
        'artifacts',
        'snapshots',
        'indexes',
        'proposals',
        'validations',
        'reports',
        'audit'
      ]) {
        ensurePrivateDirectory(resolve(directory, child));
      }
      writeJsonAtomic(resolve(directory, 'manifest.json'), {
        schemaVersion: 1,
        workspace: {
          ...workspace,
          storage: 'persistent',
          storesOriginalArtifacts: false
        }
      });
    },

    saveSnapshot(workspaceId, record) {
      writeJsonAtomic(snapshotPath(workspaceId, record.snapshot.id), {
        schemaVersion: 1,
        record
      });
    },

    saveProposal(workspaceId, proposal) {
      assertSafeId(proposal.id, PROPOSAL_ID_PATTERN, 'proposal');
      writeJsonAtomic(
        resolve(workspaceDirectory(workspaceId), 'proposals', `${proposal.id}.json`),
        { schemaVersion: 1, proposal }
      );
    },

    saveValidation(workspaceId, validation) {
      assertSafeId(validation.proposalId, PROPOSAL_ID_PATTERN, 'proposal');
      writeJsonAtomic(
        resolve(
          workspaceDirectory(workspaceId),
          'validations',
          `${validation.proposalId}.json`
        ),
        { schemaVersion: 1, validation }
      );
    },

    appendAudit(workspaceId, event) {
      const path = auditPath(workspaceId);
      ensurePrivateDirectory(dirname(path));
      const line = `${JSON.stringify(event)}\n`;
      const currentSize = existsSync(path) ? lstatSync(path).size : 0;
      if (currentSize + Buffer.byteLength(line) > MAX_AUDIT_BYTES) {
        throw storageError('AUDIT_LIMIT_EXCEEDED', 'Workspace audit log limit reached.');
      }
      appendFileSync(path, line, { encoding: 'utf8', mode: 0o600 });
    },

    loadWorkspaces() {
      const restored = [];
      for (const entry of readdirSync(workspacesDirectory, { withFileTypes: true })) {
        if (!entry.isDirectory() || !WORKSPACE_ID_PATTERN.test(entry.name)) continue;
        const directory = workspaceDirectory(entry.name);
        const manifestPath = resolve(directory, 'manifest.json');
        if (!existsSync(manifestPath)) continue;

        try {
          const manifest = readJson(manifestPath);
          const workspace = manifest?.workspace;
          if (
            manifest?.schemaVersion !== 1 ||
            workspace?.id !== entry.name ||
            workspace?.storage !== 'persistent'
          ) {
            continue;
          }
          const records = [];
          const snapshotsDirectory = resolve(directory, 'snapshots');
          if (existsSync(snapshotsDirectory)) {
            for (const snapshotEntry of readdirSync(snapshotsDirectory, {
              withFileTypes: true
            })) {
              if (!snapshotEntry.isFile() || !snapshotEntry.name.endsWith('.json')) continue;
              const stored = readJson(resolve(snapshotsDirectory, snapshotEntry.name));
              if (
                stored?.schemaVersion === 1 &&
                stored?.record?.snapshot?.workspaceId === workspace.id
              ) {
                records.push(stored.record);
              }
            }
          }
          const proposals = [];
          const proposalsDirectory = resolve(directory, 'proposals');
          if (existsSync(proposalsDirectory)) {
            for (const proposalEntry of readdirSync(proposalsDirectory, {
              withFileTypes: true
            })) {
              if (!proposalEntry.isFile() || !proposalEntry.name.endsWith('.json')) {
                continue;
              }
              const stored = readJson(resolve(proposalsDirectory, proposalEntry.name));
              if (
                stored?.schemaVersion === 1 &&
                stored?.proposal?.workspaceId === workspace.id
              ) {
                proposals.push(stored.proposal);
              }
            }
          }
          const validations = [];
          const validationsDirectory = resolve(directory, 'validations');
          if (existsSync(validationsDirectory)) {
            for (const validationEntry of readdirSync(validationsDirectory, {
              withFileTypes: true
            })) {
              if (
                !validationEntry.isFile() ||
                !validationEntry.name.endsWith('.json')
              ) {
                continue;
              }
              const stored = readJson(
                resolve(validationsDirectory, validationEntry.name)
              );
              if (
                stored?.schemaVersion === 1 &&
                stored?.validation?.workspaceId === workspace.id
              ) {
                validations.push(stored.validation);
              }
            }
          }
          restored.push({
            workspace,
            records,
            proposals,
            validations,
            audit: this.readAudit(workspace.id)
          });
        } catch {
          // A corrupt workspace is ignored rather than partially trusted.
        }
      }
      return restored;
    },

    readAudit(workspaceId) {
      const path = auditPath(workspaceId);
      if (!existsSync(path)) return [];
      if (lstatSync(path).size > MAX_AUDIT_BYTES) {
        throw storageError('AUDIT_LIMIT_EXCEEDED', 'Workspace audit log limit reached.');
      }
      return readFileSync(path, 'utf8')
        .split(/\r?\n/)
        .filter(Boolean)
        .slice(-500)
        .flatMap((line) => {
          try {
            return [JSON.parse(line)];
          } catch {
            return [];
          }
        });
    },

    deleteWorkspace(workspaceId) {
      const directory = workspaceDirectory(workspaceId);
      if (existsSync(directory)) {
        rmSync(directory, { recursive: true, force: false });
      }
    }
  };
}
