import { createHash } from 'node:crypto';
import { createServer as createHttpServer } from 'node:http';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createChangePlan } from './beginnerChangeAssistant.js';
import { normalizeChangeRequirement } from './requirementNormalizer.js';
import { createServer as createLegacyServer } from './server.js';

const MAX_JSON_BYTES = 6_000_000;

function writeSecurityHeaders(res) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Cache-Control', 'no-store');
}

function sendJson(res, statusCode, payload) {
  const body = JSON.stringify(payload);
  writeSecurityHeaders(res);
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Content-Length', Buffer.byteLength(body));
  res.writeHead(statusCode);
  res.end(body);
}

function sendError(res, statusCode, code, message) {
  sendJson(res, statusCode, { error: { code, message } });
}

function parseJsonBody(req, maxBytes = MAX_JSON_BYTES) {
  return new Promise((resolveBody, reject) => {
    const chunks = [];
    let size = 0;
    let settled = false;

    req.on('data', (chunk) => {
      if (settled) {
        return;
      }

      size += chunk.length;
      if (size > maxBytes) {
        settled = true;
        reject(new Error('Payload too large'));
        req.destroy();
        return;
      }

      chunks.push(chunk);
    });

    req.on('end', () => {
      if (settled) {
        return;
      }

      try {
        settled = true;
        resolveBody(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {});
      } catch {
        settled = true;
        reject(new Error('Invalid JSON body'));
      }
    });

    req.on('error', (error) => {
      if (!settled) {
        settled = true;
        reject(error);
      }
    });
  });
}

function buildDraftId(prefix, ...parts) {
  const hash = createHash('sha1').update(parts.filter(Boolean).join('|')).digest('hex').slice(0, 10);
  return `${prefix}-${hash}`;
}

function createDraftAnalysisContext({ vendor, requestText, sourceFilename }) {
  const selectedVendor = vendor === 'mitsubishi' ? 'mitsubishi' : 'siemens';
  const filename = sourceFilename || `${selectedVendor}-natural-language-draft.txt`;
  const projectId = buildDraftId('project-draft', selectedVendor, requestText);
  const vendorLabel = selectedVendor === 'mitsubishi' ? 'Mitsubishi' : 'Siemens';

  return {
    id: buildDraftId('analysis-draft', projectId, requestText),
    project: {
      id: projectId,
      name: `${vendorLabel} natural-language draft`,
      vendor: selectedVendor,
      source: {
        filename,
        fileType: 'natural-language-draft',
        detectedBy: 'request-only'
      },
      blocks: [],
      variables: [],
      ioAddresses: [],
      callGraph: [],
      protectedItems: [],
      parserWarnings: ['PLC export file was not provided. Existing project impact analysis is unavailable.']
    },
    summary: {
      blockCount: 0,
      variableCount: 0,
      ioAddressCount: 0,
      callEdgeCount: 0,
      protectedItemCount: 0,
      severityCounts: { high: 0, medium: 0, low: 0, info: 0 },
      languageDistribution: {}
    },
    findings: [],
    assistantSummary: [
      `${vendorLabel} 파일 없는 자연어 초안 모드입니다.`,
      '기존 PLC export가 없어 블록, 태그, I/O 영향 분석은 수행하지 않았습니다.',
      `요청: ${requestText}`
    ].join('\n'),
    limitations: [
      'PLC export 파일이 없어 기존 회로와의 충돌, 호출 관계, I/O 중복을 확인하지 못합니다.',
      '생성되는 내용은 신규 로직 초안 또는 검토용 후보이며 실제 프로젝트 반영 전 주소/태그 매핑이 필요합니다.',
      '벤더 툴 컴파일, 시뮬레이터 검증, 자격 있는 PLC 엔지니어 승인이 필요합니다.',
      '온라인 PLC 접속, PLC 쓰기, 자동 수정 기능은 제공하지 않습니다.'
    ]
  };
}

function validateChangePlanPayload(body) {
  if (!body || typeof body !== 'object') {
    throw new Error('요청 본문이 올바르지 않습니다.');
  }

  if (typeof body.requestText !== 'string' || body.requestText.trim().length === 0) {
    throw new Error('회로수정 요청 내용이 필요합니다.');
  }

  const vendor = body.vendor === 'mitsubishi' ? 'mitsubishi' : 'siemens';
  const requestText = body.requestText.trim();
  const sourceFilename = typeof body.sourceFilename === 'string' ? body.sourceFilename : '';
  const analysis =
    body.analysis && typeof body.analysis === 'object'
      ? body.analysis
      : createDraftAnalysisContext({ vendor, requestText, sourceFilename });

  return {
    analysis,
    vendor,
    requestText,
    sourceContent: typeof body.sourceContent === 'string' ? body.sourceContent : '',
    sourceFilename: sourceFilename || analysis?.project?.source?.filename || ''
  };
}

async function handleCreateChangePlan(req, res) {
  if (req.method !== 'POST') {
    sendError(res, 405, 'method_not_allowed', 'Method not allowed');
    return;
  }

  const body = await parseJsonBody(req);
  const payload = validateChangePlanPayload(body);
  const normalization = await normalizeChangeRequirement(payload);
  const changePlan = createChangePlan({
    ...payload,
    normalizedRequirementInput: normalization.requirement,
    safetyValidation: normalization.validation,
    normalizationSource: normalization.source,
    fallbackReason: normalization.fallbackReason
  });

  sendJson(res, 201, { data: changePlan });
}

export function createServer() {
  const legacyServer = createLegacyServer();
  const legacyHandler = legacyServer.listeners('request')[0];

  if (typeof legacyHandler !== 'function') {
    throw new Error('Legacy server request handler is unavailable.');
  }

  return createHttpServer(async (req, res) => {
    const url = new URL(req.url || '/', 'http://localhost');

    if (url.pathname !== '/api/v1/change-plans') {
      return legacyHandler.call(legacyServer, req, res);
    }

    try {
      await handleCreateChangePlan(req, res);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Internal server error';
      const statusCode = /필요|비어|올바르지|Invalid JSON|Payload too large/.test(message) ? 400 : 500;
      if (statusCode >= 500) {
        console.error('[plc-beginner-server-error]', error);
      }
      sendError(res, statusCode, statusCode === 400 ? 'bad_request' : 'internal_error', message);
    }
  });
}

const executedPath = process.argv[1] ? resolve(process.argv[1]) : '';
if (fileURLToPath(import.meta.url) === executedPath) {
  const port = Number(process.env.PORT || 4173);
  const server = createServer();
  server.listen(port, () => {
    console.log(`PLC Beginner Wizard running on http://localhost:${port}`);
  });
}
