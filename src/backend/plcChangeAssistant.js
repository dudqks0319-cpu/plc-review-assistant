import { createHash } from 'node:crypto';

const SAFETY_KEYWORDS = [
  'emergency',
  'e-stop',
  'estop',
  'safety',
  'guard',
  'door',
  'light curtain',
  'sto',
  '비상',
  '비상정지',
  '안전',
  '도어',
  '라이트커튼',
  '가드'
];

const UNSAFE_ACTION_KEYWORDS = [
  'bypass',
  'ignore',
  'disable',
  'remove',
  'override',
  'force',
  '우회',
  '무시',
  '해제',
  '제거',
  '비활성',
  '강제',
  '건너'
];

const START_KEYWORDS = ['start', 'enable', 'auto', 'run', 'sensor', 'detect', '시작', '기동', '자동', '감지', '센서'];
const STOP_KEYWORDS = ['stop', 'emergency', 'overload', 'fault', 'alarm', 'door', '정지', '비상', '과부하', '알람', '도어'];

const VENDOR_PROFILES = {
  siemens: {
    id: 'siemens-plc-change-assistant',
    title: 'Siemens PLC 분석 및 회로수정',
    patchType: 'SCL/SimaticML patch candidate',
    timerPreset: (seconds) => `T#${seconds}S`,
    simulator: 'S7-PLCSIM Advanced scenario candidate',
    manualSteps: [
      'TIA Portal에서 오프라인 프로젝트를 백업합니다.',
      'TIA Portal Openness 또는 수동 import로 후보 패치를 별도 브랜치/복사본에 반영합니다.',
      'Compile API 또는 TIA Portal UI에서 컴파일 결과를 확인합니다.',
      'S7-PLCSIM Advanced에서 생성된 테스트 시나리오를 실행합니다.',
      '자격 있는 PLC 엔지니어가 승인한 뒤 현장 검증 절차로 이동합니다.'
    ]
  },
  mitsubishi: {
    id: 'mitsubishi-change-assistant',
    title: 'Mitsubishi 분석 및 회로수정',
    patchType: 'GX Works ladder CSV/listing patch candidate',
    timerPreset: (seconds) => `K${Math.round(seconds * 10)}`,
    simulator: 'GX Works3 Simulator scenario candidate',
    manualSteps: [
      'GX Works3 프로젝트와 export 파일을 백업합니다.',
      'Ladder CSV/listing 후보를 검토하고 GX Works3에서 별도 복사본에 반영합니다.',
      'GX Works3의 프로그램 체크와 변환/빌드 결과를 확인합니다.',
      'GX Works3 Simulator에서 생성된 테스트 시나리오를 실행합니다.',
      '자격 있는 PLC 엔지니어가 승인한 뒤 현장 검증 절차로 이동합니다.'
    ]
  }
};

function makeId(prefix, ...parts) {
  const hash = createHash('sha1').update(parts.filter(Boolean).join('|')).digest('hex').slice(0, 10);
  return `${prefix}-${hash}`;
}

function safeFilename(value, fallback = 'plc-program') {
  const base = safeString(value, fallback, 160)
    .split(/[\\/]/)
    .pop()
    .replace(/\.[^.]+$/, '')
    .replace(/[^A-Za-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '');

  return base || fallback;
}

function safeString(value, fallback = '', maxLength = 1000) {
  if (typeof value !== 'string') {
    return fallback;
  }

  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, maxLength) : fallback;
}

function lower(value = '') {
  return safeString(value, '').toLowerCase();
}

function includesAny(value, keywords) {
  const normalized = lower(value);
  return keywords.some((keyword) => normalized.includes(keyword.toLowerCase()));
}

function displayElement(element) {
  if (!element) {
    return 'Unknown_Output';
  }

  return element.address || element.name || element.owner || 'Unknown_Output';
}

function siemensOperand(element) {
  if (!element) {
    return 'Target_Output';
  }

  return element.name || (element.address ? `%${element.address}` : 'Target_Output');
}

function mitsubishiOperand(element) {
  if (!element) {
    return 'Y0';
  }

  return element.address || element.name || 'Y0';
}

function isOutputElement(element) {
  return element?.direction === 'output' || /^[QY]/i.test(element?.address || '');
}

function isInputElement(element) {
  return element?.direction === 'input' || /^[IX]/i.test(element?.address || '');
}

