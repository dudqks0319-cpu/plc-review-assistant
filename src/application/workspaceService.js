import { createHash, randomUUID } from 'node:crypto';
import { createProjectBundleSnapshot } from './projectBundle.js';
import {
  buildCrossReferenceIndex,
  traceBackward,
  traceForward
} from '../domain/dataFlow.js';
import { answerGroundedQuestion } from './groundedQuestion.js';
import { createKnowledgeBase } from './knowledgeBase.js';

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

export function createWorkspaceService({ persistenceStore = null } = {}) {
  const workspaces = new Map();
  const snapshotRecords = new Map();
  const auditRecords = new Map();
  const proposalRecords = new Map();
  const validationRecords = new Map();
  const knowledgeBase = createKnowledgeBase();

  function recordAudit(workspace, event) {
    const record = {
      id: `audit-${randomUUID()}`,
      timestamp: new Date().toISOString(),
      ...event
    };
    const records = auditRecords.get(workspace.id) || [];
    records.push(record);
    auditRecords.set(workspace.id, records.slice(-500));
    if (workspace.storage === 'persistent') {
      persistenceStore.appendAudit(workspace.id, record);
    }
    return record;
  }

  if (persistenceStore) {
    for (const restored of persistenceStore.loadWorkspaces().slice(0, MAX_WORKSPACES)) {
      const workspace = restored.workspace;
      if (!workspace?.id || workspace.storage !== 'persistent') continue;
      const records = Array.isArray(restored.records)
        ? restored.records.slice(0, MAX_SNAPSHOTS_PER_WORKSPACE)
        : [];
      workspace.snapshotIds = records.map((record) => record.snapshot.id);
      workspaces.set(workspace.id, workspace);
      auditRecords.set(
        workspace.id,
        Array.isArray(restored.audit) ? restored.audit.slice(-500) : []
      );
      proposalRecords.set(
        workspace.id,
        Array.isArray(restored.proposals) ? restored.proposals.slice(-100) : []
      );
      validationRecords.set(
        workspace.id,
        Array.isArray(restored.validations) ? restored.validations.slice(-100) : []
      );
      for (const record of records) {
        if (snapshotRecords.size >= MAX_TOTAL_SNAPSHOTS) break;
        snapshotRecords.set(record.snapshot.id, record);
      }
    }
  }

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
    listWorkspaces() {
      return [...workspaces.values()].map((workspace) => ({ ...workspace }));
    },

    createWorkspace(input = {}) {
      if (workspaces.size >= MAX_WORKSPACES) {
        throw serviceError(
          'WORKSPACE_LIMIT_EXCEEDED',
          `At most ${MAX_WORKSPACES} in-memory workspaces may be active.`,
          429
        );
      }
      const vendor = input.vendor === 'siemens' ? 'siemens' : 'mitsubishi';
      const wantsPersistence = input.storage === 'persistent';
      if (wantsPersistence && !persistenceStore) {
        throw serviceError(
          'PERSISTENCE_UNAVAILABLE',
          'Persistent workspace storage is not configured.',
          503
        );
      }
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
        storage: wantsPersistence ? 'persistent' : 'memory-only',
        storesOriginalArtifacts: false
      };
      workspaces.set(id, workspace);
      auditRecords.set(id, []);
      proposalRecords.set(id, []);
      validationRecords.set(id, []);
      if (workspace.storage === 'persistent') {
        persistenceStore.saveWorkspace(workspace);
      }
      recordAudit(workspace, {
        event: 'workspace.created',
        vendor: workspace.vendor,
        cpuProfileId: workspace.cpuProfileId,
        storesOriginalArtifacts: false
      });
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
      knowledgeBase.deleteWorkspace(id);
      workspaces.delete(id);
      auditRecords.delete(id);
      proposalRecords.delete(id);
      validationRecords.delete(id);
      if (workspace.storage === 'persistent') {
        persistenceStore.deleteWorkspace(id);
      }
      return {
        id,
        deletedSnapshotCount: workspace.snapshotIds.length,
        storage: workspace.storage
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
      if (workspace.storage === 'persistent') {
        persistenceStore.saveSnapshot(workspace.id, record);
        persistenceStore.saveWorkspace(workspace);
      }
      recordAudit(workspace, {
        event: 'workspace.imported',
        snapshotId: record.snapshot.id,
        snapshotHash: record.snapshot.contentHash,
        artifactCount: record.snapshot.artifacts.length,
        artifacts: record.snapshot.artifacts.map((artifact) => ({
          filename: artifact.filename,
          contentHash: artifact.contentHash,
          sizeBytes: artifact.sizeBytes,
          encoding: artifact.encoding
        }))
      });
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

    askQuestion(id, input = {}) {
      const record = getSnapshotRecordOrThrow(id);
      const workspace = getWorkspaceOrThrow(record.snapshot.workspaceId);
      const mode = typeof input.mode === 'string' ? input.mode : 'grounded';
      if (mode !== 'grounded') {
        throw serviceError(
          'QUESTION_MODE_UNSUPPORTED',
          'Only grounded question mode is supported.'
        );
      }
      const question = typeof input.question === 'string' ? input.question.trim() : '';
      const includeManualEvidence = input.includeManualEvidence !== false;
      const manualEvidence = includeManualEvidence
        ? knowledgeBase.search(workspace, question, { limit: 4 })
        : { results: [], warnings: [], strategy: 'disabled' };
      const result = answerGroundedQuestion({
        snapshot: record.snapshot,
        question,
        maxTraceDepth: input.maxTraceDepth,
        manualEvidence
      });
      recordAudit(workspace, {
        event: 'question.answered',
        snapshotId: record.snapshot.id,
        questionHash: createHash('sha256').update(question, 'utf8').digest('hex'),
        questionType: result.questionType,
        evidenceIds: result.evidence.map((entry) => entry.id),
        confidence: result.confidence?.level || result.confidence || 'unknown'
      });
      return result;
    },

    importKnowledgeDocument(id, input = {}) {
      const workspace = getWorkspaceOrThrow(id);
      return knowledgeBase.importDocument(workspace, input);
    },

    listKnowledgeDocuments(id) {
      getWorkspaceOrThrow(id);
      return knowledgeBase.listDocuments(id);
    },

    deleteKnowledgeDocument(id, documentId) {
      getWorkspaceOrThrow(id);
      return knowledgeBase.deleteDocument(id, documentId);
    },

    getAudit(id) {
      getWorkspaceOrThrow(id);
      return [...(auditRecords.get(id) || [])];
    },

    listProposals(id) {
      getWorkspaceOrThrow(id);
      return [...(proposalRecords.get(id) || [])];
    },

    listValidations(id) {
      getWorkspaceOrThrow(id);
      return [...(validationRecords.get(id) || [])];
    },

    recordChangeProposal({
      workspaceId,
      snapshotId,
      requestText,
      changePlan
    }) {
      const workspace = getWorkspaceOrThrow(workspaceId);
      const snapshotRecord = getSnapshotRecordOrThrow(snapshotId);
      if (snapshotRecord.snapshot.workspaceId !== workspace.id) {
        throw serviceError(
          'SNAPSHOT_WORKSPACE_MISMATCH',
          'Snapshot does not belong to the workspace.'
        );
      }
      const requestHash = createHash('sha256')
        .update(String(requestText || ''), 'utf8')
        .digest('hex');
      const candidateFiles = Array.isArray(changePlan?.candidateFiles)
        ? changePlan.candidateFiles.slice(0, 32).map((file) => {
            const content = typeof file.content === 'string' ? file.content : '';
            return {
              id: typeof file.id === 'string' ? file.id.slice(0, 120) : null,
              filename:
                typeof file.filename === 'string'
                  ? file.filename.slice(0, 180)
                  : 'candidate',
              contentHash: createHash('sha256')
                .update(content, 'utf8')
                .digest('hex'),
              sizeBytes: Buffer.byteLength(content, 'utf8')
            };
          })
        : [];
      const proposalHash = createHash('sha256')
        .update(
          JSON.stringify({
            snapshotId,
            requestHash,
            candidateFiles,
            riskClass: changePlan?.riskClass || null,
            executionScope: changePlan?.executionScope || null
          }),
          'utf8'
        )
        .digest('hex');
      const proposal = {
        id: `proposal-${proposalHash.slice(0, 20)}`,
        workspaceId,
        snapshotId,
        snapshotHash: snapshotRecord.snapshot.contentHash,
        requestHash,
        riskClass: changePlan?.riskClass || 'unknown',
        executionScope: changePlan?.executionScope || 'review-only',
        patchStatus: changePlan?.recommendedPatch?.status || 'unknown',
        candidateFiles,
        createdAt: new Date().toISOString(),
        storesCandidateContent: false
      };
      const validation = {
        workspaceId,
        proposalId: proposal.id,
        snapshotId,
        summary: changePlan?.validationLoop?.summary || null,
        validationRuns: Array.isArray(
          changePlan?.validationLoop?.validationRuns
        )
          ? changePlan.validationLoop.validationRuns.slice(0, 11)
          : [],
        recordedAt: new Date().toISOString()
      };
      const proposals = proposalRecords.get(workspaceId) || [];
      const proposalIndex = proposals.findIndex((item) => item.id === proposal.id);
      if (proposalIndex >= 0) {
        proposals[proposalIndex] = proposal;
      } else {
        proposals.push(proposal);
      }
      proposalRecords.set(workspaceId, proposals.slice(-100));
      const validations = validationRecords.get(workspaceId) || [];
      const validationIndex = validations.findIndex(
        (item) => item.proposalId === proposal.id
      );
      if (validationIndex >= 0) {
        validations[validationIndex] = validation;
      } else {
        validations.push(validation);
      }
      validationRecords.set(workspaceId, validations.slice(-100));
      if (workspace.storage === 'persistent') {
        persistenceStore.saveProposal(workspaceId, proposal);
        persistenceStore.saveValidation(workspaceId, validation);
      }
      recordAudit(workspace, {
        event: 'change-proposal.generated',
        snapshotId,
        proposalId: proposal.id,
        requestHash,
        riskClass: proposal.riskClass,
        executionScope: proposal.executionScope,
        candidateFileHashes: candidateFiles.map((file) => file.contentHash),
        validationSummary: validation.summary
      });
      return { proposal, validation };
    },

    recordProposalDecision({
      workspaceId,
      proposalId,
      status,
      reviewerRole,
      note
    }) {
      const workspace = getWorkspaceOrThrow(workspaceId);
      const proposals = proposalRecords.get(workspaceId) || [];
      const proposalIndex = proposals.findIndex((item) => item.id === proposalId);
      if (proposalIndex < 0) {
        throw serviceError('PROPOSAL_NOT_FOUND', 'Change proposal not found.', 404);
      }
      if (!['approved', 'rejected'].includes(status)) {
        throw serviceError(
          'INVALID_DECISION_STATUS',
          'Decision status must be approved or rejected.'
        );
      }
      const allowedRoles = new Set([
        'plc-engineer',
        'safety-reviewer',
        'workspace-owner'
      ]);
      if (!allowedRoles.has(reviewerRole)) {
        throw serviceError(
          'INVALID_REVIEWER_ROLE',
          'A bounded reviewer role is required.'
        );
      }
      const proposal = proposals[proposalIndex];
      if (status === 'approved' && proposal.riskClass === 'R4') {
        throw serviceError(
          'BLOCKED_PROPOSAL_CANNOT_BE_APPROVED',
          'An R4 blocked proposal cannot be approved.',
          409
        );
      }
      const normalizedNote = typeof note === 'string' ? note.trim().slice(0, 1000) : '';
      const decision = {
        id: `decision-${randomUUID()}`,
        proposalId,
        workspaceId,
        status,
        reviewerRole,
        noteHash: normalizedNote
          ? createHash('sha256').update(normalizedNote, 'utf8').digest('hex')
          : null,
        scope: 'manual-review-only',
        authorizationEffect: 'none',
        canWriteToPlc: false,
        recordedAt: new Date().toISOString()
      };
      const updatedProposal = {
        ...proposal,
        lastDecision: decision
      };
      proposals[proposalIndex] = updatedProposal;
      proposalRecords.set(workspaceId, proposals);
      if (workspace.storage === 'persistent') {
        persistenceStore.saveProposal(workspaceId, updatedProposal);
      }
      recordAudit(workspace, {
        event: 'change-proposal.decision',
        proposalId,
        status,
        reviewerRole,
        noteHash: decision.noteHash,
        scope: decision.scope,
        authorizationEffect: 'none',
        canWriteToPlc: false
      });
      return decision;
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
