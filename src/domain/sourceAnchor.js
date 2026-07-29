import { createHash } from 'node:crypto';

function stableId(prefix, ...parts) {
  return `${prefix}-${createHash('sha256').update(parts.map(String).join('|')).digest('hex').slice(0, 16)}`;
}

export function hashContent(value) {
  return createHash('sha256').update(String(value ?? ''), 'utf8').digest('hex');
}

export function createArtifact({ filename, content }) {
  const safeFilename = String(filename || 'uploaded-project');
  const safeContent = String(content ?? '');
  const contentHash = hashContent(safeContent);

  return {
    id: stableId('artifact', safeFilename, contentHash),
    filename: safeFilename,
    contentHash,
    sizeBytes: Buffer.byteLength(safeContent, 'utf8')
  };
}

/**
 * @param {{
 *   artifactId: string;
 *   filename: string;
 *   rawSnippet: string;
 *   lineStart?: number;
 *   lineEnd?: number;
 *   byteStart?: number;
 *   byteEnd?: number;
 *   programId?: string;
 *   networkId?: string;
 *   instructionId?: string;
 * }} input
 */
export function createSourceAnchor({
  artifactId,
  filename,
  rawSnippet,
  lineStart,
  lineEnd = lineStart,
  byteStart,
  byteEnd,
  programId,
  networkId,
  instructionId
}) {
  const rawSnippetHash = hashContent(rawSnippet);
  const anchor = {
    id: stableId(
      'source',
      artifactId,
      filename,
      lineStart ?? '',
      lineEnd ?? '',
      byteStart ?? '',
      byteEnd ?? '',
      programId ?? '',
      networkId ?? '',
      instructionId ?? '',
      rawSnippetHash
    ),
    artifactId,
    filename,
    rawSnippetHash
  };

  for (const [key, value] of Object.entries({
    lineStart,
    lineEnd,
    byteStart,
    byteEnd,
    programId,
    networkId,
    instructionId
  })) {
    if (value !== undefined && value !== null && value !== '') {
      anchor[key] = value;
    }
  }

  return Object.freeze(anchor);
}

export function lineNumberAt(content, byteIndex) {
  if (!Number.isInteger(byteIndex) || byteIndex < 0) {
    return 1;
  }

  return String(content).slice(0, byteIndex).split(/\r\n|\n|\r/).length;
}