function allElements(project) {
  const variables = Array.isArray(project?.variables) ? project.variables : [];
  const ioAddresses = Array.isArray(project?.ioAddresses) ? project.ioAddresses : [];
  return [
    ...variables.map((item) => ({ ...item, kind: item.kind || 'variable' })),
    ...ioAddresses.map((item) => ({
      name: item.owner,
      address: item.address,
      direction: item.direction,
      comment: '',
      kind: 'io-address'
    }))
  ];
}

function scoreElementForRequest(element, requestText, keywords) {
  const haystack = [element.name, element.address, element.comment, element.owner].filter(Boolean).join(' ');
  let score = 0;

  if (element.address && lower(requestText).includes(lower(element.address))) {
    score += 8;
  }

  if (element.name && lower(requestText).includes(lower(element.name))) {
    score += 7;
  }

  if (includesAny(haystack, keywords)) {
    score += 3;
  }

  if (element.comment && includesAny(element.comment, keywords)) {
    score += 2;
  }

  return score;
}

function findTargetOutput(project, requestText) {
  const outputs = allElements(project).filter(isOutputElement);
  const scored = outputs
    .map((element) => ({
      element,
      score: scoreElementForRequest(element, requestText, ['motor', 'conveyor', 'pump', 'valve', 'coil', '모터', '컨베이어', '펌프', '밸브', '출력'])
    }))
    .sort((a, b) => b.score - a.score);

  const best = scored.find((item) => item.score > 0) || scored[0];
  if (!best) {
    return {
      name: 'Target_Output',
      address: '',
      confidence: 0.2,
      reason: '출력 후보를 찾지 못해 사용자가 확인해야 합니다.'
    };
  }

  return {
    ...best.element,
    confidence: Math.min(0.95, 0.45 + best.score / 12),
    reason: best.score > 0 ? '요구사항 텍스트와 PLC 출력 후보가 일치합니다.' : '분석된 출력 중 첫 번째 후보입니다.'
  };
}

function findConditionElements(project, requestText, kind) {
  const keywords = kind === 'stop' ? STOP_KEYWORDS : START_KEYWORDS;
  const elements = allElements(project)
    .filter((element) => (kind === 'stop' ? true : isInputElement(element)))
    .map((element) => ({
      element,
      score: scoreElementForRequest(element, requestText, keywords)
    }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5)
    .map((item) => ({
      ...item.element,
      confidence: Math.min(0.95, 0.4 + item.score / 12)
    }));

  if (elements.length > 0) {
    return elements;
  }

  return allElements(project)
    .filter((element) => (kind === 'stop' ? includesAny(`${element.name} ${element.comment}`, STOP_KEYWORDS) : isInputElement(element)))
    .slice(0, 3)
    .map((element) => ({ ...element, confidence: 0.35 }));
}

function extractDelaySeconds(requestText) {
  const match = requestText.match(/(\d+(?:\.\d+)?)\s*(초|s|sec|secs|second|seconds)/i);
  if (!match) {
    return 0;
  }

  return Number(match[1]);
}

function unsafeModificationRequested(requestText) {
  const normalized = lower(requestText);
  return SAFETY_KEYWORDS.some((safetyKeyword) =>
    UNSAFE_ACTION_KEYWORDS.some((actionKeyword) => {
      const safety = safetyKeyword.toLowerCase();
      const action = actionKeyword.toLowerCase();
      return (
        normalized.includes(safety) &&
        normalized.includes(action) &&
        Math.abs(normalized.indexOf(safety) - normalized.indexOf(action)) < 48
      );
    })
  );
}

function scoreCandidateLocations(project, targetOutput, startConditions, stopConditions) {
  const blocks = Array.isArray(project?.blocks) ? project.blocks : [];
  const terms = [targetOutput, ...startConditions, ...stopConditions]
    .flatMap((item) => [item?.name, item?.address, item?.comment])
    .filter(Boolean);

  return blocks
    .map((block) => {
      const blockText = `${block.name} ${block.type} ${block.comment}`;
      const matchedTerms = terms.filter((term) => lower(blockText).includes(lower(term)));
      const typeScore = ['PROGRAM', 'FB', 'FC', 'OB'].includes(block.type) ? 2 : 1;
      const score = typeScore + matchedTerms.length * 2 + (block.protected ? -20 : 0);
      return {
        blockName: block.name,
        blockType: block.type,
        protected: block.protected,
        score,
        reasons:
          matchedTerms.length > 0
            ? matchedTerms.slice(0, 4).map((term) => `${term} 관련 명칭이 블록 정보와 일치합니다.`)
            : ['분석된 블록 중 수정 후보로 검토할 수 있습니다.']
      };
    })
    .filter((candidate) => !candidate.protected)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3)
    .map((candidate, index) => ({
      rank: index + 1,
      ...candidate
    }));
}

