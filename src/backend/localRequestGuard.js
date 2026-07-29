const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);

function guardError(code, message, statusCode) {
  const error = new Error(message);
  error.code = code;
  error.statusCode = statusCode;
  return error;
}

export function assertTrustedLocalMutation(req) {
  const method = String(req.method || 'GET').toUpperCase();
  if (!MUTATING_METHODS.has(method)) return;

  const fetchSite = String(req.headers['sec-fetch-site'] || '').toLowerCase();
  if (fetchSite === 'cross-site') {
    throw guardError(
      'CROSS_SITE_REQUEST_BLOCKED',
      'Cross-site mutation requests are not allowed.',
      403
    );
  }

  const origin = req.headers.origin;
  if (!origin) return;

  const host = String(req.headers.host || '');
  let parsedOrigin;
  try {
    parsedOrigin = new URL(String(origin));
  } catch {
    throw guardError('ORIGIN_INVALID', 'Request origin is invalid.', 403);
  }

  if (
    parsedOrigin.protocol !== 'http:' ||
    parsedOrigin.host !== host ||
    !['127.0.0.1', 'localhost', '[::1]'].includes(parsedOrigin.hostname)
  ) {
    throw guardError(
      'ORIGIN_NOT_ALLOWED',
      'Mutation requests must originate from the local application.',
      403
    );
  }
}

export function assertJsonRequest(req) {
  const method = String(req.method || 'GET').toUpperCase();
  if (!MUTATING_METHODS.has(method) || method === 'DELETE') return;
  const contentType = String(req.headers['content-type'] || '')
    .split(';')[0]
    .trim()
    .toLowerCase();
  if (contentType !== 'application/json') {
    throw guardError(
      'CONTENT_TYPE_UNSUPPORTED',
      'API mutation requests require application/json.',
      415
    );
  }
}

export function assertLoopbackHost(host) {
  const normalized = String(host || '').trim().toLowerCase();
  if (!LOOPBACK_HOSTS.has(normalized)) {
    throw guardError(
      'NON_LOOPBACK_BIND_BLOCKED',
      'PLC Review Assistant may only bind to a local loopback address.',
      400
    );
  }
  return normalized;
}
