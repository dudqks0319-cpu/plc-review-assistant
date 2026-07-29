export const SAFETY_KEYWORDS = [
  'emergency',
  'e-stop',
  'estop',
  'safety',
  'guard',
  'door',
  'light curtain',
  'sto',
  'ss1',
  'sls',
  'safe torque off',
  'safe stop 1',
  'safely-limited speed',
  'safety door',
  'safety block',
  'protected block',
  'overload',
  '비상',
  '비상정지',
  '안전',
  '안전문',
  '안전 블록',
  '보호 블록',
  '도어',
  '라이트커튼',
  '가드',
  '과부하'
];

export const UNSAFE_ACTION_KEYWORDS = [
  'bypass',
  'ignore',
  'disable',
  'remove',
  'override',
  'force',
  'always on',
  'permanent on',
  '우회',
  '무시',
  '해제',
  '제거',
  '비활성',
  '강제',
  '상시 on',
  '항상 on',
  '항상 켜',
  '고정 on',
  '건너'
];

function normalize(value = '') {
  return String(value || '').toLowerCase();
}

function hasKeyword(text, keyword) {
  const normalizedKeyword = keyword.toLowerCase();
  if (['sto', 'ss1', 'sls'].includes(normalizedKeyword)) {
    return new RegExp(`\\b${normalizedKeyword}\\b`, 'i').test(text);
  }

  return text.includes(normalizedKeyword);
}

function explicitOutputForceRequested(text) {
  const device = String.raw`\b(?:y|q)\d+(?:\.\d+)?\b`;
  const output = String.raw`(?:출력|코일|output|coil|${device})`;
  const force = String.raw`(?:force|override|강제(?:\s*(?:on|off|켜|끄|설정))?)`;
  return (
    new RegExp(`${output}.{0,32}${force}`, 'i').test(text) ||
    new RegExp(`${force}.{0,32}${output}`, 'i').test(text)
  );
}

export function includesSafetyKeyword(value) {
  const text = normalize(value);
  return SAFETY_KEYWORDS.some((keyword) => hasKeyword(text, keyword));
}

export function unsafeModificationRequested(value) {
  const text = normalize(value);
  return (
    explicitOutputForceRequested(text) ||
    SAFETY_KEYWORDS.some((safetyKeyword) =>
      UNSAFE_ACTION_KEYWORDS.some((actionKeyword) => {
        const safety = safetyKeyword.toLowerCase();
        const action = actionKeyword.toLowerCase();
        return (
          hasKeyword(text, safety) &&
          text.includes(action) &&
          Math.abs(text.indexOf(safety) - text.indexOf(action)) < 48
        );
      })
    )
  );
}

export function validateNormalizedRequirement({ requestText, normalizedRequirement }) {
  const reasons = [];
  const combined = [
    requestText,
    normalizedRequirement?.targetBehavior,
    normalizedRequirement?.uncertainties?.join(' ')
  ].join(' ');

  if (unsafeModificationRequested(combined)) {
    reasons.push('안전회로 또는 비상정지 조건을 우회/제거/무시하는 변경으로 해석되었습니다.');
  }

  if (normalizedRequirement?.priorityRules?.some((rule) => /start.*override.*stop|기동.*우선/i.test(String(rule)))) {
    reasons.push('기동 조건이 정지 조건보다 우선하는 규칙은 허용되지 않습니다.');
  }

  return {
    ok: reasons.length === 0,
    reasons
  };
}