function conditionExpression(elements, vendor) {
  const operands = elements.map((element) => (vendor === 'siemens' ? siemensOperand(element) : mitsubishiOperand(element)));
  return operands.length > 0 ? operands.join(' AND ') : 'Start_Enable';
}

function negatedStopExpression(elements, vendor) {
  const operands = elements.map((element) => (vendor === 'siemens' ? `NOT ${siemensOperand(element)}` : `ANI ${mitsubishiOperand(element)}`));
  return operands.length > 0 ? operands.join(vendor === 'siemens' ? ' AND ' : '\n') : vendor === 'siemens' ? 'Stop_Clear' : 'ANI Stop_Clear';
}

function createSiemensPatch(requirement, targetOutput, startConditions, stopConditions) {
  const delay = requirement.delaySeconds || 0;
  const timerName = `${targetOutput.name || 'Target'}_DelayTON`.replace(/[^A-Za-z0-9_]/g, '_');
  const startExpression = conditionExpression(startConditions, 'siemens');
  const stopExpression = negatedStopExpression(stopConditions, 'siemens');
  const target = siemensOperand(targetOutput);
  const timerPreset = VENDOR_PROFILES.siemens.timerPreset(delay || 1);
  const sclPatch =
    delay > 0
      ? `${timerName}(IN := ${startExpression} AND ${stopExpression}, PT := ${timerPreset});\n${target} := ${timerName}.Q AND ${stopExpression};`
      : `${target} := ${startExpression} AND ${stopExpression};`;

  return [
    {
      name: 'SCL patch candidate',
      language: 'SCL',
      content: sclPatch
    },
    {
      name: 'SimaticML patch note',
      language: 'XML',
      content: '<!-- Candidate only: import into an offline TIA Portal project after engineer review. -->'
    }
  ];
}

function createMitsubishiPatch(requirement, targetOutput, startConditions, stopConditions) {
  const delay = requirement.delaySeconds || 0;
  const timerDevice = 'T200';
  const startLines = startConditions.map((element, index) => `${index === 0 ? 'LD' : 'AND'} ${mitsubishiOperand(element)}`);
  const stopLines = stopConditions.map((element) => `ANI ${mitsubishiOperand(element)}`);
  const target = mitsubishiOperand(targetOutput);
  const timerPreset = VENDOR_PROFILES.mitsubishi.timerPreset(delay || 1);
  const listing =
    delay > 0
      ? [...startLines, ...stopLines, `OUT ${timerDevice} ${timerPreset}`, `LD ${timerDevice}`, ...stopLines, `OUT ${target}`].join('\n')
      : [...startLines, ...stopLines, `OUT ${target}`].join('\n');

  return [
    {
      name: 'Ladder listing patch candidate',
      language: 'GX Works listing',
      content: listing
    },
    {
      name: 'Ladder CSV patch candidate',
      language: 'CSV',
      content: listing
        .split('\n')
        .map((line, index) => `${index + 1},"${line.replaceAll('"', '""')}"`)
        .join('\n')
    }
  ];
}

function insertSiemensCandidateIntoSource(sourceContent, patchArtifacts) {
  const sclPatch = patchArtifacts.find((artifact) => artifact.language === 'SCL')?.content || '';
  const candidateComment = [
    '<!--',
    'PLC Change Assistant candidate patch.',
    'Review in an offline TIA Portal project. Do not import into a live PLC without engineering approval.',
    sclPatch,
    '-->'
  ].join('\n');

  if (/<\/Document>\s*$/i.test(sourceContent)) {
    return sourceContent.replace(/<\/Document>\s*$/i, `${candidateComment}\n</Document>\n`);
  }

  return `${sourceContent.trimEnd()}\n\n// PLC Change Assistant candidate patch\n${sclPatch}\n`;
}

