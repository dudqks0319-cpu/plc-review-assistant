const WINDOWS_RESERVED_BASENAMES = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;
const SAFE_EXTENSIONS = new Set([
  'asc',
  'csv',
  'diff',
  'json',
  'lst',
  'md',
  'pdf',
  'scl',
  'txt',
  'xls',
  'xml'
]);
const UTF8_BOM = new Uint8Array([0xef, 0xbb, 0xbf]);

function safeExtension(value, fallback = 'txt') {
  const normalized = String(value || '').toLowerCase();
  return SAFE_EXTENSIONS.has(normalized) ? normalized : fallback;
}

function trimToLength(value, maxLength) {
  return Array.from(value).slice(0, maxLength).join('');
}

export function normalizeDownloadBaseName(
  value,
  { fallbackBase = 'plc-change-candidate', maxLength = 160 } = {}
) {
  const fallback = String(fallbackBase || 'plc-change-candidate')
    .normalize('NFC')
    .replace(/[<>:"/\\|?*\u0000-\u001f\u007f]+/g, '-')
    .replace(/\s+/g, ' ')
    .replace(/-+/g, '-')
    .replace(/^[ .-]+|[ .-]+$/g, '') || 'plc-change-candidate';
  const leaf = String(value || '')
    .normalize('NFC')
    .split(/[\\/]+/)
    .filter((part) => part && part !== '.' && part !== '..')
    .at(-1) || fallback;
  let base = leaf
    .replace(/\.[^.]*$/, '')
    .replace(/[<>:"/\\|?*\u0000-\u001f\u007f]+/g, '-')
    .replace(/\.{2,}/g, '-')
    .replace(/\s+/g, ' ')
    .replace(/-+/g, '-')
    .replace(/^[ .-]+|[ .-]+$/g, '');

  if (!base) base = fallback;
  if (WINDOWS_RESERVED_BASENAMES.test(base)) base = `_${base}`;

  return trimToLength(base, Math.max(1, maxLength)).replace(/[ .]+$/g, '') || fallback;
}

export function normalizeDownloadFilename(
  value,
  { extension = 'txt', fallbackBase = 'plc-change-candidate', maxLength = 180 } = {}
) {
  const safeExt = safeExtension(extension);
  const suffix = `.${safeExt}`;
  const boundedBase = normalizeDownloadBaseName(value, {
    fallbackBase,
    maxLength: Math.max(1, maxLength - suffix.length)
  });
  return `${boundedBase}${suffix}`;
}

export function createAttachmentContentDisposition(
  filename,
  { fallbackBase = 'plc-review' } = {}
) {
  const extension = safeExtension(String(filename || '').match(/\.([A-Za-z0-9]{1,10})$/)?.[1]);
  const safeFilename = normalizeDownloadFilename(filename, { extension, fallbackBase });
  const asciiBase = normalizeDownloadBaseName(
    safeFilename
      .replace(/\.[^.]+$/, '')
      .normalize('NFKD')
      .replace(/[^\x20-\x7e]/g, ''),
    { fallbackBase, maxLength: 120 }
  ).replace(/[^A-Za-z0-9 _().-]/g, '-');
  const asciiFilename = normalizeDownloadFilename(asciiBase, {
    extension,
    fallbackBase,
    maxLength: 140
  });
  const encodedFilename = encodeURIComponent(safeFilename).replace(
    /[!'()*]/g,
    (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`
  );

  return `attachment; filename="${asciiFilename}"; filename*=UTF-8''${encodedFilename}`;
}

export function parseContentDispositionFilename(
  disposition,
  { extension = 'txt', fallbackBase = 'plc-review' } = {}
) {
  const value = String(disposition || '');
  const encodedMatch = value.match(/filename\*=UTF-8''([^;]+)/i);
  const quotedMatch = value.match(/filename="([^"]+)"/i);
  const plainMatch = value.match(/filename=([^;\s]+)/i);
  let filename = quotedMatch?.[1] || plainMatch?.[1] || fallbackBase;

  if (encodedMatch) {
    try {
      filename = decodeURIComponent(encodedMatch[1]);
    } catch {
      // Use the ASCII fallback when the RFC 5987 value is malformed.
    }
  }

  return normalizeDownloadFilename(filename, { extension, fallbackBase });
}

function normalizeCsvLineEndings(value) {
  return String(value ?? '').replace(/\r\n|\r|\n/g, '\r\n');
}

function escapeCsvCell(value) {
  const normalized = normalizeCsvLineEndings(value);
  return /[",\r\n]/.test(normalized)
    ? `"${normalized.replaceAll('"', '""')}"`
    : normalized;
}

export function serializeCsv(rows) {
  if (!Array.isArray(rows)) {
    throw new TypeError('CSV rows must be an array.');
  }

  return rows
    .map((row) => {
      if (!Array.isArray(row)) {
        throw new TypeError('Each CSV row must be an array.');
      }
      return row.map(escapeCsvCell).join(',');
    })
    .join('\r\n');
}

function encodeUtf8(value) {
  return new TextEncoder().encode(value);
}

function prependBom(bytes) {
  const result = new Uint8Array(UTF8_BOM.length + bytes.length);
  result.set(UTF8_BOM, 0);
  result.set(bytes, UTF8_BOM.length);
  return result;
}

export function createDownloadArtifact(file = {}) {
  const rawFilename = String(file.filename || 'plc-change-candidate.txt');
  const filenameExtension = rawFilename.match(/\.([A-Za-z0-9]{1,10})$/)?.[1];
  const isCsv = /^text\/csv\b/i.test(String(file.mimeType || '')) ||
    String(filenameExtension || '').toLowerCase() === 'csv';
  const extension = isCsv
    ? 'csv'
    : safeExtension(filenameExtension, 'txt');
  const filename = normalizeDownloadFilename(rawFilename, {
    extension,
    fallbackBase: 'plc-change-candidate'
  });

  if (isCsv) {
    const content = normalizeCsvLineEndings(String(file.content ?? '').replace(/^\uFEFF/, ''));
    return {
      filename,
      mimeType: 'text/csv; charset=utf-8',
      bytes: prependBom(encodeUtf8(content))
    };
  }

  return {
    filename,
    mimeType: file.mimeType || 'text/plain; charset=utf-8',
    bytes: encodeUtf8(String(file.content ?? ''))
  };
}
