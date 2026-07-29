import { createHash } from 'node:crypto';
import { createManualValidationRecord } from './vendorValidationAdapters.js';

const VALIDATION_LEVELS = Object.freeze([
  'V0',
  'V1',
  'V2',
  'V3',
  'V4',
  'V5',
  'V6',
  'V7',
  'V8',
  'V9',
  'V10'
]);

const SUPPORTED_MITSUBISHI_INSTRUCTIONS = new Set([
  'LD',
  'LDI',
  'AND',
  'ANI',
  'OR',
  'ORI',
  'ANB',
  'ORB',
  'MPS',
  'MRD',
  'MPP',
  'OUT',
  'SET',
  'RST',
  'PLS',
  'PLF',
  'MOV',
  'DMOV',
  'BMOV',
  'CMP',
  'ZCP',
  'ADD',
  'SUB',
  'MUL',
  'DIV',
  'CJ',
  'CALL',
  'RET',
  'FOR',
  'NEXT',
  'END',
  'FEND'
]);

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function stableId(prefix, ...parts) {
  return `${prefix}-${createHash('sha256')
    .update(parts.map(String).join('|'))
    .digest('hex')
    .slice(0, 16)}`;
}

function diagnostic(code, severity, message, evidenceIds = []) {
  return {
    code,
    severity,
    message,
    evidenceIds: [...new Set(evidenceIds.filter(Boolean))]
  };
}

function createRun({ level, status, tool, timestamp, diagnostics = [], evidenceIds = [] }) {
  return {
    id: stableId('validation', level, tool, timestamp, diagnostics.map((item) => item.code).join(',')),
    level,
    status,
    tool,
    toolVersion: 'phase8-local-v1',
    startedAt: timestamp,
    finishedAt: timestamp,
    diagnostics,
    evidenceIds: [...new Set(evidenceIds.filter(Boolean))]
  };
}

function statusForDiagnostics(diagnostics, emptyStatus = 'pass') {
  if (diagnostics.some((item) => item.severity === 'error')) return 'fail';
  if (diagnostics.some((item) => item.severity === 'warning')) return 'warning';
  return emptyStatus;
}

function schemaRun(changeCandidate, circuitDraft, timestamp) {
  const diagnostics = [];
  if (changeCandidate?.version !== 'change-candidate-v2') {
    diagnostics.push(
      diagnostic('CHANGE_CANDIDATE_SCHEMA_INVALID', 'error', 'ChangeCandidate v2가 필요합니다.')
    );
  }
  if (changeCandidate?.logicIr?.version !== 'logic-candidate-v2') {
    diagnostics.push(
      diagnostic('LOGIC_IR_SCHEMA_INVALID', 'error', 'LogicCandidate v2가 필요합니다.')
    );
  }
  if (!changeCandidate?.template?.id) {
    diagnostics.push(
      diagnostic('TEMPLATE_REQUIRED', 'error', '검증할 저위험 Template이 없습니다.')
    );
  }
  if (!Array.isArray(circuitDraft?.instructionList)) {
    diagnostics.push(
      diagnostic('INSTRUCTION_LIST_REQUIRED', 'error', 'GX Works2 명령 후보가 없습니다.')
    );
  }
  return createRun({
    level: 'V0',
    status: statusForDiagnostics(diagnostics),
    tool: 'candidate-schema-validator',
    timestamp,
    diagnostics,
    evidenceIds: [changeCandidate?.template?.id]
  });
}