function insertMitsubishiCandidateIntoSource(sourceContent, patchArtifacts) {
  const listing = patchArtifacts.find((artifact) => artifact.language === 'GX Works listing')?.content || '';
  return [
    sourceContent.trimEnd(),
    '',
    '; PLC Change Assistant candidate patch',
    '; Review in GX Works3 offline project before any field use.',
    listing,
    ''
  ].join('\n');
}

function createUnifiedDiff({ filename, sourceContent, modifiedContent }) {
  const beforeLines = sourceContent.split(/\r\n|\n|\r/);
  const afterLines = modifiedContent.split(/\r\n|\n|\r/);
  const commonPrefixLength = beforeLines.findIndex((line, index) => line !== afterLines[index]);
  const diffStart = commonPrefixLength === -1 ? beforeLines.length : commonPrefixLength;
  const removed = beforeLines.slice(diffStart);
  const added = afterLines.slice(diffStart);

  return [
    `--- ${filename}`,
    `+++ ${filename}.candidate`,
    `@@ -${diffStart + 1},${Math.max(removed.length, 1)} +${diffStart + 1},${Math.max(added.length, 1)} @@`,
    ...removed.map((line) => `-${line}`),
    ...added.map((line) => `+${line}`),
    ''
  ].join('\n');
}

function createCandidateFiles({ sourceContent, sourceFilename, vendor, patchArtifacts, blockedReason, normalizedRequirement, simulation }) {
  if (blockedReason) {
    return [];
  }

  const originalContent = safeString(sourceContent, '', 5_000_000);
  const baseName = safeFilename(sourceFilename);
  const modifiedContent =
    vendor === 'siemens'
      ? insertSiemensCandidateIntoSource(originalContent, patchArtifacts)
      : insertMitsubishiCandidateIntoSource(originalContent, patchArtifacts);
  const modifiedExtension = vendor === 'siemens' ? 'candidate.xml' : 'candidate.lst';
  const patchFileExtension = vendor === 'siemens' ? 'candidate.scl' : 'candidate.csv';
  const primaryPatch = patchArtifacts[0]?.content || '';
  const secondaryPatch = patchArtifacts[1]?.content || '';
  const changePlanJson = JSON.stringify(
    {
      targetBehavior: normalizedRequirement.targetBehavior,
      targetOutput: normalizedRequirement.targetOutput,
      delaySeconds: normalizedRequirement.delaySeconds,
      priorityRules: normalizedRequirement.priorityRules,
      simulation
    },
    null,
    2
  );

  return [
    {
      id: makeId('file', baseName, vendor, 'modified'),
      filename: `${baseName}.${modifiedExtension}`,
      label: '수정 후보 프로그램',
      mimeType: 'text/plain; charset=utf-8',
      content: modifiedContent
    },
    {
      id: makeId('file', baseName, vendor, 'patch'),
      filename: `${baseName}.${patchFileExtension}`,
      label: vendor === 'siemens' ? 'SCL 패치 후보' : 'Ladder CSV 패치 후보',
      mimeType: 'text/plain; charset=utf-8',
      content: vendor === 'siemens' ? primaryPatch : secondaryPatch || primaryPatch
    },
    {
      id: makeId('file', baseName, vendor, 'diff'),
      filename: `${baseName}.candidate.diff`,
      label: '수정 전후 diff',
      mimeType: 'text/x-diff; charset=utf-8',
      content: createUnifiedDiff({
        filename: sourceFilename || `${baseName}.txt`,
        sourceContent: originalContent,
        modifiedContent
      })
    },
    {
      id: makeId('file', baseName, vendor, 'json'),
      filename: `${baseName}.change-plan.json`,
      label: '변경 계획 JSON',
      mimeType: 'application/json; charset=utf-8',
      content: changePlanJson
    }
  ];
}

function createExpectedBehavior(requirement) {
  const delay = requirement.delaySeconds;
  const target = displayElement(requirement.targetOutput);

  if (delay > 0) {
    return [
      `기동 조건이 ON 되어도 ${target} 출력은 즉시 ON 되지 않습니다.`,
      `기동 조건이 ${delay}초 동안 유지되면 타이머 완료 후 ${target} 출력이 ON 되는 후보안입니다.`,
      `${delay}초 전에 기동 조건이 해제되면 타이머는 reset 되는 것으로 검증합니다.`,
      '정지/비상정지/과부하/도어 등 stop 조건은 타이머 상태보다 우선하여 출력을 OFF 해야 합니다.'
    ];
  }

  return [
    `${target} 출력은 기동 조건과 기존 stop 인터락 조건을 모두 만족할 때만 ON 되는 후보안입니다.`,
    '정지/비상정지/과부하/도어 등 stop 조건은 기동 조건보다 우선해야 합니다.'
  ];
}

