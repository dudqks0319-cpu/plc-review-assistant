import { randomUUID } from 'node:crypto';
import { createProjectBundleSnapshot } from './projectBundle.js';
import {
  buildCrossReferenceIndex,
  traceBackward,
  traceForward
} from '../domain/dataFlow.js';

const MAX_WORKSPACES = 8;
const MAX_SNAPSHOTS_PER_WORKSPACE = 10;
const MAX_TOTAL_SNAPSHOTS = 40;

function serviceError(code, message, statusCode = 400) {
  const error = new Error(message);
  error.code = code;
  error.statusCode = statusCode;
  return error;
}

function safeName(value, fallback) {
  const name = typeof value === 'string' ? value.trim() : '';
  return (name || fallback).slice(0, 120);
}

function serializeReferenceIndex(index) {
  const toObject = (map) => Object.fromEntries([...map.entries()]);
  return {
    writersByDevice: toObject(index.writersByDevice),
    readersByDevice: toObject(index.readersByDevice),
    settersByDevice: toObject(index.settersByDevice),
    resettersByDevice: toObject(index.resettersByDevice),
    lastWriteCandidatesByDevice: toObject(index.lastWriteCandidatesByDevice),
    indirectReferences: index.indirectReferences,
    executionOrderKnown: index.executionOrderKnown
  };
}

export function createWorkspaceService() {
  const workspaces = new Map();
  const snapshotRecords = new Map();

  function getWorkspaceOrThrow(id) {
    const workspace = workspaces.get(id);
    if (!workspace) {
      throw serviceError('WORKSPACE_NOT_FOUND', 'Workspace not found.', 404);
    }
    return workspace;
  }

  function getSnapshotRecordOrThrow(id) {
    const record = snapshotRecords.get(id);
    if (!record) {
      throw serviceError('SNAPSHOT_NOT_FOUND', 'Snapshot not found.', 404);
    }
    return record;
  }

  return {
    createWorkspace(input = {}) {
      if (workspaces.size >= MAX_WORKSPACES) {
        throw serviceError(
          'WORKSPACE_LIMIT_EXCEEDED',
          `At most ${MAX_WORKSPACES} in-memory workspaces may be active.`,
          429
        );
      }
      const vendor = input.vendor === 'siemens' ? 'siemens' : 'mitsubishi';
      const id = `workspace-${randomUUID()}`;
      const workspace = {
        id,
        name: safeName(input.name, 'PLC review workspace'),
        vendor,
        cpuProfileId:
          vendor === 'mitsubishi' && typeof input.cpuProfileId === 'string'
            ? input.cpuProfileId
            : null,
        snapshotIds: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        storage: 'memory-only'
      };
      workspaces.set(id, workspace);
      return workspace;
    },

    getWorkspace(id) {
      return getWorkspaceOrThrow(id);
    },

    deleteWorkspace(id) {
      const workspace = getWorkspaceOrThrow(id);
      for (const snapshotId of workspace.snapshotIds) {
        snapshotRecords.delete(snapshotId);
      }
      workspaces.delete(id);
      return {
        id,
        deletedSnapshotCount: workspace.snapshotIds.length,
        storage: 'memory-only'
      };
    },

    importArtifacts(id, input = {}) {
      const workspace = getWorkspaceOrThrow(id);
      if (
        workspace.snapshotIds.length >= MAX_SNAPSHOTS_PER_WORKSPACE ||
        snapshotRecords.size >= MAX_TOTAL_SNAPSHOTS
      ) {
        throw serviceError(
          'SNAPSHOT_LIMIT_EXCEEDED',
          'The in-memory snapshot limit has been reached. Delete an unused workspace first.',
          429
        );
      }
      const record = createProjectBundleSnapshot({
        workspaceId: workspace.id,
        vendor: workspace.vendor,
        cpuProfileId:
          typeof input.cpuProfileId === 'string' ? input.cpuProfileId : workspace.cpuProfileId,
        artifacts: input.artifacts
      });
      const existingRecord = snapshotRecords.get(record.snapshot.id);
      if (existingRecord) {
        return {
          ...existingRecord,
          reused: true
        };
      }
      snapshotRecords.set(record.snapshot.id, record);
      workspace.snapshotIds.push(record.snapshot.id);
      workspace.cpuProfileId = record.snapshot.cpuProfileId;
      workspace.updatedAt = new Date().toISOString();
      return record;
    },

    getSnapshot(id) {
      return getSnapshotRecordOrThrow(id).snapshot;
    },

    getPrograms(id) {
      return getSnapshotRecordOrThrow(id).snapshot.programs;
    },

    getFindings(id) {
      return getSnapshotRecordOrThrow(id).findings;
    },

    getDataFlow(id) {
      const snapshot = getSnapshotRecordOrThrow(id).snapshot;
      return {
        nodes: snapshot.devices,
        edges: snapshot.dataFlowEdges,
        referenceIndex: serializeReferenceIndex(buildCrossReferenceIndex(snapshot))
      };
    },

    getDevice(id, address, { maxTraceDepth = 4 } = {}) {
      const snapshot = getSnapshotRecordOrThrow(id).snapshot;
      const normalizedAddress = String(address || '').trim().toUpperCase();
      const device = snapshot.devices.find(
        (item) => item.canonicalAddress === normalizedAddress
      );
      if (!device) {
        throw serviceError('DEVICE_NOT_FOUND', `Device ${normalizedAddress} not found.`, 404);
      }
      const index = buildCrossReferenceIndex(snapshot);
      return {
        device,
        readers: index.readersByDevice.get(normalizedAddress) || [],
        writers: index.writersByDevice.get(normalizedAddress) || [],
        setters: index.settersByDevice.get(normalizedAddress) || [],
        resetters: index.resettersByDevice.get(normalizedAddress) || [],
        lastWriteCandidates: index.lastWriteCandidatesByDevice.get(normalizedAddress) || [],
        executionOrderKnown: index.executionOrderKnown,
        backwardTrace: traceBackward(snapshot, normalizedAddress, {
          maxDepth: maxTraceDepth
        }),
        forwardTrace: traceForward(snapshot, normalizedAddress, {
          maxDepth: maxTraceDepth
        })
      };
    }
  };
}
