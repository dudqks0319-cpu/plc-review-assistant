import { createServer as createHttpServer } from 'node:http';
import { extname, join, resolve } from 'node:path';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import {
  analyzePlcProject,
  createExcelReport,
  createMarkdownReport,
  createPdfReport
} from './plcAnalyzer.js';
import { createChangePlan, VENDOR_PROFILES } from './plcChangeAssistant.js';

const PUBLIC_DIR = join(process.cwd(), 'public');
const MAX_JSON_BYTES = 6_000_000;

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml; charset=utf-8',
  '.ico': 'image/x-icon'
};

function writeSecurityHeaders(res, extraHeaders = {}) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Cache-Control', 'no-store');

  for (const [key, value] of Object.entries(extraHeaders)) {
    res.setHeader(key, value);
  }
}

function sendJson(res, statusCode, payload) {
  const body = JSON.stringify(payload);
  writeSecurityHeaders(res, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body)
  });
  res.writeHead(statusCode);
  res.end(body);
}

function sendError(res, statusCode, code, message) {
  sendJson(res, statusCode, {
    error: {
      code,
      message
    }
  });
}

function sendText(res, statusCode, body, contentType, filename) {
  const buffer = Buffer.isBuffer(body) ? body : Buffer.from(String(body), 'utf8');
  const headers = {
    'Content-Type': contentType,
    'Content-Length': buffer.length
  };

  if (filename) {
    headers['Content-Disposition'] = `attachment; filename="${filename}"`;
  }

  writeSecurityHeaders(res, headers);
  res.writeHead(statusCode);
  res.end(buffer);
}

function parseJsonBody(req, maxBytes = MAX_JSON_BYTES) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;

    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > maxBytes) {
        reject(new Error('Payload too large'));
        req.destroy();
        return;
      }

      chunks.push(chunk);
    });

    req.on('end', () => {
      try {
        if (chunks.length === 0) {
          resolve({});
          return;
        }

        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        reject(new Error('Invalid JSON body'));
      }
    });

    req.on('error', reject);
  });
}

function methodNotAllowed(res) {
  sendError(res, 405, 'method_not_allowed', 'Method not allowed');
}

async function serveStatic(req, res) {
  const url = new URL(req.url || '/', 'http://localhost');
  const normalizedPath = url.pathname === '/' ? '/index.html' : url.pathname;

  if (normalizedPath.includes('..')) {
    sendError(res, 400, 'invalid_path', 'Invalid path');
    return;
  }

  try {
    const filePath = join(PUBLIC_DIR, normalizedPath);
    const data = await readFile(filePath);
    const extension = extname(filePath);

    writeSecurityHeaders(res, {
      'Content-Type': MIME_TYPES[extension] || 'application/octet-stream',
      'Content-Length': data.length
    });
    res.writeHead(200);
    res.end(data);
  } catch {
    if (normalizedPath !== '/index.html') {
      await serveStatic({ ...req, url: '/index.html' }, res);
      return;
    }

    sendError(res, 404, 'not_found', 'Not found');
  }
}

function validateAnalysisPayload(body) {
  if (!body || typeof body !== 'object') {
    throw new Error('요청 본문이 올바르지 않습니다.');
  }

  if (typeof body.content !== 'string' || body.content.trim().length === 0) {
    throw new Error('content 필드에 업로드 파일 텍스트가 필요합니다.');
  }

  return {
    filename: typeof body.filename === 'string' ? body.filename : 'uploaded-project.txt',
    vendor: typeof body.vendor === 'string' ? body.vendor : 'auto',
    content: body.content
  };
}

function validateReportPayload(body) {
  if (!body || typeof body !== 'object' || !body.analysis || typeof body.analysis !== 'object') {
    throw new Error('analysis 객체가 필요합니다.');
  }

  const format = typeof body.format === 'string' ? body.format.toLowerCase() : 'markdown';
  if (!['markdown', 'excel', 'pdf'].includes(format)) {
    throw new Error('format은 markdown, excel, pdf 중 하나여야 합니다.');
  }

  return {
    analysis: body.analysis,
    changePlan: body.changePlan || null,
    format
  };
}