function createTestCases(requirement) {
  const delay = requirement.delaySeconds || 0;
  return [
    {
      name: 'start condition OFF keeps output OFF',
      inputs: { startCondition: false, stopCondition: false, safetyCondition: false, elapsedSeconds: 0 },
      expectedOutput: false
    },
    {
      name: delay > 0 ? 'start before delay keeps output OFF' : 'start condition ON turns output ON',
      inputs: {
        startCondition: true,
        stopCondition: false,
        safetyCondition: false,
        elapsedSeconds: delay > 0 ? Math.max(0, delay - 0.1) : 0
      },
      expectedOutput: delay === 0
    },
    {
      name: delay > 0 ? 'start after delay turns output ON' : 'stop priority still required',
      inputs: { startCondition: true, stopCondition: false, safetyCondition: false, elapsedSeconds: delay },
      expectedOutput: true
    },
    {
      name: 'stop condition overrides output',
      inputs: { startCondition: true, stopCondition: true, safetyCondition: false, elapsedSeconds: delay },
      expectedOutput: false
    },
    {
      name: 'safety condition overrides output',
      inputs: { startCondition: true, stopCondition: false, safetyCondition: true, elapsedSeconds: delay },
      expectedOutput: false
    }
  ];
}

function runBuiltInHarness(requirement, blockedReason) {
  if (blockedReason) {
    return {
      harness: 'built-in-static-timer-harness',
      result: 'blocked',
      blockedReason,
      timeline: [],
      truthTable: []
    };
  }

  const delay = requirement.delaySeconds || 0;
  const testCases = createTestCases(requirement);
  const timeline = testCases.map((testCase) => {
    const { startCondition, stopCondition, safetyCondition, elapsedSeconds } = testCase.inputs;
    const output = startCondition && !stopCondition && !safetyCondition && elapsedSeconds >= delay;
    return {
      name: testCase.name,
      elapsedSeconds,
      output,
      pass: output === testCase.expectedOutput
    };
  });

  return {
    harness: 'built-in-static-timer-harness',
    result: timeline.every((item) => item.pass) ? 'pass' : 'fail',
    timerPresetSeconds: delay,
    timeline,
    truthTable: [
      { start: false, stop: false, safety: false, delayElapsed: false, output: false },
      { start: true, stop: false, safety: false, delayElapsed: false, output: delay === 0 },
      { start: true, stop: false, safety: false, delayElapsed: true, output: true },
      { start: true, stop: true, safety: false, delayElapsed: true, output: false },
      { start: true, stop: false, safety: true, delayElapsed: true, output: false }
    ]
  };
}

function riskLevel(requestText, blockedReason, stopConditions) {
  if (blockedReason) {
    return 'blocked';
  }

  if (includesAny(requestText, SAFETY_KEYWORDS) || stopConditions.some((condition) => includesAny(`${condition.name} ${condition.comment}`, SAFETY_KEYWORDS))) {
    return 'high';
  }

  return 'medium';
}

