import { normalizeRequirementWithCodexAppServer } from './codexAppServerClient.js';
import { validateNormalizedRequirement } from './safetyValidator.js';

function safeString(value, fallback = '', maxLength = 1000) {
  if (typeof value !== 'string') {
    return fallback;
  }

  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, maxLength) : fallback;
}

function extractDelaySeconds(requestText) {
  const match = safeString(requestText).match(/(\d+(?:\.\d+)?)\s*(초|s|sec|secs|second|seconds)/i);
  return match ? Number(match[1]) : 0;
}

function fallbackRequirement({ requestText }) {
  const delaySeconds = extractDelaySeconds(requestText);
  return {
    targetBehavior: delaySeconds > 0 ? `${delaySeconds}초 지연 동작 후보` : 'PLC 출력 조건 변경 후보',
    targetOutput: { name: '', address: '', confidence: 0 },
    delaySeconds,
    startConditions: [],
    stopConditions: [],
    priorityRules: ['stop_conditions_override_start', 'existing_safety_interlocks_must_remain'],
    safetyNotes: ['비상정지와 안전회로는 자동수정하지 않습니다.'],
    uncertainties: ['Codex 정규화가 비활성화되었거나 실패하면 규칙 기반 파서로 보완합니다.']
  };
}

function isCodexEnabled(env = process.env) {
  return ['1', 'true', 'app-server', 'on'].includes(String(env.PLC_CODEX_REQUIREMENT_NORMALIZER || '').toLowerCase());
}

export async function normalizeChangeRequirement({ analysis, vendor, requestText, env = process.env }) {
  const request = safeString(requestText, '', 4000);
  if (!request) {
    throw new Error('회로수정 요청 내용이 필요합니다.');
  }

  if (isCodexEnabled(env)) {
    try {
      const codexResult = await normalizeRequirementWithCodexAppServer({ analysis, vendor, requestText: request, env });
      const validation = validateNormalizedRequirement({
        requestText: request,
        normalizedRequirement: codexResult.requirement
      });

      return {
        source: codexResult.source,
        requirement: codexResult.requirement,
        validation,
        fallbackReason: null
      };
    } catch (error) {
      const requirement = fallbackRequirement({ requestText: request });
      return {
        source: 'deterministic-fallback',
        requirement,
        validation: validateNormalizedRequirement({ requestText: request, normalizedRequirement: requirement }),
        fallbackReason: error instanceof Error ? error.message : 'Codex normalization failed'
      };
    }
  }

  const requirement = fallbackRequirement({ requestText: request });
  return {
    source: 'deterministic-fallback',
    requirement,
    validation: validateNormalizedRequirement({ requestText: request, normalizedRequirement: requirement }),
    fallbackReason: 'Codex requirement normalizer is disabled'
  };
}
