import { createHash } from 'node:crypto';

const WRITER_ACCESS = new Set(['write', 'set', 'reset', 'indirect-write']);
const READER_ACCESS = new Set(['read', 'indirect-read']);

function stableId(prefix, ...parts) {
  return `${prefix}-${createHash('sha256').update(parts.map(String).join('|')).digest('hex').slice(0, 16)}`;
}

function addToIndex(index, key, value) {
  if (!key) return;
  const entries = index.get(key) || [];
  entries.push(value);
  index.set(key, entries);
}

function normalizedAddress(value) {
  return String(value || '').trim().toUpperCase();
}

export function buildDataFlowEdges(references) {
  const referencesByNetwork = new Map();
  for (const reference of references || []) {
    const networkId = reference.source?.networkId;
    if (!networkId) continue;
    addToIndex(referencesByNetwork, networkId, reference);
  }

  const edges = [];
  const seen = new Set();
  for (const [networkId, networkReferences] of referencesByNetwork) {
    const readers = networkReferences.filter((reference) => READER_ACCESS.has(reference.access));
    const writers = networkReferences.filter((reference) => WRITER_ACCESS.has(reference.access));
    for (const reader of readers) {
      for (const writer of writers) {
        const key = `${reader.deviceId}|${writer.deviceId}|${networkId}|${writer.instructionId}`;
        if (seen.has(key)) continue;
        seen.add(key);
        edges.push({
          id: stableId('flow', key),
          fromDeviceId: reader.deviceId,
          fromAddress: reader.canonicalAddress,
          toDeviceId: writer.deviceId,
          toAddress: writer.canonicalAddress,
          relation: 'influences',
          networkId,
          instructionId: writer.instructionId,
          source: writer.source,
          evidence: 'derived'
        });
      }
    }
  }

  return edges;
}

export function buildCrossReferenceIndex(snapshot) {
  const writersByDevice = new Map();
  const readersByDevice = new Map();
  const settersByDevice = new Map();
  const resettersByDevice = new Map();
  const indirectReferences = [];

  for (const reference of snapshot?.references || []) {
    const address = normalizedAddress(reference.canonicalAddress);
    if (WRITER_ACCESS.has(reference.access)) addToIndex(writersByDevice, address, reference);
    if (READER_ACCESS.has(reference.access)) addToIndex(readersByDevice, address, reference);
    if (reference.access === 'set') addToIndex(settersByDevice, address, reference);
    if (reference.access === 'reset') addToIndex(resettersByDevice, address, reference);
    if (reference.access.startsWith('indirect-')) indirectReferences.push(reference);
  }

  const lastWriteCandidatesByDevice = new Map();
  for (const [address, writers] of writersByDevice) {
    const sorted = [...writers].sort(
      (left, right) =>
        (right.source?.lineStart || 0) - (left.source?.lineStart || 0)
    );
    lastWriteCandidatesByDevice.set(address, sorted);
  }

  return {
    writersByDevice,
    readersByDevice,
    settersByDevice,
    resettersByDevice,
    lastWriteCandidatesByDevice,
    indirectReferences,
    executionOrderKnown: false
  };
}

function trace(snapshot, startAddress, direction, maxDepth) {
  const normalizedStart = normalizedAddress(startAddress);
  const devicesByAddress = new Map(
    (snapshot?.devices || []).map((device) => [normalizedAddress(device.canonicalAddress), device])
  );
  const edges = snapshot?.dataFlowEdges?.length
    ? snapshot.dataFlowEdges
    : buildDataFlowEdges(snapshot?.references || []);
  const queue = [{ address: normalizedStart, depth: 0 }];
  const visited = new Set([normalizedStart]);
  const resultEdges = [];
  const cycles = [];

  while (queue.length > 0) {
    const current = queue.shift();
    if (current.depth >= maxDepth) continue;
    const candidates = edges.filter((edge) =>
      direction === 'forward'
        ? normalizedAddress(edge.fromAddress) === current.address
        : normalizedAddress(edge.toAddress) === current.address
    );

    for (const edge of candidates) {
      resultEdges.push(edge);
      const nextAddress = normalizedAddress(
        direction === 'forward' ? edge.toAddress : edge.fromAddress
      );
      if (visited.has(nextAddress)) {
        cycles.push({ from: current.address, to: nextAddress, edgeId: edge.id });
        continue;
      }
      visited.add(nextAddress);
      queue.push({ address: nextAddress, depth: current.depth + 1 });
    }
  }

  return {
    startAddress: normalizedStart,
    direction,
    maxDepth,
    devices: [...visited].map((address) =>
      devicesByAddress.get(address) || {
        id: stableId('unknown-device', address),
        canonicalAddress: address,
        role: 'unknown',
        profileStatus: 'unknown-profile'
      }
    ),
    edges: resultEdges,
    cycles,
    truncated: queue.length > 0
  };
}

export function traceForward(snapshot, startAddress, { maxDepth = 4 } = {}) {
  return trace(snapshot, startAddress, 'forward', Math.max(1, Math.min(maxDepth, 12)));
}

export function traceBackward(snapshot, startAddress, { maxDepth = 4 } = {}) {
  return trace(snapshot, startAddress, 'backward', Math.max(1, Math.min(maxDepth, 12)));
}