function irIntegrityRun(changeCandidate, timestamp) {
  const diagnostics = [];
  const operations = (changeCandidate?.logicIr?.networks || []).flatMap(
    (network) => network?.operations || []
  );
  const operationIds = operations.map((operation) => operation?.id).filter(Boolean);
  if (new Set(operationIds).size !== operationIds.length) {
    diagnostics.push(
      diagnostic('DUPLICATE_OPERATION_ID', 'error', 'Logic IR operation ID가 중복됩니다.')
    );
  }
  if (changeCandidate?.logicIr?.writesToPlc !== false) {
    diagnostics.push(
      diagnostic('PLC_WRITE_POLICY_INVALID', 'error', 'Logic IR은 PLC 쓰기를 허용할 수 없습니다.')
    );
  }
  if (
    !(changeCandidate?.logicIr?.invariants || []).some(
      (invariant) => invariant?.id === 'candidate-read-only'
    )
  ) {
    diagnostics.push(
      diagnostic(
        'MISSING_READ_ONLY_INVARIANT',
        'error',
        'PLC 쓰기 금지 불변식이 필요합니다.'
      )
    );
  }
  return createRun({
    level: 'V1',
    status: statusForDiagnostics(diagnostics),
    tool: 'logic-ir-integrity-validator',
    timestamp,
    diagnostics,
    evidenceIds: operationIds
  });
}

function cpuDeviceRun(changeCandidate, timestamp) {
  const diagnostics = [];
  const logicIr = changeCandidate?.logicIr || {};
  const signals = [
    ...(logicIr.inputs || []),
    ...(logicIr.outputs || []),
    ...(logicIr.internals || []),
    ...(logicIr.timers || [])
  ];
  const unassigned = signals.filter((signal) => /_UNASSIGNED$/i.test(signal?.address || ''));
  if (unassigned.length > 0) {
    diagnostics.push(
      diagnostic(
        'DEVICE_ALLOCATION_REQUIRED',
        'error',
        '할당되지 않은 디바이스 주소가 있습니다.',
        unassigned.map((signal) => signal.id)
      )
    );
  }
  const unverifiedTimers = (logicIr.timers || []).filter(
    (timer) => timer?.timeBaseVerified !== true
  );
  if (unverifiedTimers.length > 0) {
    diagnostics.push(
      diagnostic(
        'UNVERIFIED_TIMER_PROFILE',
        'error',
        'CPU·타이머 time base가 검증되지 않았습니다.',
        unverifiedTimers.map((timer) => timer.id)
      )
    );
  }
  return createRun({
    level: 'V2',
    status: statusForDiagnostics(diagnostics),
    tool: 'cpu-device-profile-validator',
    timestamp,
    diagnostics,
    evidenceIds: signals.map((signal) => signal.id)
  });
}

function instructionSyntaxRun(circuitDraft, timestamp) {
  const diagnostics = [];
  const lines = Array.isArray(circuitDraft?.instructionList)
    ? circuitDraft.instructionList
    : [];
  const executableLines = lines.filter(
    (line) => typeof line === 'string' && line.trim() && !line.trim().startsWith(';')
  );

  if (executableLines.at(-1)?.trim().toUpperCase() !== 'END') {
    diagnostics.push(
      diagnostic('MISSING_END', 'error', 'GX Works2 명령 후보의 마지막 END가 없습니다.')
    );
  }

  executableLines.forEach((line, index) => {
    const [opcode, ...operands] = line.trim().toUpperCase().split(/\s+/);
    if (!SUPPORTED_MITSUBISHI_INSTRUCTIONS.has(opcode)) {
      diagnostics.push(
        diagnostic(
          'UNSUPPORTED_INSTRUCTION',
          'error',
          `${index + 1}번째 실행 줄의 ${opcode || '빈 명령'}은 지원 범위 밖입니다.`
        )
      );
      return;
    }
    if (
      !['ANB', 'ORB', 'MPS', 'MRD', 'MPP', 'RET', 'NEXT', 'END', 'FEND'].includes(
        opcode
      ) &&
      operands.length === 0
    ) {
      diagnostics.push(
        diagnostic(
          'MISSING_INSTRUCTION_OPERAND',
          'error',
          `${opcode} 명령의 피연산자가 없습니다.`
        )
      );
    }
  });

  return createRun({
    level: 'V3',
    status: statusForDiagnostics(diagnostics),
    tool: 'gxworks2-il-subset-validator',
    timestamp,
    diagnostics,
    evidenceIds: []
  });
}

