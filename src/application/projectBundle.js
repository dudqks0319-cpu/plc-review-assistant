import { basename, extname } from 'node:path';
import { createHash } from 'node:crypto';
import { analyzePlcProject } from '../backend/plcAnalyzer.js';
import { buildDataFlowEdges } from '../domain/dataFlow.js';

const MAX_ARTIFACTS = 32;
const MAX_ARTIFACT_BYTES = 2_000_000;
const MAX_BUNDLE_BYTES = 10_000_000;
const ALLOWED_EXTENSIONS = new Set(['.csv', '.txt', '.lst', '.asc']);
const ENCODING_LABELS = Object.freeze({
  'utf-8': 'utf-8',
  utf8: 'utf-8',
  'utf-8-bom': 'utf-8',
  cp949: 'euc-kr',
  'euc-kr': 'euc-kr',
  'shift-jis': 'shift_jis',
  shift_jis: 'shift_jis',
  cp932: 'shift_jis',
  'windows-1252': 'windows-1252'
});

function stableId(prefix, ...parts) {
  return `${prefix}-${createHash('sha256').update(parts.map(String).join('|')).digest('hex').slice(0, 20)}`;
}

function fail(code, message) {
  const error = new Error(`${code}: ${message}`);
  error.code = code;
  throw error;
}

function validateFilename(filename) {
  const value = String(filename || '');
  if (
    !value ||
    value.includes('\0') ||
    value.includes('/') ||
    value.includes('\\') ||
    basename(value) !== value
  ) {
    fail('ARTIFACT_FILENAME_INVALID', 'Artifact filenames must be plain local names.');
  }

  const extension = extname(value).toLowerCase();
  if (extension === '.zip') {
    fail(
      'ARCHIVE_EXTRACTION_DISABLED',
      'Archive extraction stays disabled until bounded ZIP handling is implemented and tested.'
    );
  }
  if (!ALLOWED_EXTENSIONS.has(extension)) {
    fail('ARTIFACT_EXTENSION_UNSUPPORTED', `Unsupported artifact extension: ${extension || '(none)'}`);
  }
  return value;
}

function decodeArtifact(artifact) {
  const filename = validateFilename(artifact?.filename);
  const requestedEncoding = String(artifact?.encoding || 'utf-8').toLowerCase();
  const decoderLabel = ENCODING_LABELS[requestedEncoding];
  if (!decoderLabel) {
    fail('ARTIFACT_ENCODING_UNSUPPORTED', `Unsupported artifact encoding: ${requestedEncoding}`);
  }

  let bytes;
  let content;
  if (typeof artifact.content === 'string') {
    bytes = Buffer.from(artifact.content, 'utf8');
    content = artifact.content;
  } else if (typeof artifact.contentBase64 === 'string') {
    if (
      artifact.contentBase64.length === 0 ||
      artifact.contentBase64.length % 4 !== 0 ||
      !/^[A-Za-z0-9+/]+={0,2}$/.test(artifact.contentBase64)
    ) {
      fail('ARTIFACT_BASE64_INVALID', `Invalid base64 content for ${filename}.`);
    }
    bytes = Buffer.from(artifact.contentBase64, 'base64');
  } else {
    fail('ARTIFACT_CONTENT_REQUIRED', `Artifact content is required for ${filename}.`);
  }

  if (bytes.length > MAX_ARTIFACT_BYTES) {
    fail('ARTIFACT_TOO_LARGE', `${filename} exceeds ${MAX_ARTIFACT_BYTES} bytes.`);
  }

  if (content === undefined) {
    try {
      content = new TextDecoder(decoderLabel, { fatal: true }).decode(bytes);
    } catch {
      fail('ARTIFACT_DECODE_FAILED', `${filename} could not be decoded as ${requestedEncoding}.`);
    }
  }
  if (requestedEncoding === 'utf-8-bom') {
    content = content.replace(/^\uFEFF/, '');
  }

  return {
    filename,
    content,
    encoding: requestedEncoding,
    sizeBytes: bytes.length
  };
}

