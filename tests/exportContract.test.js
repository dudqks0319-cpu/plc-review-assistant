import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createAttachmentContentDisposition,
  createDownloadArtifact,
  normalizeDownloadFilename,
  parseContentDispositionFilename,
  serializeCsv
} from '../public/exportContract.js';
import {
  createLargeWindowsCsvRows,
  WINDOWS_CSV_FIXTURE
} from './fixtures/export/windowsCsvFixture.js';

const UTF8_BOM = Buffer.from([0xef, 0xbb, 0xbf]);

test('Windows CSV fixture fixes UTF-8 BOM, CRLF, escaping, and safe Unicode filename bytes', () => {
  const content = serializeCsv(WINDOWS_CSV_FIXTURE.rows);
  const artifact = createDownloadArtifact({
    filename: WINDOWS_CSV_FIXTURE.filename,
    mimeType: 'text/csv; charset=utf-8',
    content
  });
  const bytes = Buffer.from(artifact.bytes);

  assert.equal(content, WINDOWS_CSV_FIXTURE.expectedText);
  assert.equal(artifact.filename, WINDOWS_CSV_FIXTURE.expectedFilename);
  assert.equal(artifact.mimeType, 'text/csv; charset=utf-8');
  assert.deepEqual(bytes.subarray(0, 3), UTF8_BOM);
  assert.equal(bytes.subarray(3).toString('utf8'), WINDOWS_CSV_FIXTURE.expectedText);
  assert.equal(bytes.includes(Buffer.from('\r\n', 'utf8')), true);
  assert.equal(bytes.includes(Buffer.from('\n', 'utf8')), true);
});

test('zero-row CSV remains an explicit Excel-compatible UTF-8 artifact', () => {
  const artifact = createDownloadArtifact({
    filename: '빈 결과.csv',
    mimeType: 'text/csv',
    content: serializeCsv([])
  });

  assert.equal(serializeCsv([]), '');
  assert.deepEqual(Buffer.from(artifact.bytes), UTF8_BOM);
  assert.equal(artifact.filename, '빈 결과.csv');
});

test('repeated CSV preparation keeps exactly one BOM', () => {
  const artifact = createDownloadArtifact({
    filename: '중복 export.csv',
    mimeType: 'text/csv; charset=utf-8',
    content: `\uFEFF${serializeCsv([['번호', '명령'], [1, 'END']])}`
  });
  const bytes = Buffer.from(artifact.bytes);

  assert.deepEqual(bytes.subarray(0, 3), UTF8_BOM);
  assert.notDeepEqual(bytes.subarray(3, 6), UTF8_BOM);
  assert.equal(bytes.subarray(3).toString('utf8'), '번호,명령\r\n1,END');
});

test('large CSV fixture is not truncated and preserves its final multiline Korean field', () => {
  const rows = createLargeWindowsCsvRows();
  const content = serializeCsv(rows);
  const artifact = createDownloadArtifact({
    filename: '대용량 검토 (20,000건).csv',
    mimeType: 'text/csv; charset=utf-8',
    content
  });
  const decoded = Buffer.from(artifact.bytes).subarray(3).toString('utf8');

  assert.equal(rows.length, 20_001);
  assert.equal(decoded, content);
  assert.match(decoded, /20000,OUT Y19999,"대용량 fixture 19999, ""손실 없음""\r\n재검토"$/);
  assert.equal(artifact.bytes.byteLength > 1_000_000, true);
});

test('download filenames preserve Korean, English, spaces, and parentheses without path injection', () => {
  assert.equal(
    normalizeDownloadFilename('..\\..//한글 English (검토):A?*.CSV', {
      extension: 'csv',
      fallbackBase: 'plc-change-candidate'
    }),
    '한글 English (검토)-A.csv'
  );
  assert.equal(
    normalizeDownloadFilename('CON.txt', { extension: 'txt' }),
    '_CON.txt'
  );
  assert.equal(
    normalizeDownloadFilename('safe.csv.exe', { extension: 'csv' }),
    'safe.csv.csv'
  );
});

test('Content-Disposition decoding rejects separators and enforces the requested extension', () => {
  const disposition =
    "attachment; filename=\"plc-review.xls\"; filename*=UTF-8''..%2F%ED%95%9C%EA%B8%80%20Review%20(A).xls";

  assert.equal(
    parseContentDispositionFilename(disposition, {
      extension: 'xls',
      fallbackBase: 'plc-review'
    }),
    '한글 Review (A).xls'
  );
  assert.equal(
    parseContentDispositionFilename(
      "attachment; filename=\"..\\\\escape.pdf\"; filename*=UTF-8''%E0%A4%A",
      { extension: 'pdf', fallbackBase: 'plc-review' }
    ),
    'escape.pdf'
  );
});

test('Content-Disposition generation cannot inject response headers', () => {
  const disposition = createAttachmentContentDisposition(
    '../한글 보고서 (A)\r\nX-Evil: yes.xls'
  );

  assert.equal(disposition.includes('\r'), false);
  assert.equal(disposition.includes('\n'), false);
  assert.match(disposition, /^attachment; filename="[^"]+"; filename\*=UTF-8''/);
  assert.equal(
    parseContentDispositionFilename(disposition, {
      extension: 'xls',
      fallbackBase: 'plc-review'
    }),
    '한글 보고서 (A)-X-Evil- yes.xls'
  );
});