function staticRulesRun(changeCandidate, timestamp) {
  const diagnostics = [];
  if (changeCandidate?.risk?.class === 'R4') {
    diagnostics.push(
      diagnostic('R4_CHANGE_BLOCKED', 'error', 'R4 요청은 검증·수정 후보 생성을 차단합니다.')
    );
  }
  for (const missing of changeCandidate?.validation?.missingFacts || []) {
    diagnostics.push(
      diagnostic('REQUIRED_FACT_MISSING', 'error', `필수 사실 ${missing}이 확인되지 않았습니다.`)
    );
  }
  for (const conflict of changeCandidate?.impactAnalysis?.conflicts || []) {
    if (conflict?.severity === 'must-review') {
      diagnostics.push(
        diagnostic(
          conflict.code || 'IMPACT_CONFLICT',
          'error',
          conflict.detail || '영향 분석 충돌을 검토해야 합니다.'
        )
      );
    }
  }
  if (changeCandidate?.policy?.canWriteToPlc !== false) {
    diagnostics.push(
      diagnostic('DIRECT_PLC_WRITE_FORBIDDEN', 'error', 'PLC 직접 쓰기 정책 위반입니다.')
    );
  }
  return createRun({
    level: 'V4',
    status: statusForDiagnostics(diagnostics),
    tool: 'phase8-static-rule-validator',
    timestamp,
    diagnostics,
    evidenceIds: []
  });
}

function logicPropertyRun(changeCandidate, timestamp) {
  const diagnostics = [];
  const invariants = changeCandidate?.logicIr?.invariants || [];
  const invariantIds = new Set(invariants.map((invariant) => invariant?.id));
  const templateId = changeCandidate?.template?.id;
  const requiredByTemplate = {
    'self-holding': ['stop-priority'],
    'start-stop': ['stop-priority'],
    'delay-on': ['stop-priority'],
    'delay-off': ['stop-priority'],
    'alarm-latch-reset': ['reset-priority'],
    'mutual-interlock': ['mutual-exclusion']
  };
  for (const requiredId of requiredByTemplate[templateId] || []) {
    if (!invariantIds.has(requiredId)) {
      diagnostics.push(
        diagnostic(
          'REQUIRED_INVARIANT_MISSING',
          'error',
          `${templateId} Template에 ${requiredId} 불변식이 필요합니다.`
        )
      );
    }
  }
  return createRun({
    level: 'V5',
    status: statusForDiagnostics(diagnostics),
    tool: 'logic-property-validator',
    timestamp,
    diagnostics,
    evidenceIds: invariants.map((invariant) => invariant.id)
  });
}

function booleanInput(inputs, address, aliases = []) {
  if (address && Object.hasOwn(inputs, address)) return Boolean(inputs[address]);
  for (const alias of aliases) {
    if (Object.hasOwn(inputs, alias)) return Boolean(inputs[alias]);
  }
  return false;
}