function enrichDevices(devices, analyses) {
  const metadataByAddress = new Map();
  for (const analysis of analyses) {
    for (const variable of analysis.project.variables || []) {
      if (!variable.address) continue;
      const address = variable.address.toUpperCase();
      const metadata = metadataByAddress.get(address) || {
        labels: [],
        comments: [],
        sourceAnchors: []
      };
      if (variable.name && !metadata.labels.includes(variable.name)) metadata.labels.push(variable.name);
      if (variable.comment && !metadata.comments.includes(variable.comment)) metadata.comments.push(variable.comment);
      if (variable.sourceAnchor) metadata.sourceAnchors.push(variable.sourceAnchor);
      metadataByAddress.set(address, metadata);
    }
  }

  return devices.map((device) => {
    const metadata = metadataByAddress.get(device.canonicalAddress) || {};
    return {
      ...device,
      label: metadata.labels?.[0] || null,
      aliases: metadata.labels?.slice(1) || [],
      comment: metadata.comments?.[0] || null,
      sourceAnchors: metadata.sourceAnchors || []
    };
  });
}

export function createProjectBundleSnapshot({
  workspaceId,
  vendor = 'mitsubishi',
  cpuProfileId = null,
  artifacts
}) {
  if (!Array.isArray(artifacts) || artifacts.length === 0) {
    fail('ARTIFACTS_REQUIRED', 'At least one PLC export artifact is required.');
  }
  if (artifacts.length > MAX_ARTIFACTS) {
    fail('ARTIFACT_COUNT_EXCEEDED', `A bundle may contain at most ${MAX_ARTIFACTS} artifacts.`);
  }

  const decodedArtifacts = artifacts.map(decodeArtifact);
  const filenames = new Set();
  for (const artifact of decodedArtifacts) {
    if (filenames.has(artifact.filename.toLowerCase())) {
      fail('ARTIFACT_FILENAME_DUPLICATE', `Duplicate artifact filename: ${artifact.filename}`);
    }
    filenames.add(artifact.filename.toLowerCase());
  }
  const totalBytes = decodedArtifacts.reduce((sum, artifact) => sum + artifact.sizeBytes, 0);
  if (totalBytes > MAX_BUNDLE_BYTES) {
    fail('BUNDLE_TOO_LARGE', `The decoded bundle exceeds ${MAX_BUNDLE_BYTES} bytes.`);
  }

  const analyses = decodedArtifacts.map((artifact) =>
    analyzePlcProject({
      filename: artifact.filename,
      vendor,
      cpuProfileId,
      content: artifact.content
    })
  );
  const artifactMetadata = analyses.map((analysis, index) => ({
    ...analysis.snapshot.artifacts[0],
    encoding: decodedArtifacts[index].encoding
  }));
  const programs = analyses.flatMap((analysis) => analysis.snapshot.programs);
  const references = analyses.flatMap((analysis) => analysis.snapshot.references);
  const devicesById = new Map(
    analyses
      .flatMap((analysis) => analysis.snapshot.devices)
      .map((device) => [device.id, device])
  );
  const devices = enrichDevices([...devicesById.values()], analyses);
  const parseWarnings = analyses.flatMap((analysis) =>
    analysis.snapshot.parseWarnings.map((warning) => ({
      ...warning,
      artifactId: warning.source?.artifactId || analysis.snapshot.artifacts[0].id
    }))
  );
  const contentHash = createHash('sha256')
    .update(artifactMetadata.map((artifact) => artifact.contentHash).sort().join('|'))
    .digest('hex');
  const snapshot = {
    id: stableId('snapshot', workspaceId || 'ephemeral', contentHash, cpuProfileId || 'unknown-profile'),
    workspaceId: workspaceId || null,
    contentHash,
    vendor,
    cpuProfileId: analyses.find((analysis) => analysis.snapshot.cpuProfileId)?.snapshot.cpuProfileId || null,
    artifacts: artifactMetadata,
    programs,
    devices,
    references,
    callEdges: analyses.flatMap((analysis) => analysis.snapshot.callEdges),
    dataFlowEdges: buildDataFlowEdges(references),
    parseWarnings,
    createdAt: new Date().toISOString()
  };

  return {
    snapshot,
    findings: analyses.flatMap((analysis) =>
      analysis.findings.map((finding) => ({
        ...finding,
        id: stableId('finding', analysis.id, finding.id)
      }))
    ),
    artifactResults: analyses.map((analysis, index) => ({
      artifact: artifactMetadata[index],
      summary: analysis.summary,
      parserWarnings: analysis.snapshot.parseWarnings
    }))
  };
}
