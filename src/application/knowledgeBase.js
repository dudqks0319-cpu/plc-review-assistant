import { createHash, randomUUID } from 'node:crypto';

const SOURCE_TYPES = new Set([
  'vendor-manual',
  'company-rule',
  'approved-case',
  'public-guideline'
]);
const LICENSE_POLICIES = new Set(['local-index-only', 'redistributable', 'unknown']);
const MAX_DOCUMENTS_PER_WORKSPACE = 16;
const MAX_DOCUMENT_BYTES = 1_000_000;
const MAX_WORKSPACE_BYTES = 8_000_000;
const MAX_CHUNKS_PER_DOCUMENT = 500;
const MAX_CHUNK_CHARS = 1_200;
const PROMPT_INJECTION_PATTERNS = [
  /ignore (?:all |the )?(?:previous|prior) instructions?/i,
  /system prompt/i,
  /developer message/i,
  /이전 (?:지시|명령).{0,20}(?:무시|따르지)/i,
  /도구.{0,20}(?:실행|권한|호출)/i,
  /(?:network|shell|command).{0,20}(?:execute|run)/i
];

function knowledgeError(code, message, statusCode = 400) {
  const error = new Error(message);
  error.code = code;
  error.statusCode = statusCode;
  return error;
}

function stableId(prefix, ...parts) {
  return `${prefix}-${createHash('sha256')
    .update(parts.map(String).join('|'))
    .digest('hex')
    .slice(0, 20)}`;
}

function safeText(value, maxLength) {
  return typeof value === 'string' ? value.trim().slice(0, maxLength) : '';
}

function normalizeFamily(value) {
  return safeText(value, 80).toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function profileFamily(cpuProfileId) {
  const normalized = normalizeFamily(cpuProfileId);
  if (normalized.includes('fx3')) return 'fx3';
  if (normalized.includes('qcpu') || normalized === 'q' || /^q\d/.test(normalized)) {
    return 'qcpu';
  }
  if (normalized.includes('lcpu') || normalized === 'l' || /^l\d/.test(normalized)) {
    return 'lcpu';
  }
  return '';
}

function tokenize(value) {
  const lowerValue = String(value || '').toLowerCase();
  const extractedDevices = [
    ...lowerValue.matchAll(
      /(?:^|[^a-z0-9])((?:zr|sd|sm|x|y|m|l|b|d|w|r|t|c|z)[0-9a-f]+)(?![a-z0-9])/g
    )
  ].map((match) => match[1]);
  const normalized = lowerValue
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^a-z0-9가-힣]+/g, ' ')
    .trim();
  if (!normalized) return [];
  const rawWords = normalized.split(/\s+/).filter(Boolean);
  const deviceParts = [...rawWords, ...extractedDevices].flatMap((token) => {
    const match = token.match(/^(zr|sd|sm|x|y|m|l|b|d|w|r|t|c|z)([0-9a-f]+)$/);
    return match ? [token, match[1], match[2]] : [];
  });
  const words = [...rawWords, ...deviceParts].filter(
    (token) => token.length > 1 || /^(?:x|y|m|l|b|d|w|r|t|c|z)$/.test(token)
  );
  const koreanBigrams = [];
  for (const word of words.filter((token) => /[가-힣]/.test(token))) {
    for (let index = 0; index < word.length - 1; index += 1) {
      koreanBigrams.push(word.slice(index, index + 2));
    }
  }
  return [...new Set([...words, ...koreanBigrams])];
}

function stripPromptInjection(text) {
  const signals = [];
  const safeParagraphs = [];
  for (const paragraph of String(text || '').split(/\n{2,}/)) {
    const matched = PROMPT_INJECTION_PATTERNS.filter((pattern) => pattern.test(paragraph));
    if (matched.length) {
      signals.push({
        code: 'PROMPT_INJECTION_TEXT_EXCLUDED',
        detail: 'A document paragraph that resembled instructions was excluded from search.'
      });
      continue;
    }
    if (paragraph.trim()) safeParagraphs.push(paragraph.trim());
  }
  return {
    safeText: safeParagraphs.join('\n\n'),
    signals
  };
}

function chunkText(text) {
  const chunks = [];
  const paragraphs = String(text || '').split(/\n{2,}/).filter(Boolean);
  for (const paragraph of paragraphs) {
    for (let offset = 0; offset < paragraph.length; offset += MAX_CHUNK_CHARS) {
      chunks.push(paragraph.slice(offset, offset + MAX_CHUNK_CHARS));
      if (chunks.length >= MAX_CHUNKS_PER_DOCUMENT) return chunks;
    }
  }
  return chunks;
}