function simulateScenario({ templateId, changeCandidate, circuitDraft, scenario }) {
  const logicIr = changeCandidate?.logicIr || {};
  const inputA = logicIr.inputs?.[0]?.address || 'INPUT_A';
  const inputB = logicIr.inputs?.[1]?.address || 'INPUT_B';
  const outputA = logicIr.outputs?.[0]?.address || 'OUTPUT_A';
  const outputB = logicIr.outputs?.[1]?.address || 'OUTPUT_B';
  const durationSeconds = logicIr.timers?.[0]?.durationSeconds || 0;
  const inputs = scenario?.inputs || {};
  const first = booleanInput(inputs, inputA, ['start', 'alarm']);
  const second = booleanInput(inputs, inputB, ['stop', 'reset']);
  let actualState = { [outputA]: false };

  if (templateId === 'self-holding') {
    actualState[outputA] =
      (Boolean(inputs.start) || Boolean(inputs.previouslyLatched)) &&
      !Boolean(inputs.stop);
  } else if (templateId === 'start-stop') {
    actualState[outputA] = Boolean(inputs.start) && !Boolean(inputs.stop);
  } else if (templateId === 'delay-on') {
    actualState[outputA] =
      first &&
      !second &&
      Number(inputs.elapsedSeconds || 0) >= durationSeconds;
  } else if (templateId === 'delay-off') {
    actualState[outputA] =
      !second &&
      (first || Number(inputs.elapsedSinceOffSeconds || 0) < durationSeconds);
  } else if (templateId === 'edge-one-shot') {
    const falling = (circuitDraft?.instructionList || []).some((line) =>
      /^PLF\b/i.test(String(line).trim())
    );
    const previous = Boolean(inputs.previous);
    const current = Boolean(inputs.current);
    actualState[outputA] = falling
      ? previous && !current
      : !previous && current;
  } else if (templateId === 'alarm-latch-reset') {
    actualState[outputA] =
      (Boolean(inputs.alarm) || Boolean(inputs.previouslyLatched)) &&
      !Boolean(inputs.reset);
  } else if (templateId === 'mutual-interlock') {
    const outputAValue = first;
    const outputBValue = second && !outputAValue;
    actualState = {
      [outputA]: outputAValue,
      [outputB]: outputBValue
    };
  } else if (templateId === 'sensor-debounce') {
    actualState[outputA] =
      first &&
      !second &&
      Number(inputs.stableSeconds || 0) >= durationSeconds;
  } else {
    return {
      ...scenario,
      status: 'not-run',
      actualState,
      diagnostics: [
        diagnostic(
          'SIMULATOR_TEMPLATE_UNSUPPORTED',
          'warning',
          `${templateId || 'Unknown'} Template은 간이 Simulator 범위 밖입니다.`
        )
      ]
    };
  }

  const expectedState = scenario?.expectedState || { [outputA]: scenario?.expectedOutput };
  const expectedMatches = Object.entries(expectedState).every(([key, value]) => {
    if (key === 'mutuallyExclusive') {
      return value === true ? !(actualState[outputA] && actualState[outputB]) : true;
    }
    return actualState[key] === value;
  });

  return {
    ...scenario,
    status: expectedMatches ? 'pass' : 'fail',
    actualState,
    diagnostics: expectedMatches
      ? []
      : [
          diagnostic(
            'SCENARIO_EXPECTATION_MISMATCH',
            'error',
            `${scenario?.name || '시나리오'}의 기대 상태와 시뮬레이션 결과가 다릅니다.`
          )
        ]
  };
}

function simulatorRun(changeCandidate, circuitDraft, testScenarios, prerequisiteRuns, timestamp) {
  const blockedByPrerequisite = prerequisiteRuns.some((run) => run.status === 'fail');
  if (blockedByPrerequisite || !Array.isArray(testScenarios) || testScenarios.length === 0) {
    const reason = blockedByPrerequisite
      ? 'V0~V5 실패로 시뮬레이션을 실행하지 않았습니다.'
      : '실행할 Template 시나리오가 없습니다.';
    const diagnostics = [
      diagnostic(
        blockedByPrerequisite ? 'SIMULATION_PREREQUISITE_FAILED' : 'SIMULATION_SCENARIO_REQUIRED',
        'info',
        reason
      )
    ];
    return {
      run: createRun({
        level: 'V6',
        status: 'not-run',
        tool: 'phase8-template-simulator',
        timestamp,
        diagnostics,
        evidenceIds: []
      }),
      simulation: {
        harness: 'phase8-template-simulator',
        result: 'not-run',
        scenarios: [],
        diagnostics
      },
      trend: {
        status: 'not-run',
        columns: [],
        rows: []
      }
    };
  }

  const templateId = changeCandidate?.template?.id;
  const scenarios = testScenarios.map((scenario) =>
    simulateScenario({
      templateId,
      changeCandidate,
      circuitDraft,
      scenario
    })
  );
  const result = scenarios.some((scenario) => scenario.status === 'fail')
    ? 'fail'
    : scenarios.some((scenario) => scenario.status === 'not-run')
      ? 'warning'
      : 'pass';
  const rows = scenarios.map((scenario, index) => ({
    scenarioId: scenario.id,
    scenario: scenario.name,
    step: index,
    timeSeconds: Number(
      scenario.inputs?.elapsedSeconds ??
        scenario.inputs?.elapsedSinceOffSeconds ??
        scenario.inputs?.stableSeconds ??
        scenario.inputs?.scan ??
        index
    ),
    signals: {
      ...(scenario.inputs || {}),
      ...(scenario.actualState || {})
    },
    status: scenario.status
  }));
  const columns = [
    ...new Set(rows.flatMap((row) => Object.keys(row.signals || {})))
  ];
  const diagnostics = scenarios.flatMap((scenario) => scenario.diagnostics || []);

  return {
    run: createRun({
      level: 'V6',
      status: result,
      tool: 'phase8-template-simulator',
      timestamp,
      diagnostics,
      evidenceIds: scenarios.map((scenario) => scenario.id)
    }),
    simulation: {
      harness: 'phase8-template-simulator',
      result,
      scenarios,
      diagnostics
    },
    trend: {
      status: result,
      columns,
      rows
    }
  };
}