function validateChangePlanPayload(body) {
  if (!body || typeof body !== 'object' || !body.analysis || typeof body.analysis !== 'object') {
    throw new Error('analysis 객체가 필요합니다.');
  }

  if (typeof body.requestText !== 'string' || body.requestText.trim().length === 0) {
    throw new Error('회로수정 요청 내용이 필요합니다.');
  }

  const vendor = body.vendor === 'mitsubishi' ? 'mitsubishi' : 'siemens';
  return {
    analysis: body.analysis,
    vendor,
    requestText: body.requestText,
    sourceContent: typeof body.sourceContent === 'string' ? body.sourceContent : '',
    sourceFilename: typeof body.sourceFilename === 'string' ? body.sourceFilename : body.analysis?.project?.source?.filename || ''
  };
}

async function handleCreateAnalysis(req, res) {
  if (req.method !== 'POST') {
    methodNotAllowed(res);
    return;
  }

  const body = await parseJsonBody(req);
  const payload = validateAnalysisPayload(body);
  const analysis = analyzePlcProject(payload);

  sendJson(res, 201, { data: analysis });
}

async function handleCreateReport(req, res) {
  if (req.method !== 'POST') {
    methodNotAllowed(res);
    return;
  }

  const body = await parseJsonBody(req);
  const { analysis, changePlan, format } = validateReportPayload(body);
  const baseName = String(analysis?.project?.name || 'plc-review').replace(/[^A-Za-z0-9_-]+/g, '-').slice(0, 80);

  if (format === 'markdown') {
    sendText(res, 200, createMarkdownReport(analysis, changePlan), 'text/markdown; charset=utf-8', `${baseName}.md`);
    return;
  }

  if (format === 'excel') {
    sendText(
      res,
      200,
      createExcelReport(analysis, changePlan),
      'application/vnd.ms-excel; charset=utf-8',
      `${baseName}.xls`
    );
    return;
  }

  sendText(res, 200, createPdfReport(analysis, changePlan), 'application/pdf', `${baseName}.pdf`);
}

async function handleCreateChangePlan(req, res) {
  if (req.method !== 'POST') {
    methodNotAllowed(res);
    return;
  }

  const body = await parseJsonBody(req);
  const payload = validateChangePlanPayload(body);
  const changePlan = createChangePlan(payload);

  sendJson(res, 201, { data: changePlan });
}

export function createServer() {
  return createHttpServer(async (req, res) => {
    const method = req.method || 'GET';
    const url = new URL(req.url || '/', 'http://localhost');

    try {
      if (url.pathname === '/api/health') {
        if (method !== 'GET') {
          methodNotAllowed(res);
          return;
        }

        sendJson(res, 200, {
          data: {
            status: 'ok',
            product: 'PLC Review Assistant',
            versions: Object.values(VENDOR_PROFILES).map((profile) => ({
              id: profile.id,
              title: profile.title,
              patchType: profile.patchType,
              simulator: profile.simulator
            })),
            supportedInputs: ['Siemens TIA XML', 'Mitsubishi CSV', 'Mitsubishi TXT'],
            writesToPlc: false,
            bypassesProtectedBlocks: false
          }
        });
        return;
      }

      if (url.pathname === '/api/v1/analyses') {
        await handleCreateAnalysis(req, res);
        return;
      }

      if (url.pathname === '/api/v1/reports') {
        await handleCreateReport(req, res);
        return;
      }

      if (url.pathname === '/api/v1/change-plans') {
        await handleCreateChangePlan(req, res);
        return;
      }

      if (url.pathname.startsWith('/api/')) {
        sendError(res, 404, 'not_found', 'Not found');
        return;
      }

      await serveStatic(req, res);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Internal server error';
      const statusCode = /필요|비어|올바르지|format|Invalid JSON|Payload too large/.test(message) ? 400 : 500;
      if (statusCode >= 500) {
        console.error('[plc-review-server-error]', error);
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
    console.log(`PLC Review Assistant running on http://localhost:${port}`);
  });
}