export function createChangePlan({ analysis, vendor, requestText, sourceContent = '', sourceFilename = '' }) {
  const selectedVendor = vendor === 'mitsubishi' ? 'mitsubishi' : 'siemens';
  const profile = VENDOR_PROFILES[selectedVendor];
  const project = analysis?.project || {};
  const request = safeString(requestText, '', 4000);

  if (!request) {
    throw new Error('회로수정 요청 내용이 필요합니다.');
  }

  const targetOutput = findTargetOutput(project, request);
  const startConditions = findConditionElements(project, request, 'start');
  const stopConditions = findConditionElements(project, request, 'stop');
  const delaySeconds = extractDelaySeconds(request);
  const blockedReason = unsafeModificationRequested(request)
    ? '안전회로 또는 비상정지 조건을 우회/제거/무시하는 변경으로 해석되어 자동 패치 생성을 중단했습니다.'
    : null;
  const normalizedRequirement = {
    userRequest: request,
    targetBehavior:
      delaySeconds > 0
        ? `${displayElement(targetOutput)} ${delaySeconds}초 지연 기동 후보`
        : `${displayElement(targetOutput)} 제어 조건 변경 후보`,
    targetOutput,
    delaySeconds,
    startConditions,
    stopConditions,
    priorityRules: ['stop_conditions_override_start', 'existing_safety_interlocks_must_remain'],
    safetyNote: '비상정지와 안전회로는 PLC 로직 자동수정 대상이 아니며 기존 안전 절차를 유지해야 합니다.'
  };
  const candidateLocations = scoreCandidateLocations(project, targetOutput, startConditions, stopConditions);
  const patchArtifacts =
    blockedReason === null
      ? selectedVendor === 'siemens'
        ? createSiemensPatch(normalizedRequirement, targetOutput, startConditions, stopConditions)
        : createMitsubishiPatch(normalizedRequirement, targetOutput, startConditions, stopConditions)
      : [];
  const expectedBehavior = createExpectedBehavior(normalizedRequirement);
  const testCases = createTestCases(normalizedRequirement);
  const simulation = runBuiltInHarness(normalizedRequirement, blockedReason);
  const risk = riskLevel(request, blockedReason, stopConditions);
  const candidateFiles = createCandidateFiles({
    sourceContent,
    sourceFilename: sourceFilename || project?.source?.filename || 'plc-program.txt',
    vendor: selectedVendor,
    patchArtifacts,
    blockedReason,
    normalizedRequirement,
    simulation
  });

  return {
    id: makeId('change', analysis?.id || project?.id || 'analysis', selectedVendor, request),
    version: profile.id,
    title: profile.title,
    vendor: selectedVendor,
    normalizedRequirement,
    affectedElements: [
      {
        kind: 'target-output',
        name: targetOutput.name || targetOutput.owner || '',
        address: targetOutput.address || '',
        confidence: targetOutput.confidence,
        reason: targetOutput.reason
      },
      ...startConditions.map((condition) => ({
        kind: 'start-condition',
        name: condition.name || condition.owner || '',
        address: condition.address || '',
        confidence: condition.confidence,
        reason: '기동 조건 후보입니다.'
      })),
      ...stopConditions.map((condition) => ({
        kind: 'stop-condition',
        name: condition.name || condition.owner || '',
        address: condition.address || '',
        confidence: condition.confidence,
        reason: '정지/인터락 조건 후보입니다.'
      }))
    ],
    candidateLocations,
    recommendedPatch: {
      status: blockedReason ? 'blocked' : 'candidate',
      patchType: profile.patchType,
      title: blockedReason ? '자동 패치 생성 중단' : `${profile.patchType} 생성`,
      summary: blockedReason
        ? blockedReason
        : '벤더 툴의 오프라인 프로젝트 복사본에 반영하기 위한 후보 패치입니다. 실제 PLC에는 자동 적용하지 않습니다.',
      patchArtifacts,
      manualSteps: profile.manualSteps,
      engineerReviewRequired: true,
      blockedReason
    },
    candidateFiles,
    beforeAfterDiff: [
      {
        area: displayElement(targetOutput),
        before: '기존 로직의 직접 출력 조건 또는 현재 export 기준 동작을 유지합니다.',
        after:
          delaySeconds > 0
            ? `${delaySeconds}초 TON 지연 조건과 stop 우선 조건을 추가하는 후보안입니다.`
            : '기동 조건과 stop 우선 조건을 명확히 분리하는 후보안입니다.'
      }
    ],
    expectedBehavior,
    testCases,
    simulation,
    riskLevel: risk,
    simulatorTarget: profile.simulator,
    approvalsRequired:
      risk === 'high' || risk === 'blocked'
        ? ['안전 담당자', 'PLC 담당자', '현장 책임자']
        : ['PLC 담당자', '현장 책임자'],
    warnings: [
      '생성된 내용은 수정 후보이며 실제 설비 동작 보증이 아닙니다.',
      '벤더 툴 컴파일, 시뮬레이터 검증, 현장 검증을 모두 통과해야 합니다.',
      '보호 블록, 암호화 블록, 안전회로는 자동수정하지 않습니다.'
    ]
  };
}

export { VENDOR_PROFILES };