function localValidationRuns(changeCandidate, circuitDraft, testScenarios, timestamp) {
  const runs = [
    schemaRun(changeCandidate, circuitDraft, timestamp),
    irIntegrityRun(changeCandidate, timestamp),
    cpuDeviceRun(changeCandidate, timestamp),
    instructionSyntaxRun(circuitDraft, timestamp),
    staticRulesRun(changeCandidate, timestamp),
    logicPropertyRun(changeCandidate, timestamp)
  ];
  const simulator = simulatorRun(
    changeCandidate,
    circuitDraft,
    testScenarios,
    runs,
    timestamp
  );
  return {
    runs: [...runs, simulator.run],
    simulation: simulator.simulation,
    trend: simulator.trend
  };
}

function repairableActions(runs, circuitDraft) {
  const codes = new Set(
    runs.flatMap((run) => run.diagnostics || []).map((item) => item.code)
  );
  const actions = [];
  if (
    codes.has('MISSING_END') &&
    Array.isArray(circuitDraft?.instructionList) &&
    !codes.has('UNSUPPORTED_INSTRUCTION')
  ) {
    actions.push('APPEND_END');
  }
  return actions;
}

function applyRepairs(circuitDraft, actions, iteration) {
  const repaired = clone(circuitDraft);
  const records = [];
  if (actions.includes('APPEND_END')) {
    repaired.instructionList = [...repaired.instructionList, 'END'];
    records.push({
      id: stableId('repair', iteration, 'APPEND_END'),
      code: 'APPEND_END',
      iteration,
      description: 'GX Works2 명령 후보 끝에 누락된 END를 추가했습니다.',
      safeScope: 'candidate-artifact-only'
    });
  }
  return { circuitDraft: repaired, records };
}

function normalizeManualRecords(records) {
  if (!Array.isArray(records)) return [];
  return records.slice(0, 8).map((record) =>
    createManualValidationRecord(record)
  );
}

function manualOrDefaultRun(level, records, timestamp) {
  const record = records.find((item) => item.level === level);
  if (record) {
    return {
      id: stableId('validation', level, record.tool, record.startedAt, record.status),
      ...record
    };
  }
  const labels = {
    V7: 'External IEC compiler',
    V8: 'GX Works2 manual program check',
    V9: 'Engineer approval',
    V10: 'Field standard validation'
  };
  const status = level === 'V7' ? 'not-applicable' : 'not-run';
  const code =
    level === 'V7'
      ? 'MITSUBISHI_IL_EXTERNAL_ST_NOT_APPLICABLE'
      : 'MANUAL_VALIDATION_REQUIRED';
  return createRun({
    level,
    status,
    tool: labels[level],
    timestamp,
    diagnostics: [
      diagnostic(
        code,
        'info',
        level === 'V7'
          ? 'Mitsubishi IL 후보를 외부 ST 컴파일러의 최종 검증으로 표현하지 않습니다.'
          : `${labels[level]} 결과가 아직 기록되지 않았습니다.`
      )
    ],
    evidenceIds: []
  });
}