function scoreChunk(chunk, queryTokens) {
  if (!queryTokens.length) return 0;
  const frequencies = new Map();
  for (const token of chunk.tokens) {
    frequencies.set(token, (frequencies.get(token) || 0) + 1);
  }
  let score = 0;
  for (const token of queryTokens) {
    const frequency = frequencies.get(token) || 0;
    if (frequency > 0) score += 1 + Math.log1p(frequency);
    if (chunk.normalizedText.includes(token)) score += 0.25;
  }
  return score / Math.sqrt(Math.max(1, chunk.tokens.length));
}

function publicDocument(document) {
  return {
    id: document.id,
    filename: document.filename,
    sourceType: document.sourceType,
    vendor: document.vendor,
    family: document.family,
    cpuModels: document.cpuModels,
    engineeringTool: document.engineeringTool,
    documentNumber: document.documentNumber,
    revision: document.revision,
    section: document.section,
    page: document.page,
    contentHash: document.contentHash,
    licensePolicy: document.licensePolicy,
    sizeBytes: document.sizeBytes,
    chunkCount: document.chunks.length,
    warnings: document.warnings,
    storage: 'memory-only',
    createdAt: document.createdAt
  };
}

export function createKnowledgeBase() {
  const documentsByWorkspace = new Map();

  function documentsFor(workspaceId) {
    return documentsByWorkspace.get(workspaceId) || [];
  }

  return {
    importDocument(workspace, input = {}) {
      const workspaceId = workspace?.id;
      if (!workspaceId) {
        throw knowledgeError('WORKSPACE_REQUIRED', 'A workspace is required.');
      }
      const documents = documentsFor(workspaceId);
      if (documents.length >= MAX_DOCUMENTS_PER_WORKSPACE) {
        throw knowledgeError(
          'KNOWLEDGE_DOCUMENT_LIMIT_EXCEEDED',
          `At most ${MAX_DOCUMENTS_PER_WORKSPACE} local knowledge documents may be active.`,
          429
        );
      }

      const filename = safeText(input.filename, 240);
      if (!filename || filename.includes('/') || filename.includes('\\')) {
        throw knowledgeError(
          'KNOWLEDGE_FILENAME_INVALID',
          'Knowledge document filenames must be plain local names.'
        );
      }
      if (!/\.(?:txt|md)$/i.test(filename)) {
        throw knowledgeError(
          'KNOWLEDGE_EXTENSION_UNSUPPORTED',
          'Only local TXT and Markdown knowledge documents are accepted.'
        );
      }
      const sourceType = safeText(input.sourceType, 40);
      if (!SOURCE_TYPES.has(sourceType)) {
        throw knowledgeError('KNOWLEDGE_SOURCE_TYPE_INVALID', 'Knowledge source type is invalid.');
      }
      const licensePolicy = safeText(input.licensePolicy, 40) || 'unknown';
      if (!LICENSE_POLICIES.has(licensePolicy)) {
        throw knowledgeError('KNOWLEDGE_LICENSE_POLICY_INVALID', 'License policy is invalid.');
      }
      const vendor = safeText(input.vendor, 40).toLowerCase() || workspace.vendor;
      if (vendor !== workspace.vendor) {
        throw knowledgeError(
          'KNOWLEDGE_VENDOR_MISMATCH',
          'Knowledge document vendor must match the workspace vendor.'
        );
      }
      const content = typeof input.content === 'string' ? input.content : '';
      const sizeBytes = Buffer.byteLength(content, 'utf8');
      if (!content.trim()) {
        throw knowledgeError('KNOWLEDGE_CONTENT_REQUIRED', 'Knowledge document text is required.');
      }
      if (sizeBytes > MAX_DOCUMENT_BYTES) {
        throw knowledgeError(
          'KNOWLEDGE_DOCUMENT_TOO_LARGE',
          `Knowledge document exceeds ${MAX_DOCUMENT_BYTES} bytes.`,
          413
        );
      }
      const totalBytes = documents.reduce((sum, document) => sum + document.sizeBytes, 0);
      if (totalBytes + sizeBytes > MAX_WORKSPACE_BYTES) {
        throw knowledgeError(
          'KNOWLEDGE_WORKSPACE_LIMIT_EXCEEDED',
          'Local knowledge storage limit has been reached.',
          429
        );
      }

      const contentHash = createHash('sha256').update(content).digest('hex');
      const duplicate = documents.find((document) => document.contentHash === contentHash);
      if (duplicate) return { ...publicDocument(duplicate), reused: true };

      const sanitized = stripPromptInjection(content);
      if (!sanitized.safeText) {
        throw knowledgeError(
          'KNOWLEDGE_CONTENT_UNTRUSTED',
          'All document text was excluded by the prompt-injection guard.'
        );
      }
      const id = `knowledge-${randomUUID()}`;
      const family = safeText(input.family, 80);
      const document = {
        id,
        filename,
        sourceType,
        vendor,
        family,
        normalizedFamily: profileFamily(family) || normalizeFamily(family),
        cpuModels: Array.isArray(input.cpuModels)
          ? input.cpuModels.map((item) => safeText(item, 80)).filter(Boolean).slice(0, 20)
          : [],
        engineeringTool: safeText(input.engineeringTool, 100),
        documentNumber: safeText(input.documentNumber, 100),
        revision: safeText(input.revision, 80),
        section: safeText(input.section, 160),
        page: Number.isInteger(input.page) && input.page > 0 ? input.page : null,
        contentHash,
        licensePolicy,
        sizeBytes,
        warnings: sanitized.signals,
        createdAt: new Date().toISOString(),
        chunks: chunkText(sanitized.safeText).map((text, index) => ({
          id: stableId('chunk', id, index, text),
          documentId: id,
          ordinal: index + 1,
          text,
          normalizedText: text.normalize('NFKC').toLowerCase(),
          tokens: tokenize(text)
        }))
      };
      documents.push(document);
      documentsByWorkspace.set(workspaceId, documents);
      return publicDocument(document);
    },

    listDocuments(workspaceId) {
      return documentsFor(workspaceId).map(publicDocument);
    },

    deleteDocument(workspaceId, documentId) {
      const documents = documentsFor(workspaceId);
      const index = documents.findIndex((document) => document.id === documentId);
      if (index < 0) {
        throw knowledgeError('KNOWLEDGE_DOCUMENT_NOT_FOUND', 'Knowledge document not found.', 404);
      }
      const [document] = documents.splice(index, 1);
      return { id: document.id, deletedChunkCount: document.chunks.length, storage: 'memory-only' };
    },

    deleteWorkspace(workspaceId) {
      documentsByWorkspace.delete(workspaceId);
    },

    search(workspace, query, { limit = 4 } = {}) {
      const queryTokens = tokenize(query);
      const expectedFamily = profileFamily(workspace?.cpuProfileId);
      const warnings = [];
      const candidates = [];
      for (const document of documentsFor(workspace?.id)) {
        if (document.vendor !== workspace.vendor) continue;
        if (!expectedFamily && document.normalizedFamily) {
          warnings.push({
            code: 'KNOWLEDGE_CPU_FAMILY_REQUIRED',
            documentId: document.id,
            detail: `${document.filename} was excluded because the workspace CPU family is unknown.`
          });
          continue;
        }
        if (
          expectedFamily &&
          document.normalizedFamily &&
          document.normalizedFamily !== expectedFamily
        ) {
          warnings.push({
            code: 'KNOWLEDGE_CPU_FAMILY_FILTERED',
            documentId: document.id,
            detail: `${document.filename} was excluded because its CPU family does not match.`
          });
          continue;
        }
        for (const chunk of document.chunks) {
          const score = scoreChunk(chunk, queryTokens);
          if (score <= 0) continue;
          candidates.push({ document, chunk, score });
        }
      }
      candidates.sort(
        (left, right) =>
          right.score - left.score ||
          left.document.filename.localeCompare(right.document.filename) ||
          left.chunk.ordinal - right.chunk.ordinal
      );
      return {
        strategy: 'local-bm25-like+lexical-rerank',
        results: candidates.slice(0, Math.max(1, Math.min(limit, 8))).map(({ document, chunk, score }) => ({
          evidenceId: `evi-${chunk.id}`,
          chunkId: chunk.id,
          documentId: document.id,
          score: Number(score.toFixed(4)),
          citation: {
            filename: document.filename,
            sourceType: document.sourceType,
            vendor: document.vendor,
            family: document.family || null,
            documentNumber: document.documentNumber || null,
            revision: document.revision || null,
            section: document.section || null,
            page: document.page,
            licensePolicy: document.licensePolicy
          },
          snippet: chunk.text.slice(0, 500),
          contentHash: document.contentHash
        })),
        warnings
      };
    }
  };
}
