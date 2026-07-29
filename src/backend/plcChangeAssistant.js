import { createHash } from 'node:crypto';
import {
  includesSafetyKeyword,
  unsafeModificationRequested as deterministicUnsafeModificationRequested
} from './safetyValidator.js';

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

const START_KEYWORDS = [
  'start',
  'enable',
  'trigger',
  'edge',
  'alarm',
  'auto',
  'run',
  'sensor',
  'detect',
  '시작',
  '기동',
  '허가',
  '트리거',
  '엣지',
  '알람',
  '경보',
  '자동',
  '감지',
  '센서'
];
const STOP_KEYWORDS = [
  'stop',
  'reset',
  'emergency',
  'overload',
  'fault',
  'alarm',
  'door',
  '정지',
  '리셋',
  '복귀',
  '비상',
  '과부하',
  '알람',
  '도어'
];

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
    title: 'Mitsubishi GX Works2/GX Works 분석 및 회로수정',
    patchType: 'GX Works2 ladder instruction/listing patch candidate',
    timerPreset: (seconds) => `K${Math.round(seconds * 10)}`,
    simulator: 'GX Works2/GX Simulator scenario candidate',
    manualSteps: [
      'GX Works2 프로젝트와 export 파일을 백업합니다.',
      'GX Works2 Ladder/Instruction List 후보를 검토하고 별도 복사본에 반영합니다.',
      'GX Works2의 프로그램 체크와 변환/빌드 결과를 확인합니다.',
      'GX Simulator 또는 현장 표준 시뮬레이션 절차에서 생성된 테스트 시나리오를 실행합니다.',
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

function nearestKeywordDistance(requestText, element, keywords) {
  const request = lower(requestText);
  const identifiers = [element?.address, element?.name, element?.owner]
    .map((value) => lower(value))
    .filter(Boolean);
  let nearest = Number.POSITIVE_INFINITY;
  for (const identifier of identifiers) {
    let index = request.indexOf(identifier);
    while (index >= 0) {
      for (const keyword of keywords) {
        let keywordIndex = request.indexOf(keyword.toLowerCase());
        while (keywordIndex >= 0) {
          nearest = Math.min(nearest, Math.abs(keywordIndex - index));
          keywordIndex = request.indexOf(keyword.toLowerCase(), keywordIndex + 1);
        }
      }
      index = request.indexOf(identifier, index + identifier.length);
    }
  }
  return nearest;
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

function findConditionElements(project, requestText, kind, excludedAddresses = []) {
  const keywords = kind === 'stop' ? STOP_KEYWORDS : START_KEYWORDS;
  const oppositeKeywords = kind === 'stop' ? START_KEYWORDS : STOP_KEYWORDS;
  const excluded = new Set(excludedAddresses.filter(Boolean).map((address) => lower(address)));
  const requestHasCategory = includesAny(requestText, keywords);
  const elements = allElements(project)
    .filter(
      (element) =>
        !excluded.has(lower(element.address)) &&
        !isOutputElement(element) &&
        (kind === 'stop' || isInputElement(element))
    )
    .map((element) => {
      const labelText = `${element.name || ''} ${element.comment || ''} ${element.owner || ''}`;
      const semanticLabel = includesAny(labelText, keywords);
      const categoryDistance = nearestKeywordDistance(
        requestText,
        element,
        keywords
      );
      const oppositeDistance = nearestKeywordDistance(
        requestText,
        element,
        oppositeKeywords
      );
      const contextualMention =
        categoryDistance <= 32 && categoryDistance < oppositeDistance;
      return {
        element,
        score: scoreElementForRequest(element, requestText, keywords),
        eligible:
          contextualMention ||
          (semanticLabel && (kind === 'stop' || requestHasCategory))
      };
    })
    .filter((item) => item.eligible && item.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5)
    .map((item) => ({
      ...item.element,
      confidence: Math.min(0.95, 0.4 + item.score / 12)
    }));

  if (elements.length > 0) {
    return elements;
  }

  if (kind === 'start' && !requestHasCategory) {
    return [];
  }

  return allElements(project)
    .filter(
      (element) =>
        !excluded.has(lower(element.address)) &&
        !isOutputElement(element) &&
        includesAny(`${element.name} ${element.comment}`, keywords)
    )
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

function extractDevices(requestText, prefixes) {
  const source = safeString(requestText, '', 4000).toUpperCase();
  const pattern = new RegExp(`\\b(?:${prefixes.join('|')})\\d+[A-F0-9]*(?:\\.\\d+)?\\b`, 'gi');
  return [...new Set(source.match(pattern) || [])];
}

function pickDevice(requestText, prefixes, fallback) {
  return extractDevices(requestText, prefixes)[0] || fallback;
}

function detectCircuitKind(requestText) {
  const normalized = lower(requestText).replace(/\s+/g, '');

  if (/지연(?:off|오프)|delay[-_]?off|(?:뒤|후).{0,12}(?:꺼|off)/.test(normalized)) {
    return 'delay-off';
  }

  if (/one[-_]?shot|원샷|상승(?:엣지|edge)|하강(?:엣지|edge)|rising|falling/.test(normalized)) {
    return 'edge-one-shot';
  }

  if (/(?:alarm|알람|경보).{0,40}(?:latch|래치|유지|reset|리셋|복귀)/.test(normalized)) {
    return 'alarm-latch-reset';
  }

  if (/상호인터락|상호연동|mutualinterlock|두출력.{0,20}(?:동시|인터락)/.test(normalized)) {
    return 'mutual-interlock';
  }

  if (/debounce|디바운스|채터링|센서.{0,30}(?:흔들|노이즈|안정)/.test(normalized)) {
    return 'sensor-debounce';
  }

  if (/자기유지|자기보유|seal[-_]?in|self[-_]?hold|holding/.test(normalized)) {
    return 'self-holding';
  }

  if (/엘리베이터|승강기|elevator|lift/.test(normalized)) {
    return 'two-floor-elevator';
  }

  if (/지연|타이머|timer|delay|초/.test(normalized)) {
    return 'delayed-output';
  }

  return 'output-control';
}

function unsafeModificationRequested(requestText) {
  return deterministicUnsafeModificationRequested(requestText);
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

function collectUsedMitsubishiDevices(project, prefix) {
  const values = [
    ...(project?.variables || []).map((item) => item.address),
    ...(project?.ioAddresses || []).map((item) => item.address)
  ].filter(Boolean);
  const pattern = new RegExp(`^${prefix}(\\d+)$`, 'i');
  return new Set(
    values
      .map((value) => String(value).toUpperCase().match(pattern)?.[1])
      .filter(Boolean)
      .map(Number)
  );
}

function chooseMitsubishiTimer(project) {
  const usedTimers = collectUsedMitsubishiDevices(project, 'T');
  for (let timer = 200; timer <= 255; timer += 1) {
    if (!usedTimers.has(timer)) {
      return `T${timer}`;
    }
  }

  for (let timer = 0; timer <= 199; timer += 1) {
    if (!usedTimers.has(timer)) {
      return `T${timer}`;
    }
  }

  return 'T_UNASSIGNED';
}

function chooseMitsubishiInternal(project) {
  const usedInternals = collectUsedMitsubishiDevices(project, 'M');
  for (let relay = 200; relay <= 499; relay += 1) {
    if (!usedInternals.has(relay)) {
      return `M${relay}`;
    }
  }

  for (let relay = 0; relay <= 199; relay += 1) {
    if (!usedInternals.has(relay)) {
      return `M${relay}`;
    }
  }

  return 'M_UNASSIGNED';
}

function createMitsubishiPatch(requirement, targetOutput, startConditions, stopConditions, project) {
  const delay = requirement.delaySeconds || 0;
  const timerDevice = chooseMitsubishiTimer(project);
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

function withEndInstruction(lines) {
  return lines.at(-1) === 'END' ? lines : [...lines, 'END'];
}

function createGxWorks2CsvRows(lines) {
  return lines.map((line, index) => `${index + 1},"${line.replaceAll('"', '""')}"`).join('\n');
}

function makeIoMap(entries) {
  return entries.map(([device, label, role, contact]) => ({
    device,
    label,
    role,
    contact
  }));
}

function createSelfHoldingDraft({ requestText, targetOutput }) {
  const xDevices = extractDevices(requestText, ['X']);
  const output = pickDevice(requestText, ['Y'], targetOutput.address || 'Y0');
  const start = xDevices[0] || 'X0';
  const stop = xDevices[1] || 'X1';
  const instructionList = withEndInstruction([
    '; GX Works2 candidate: self-holding circuit',
    `LD ${start}`,
    `OR ${output}`,
    `ANI ${stop}`,
    `OUT ${output}`
  ]);

  return {
    targetPlatform: 'GX Works2',
    circuitType: 'self-holding',
    title: 'GX Works2 자기유지 회로 초안',
    ioMap: makeIoMap([
      [start, 'Start PB', '기동 입력', 'NO'],
      [stop, 'Stop PB', '정지 입력', 'NC logic by ANI'],
      [output, 'Motor/Relay', '자기유지 출력', 'coil']
    ]),
    instructionList,
    ladderPreview: [
      {
        title: 'Network 1 - 자기유지',
        ascii: [
          `|----[/ ${stop} STOP]----+----[ ${start} START ]----( ${output} OUT )`,
          '|                    |',
          `|                    +----[ ${output} HOLD ]-----|`
        ].join('\n'),
        explanation: `${start} 기동 또는 ${output} 자기유지 접점이 살아 있고 ${stop} 정지 조건이 없을 때 ${output} 출력을 유지합니다.`
      }
    ],
    operationSummary: [
      `${start}가 ON 되면 ${output}이 ON 됩니다.`,
      `${output}이 ON 된 뒤에는 ${start}가 OFF 되어도 ${output} 보조 접점으로 출력이 유지됩니다.`,
      `${stop}이 ON 되면 ANI 조건이 끊기며 ${output}이 OFF 됩니다.`
    ],
    gxWorks2Notes: [
      'GX Works2의 Ladder/Instruction List 편집기에 수동 입력하기 위한 명령 리스트 후보입니다.',
      '정지 입력 배선 방식에 따라 NO/NC 접점 해석을 현장 표준에 맞게 확인해야 합니다.'
    ],
    safetyNotes: ['실제 설비 적용 전 모터 보호, 비상정지, 과부하, 안전 릴레이 인터락을 별도로 검증해야 합니다.']
  };
}

function createElevatorDraft({ requestText }) {
  const xDevices = extractDevices(requestText, ['X']);
  const yDevices = extractDevices(requestText, ['Y']);
  const mDevices = extractDevices(requestText, ['M']);
  const floor1Call = xDevices[0] || 'X0';
  const floor2Call = xDevices[1] || 'X1';
  const floor1Limit = xDevices[2] || 'X2';
  const floor2Limit = xDevices[3] || 'X3';
  const doorClosed = xDevices[4] || 'X4';
  const emergencyStop = xDevices[5] || 'X5';
  const upMotor = yDevices[0] || 'Y0';
  const downMotor = yDevices[1] || 'Y1';
  const doorOpen = yDevices[2] || 'Y2';
  const upRequest = mDevices[0] || 'M0';
  const downRequest = mDevices[1] || 'M1';
  const instructionList = withEndInstruction([
    '; GX Works2 candidate: simple two-floor elevator training circuit',
    `LD ${floor2Call}`,
    `ANI ${floor2Limit}`,
    `SET ${upRequest}`,
    `LD ${floor2Limit}`,
    `RST ${upRequest}`,
    `LD ${floor1Call}`,
    `ANI ${floor1Limit}`,
    `SET ${downRequest}`,
    `LD ${floor1Limit}`,
    `RST ${downRequest}`,
    `LD ${upRequest}`,
    `ANI ${downRequest}`,
    `AND ${doorClosed}`,
    `ANI ${emergencyStop}`,
    `ANI ${floor2Limit}`,
    `OUT ${upMotor}`,
    `LD ${downRequest}`,
    `ANI ${upRequest}`,
    `AND ${doorClosed}`,
    `ANI ${emergencyStop}`,
    `ANI ${floor1Limit}`,
    `OUT ${downMotor}`,
    `LD ${floor1Limit}`,
    `OR ${floor2Limit}`,
    `ANI ${upMotor}`,
    `ANI ${downMotor}`,
    `OUT ${doorOpen}`
  ]);

  return {
    targetPlatform: 'GX Works2',
    circuitType: 'two-floor-elevator',
    title: 'GX Works2 2층 엘리베이터 교육용 회로 초안',
    ioMap: makeIoMap([
      [floor1Call, '1F Call', '1층 호출', 'NO'],
      [floor2Call, '2F Call', '2층 호출', 'NO'],
      [floor1Limit, '1F Limit', '1층 도착 검출', 'NO'],
      [floor2Limit, '2F Limit', '2층 도착 검출', 'NO'],
      [doorClosed, 'Door Closed', '문 닫힘 확인', 'NO'],
      [emergencyStop, 'Emergency Stop', '비상정지 입력', 'NC logic by ANI'],
      [upRequest, 'Up Request', '상승 요청 래치', 'internal relay'],
      [downRequest, 'Down Request', '하강 요청 래치', 'internal relay'],
      [upMotor, 'Up Motor', '상승 모터 출력', 'coil'],
      [downMotor, 'Down Motor', '하강 모터 출력', 'coil'],
      [doorOpen, 'Door Open', '문 열림 출력', 'coil']
    ]),
    instructionList,
    ladderPreview: [
      {
        title: 'Network 1 - 상승/하강 요청 래치',
        ascii: [
          `|----[ ${floor2Call} 2F CALL ]----[/ ${floor2Limit} 2F LIMIT ]----(SET ${upRequest})`,
          `|----[ ${floor2Limit} 2F LIMIT ]-----------------------------(RST ${upRequest})`,
          `|----[ ${floor1Call} 1F CALL ]----[/ ${floor1Limit} 1F LIMIT ]----(SET ${downRequest})`,
          `|----[ ${floor1Limit} 1F LIMIT ]-----------------------------(RST ${downRequest})`
        ].join('\n'),
        explanation: '목표 층 호출을 내부 릴레이에 래치하고 해당 층 리미트가 감지되면 요청을 해제합니다.'
      },
      {
        title: 'Network 2 - 모터 상호 인터락',
        ascii: [
          `|----[ ${upRequest} ]----[/ ${downRequest} ]----[ ${doorClosed} ]----[/ ${emergencyStop} ]----[/ ${floor2Limit} ]----( ${upMotor} UP )`,
          `|----[ ${downRequest} ]----[/ ${upRequest} ]----[ ${doorClosed} ]----[/ ${emergencyStop} ]----[/ ${floor1Limit} ]----( ${downMotor} DOWN )`
        ].join('\n'),
        explanation: '상승/하강 출력이 동시에 켜지지 않도록 상호 인터락하고, 문 닫힘과 비상정지를 조건에 포함합니다.'
      },
      {
        title: 'Network 3 - 도착 시 문 열림 출력',
        ascii: `|----[ ${floor1Limit} OR ${floor2Limit} ]----[/ ${upMotor} ]----[/ ${downMotor} ]----( ${doorOpen} DOOR )`,
        explanation: '도착 리미트가 있고 모터가 정지된 상태에서 문 열림 출력을 냅니다.'
      }
    ],
    operationSummary: [
      `${floor2Call} 호출 시 ${upRequest}가 SET 되고, 문 닫힘/비상정지/상호 인터락 조건을 만족하면 ${upMotor}가 ON 됩니다.`,
      `${floor2Limit}가 감지되면 ${upRequest}가 RST 되어 상승 출력이 정지합니다.`,
      `${floor1Call} 호출 시 ${downRequest}가 SET 되고, ${floor1Limit} 도착 시 하강 요청이 해제됩니다.`,
      `${upMotor}와 ${downMotor}는 내부 요청 릴레이 상호 인터락으로 동시에 ON 되지 않도록 구성했습니다.`
    ],
    gxWorks2Notes: [
      'GX Works2에서 교육/검토용으로 입력할 수 있는 단순 2층 엘리베이터 명령 리스트 후보입니다.',
      '실제 승강기 제어에는 도어락, 과속, 브레이크, 위치 검출 이중화, 안전 PLC/릴레이 등 별도 안전 회로가 필요합니다.'
    ],
    safetyNotes: ['실제 승강기 또는 인명 안전 설비에 그대로 적용하면 안 됩니다. 교육용/검토용 초안입니다.']
  };
}

function createDelayedOutputDraft({ requirement, requestText, targetOutput, startConditions, stopConditions, project }) {
  const delay = requirement.delaySeconds || extractDelaySeconds(requestText) || 0;
  const timerDevice = chooseMitsubishiTimer(project);
  const xDevices = extractDevices(requestText, ['X']);
  const output = pickDevice(requestText, ['Y'], targetOutput.address || 'Y0');
  const start = startConditions[0]?.address || xDevices[0] || 'X0';
  const stop = stopConditions[0]?.address || xDevices[1] || 'X1';
  const timerPreset = VENDOR_PROFILES.mitsubishi.timerPreset(delay || 1);
  const instructionList = withEndInstruction(
    delay > 0
      ? [
          '; GX Works2 candidate: delayed output circuit',
          `LD ${start}`,
          `ANI ${stop}`,
          `OUT ${timerDevice} ${timerPreset}`,
          `LD ${timerDevice}`,
          `ANI ${stop}`,
          `OUT ${output}`
        ]
      : ['; GX Works2 candidate: output control circuit', `LD ${start}`, `ANI ${stop}`, `OUT ${output}`]
  );

  return {
    targetPlatform: 'GX Works2',
    circuitType: delay > 0 ? 'delayed-output' : 'output-control',
    title: delay > 0 ? 'GX Works2 지연 출력 회로 초안' : 'GX Works2 출력 제어 회로 초안',
    ioMap: makeIoMap([
      [start, 'Start/Detect', '기동 또는 감지 입력', 'NO'],
      [stop, 'Stop/Interlock', '정지 또는 인터락 입력', 'NC logic by ANI'],
      ...(delay > 0
        ? [[timerDevice, 'Delay Timer', `${delay}초 지연 타이머`, 'timer']]
        : []),
      [output, 'Target Output', '대상 출력', 'coil']
    ]),
    instructionList,
    ladderPreview: [
      {
        title: delay > 0 ? 'Network 1 - 지연 출력' : 'Network 1 - 출력 제어',
        ascii:
          delay > 0
            ? [
                `|----[ ${start} START ]----[/ ${stop} STOP ]----( ${timerDevice} ${timerPreset} )`,
                `|----[ ${timerDevice} DONE ]----[/ ${stop} STOP ]----( ${output} OUT )`
              ].join('\n')
            : `|----[ ${start} START ]----[/ ${stop} STOP ]----( ${output} OUT )`,
        explanation:
          delay > 0
            ? `${start} 조건이 유지되면 ${timerDevice}가 ${timerPreset} 후 완료되고 ${output}을 ON 합니다. ${stop} 조건은 타이머와 출력보다 우선합니다.`
            : `${start} 조건과 ${stop} 인터락 조건으로 ${output} 출력을 제어합니다.`
      }
    ],
    operationSummary:
      delay > 0
        ? [
            `${start}가 ON 되고 ${stop}이 OFF 상태이면 ${timerDevice} 타이머가 시작됩니다.`,
            `${delay}초가 지나면 ${timerDevice} 완료 접점으로 ${output}이 ON 됩니다.`,
            `${stop}이 ON 되면 타이머 완료 여부와 무관하게 ${output}이 OFF 됩니다.`
          ]
        : [`${start}가 ON 되고 ${stop}이 OFF 상태이면 ${output}이 ON 됩니다.`, `${stop}이 ON 되면 ${output}이 OFF 됩니다.`],
    gxWorks2Notes: [
      'GX Works2 타이머 preset은 0.1초 단위 K값 후보로 작성했습니다.',
      '사용 중인 T 디바이스와 실제 타임베이스는 프로젝트 CPU 설정에서 확인해야 합니다.'
    ],
    safetyNotes: ['정지, 비상정지, 과부하, 도어 인터락 등 안전 조건은 실제 프로젝트 기준으로 보강해야 합니다.']
  };
}

function createDelayOffDraft({ requirement, requestText, targetOutput, startConditions, stopConditions, project }) {
  const delay = requirement.delaySeconds || extractDelaySeconds(requestText) || 0;
  const xDevices = extractDevices(requestText, ['X']);
  const output = pickDevice(requestText, ['Y'], targetOutput.address || 'Y0');
  const start = startConditions[0]?.address || xDevices[0] || 'X0';
  const stop = stopConditions[0]?.address || xDevices[1] || 'X1';
  const timerDevice = chooseMitsubishiTimer(project);
  const holdRelay = chooseMitsubishiInternal(project);
  const timerPreset = VENDOR_PROFILES.mitsubishi.timerPreset(delay || 1);
  const instructionList = withEndInstruction([
    '; GX Works2 candidate: delay-off circuit',
    `LD ${start}`,
    `SET ${holdRelay}`,
    `LD ${stop}`,
    `RST ${holdRelay}`,
    `LDI ${start}`,
    `ANI ${stop}`,
    `OUT ${timerDevice} ${timerPreset}`,
    `LD ${timerDevice}`,
    `RST ${holdRelay}`,
    `LD ${holdRelay}`,
    `ANI ${stop}`,
    `OUT ${output}`
  ]);

  return {
    targetPlatform: 'GX Works2',
    circuitType: 'delay-off',
    title: 'GX Works2 지연 OFF 회로 초안',
    ioMap: makeIoMap([
      [start, 'Run Input', '기동 입력', 'NO'],
      [stop, 'Stop/Interlock', '정지 또는 인터락 입력', 'NC logic by ANI'],
      [holdRelay, 'Off-delay Hold', '지연 OFF 내부 유지', 'internal relay'],
      [timerDevice, 'Off-delay Timer', `${delay}초 OFF 지연 타이머`, 'timer'],
      [output, 'Target Output', '지연 OFF 대상 출력', 'coil']
    ]),
    instructionList,
    ladderPreview: [
      {
        title: 'Network 1 - 출력 유지와 OFF 지연',
        ascii: [
          `|----[ ${start} RUN ]--------------------------------------(SET ${holdRelay})`,
          `|----[ ${stop} STOP ]-------------------------------------(RST ${holdRelay})`,
          `|----[/ ${start} RUN ]----[/ ${stop} STOP ]----( ${timerDevice} ${timerPreset} )`,
          `|----[ ${timerDevice} DONE ]-------------------------------(RST ${holdRelay})`,
          `|----[ ${holdRelay} HOLD ]----[/ ${stop} STOP ]------------( ${output} OUT )`
        ].join('\n'),
        explanation: `${start}가 OFF 된 뒤 ${timerDevice}가 ${timerPreset}에 도달할 때까지 ${holdRelay}로 ${output}을 유지하며, ${stop}은 즉시 출력을 끕니다.`
      }
    ],
    operationSummary: [
      `${start}가 ON 되면 ${holdRelay}가 SET 되어 ${output}이 ON 됩니다.`,
      `${start}가 OFF 되면 ${timerDevice}가 시작되고 ${delay}초 후 ${holdRelay}를 RST 합니다.`,
      `${stop}이 ON 되면 타이머와 무관하게 ${holdRelay}와 ${output}을 즉시 OFF 합니다.`
    ],
    gxWorks2Notes: [
      'SET/RST 스캔 순서와 정지 우선 조건을 GX Works2 프로그램 체크에서 확인해야 합니다.',
      '타이머 번호와 preset time base는 선택한 CPU 프로필과 실제 프로젝트에서 다시 확인해야 합니다.'
    ],
    safetyNotes: ['지연 OFF가 허용되지 않는 안전 출력에는 사용하지 않습니다.']
  };
}

function createEdgeOneShotDraft({ requestText, targetOutput, project }) {
  const trigger = pickDevice(requestText, ['X'], 'X0');
  const output = pickDevice(requestText, ['Y'], targetOutput.address || 'Y0');
  const pulseRelay = chooseMitsubishiInternal(project);
  const falling = /하강|falling/i.test(requestText);
  const edgeInstruction = falling ? 'PLF' : 'PLS';
  const edgeLabel = falling ? '하강' : '상승';
  const instructionList = withEndInstruction([
    `; GX Works2 candidate: ${edgeLabel} edge one-shot`,
    `LD ${trigger}`,
    `${edgeInstruction} ${pulseRelay}`,
    `LD ${pulseRelay}`,
    `OUT ${output}`
  ]);

  return {
    targetPlatform: 'GX Works2',
    circuitType: 'edge-one-shot',
    title: `GX Works2 ${edgeLabel} 엣지 one-shot 회로 초안`,
    ioMap: makeIoMap([
      [trigger, 'Edge Trigger', `${edgeLabel} 엣지 입력`, falling ? 'falling edge' : 'rising edge'],
      [pulseRelay, 'One-shot Relay', `${edgeLabel} 엣지 1 scan 내부 펄스`, 'internal relay'],
      [output, 'One-shot Output', '1 scan 펄스 출력', 'coil']
    ]),
    instructionList,
    ladderPreview: [
      {
        title: `Network 1 - ${edgeLabel} 엣지 펄스`,
        ascii: [
          `|----[ ${trigger} TRIGGER ]-------------------------------(${edgeInstruction} ${pulseRelay})`,
          `|----[ ${pulseRelay} ONE SHOT ]----------------------------( ${output} ONE SCAN )`
        ].join('\n'),
        explanation: `${trigger}의 ${edgeLabel} 엣지를 ${edgeInstruction}로 검출해 ${pulseRelay}와 ${output}을 한 스캔 동안만 ON 합니다.`
      }
    ],
    operationSummary: [
      `${trigger}의 ${edgeLabel} 전이에서 ${output}이 한 번만 ON 됩니다.`,
      '입력이 같은 상태로 유지되는 동안 출력 펄스가 반복되지 않아야 합니다.'
    ],
    gxWorks2Notes: ['대상 CPU가 PLS/PLF 명령을 지원하는지 GX Works2 프로그램 체크에서 확인해야 합니다.'],
    safetyNotes: ['한 스캔 펄스를 놓칠 수 있는 외부 장치에는 별도 래치 또는 핸드셰이크가 필요합니다.']
  };
}

function createAlarmLatchResetDraft({ requestText, targetOutput }) {
  const xDevices = extractDevices(requestText, ['X']);
  const alarm = xDevices[0] || 'X0';
  const reset = xDevices[1] || 'X1';
  const output = pickDevice(requestText, ['Y'], targetOutput.address || 'Y0');
  const instructionList = withEndInstruction([
    '; GX Works2 candidate: alarm latch and reset',
    `LD ${alarm}`,
    `SET ${output}`,
    `LD ${reset}`,
    `RST ${output}`
  ]);

  return {
    targetPlatform: 'GX Works2',
    circuitType: 'alarm-latch-reset',
    title: 'GX Works2 알람 Latch + Reset 회로 초안',
    ioMap: makeIoMap([
      [alarm, 'Alarm Trigger', '알람 발생 입력', 'NO'],
      [reset, 'Alarm Reset', '알람 복귀 입력', 'NO'],
      [output, 'Alarm Output', '래치 알람 출력', 'SET/RST coil']
    ]),
    instructionList,
    ladderPreview: [
      {
        title: 'Network 1 - 알람 래치와 Reset 우선',
        ascii: [
          `|----[ ${alarm} ALARM ]------------------------------------(SET ${output})`,
          `|----[ ${reset} RESET ]------------------------------------(RST ${output})`
        ].join('\n'),
        explanation: `${alarm} 발생 시 ${output}을 SET하고, 뒤쪽 ${reset} RST 명령으로 동시 입력 시 Reset을 우선합니다.`
      }
    ],
    operationSummary: [
      `${alarm}가 한 번 ON 되면 ${output}이 래치됩니다.`,
      `${reset}이 ON 되면 ${output}이 RST 됩니다.`,
      '알람 원인이 남아 있는 상태에서 Reset 허용 여부는 현장 정책으로 확인해야 합니다.'
    ],
    gxWorks2Notes: ['동일 출력에 대한 기존 SET/RST/OUT Writer가 없는지 교차 참조로 확인해야 합니다.'],
    safetyNotes: ['안전 알람 또는 보호 정지 신호의 우회·자동 Reset 용도로 사용하지 않습니다.']
  };
}

function createMutualInterlockDraft({ requestText, targetOutput }) {
  const xDevices = extractDevices(requestText, ['X']);
  const yDevices = extractDevices(requestText, ['Y']);
  const enableA = xDevices[0] || 'X0';
  const enableB = xDevices[1] || 'X1';
  const outputA = yDevices[0] || targetOutput.address || 'Y0';
  const outputB = yDevices[1] || (outputA === 'Y0' ? 'Y1' : 'Y0');
  const instructionList = withEndInstruction([
    '; GX Works2 candidate: two-output mutual interlock',
    `LD ${enableA}`,
    `ANI ${outputB}`,
    `OUT ${outputA}`,
    `LD ${enableB}`,
    `ANI ${outputA}`,
    `OUT ${outputB}`
  ]);

  return {
    targetPlatform: 'GX Works2',
    circuitType: 'mutual-interlock',
    title: 'GX Works2 두 출력 상호 인터락 회로 초안',
    ioMap: makeIoMap([
      [enableA, 'Enable A', '출력 A 허가 입력', 'NO'],
      [enableB, 'Enable B', '출력 B 허가 입력', 'NO'],
      [outputA, 'Output A', '상호 인터락 출력 A', 'coil'],
      [outputB, 'Output B', '상호 인터락 출력 B', 'coil']
    ]),
    instructionList,
    ladderPreview: [
      {
        title: 'Network 1 - 두 출력 상호 배타',
        ascii: [
          `|----[ ${enableA} ENABLE A ]----[/ ${outputB} ]------------( ${outputA} OUT A )`,
          `|----[ ${enableB} ENABLE B ]----[/ ${outputA} ]------------( ${outputB} OUT B )`
        ].join('\n'),
        explanation: `${outputA}와 ${outputB}의 NC 조건을 교차 적용해 두 출력이 동시에 ON 되지 않도록 합니다.`
      }
    ],
    operationSummary: [
      `${enableA}가 ON이고 ${outputB}가 OFF일 때만 ${outputA}가 ON 됩니다.`,
      `${enableB}가 ON이고 ${outputA}가 OFF일 때만 ${outputB}가 ON 됩니다.`,
      `${outputA}와 ${outputB}가 동시에 ON 되는 상태를 허용하지 않습니다.`
    ],
    gxWorks2Notes: ['출력 피드백이 필요한 설비에서는 실제 접촉기 보조접점과 하드웨어 인터락을 별도로 사용해야 합니다.'],
    safetyNotes: ['정·역회전 또는 상·하강 모션은 R3로 분류하며 이 저위험 Template만으로 현장 적용하지 않습니다.']
  };
}

function createSensorDebounceDraft({ requirement, requestText, targetOutput, startConditions, stopConditions, project }) {
  const delay = requirement.delaySeconds || extractDelaySeconds(requestText) || 0;
  const xDevices = extractDevices(requestText, ['X']);
  const sensor = startConditions[0]?.address || xDevices[0] || 'X0';
  const stop = stopConditions[0]?.address || xDevices[1] || 'X1';
  const output = pickDevice(requestText, ['Y'], targetOutput.address || 'Y0');
  const timerDevice = chooseMitsubishiTimer(project);
  const timerPreset = VENDOR_PROFILES.mitsubishi.timerPreset(delay || 1);
  const instructionList = withEndInstruction([
    '; GX Works2 candidate: sensor debounce',
    `LD ${sensor}`,
    `ANI ${stop}`,
    `OUT ${timerDevice} ${timerPreset}`,
    `LD ${timerDevice}`,
    `ANI ${stop}`,
    `OUT ${output}`
  ]);

  return {
    targetPlatform: 'GX Works2',
    circuitType: 'sensor-debounce',
    title: 'GX Works2 센서 Debounce 회로 초안',
    ioMap: makeIoMap([
      [sensor, 'Sensor Input', '안정 확인 센서 입력', 'NO'],
      [stop, 'Stop/Interlock', '정지 또는 인터락 입력', 'NC logic by ANI'],
      [timerDevice, 'Debounce Timer', `${delay}초 입력 안정 타이머`, 'timer'],
      [output, 'Debounced Output', '안정 확인 출력', 'coil']
    ]),
    instructionList,
    ladderPreview: [
      {
        title: 'Network 1 - 센서 안정 시간 확인',
        ascii: [
          `|----[ ${sensor} SENSOR ]----[/ ${stop} STOP ]----( ${timerDevice} ${timerPreset} )`,
          `|----[ ${timerDevice} DONE ]----[/ ${stop} STOP ]--( ${output} STABLE )`
        ].join('\n'),
        explanation: `${sensor}가 ${delay}초 연속 ON일 때만 ${output}을 ON하며, 중간에 OFF되면 타이머가 reset 됩니다.`
      }
    ],
    operationSummary: [
      `${sensor}가 ${delay}초 동안 연속 ON일 때 ${output}이 ON 됩니다.`,
      `안정 시간 전에 ${sensor}가 OFF되면 ${timerDevice}가 reset 됩니다.`,
      `${stop}은 타이머와 출력보다 우선합니다.`
    ],
    gxWorks2Notes: ['OFF 방향 Debounce가 필요한지는 별도 요구사항으로 확인해야 합니다.'],
    safetyNotes: ['안전 센서의 진단이나 안전 응답 시간을 일반 타이머로 대체하지 않습니다.']
  };
}

function createGxWorks2CircuitDraft({ requirement, requestText, targetOutput, startConditions, stopConditions, project }) {
  const kind = detectCircuitKind(requestText);

  if (kind === 'self-holding') {
    return createSelfHoldingDraft({ requestText, targetOutput });
  }

  if (kind === 'two-floor-elevator') {
    return createElevatorDraft({ requestText });
  }

  if (kind === 'delay-off') {
    return createDelayOffDraft({ requirement, requestText, targetOutput, startConditions, stopConditions, project });
  }

  if (kind === 'edge-one-shot') {
    return createEdgeOneShotDraft({ requestText, targetOutput, project });
  }

  if (kind === 'alarm-latch-reset') {
    return createAlarmLatchResetDraft({ requestText, targetOutput });
  }

  if (kind === 'mutual-interlock') {
    return createMutualInterlockDraft({ requestText, targetOutput });
  }

  if (kind === 'sensor-debounce') {
    return createSensorDebounceDraft({
      requirement,
      requestText,
      targetOutput,
      startConditions,
      stopConditions,
      project
    });
  }

  return createDelayedOutputDraft({ requirement, requestText, targetOutput, startConditions, stopConditions, project });
}

function resolveCircuitTargetOutput(circuitDraft, fallbackTarget) {
  const outputs = (circuitDraft?.ioMap || []).filter((item) => /^Y\d/i.test(item.device));
  if (outputs.length === 0) {
    return fallbackTarget;
  }

  return {
    ...fallbackTarget,
    name: outputs.map((item) => item.label).join(' / '),
    address: outputs.map((item) => item.device).join(', '),
    confidence: Math.max(Number(fallbackTarget?.confidence || 0), 0.95),
    reason: '자연어 회로 초안의 GX Works2 I/O 맵에서 출력 주소를 확인했습니다.'
  };
}

function createGxWorks2PatchArtifacts(circuitDraft) {
  const instructionList = circuitDraft.instructionList.join('\n');
  const ladderPreview = circuitDraft.ladderPreview
    .map((network) => `${network.title}\n${network.ascii}\n${network.explanation}`)
    .join('\n\n');

  return [
    {
      name: 'GX Works2 instruction list candidate',
      language: 'GX Works2 IL',
      content: instructionList
    },
    {
      name: 'GX Works2 CSV row candidate',
      language: 'CSV',
      content: createGxWorks2CsvRows(circuitDraft.instructionList)
    },
    {
      name: 'Ladder preview',
      language: 'Text',
      content: ladderPreview
    }
  ];
}

function formatGxWorks2CircuitFile(circuitDraft) {
  return [
    `# ${circuitDraft.title}`,
    '',
    '## I/O Map',
    ...circuitDraft.ioMap.map((item) => `- ${item.device}: ${item.label} / ${item.role} / ${item.contact}`),
    '',
    '## Instruction List',
    ...circuitDraft.instructionList,
    '',
    '## Ladder Preview',
    ...circuitDraft.ladderPreview.flatMap((network) => [network.title, network.ascii, network.explanation, '']),
    '## Operation Summary',
    ...circuitDraft.operationSummary.map((item) => `- ${item}`),
    '',
    '## GX Works2 Notes',
    ...circuitDraft.gxWorks2Notes.map((item) => `- ${item}`),
    '',
    '## Safety Notes',
    ...circuitDraft.safetyNotes.map((item) => `- ${item}`),
    ''
  ].join('\n');
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
  const listing =
    patchArtifacts.find((artifact) => ['GX Works listing', 'GX Works2 IL'].includes(artifact.language))?.content || '';
  return [
    sourceContent.trimEnd(),
    '',
    '; PLC Change Assistant candidate patch',
    '; Review in a GX Works2 offline project before any field use.',
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

function createCandidateFiles({
  sourceContent,
  sourceFilename,
  vendor,
  patchArtifacts,
  blockedReason,
  normalizedRequirement,
  simulation,
  circuitDraft
}) {
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
      simulation,
      circuitDraft
    },
    null,
    2
  );
  const files = [
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

  if (vendor === 'mitsubishi' && circuitDraft) {
    files.push({
      id: makeId('file', baseName, vendor, 'gxworks2'),
      filename: `${baseName}.gxworks2.lst`,
      label: 'GX Works2 명령 리스트',
      mimeType: 'text/plain; charset=utf-8',
      content: formatGxWorks2CircuitFile(circuitDraft)
    });
  }

  return files;
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

  if (includesSafetyKeyword(requestText) || stopConditions.some((condition) => includesSafetyKeyword(`${condition.name} ${condition.comment}`))) {
    return 'high';
  }

  return 'medium';
}

function mergeTargetOutput(ruleTarget, normalizedTarget) {
  if (!normalizedTarget || typeof normalizedTarget !== 'object') {
    return ruleTarget;
  }

  return {
    ...ruleTarget,
    name: normalizedTarget.name || ruleTarget.name,
    address: normalizedTarget.address || ruleTarget.address,
    confidence: Math.max(Number(normalizedTarget.confidence || 0), Number(ruleTarget.confidence || 0)),
    reason: normalizedTarget.name || normalizedTarget.address ? 'Codex/규칙 기반 정규화 결과를 교차 반영했습니다.' : ruleTarget.reason
  };
}

function normalizedConditionNames(values) {
  if (!Array.isArray(values)) {
    return [];
  }

  return values
    .map((value) => {
      if (typeof value === 'string') {
        return value;
      }
      return value?.name || value?.address || '';
    })
    .filter(Boolean);
}

export function createChangePlan({
  analysis,
  vendor,
  requestText,
  sourceContent = '',
  sourceFilename = '',
  normalizedRequirementInput = null,
  safetyValidation = null,
  normalizationSource = 'deterministic-rules',
  fallbackReason = null
}) {
  const selectedVendor = vendor === 'mitsubishi' ? 'mitsubishi' : 'siemens';
  const profile = VENDOR_PROFILES[selectedVendor];
  const project = analysis?.project || {};
  const request = safeString(requestText, '', 4000);

  if (!request) {
    throw new Error('회로수정 요청 내용이 필요합니다.');
  }

  const targetOutput = mergeTargetOutput(findTargetOutput(project, request), normalizedRequirementInput?.targetOutput);
  const startConditions = findConditionElements(project, request, 'start', [targetOutput.address]);
  const stopConditions = findConditionElements(project, request, 'stop', [targetOutput.address]);
  const delaySeconds = Number(normalizedRequirementInput?.delaySeconds || 0) || extractDelaySeconds(request);
  const safetyReasons = Array.isArray(safetyValidation?.reasons) ? safetyValidation.reasons : [];
  const blockedReason = unsafeModificationRequested(request)
    ? '안전회로 또는 비상정지 조건을 우회/제거/무시하는 변경으로 해석되어 자동 패치 생성을 중단했습니다.'
    : safetyReasons.length > 0
      ? safetyReasons.join(' ')
      : null;
  const baseNormalizedRequirement = {
    userRequest: request,
    targetBehavior:
      normalizedRequirementInput?.targetBehavior ||
      (delaySeconds > 0
        ? `${displayElement(targetOutput)} ${delaySeconds}초 지연 기동 후보`
        : `${displayElement(targetOutput)} 제어 조건 변경 후보`),
    targetOutput,
    delaySeconds,
    startConditions,
    stopConditions,
    codexStartConditionHints: normalizedConditionNames(normalizedRequirementInput?.startConditions),
    codexStopConditionHints: normalizedConditionNames(normalizedRequirementInput?.stopConditions),
    priorityRules: normalizedRequirementInput?.priorityRules?.length
      ? normalizedRequirementInput.priorityRules
      : ['stop_conditions_override_start', 'existing_safety_interlocks_must_remain'],
    safetyNote: normalizedRequirementInput?.safetyNotes?.join(' ') || '비상정지와 안전회로는 PLC 로직 자동수정 대상이 아니며 기존 안전 절차를 유지해야 합니다.',
    uncertainties: normalizedRequirementInput?.uncertainties || []
  };
  const circuitDraft =
    blockedReason === null && selectedVendor === 'mitsubishi'
      ? createGxWorks2CircuitDraft({
          requirement: baseNormalizedRequirement,
          requestText: request,
          targetOutput,
          startConditions,
          stopConditions,
          project
        })
      : null;
  const resolvedTargetOutput = resolveCircuitTargetOutput(circuitDraft, targetOutput);
  const normalizedRequirement =
    resolvedTargetOutput === targetOutput
      ? baseNormalizedRequirement
      : {
          ...baseNormalizedRequirement,
          targetBehavior:
            normalizedRequirementInput?.targetBehavior ||
            (delaySeconds > 0
              ? `${displayElement(resolvedTargetOutput)} ${delaySeconds}초 지연 기동 후보`
              : `${displayElement(resolvedTargetOutput)} 제어 조건 변경 후보`),
          targetOutput: resolvedTargetOutput
        };
  const candidateLocations = scoreCandidateLocations(project, resolvedTargetOutput, startConditions, stopConditions);
  const patchArtifacts =
    blockedReason === null
      ? selectedVendor === 'siemens'
        ? createSiemensPatch(normalizedRequirement, resolvedTargetOutput, startConditions, stopConditions)
        : circuitDraft
          ? createGxWorks2PatchArtifacts(circuitDraft)
          : createMitsubishiPatch(normalizedRequirement, targetOutput, startConditions, stopConditions, project)
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
    simulation,
    circuitDraft
  });

  return {
    id: makeId('change', analysis?.id || project?.id || 'analysis', selectedVendor, request),
    version: profile.id,
    title: profile.title,
    vendor: selectedVendor,
    requirementNormalization: {
      source: normalizationSource,
      fallbackReason,
      safetyValidation: safetyValidation || { ok: true, reasons: [] }
    },
    normalizedRequirement,
    affectedElements: [
      {
        kind: 'target-output',
        name: resolvedTargetOutput.name || resolvedTargetOutput.owner || '',
        address: resolvedTargetOutput.address || '',
        confidence: resolvedTargetOutput.confidence,
        reason: resolvedTargetOutput.reason
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
    circuitDraft,
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
        area: displayElement(resolvedTargetOutput),
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