function summarize(validationRuns, riskClass) {
  const localRuns = validationRuns.filter((run) =>
    ['V0', 'V1', 'V2', 'V3', 'V4', 'V5', 'V6'].includes(run.level)
  );
  const localStatus = localRuns.some((run) => run.status === 'fail')
    ? 'fail'
    : localRuns.some((run) => run.status === 'not-run')
      ? 'not-run'
      : localRuns.some((run) => run.status === 'warning')
        ? 'warning'
        : 'pass';
  const externalRuns = validationRuns.filter((run) =>
    ['V7', 'V8', 'V9', 'V10'].includes(run.level)
  );
  const overallStatus =
    riskClass === 'R4' || validationRuns.some((run) => run.status === 'fail')
      ? 'fail'
      : externalRuns.every((run) =>
            ['pass', 'not-applicable'].includes(run.status)
          )
        ? 'pass'
        : 'not-run';
  return {
    localStatus,
    overallStatus,
    highestPassedLevel:
      [...validationRuns]
        .reverse()
        .find((run) => run.status === 'pass')?.level || null,
    failedLevels: validationRuns
      .filter((run) => run.status === 'fail')
      .map((run) => run.level),
    notRunLevels: validationRuns
      .filter((run) => run.status === 'not-run')
      .map((run) => run.level)
  };
}

export function runValidationLoop({
  changeCandidate,
  circuitDraft,
  testScenarios = [],
  manualValidationRecords = [],
  maxIterations = 2,
  now = new Date().toISOString()
}) {
  const timestamp = new Date(now).toISOString();
  const boundedIterations = Math.max(1, Math.min(3, Number(maxIterations) || 2));
  let workingDraft = clone(circuitDraft);
  const candidate = clone(changeCandidate);
  const scenarios = clone(testScenarios) || [];
  const iterations = [];
  const repairs = [];
  let finalLocal = null;

  for (let iteration = 1; iteration <= boundedIterations; iteration += 1) {
    finalLocal = localValidationRuns(
      candidate,
      workingDraft,
      scenarios,
      timestamp
    );
    const localFailed = finalLocal.runs.some((run) => run.status === 'fail');
    const actions =
      localFailed && iteration < boundedIterations
        ? repairableActions(finalLocal.runs, workingDraft)
        : [];
    iterations.push({
      iteration,
      status: localFailed ? 'fail' : finalLocal.simulation.result,
      diagnosticCodes: [
        ...new Set(
          finalLocal.runs.flatMap((run) =>
            (run.diagnostics || []).map((item) => item.code)
          )
        )
      ],
      repairActions: actions
    });
    if (!localFailed || actions.length === 0) break;
    const repaired = applyRepairs(workingDraft, actions, iteration);
    workingDraft = repaired.circuitDraft;
    repairs.push(...repaired.records);
  }

  const records = normalizeManualRecords(manualValidationRecords);
  const validationRuns = [
    ...finalLocal.runs,
    ...['V7', 'V8', 'V9', 'V10'].map((level) =>
      manualOrDefaultRun(level, records, timestamp)
    )
  ];
  const summary = summarize(validationRuns, candidate?.risk?.class);

  return {
    version: 'validation-loop-v1',
    validationLevels: VALIDATION_LEVELS,
    maxIterations: boundedIterations,
    iterations,
    repairs,
    circuitDraft: workingDraft,
    validationRuns,
    summary,
    simulation: finalLocal.simulation,
    trend: finalLocal.trend,
    manualValidationRecords: records,
    policy: {
      canWriteToPlc: false,
      executesExternalProcess: false,
      externalNetworkUsed: false
    }
  };
}

