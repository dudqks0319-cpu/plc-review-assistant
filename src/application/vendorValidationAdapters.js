const MANUAL_LEVELS = new Set(['V7', 'V8', 'V9', 'V10']);
const VALIDATION_STATUSES = new Set([
  'pass',
  'fail',
  'warning',
  'not-run',
  'not-applicable'
]);
const APPROVAL_REVIEWER_ROLES = new Set([
  'plc-engineer',
  'safety-engineer',
  'site-owner'
]);

function validationError(message) {
  const error = new Error(message);
  error.statusCode = 400;
  error.code = 'INVALID_VALIDATION_RECORD';
  return error;
}

function boundedText(value, fallback = '', maxLength = 240) {
  if (typeof value !== 'string') return fallback;
  const normalized = value.trim();
  return normalized ? normalized.slice(0, maxLength) : fallback;
}

function isoTimestamp(value, fallback) {
  const normalized = boundedText(value, '', 64);
  if (!normalized) return fallback;
  const timestamp = new Date(normalized);
  if (Number.isNaN(timestamp.getTime())) {
    throw validationError('Validation timestamp must be a valid ISO date.');
  }
  return timestamp.toISOString();
}

function normalizeDiagnostics(diagnostics) {
  if (!Array.isArray(diagnostics)) return [];
  return diagnostics.slice(0, 32).map((diagnostic, index) => ({
    code: boundedText(diagnostic?.code, `MANUAL_DIAGNOSTIC_${index + 1}`, 80),
    severity: ['error', 'warning', 'info'].includes(diagnostic?.severity)
      ? diagnostic.severity
      : 'info',
    message: boundedText(diagnostic?.message, 'Manual validation note', 1000)
  }));
}

export function createManualValidationRecord({
  level,
  status,
  tool,
  toolVersion = '',
  diagnostics = [],
  evidenceIds = [],
  reviewerRole = '',
  startedAt,
  finishedAt
}) {
  if (!MANUAL_LEVELS.has(level)) {
    throw validationError('Manual validation level must be V7, V8, V9, or V10.');
  }
  if (!VALIDATION_STATUSES.has(status)) {
    throw validationError('Manual validation status is invalid.');
  }
  if (level !== 'V7' && status === 'not-applicable') {
    throw validationError('V8, V9, and V10 cannot be marked not-applicable.');
  }

  const fallbackTime = new Date().toISOString();
  const normalizedStartedAt = isoTimestamp(startedAt, fallbackTime);
  const normalizedFinishedAt = isoTimestamp(finishedAt, normalizedStartedAt);
  const normalizedTool = boundedText(tool, '', 120);
  if (!normalizedTool) {
    throw validationError('Manual validation tool is required.');
  }
  const normalizedEvidenceIds = [
    ...new Set(
      (Array.isArray(evidenceIds) ? evidenceIds : [])
        .slice(0, 64)
        .map((value) => boundedText(value, '', 160))
        .filter(Boolean)
    )
  ];
  const normalizedReviewerRole = boundedText(reviewerRole, '', 80);
  if (status === 'pass' && normalizedEvidenceIds.length === 0) {
    throw validationError('A manual pass record requires at least one evidence ID.');
  }
  if (
    normalizedReviewerRole &&
    !APPROVAL_REVIEWER_ROLES.has(normalizedReviewerRole)
  ) {
    throw validationError(
      'Reviewer role must be plc-engineer, safety-engineer, or site-owner.'
    );
  }
  if (level === 'V9' && status === 'pass' && !normalizedReviewerRole) {
    throw validationError('A V9 pass record requires a reviewer role.');
  }

  return {
    level,
    status,
    tool: normalizedTool,
    toolVersion: boundedText(toolVersion, '', 120) || undefined,
    startedAt: normalizedStartedAt,
    finishedAt: normalizedFinishedAt,
    diagnostics: normalizeDiagnostics(diagnostics),
    evidenceIds: normalizedEvidenceIds,
    reviewerRole: normalizedReviewerRole || undefined,
    source: 'manual-record',
    claimScope: 'external-result-record-only',
    qualificationVerified: false,
    fieldBehaviorGuaranteed: false
  };
}

export function createRecordOnlyVendorAdapter({ id, label, level }) {
  const adapterId = boundedText(id, '', 80);
  const adapterLabel = boundedText(label, '', 160);
  if (!adapterId || !adapterLabel || !MANUAL_LEVELS.has(level)) {
    throw validationError('A record-only adapter requires id, label, and a V7-V10 level.');
  }

  const notRun = () => ({
    level,
    status: 'not-run',
    tool: adapterLabel,
    diagnostics: [
      {
        code: 'MANUAL_VALIDATION_REQUIRED',
        severity: 'info',
        message: `${adapterLabel} 결과를 사용자가 검증 기록으로 추가해야 합니다.`
      }
    ],
    evidenceIds: [],
    canWriteToPlc: false,
    executesExternalProcess: false
  });

  return Object.freeze({
    id: adapterId,
    label: adapterLabel,
    level,
    canWriteToPlc: false,
    executesExternalProcess: false,
    async detectInstallation() {
      return notRun();
    },
    async validate() {
      return notRun();
    }
  });
}

export const EXTERNAL_ST_RECORD_ADAPTER = createRecordOnlyVendorAdapter({
  id: 'external-st-record',
  label: 'External ST/PLCopen validation record',
  level: 'V7'
});

export const GX_WORKS2_MANUAL_RECORD_ADAPTER = createRecordOnlyVendorAdapter({
  id: 'gxworks2-manual-record',
  label: 'GX Works2 manual program check',
  level: 'V8'
});
