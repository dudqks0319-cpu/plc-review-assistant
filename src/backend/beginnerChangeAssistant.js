import { createHash } from 'node:crypto';
import {
  createChangePlan as createLegacyChangePlan,
  VENDOR_PROFILES
} from './plcChangeAssistant.js';
import {
  calculateTimerDuration,
  getCpuProfile
} from '../adapters/mitsubishi/deviceAddress.js';
import {
  buildChangeCandidateV2,
  createTemplateTestScenarios
} from '../application/changeCandidateV2.js';
import { runValidationLoop } from '../application/validationLoop.js';
import {
  normalizeDownloadBaseName,
  serializeCsv
} from '../../public/exportContract.js';

const HIGH_RISK_MACHINE_PROFILES = [
  {
    id: 'elevator',
    label: '승강기/엘리베이터',
    keywords: ['엘리베이터', '승강기', 'elevator', 'lift']
  },
  {
    id: 'crane',
    label: '크레인/호이스트',
    keywords: ['크레인', '호이스트', 'crane', 'hoist']
  },
  {
    id: 'press',
    label: '프레스',
    keywords: ['프레스', 'press']
  },
  {
    id: 'combustion',
    label: '버너/보일러',
    keywords: ['버너', '보일러', 'burner', 'boiler', 'combustion']
  },
  {
    id: 'robot',
    label: '산업용 로봇',
    keywords: ['산업용 로봇', '협동로봇', '로봇 셀', 'robot cell', 'industrial robot']
  },
  {
    id: 'mobile-equipment',
    label: '무인 운반 장비',
    keywords: ['agv', 'amr', '무인운반', '무인 운반']
  },
  {
    id: 'brake-axis',
    label: '브레이크/축 제어',
    keywords: ['브레이크 해제', '브레이크', '축 제어', 'brake release', 'axis control']
  },
  {
    id: 'servo-motion',
    label: '서보/모션 제어',
    keywords: ['서보', '모션', 'servo', 'motion']
  },
  {
    id: 'safety-motion',
    label: '안전 모션 기능',
    keywords: ['sto', 'ss1', 'sls', 'safe torque off', 'safe stop 1', 'safely-limited speed']
  }
];

function safeString(value, fallback = '', maxLength = 5_000_000) {
  if (typeof value !== 'string') {
    return fallback;
  }

  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, maxLength) : fallback;
}

function makeId(prefix, ...parts) {
  const hash = createHash('sha1').update(parts.filter(Boolean).join('|')).digest('hex').slice(0, 10);
  return `${prefix}-${hash}`;
}

function safeFilename(value, fallback = 'plc-program') {
  return normalizeDownloadBaseName(safeString(value, fallback, 240), {
    fallbackBase: fallback,
    maxLength: 120
  });
}

function matchesHighRiskKeyword(text, keyword) {
  const normalizedKeyword = keyword.toLowerCase();
  if (['sto', 'ss1', 'sls'].includes(normalizedKeyword)) {
    return new RegExp(`\\b${normalizedKeyword}\\b`, 'i').test(text);
  }

  return text.includes(normalizedKeyword);
}

function detectHighRiskMachine(requestText) {
  const normalized = safeString(requestText, '', 4000).toLowerCase().replace(/\s+/g, ' ');
  return (
    HIGH_RISK_MACHINE_PROFILES.find((profile) =>
      profile.keywords.some((keyword) => matchesHighRiskKeyword(normalized, keyword))
    ) || null
  );
}

function hasProjectEvidence(project) {
  return Boolean(
    (Array.isArray(project?.blocks) && project.blocks.length > 0) ||
      (Array.isArray(project?.variables) && project.variables.length > 0) ||
      (Array.isArray(project?.ioAddresses) && project.ioAddresses.length > 0)
  );
}

function createReadiness({
  analysis,
  sourceContent,
  blockedReason,
  highRiskMachine,
  simulation,
  timerValidation
}) {
  const project = analysis?.project || {};
  const hasSource = safeString(sourceContent).length > 0 && project?.source?.fileType !== 'natural-language-draft';
  const hasEvidence = hasProjectEvidence(project);
  const timerUnknown = timerValidation?.status === 'unknown';
  const level = blockedReason
    ? 'blocked'
    : highRiskMachine
      ? 'simulation-only'
      : timerUnknown
        ? 'needs-profile'
        : hasSource
          ? 'engineer-review'
          : 'draft-only';

  return {
    mode: hasSource ? 'existing-project-review' : 'new-circuit-draft',
    level,
    canWriteToPlc: false,
    summary: blockedReason
      ? '안전 조건 때문에 회로 후보 생성을 중단했습니다.'
      : highRiskMachine
        ? `${highRiskMachine.label} 요청은 인명 안전과 관련될 수 있어 시뮬레이션 전용 초안만 제공합니다.`
        : timerUnknown
          ? 'CPU·타이머 기준이 확인되지 않아 시간값과 명령 후보를 생성하지 않았습니다.'
        : hasSource
          ? '기존 export를 참고한 수정 후보입니다. 컴파일과 현장 검증 전에는 사용할 수 없습니다.'
          : '기존 PLC 파일이 없는 신규 초안입니다. 주소와 태그는 아직 확인되지 않았습니다.',
    checks: [
      {
        id: 'source',
        label: '기존 PLC 파일',
        status: hasSource ? 'checked' : 'not-provided',
        detail: hasSource ? project?.source?.filename || '업로드 파일 분석됨' : '파일이 없어 신규 회로 초안으로 생성했습니다.'
      },
      {
        id: 'addresses',
        label: '주소·태그 충돌',
        status: hasSource && hasEvidence ? 'checked' : 'unknown',
        detail:
          hasSource && hasEvidence
            ? '업로드된 export 범위에서 주소와 태그 후보를 확인했습니다.'
            : '실제 프로젝트의 사용 주소와 태그를 확인해야 합니다.'
      },
      {
        id: 'timer-profile',
        label: 'CPU·타이머 기준',
        status:
          timerValidation?.status === 'not-applicable'
            ? 'not-applicable'
            : timerValidation?.status === 'exact'
              ? 'checked'
              : 'unknown',
        detail:
          timerValidation?.status === 'not-applicable'
            ? '이 요청에는 Mitsubishi 타이머 환산이 필요하지 않습니다.'
            : timerValidation?.status === 'exact'
              ? '검증된 CPU 타이머 프로필로 시간값을 계산했습니다.'
              : '정확한 CPU 모델, 타이머 번호, 명령의 time base를 확인해야 합니다.'
      },
      {
        id: 'compile',
        label: '벤더 툴 컴파일',
        status: blockedReason ? 'blocked' : 'required',
        detail: 'GX Works2 또는 TIA Portal의 오프라인 복사본에서 직접 확인해야 합니다.'
      },
      {
        id: 'simulation',
        label: '시뮬레이션',
        status: simulation?.result === 'pass' ? 'basic-pass' : simulation?.result || 'required',
        detail:
          simulation?.result === 'pass'
            ? '간이 논리 하네스만 통과했습니다. 벤더 시뮬레이터 검증은 별도입니다.'
            : '벤더 시뮬레이터 검증이 필요합니다.'
      }
    ]
  };
}

function addCircuitAssumptions(circuitDraft) {
  if (!circuitDraft) {
    return null;
  }

  const ioMap = Array.isArray(circuitDraft.ioMap) ? circuitDraft.ioMap : [];
  const byRole = (text) => ioMap.find((item) => String(item.role || '').includes(text))?.device;
  let assumptions = [];

  if (circuitDraft.circuitType === 'self-holding') {
    const start = byRole('기동') || 'X0';
    const stop = byRole('정지') || 'X1';
    assumptions = [
      `${start}=ON은 기동 요청으로 가정합니다.`,
      `${stop}=ON은 정지 요청으로 가정하며 ANI ${stop}은 정지 요청이 없을 때만 통과합니다.`,
      '실제 정지 버튼의 NO/NC 배선과 PLC 입력 논리는 현장 도면으로 다시 확인해야 합니다.'
    ];
  } else if (circuitDraft.circuitType === 'two-floor-elevator') {
    assumptions = [
      '교육용 2층 이동 시퀀스만 표현하며 실제 승강기 안전 제어를 구현한 것이 아닙니다.',
      '호출·도착·문 닫힘 신호는 정상적으로 배선되고 진단된 논리 신호라고 가정합니다.',
      '브레이크, 도어락, 과속, 이중 위치 검출, 안전 PLC/릴레이는 별도 안전 시스템으로 검증해야 합니다.'
    ];
  } else if (circuitDraft.circuitType === 'edge-one-shot') {
    const trigger = byRole('엣지') || 'X0';
    assumptions = [
      `${trigger}의 선택한 상승/하강 전이가 PLC 스캔에서 정상 검출된다고 가정합니다.`,
      'one-shot 내부 릴레이와 출력은 한 스캔 동안만 ON 되어야 합니다.',
      '외부 장치가 한 스캔 펄스를 놓칠 수 있으면 별도 래치 또는 핸드셰이크가 필요합니다.'
    ];
  } else if (circuitDraft.circuitType === 'alarm-latch-reset') {
    const alarm = byRole('알람 발생') || 'X0';
    const reset = byRole('복귀') || 'X1';
    assumptions = [
      `${alarm}=ON은 알람 발생 요청으로 가정합니다.`,
      `${reset}=ON은 승인된 알람 Reset 요청으로 가정하며 동시 입력에서는 Reset을 우선합니다.`,
      '알람 원인이 남아 있는 상태에서 Reset을 허용할지는 현장 표준으로 확인해야 합니다.'
    ];
  } else if (circuitDraft.circuitType === 'mutual-interlock') {
    assumptions = [
      '두 출력은 동시에 ON 되면 안 되는 독립 명령 출력으로 가정합니다.',
      '한 스캔 안의 명령 순서와 기존 출력 Writer가 상호 배타 불변식을 깨지 않는지 확인해야 합니다.',
      '기계적 위험이 있는 정·역회전, 상·하강, 브레이크 제어에는 별도 하드웨어 안전 인터락이 필요합니다.'
    ];
  } else if (
    ['delayed-output', 'delay-off', 'sensor-debounce'].includes(
      circuitDraft.circuitType
    )
  ) {
    const start = byRole('기동') || byRole('감지') || byRole('센서') || 'X0';
    const stop = byRole('정지') || byRole('인터락') || 'X1';
    assumptions = [
      `${start}=ON은 시작 또는 감지 조건으로 가정합니다.`,
      `${stop}=ON은 정지 또는 인터락 요청으로 가정합니다.`,
      '타이머 시간값은 정확한 CPU·명령·타이머 번호의 time base가 검증된 뒤에만 생성해야 합니다.'
    ];
  } else {
    const start = byRole('기동') || byRole('감지') || 'X0';
    const stop = byRole('정지') || byRole('인터락') || 'X1';
    assumptions = [
      `${start}=ON은 시작 또는 감지 조건으로 가정합니다.`,
      `${stop}=ON은 정지 또는 인터락 요청으로 가정합니다.`,
      '실제 입력 접점의 NO/NC 논리와 출력 주소는 프로젝트 도면으로 확인해야 합니다.'
    ];
  }

  return {
    ...circuitDraft,
    assumptions: [...new Set([...(circuitDraft.assumptions || []), ...assumptions])]
  };
}

function findArtifact(plan, languages) {
  const artifacts = plan?.recommendedPatch?.patchArtifacts || [];
  return artifacts.find((artifact) => languages.includes(artifact.language)) || null;
}

function formatCircuitDraft(circuitDraft, { simulationOnly = false } = {}) {
  if (!circuitDraft) {
    return '회로 미리보기가 없습니다.';
  }

  return [
    simulationOnly ? '# SIMULATION ONLY - 실제 설비 반영 금지' : `# ${circuitDraft.title}`,
    simulationOnly ? `# ${circuitDraft.title}` : '',
    '',
    '## I/O Map',
    ...(circuitDraft.ioMap || []).map(
      (item) => `- ${item.device}: ${item.label} / ${item.role} / ${item.contact}`
    ),
    '',
    '## Assumptions',
    ...(circuitDraft.assumptions || []).map((item) => `- ${item}`),
    '',
    '## Instruction List',
    ...(circuitDraft.instructionList || []),
    '',
    '## Ladder Preview',
    ...(circuitDraft.ladderPreview || []).flatMap((network) => [
      network.title,
      network.ascii,
      network.explanation,
      ''
    ]),
    '## Operation Summary',
    ...(circuitDraft.operationSummary || []).map((item) => `- ${item}`),
    '',
    '## Safety Notes',
    ...(circuitDraft.safetyNotes || []).map((item) => `- ${item}`),
    ''
  ].join('\n');
}

function createUnifiedDiff({ filename, sourceContent, modifiedContent }) {
  const beforeLines = String(sourceContent || '').split(/\r\n|\n|\r/);
  const afterLines = String(modifiedContent || '').split(/\r\n|\n|\r/);
  let diffStart = 0;

  while (
    diffStart < beforeLines.length &&
    diffStart < afterLines.length &&
    beforeLines[diffStart] === afterLines[diffStart]
  ) {
    diffStart += 1;
  }

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

function createModifiedCandidate({ plan, vendor, sourceContent }) {
  const original = String(sourceContent || '').trimEnd();

  if (vendor === 'siemens') {
    const existing = (plan.candidateFiles || []).find((file) => file.filename?.endsWith('.candidate.xml'));
    if (existing?.content) {
      return existing.content;
    }

    const scl = findArtifact(plan, ['SCL'])?.content || '';
    return `${original}\n\n// PLC Change Assistant candidate patch\n${scl}\n`;
  }

  const listing = findArtifact(plan, ['GX Works2 IL', 'GX Works listing'])?.content || '';
  return [
    original,
    '',
    '; PLC Change Assistant candidate patch',
    '; Review in a GX Works2 offline project before any field use.',
    listing,
    ''
  ].join('\n');
}

function createPlanJson(plan) {
  return JSON.stringify(
    {
      executionScope: plan.executionScope,
      riskLevel: plan.riskLevel,
      readiness: plan.readiness,
      highRiskMachine: plan.highRiskMachine,
      targetBehavior: plan.normalizedRequirement?.targetBehavior,
      targetOutput: plan.normalizedRequirement?.targetOutput,
      delaySeconds: plan.normalizedRequirement?.delaySeconds,
      priorityRules: plan.normalizedRequirement?.priorityRules,
      simulation: plan.simulation,
      timerValidation: plan.timerValidation,
      circuitDraft: plan.circuitDraft,
      changeCandidateV2: plan.changeCandidateV2,
      validationLoop: plan.validationLoop,
      warnings: plan.warnings
    },
    null,
    2
  );
}

function createTestScenarioJson(plan) {
  return JSON.stringify(
    {
      riskClass: plan.riskClass,
      executionScope: plan.executionScope,
      template: plan.changeCandidateV2?.template || null,
      testCases: plan.testCases || [],
      invariants: plan.changeCandidateV2?.logicIr?.invariants || [],
      simulation: plan.simulation,
      validationSummary: plan.validationLoop?.summary || null,
      validationRuns: plan.validationLoop?.validationRuns || [],
      trend: plan.validationLoop?.trend || null
    },
    null,
    2
  );
}

function createReviewReport(plan) {
  const conflicts = plan.changeCandidateV2?.impactAnalysis?.conflicts || [];
  const reasons = plan.changeCandidateV2?.validation?.reviewReasons || [];
  const validationRuns = plan.validationLoop?.validationRuns || [];
  const failedDiagnostics = validationRuns
    .filter((run) => run.status === 'fail')
    .flatMap((run) =>
      (run.diagnostics || []).map(
        (item) => `${run.level} ${item.code}: ${item.message}`
      )
    );
  return [
    '# PLC 변경 후보 검토 보고서',
    '',
    '이 결과는 검토용 후보입니다.',
    '실제 PLC 반영 전 원본 백업, CPU·주소 확인, 프로그램 체크,',
    '벤더 시뮬레이션, 현장 표준 테스트, 자격 있는 담당자 승인이 필요합니다.',
    '',
    `- Risk Class: ${plan.riskClass || 'Unknown'}`,
    `- 실행 범위: ${plan.executionScope}`,
    `- Template: ${plan.changeCandidateV2?.template?.label || '확인 필요'}`,
    `- PLC 직접 쓰기: ${plan.readiness?.canWriteToPlc ? '허용' : '허용하지 않음'}`,
    '',
    '## 영향·충돌',
    ...(conflicts.length
      ? conflicts.map(
          (conflict) =>
            `- ${conflict.code}: ${conflict.address || '-'} · ${conflict.detail}`
        )
      : ['- 현재 Export 범위에서 등록된 충돌 없음']),
    '',
    '## 추가 확인',
    ...(reasons.length ? reasons.map((reason) => `- ${reason}`) : ['- 없음']),
    '',
    '## Validation Matrix',
    ...(validationRuns.length
      ? validationRuns.map(
          (run) => `- ${run.level}: ${run.status} · ${run.tool}`
        )
      : ['- 미실행']),
    '',
    '## 검증 실패 이유',
    ...(failedDiagnostics.length
      ? failedDiagnostics.map((item) => `- ${item}`)
      : ['- 없음']),
    '',
    '## 승인',
    ...(plan.approvalsRequired || []).map((approval) => `- ${approval}`),
    ''
  ].join('\n');
}

function createCandidateFiles({ plan, analysis, vendor, sourceContent, sourceFilename }) {
  if (plan.executionScope === 'blocked') {
    return [];
  }

  const projectFilename = analysis?.project?.source?.filename || '';
  const effectiveFilename = sourceFilename || projectFilename || `${vendor}-natural-language-draft.txt`;
  const baseName = safeFilename(effectiveFilename);
  const hasSource = safeString(sourceContent).length > 0 && analysis?.project?.source?.fileType !== 'natural-language-draft';
  const files = [];
  const timerUnknown = plan.timerValidation?.status === 'unknown';
  const canEmitInstruction =
    plan.changeCandidateV2?.policy?.canEmitInstructionCandidate !== false;

  if (timerUnknown) {
    // A review record is still useful, but no instruction, CSV, diff, or simulator
    // artifact may contain an invented Mitsubishi timer value.
  } else if (plan.executionScope === 'simulation-only') {
    files.push({
      id: makeId('file', baseName, vendor, 'simulation'),
      filename: `${baseName}.simulation-draft.txt`,
      label: '시뮬레이션 전용 회로 설명',
      mimeType: 'text/plain; charset=utf-8',
      content: formatCircuitDraft(plan.circuitDraft, { simulationOnly: true })
    });
  } else if (canEmitInstruction) {
    const primaryPatch =
      vendor === 'siemens'
        ? findArtifact(plan, ['SCL'])
        : findArtifact(plan, ['CSV']) ||
          findArtifact(plan, ['GX Works2 IL', 'GX Works listing']);

    if (hasSource) {
      const modifiedContent = createModifiedCandidate({ plan, vendor, sourceContent });
      const modifiedExtension = vendor === 'siemens' ? 'candidate.xml' : 'instruction-candidate.txt';
      files.push(
        {
          id: makeId('file', baseName, vendor, 'modified'),
          filename: `${baseName}.${modifiedExtension}`,
          label: vendor === 'siemens' ? '수정 후보 프로그램' : '원본과 분리된 검토용 명령 후보',
          mimeType: 'text/plain; charset=utf-8',
          content: modifiedContent
        },
        {
          id: makeId('file', baseName, vendor, 'diff'),
          filename: `${baseName}.${vendor === 'siemens' ? 'candidate' : 'before-after'}.diff`,
          label: '수정 전후 diff',
          mimeType: 'text/x-diff; charset=utf-8',
          content: createUnifiedDiff({
            filename: effectiveFilename,
            sourceContent,
            modifiedContent
          })
        }
      );
    }

    if (primaryPatch?.content) {
      files.push({
        id: makeId('file', baseName, vendor, 'patch'),
        filename: `${baseName}.${vendor === 'siemens' ? 'candidate.scl' : 'review-list.csv'}`,
        label: vendor === 'siemens' ? 'SCL 패치 후보' : '검토용 CSV 목록 (Import 미검증)',
        mimeType: vendor === 'siemens' ? 'text/plain; charset=utf-8' : 'text/csv; charset=utf-8',
        content: primaryPatch.content
      });
    }

    if (vendor === 'mitsubishi' && plan.circuitDraft && !hasSource) {
      files.push({
        id: makeId('file', baseName, vendor, 'gxworks2'),
        filename: `${baseName}.instruction-draft.txt`,
        label: 'GX Works2 검토용 명령 초안 (Import 미검증)',
        mimeType: 'text/plain; charset=utf-8',
        content: formatCircuitDraft(plan.circuitDraft)
      });
    }
  }

  files.push({
    id: makeId('file', baseName, vendor, 'json'),
    filename: `${baseName}.${hasSource ? 'change-proposal' : 'logic-draft'}.json`,
    label: '변경 계획 JSON',
    mimeType: 'application/json; charset=utf-8',
    content: createPlanJson(plan)
  });
  files.push({
    id: makeId('file', baseName, vendor, 'tests'),
    filename: `${baseName}.test-scenarios.json`,
    label: '자동 검토 시나리오',
    mimeType: 'application/json; charset=utf-8',
    content: createTestScenarioJson(plan)
  });
  files.push({
    id: makeId('file', baseName, vendor, 'review'),
    filename: `${baseName}.review-report.md`,
    label: '검토 보고서',
    mimeType: 'text/markdown; charset=utf-8',
    content: createReviewReport(plan)
  });
  if (plan.validationLoop) {
    files.push({
      id: makeId('file', baseName, vendor, 'validation-matrix'),
      filename: `${baseName}.validation-matrix.json`,
      label: 'Validation Matrix',
      mimeType: 'application/json; charset=utf-8',
      content: JSON.stringify(
        {
          version: plan.validationLoop.version,
          summary: plan.validationLoop.summary,
          iterations: plan.validationLoop.iterations,
          repairs: plan.validationLoop.repairs,
          validationRuns: plan.validationLoop.validationRuns,
          policy: plan.validationLoop.policy
        },
        null,
        2
      )
    });
    files.push({
      id: makeId('file', baseName, vendor, 'trend'),
      filename: `${baseName}.trend.json`,
      label: '시뮬레이션 Trend',
      mimeType: 'application/json; charset=utf-8',
      content: JSON.stringify(plan.validationLoop.trend, null, 2)
    });
  }

  return files;
}

function synchronizeRepairedPatchArtifacts(plan) {
  if (
    plan.vendor !== 'mitsubishi' ||
    !Array.isArray(plan.circuitDraft?.instructionList) ||
    !(plan.validationLoop?.repairs || []).length
  ) {
    return;
  }
  const instructionList = plan.circuitDraft.instructionList.join('\n');
  const csv = serializeCsv(
    plan.circuitDraft.instructionList.map((line, index) => [index + 1, line])
  );
  plan.recommendedPatch = {
    ...plan.recommendedPatch,
    patchArtifacts: (plan.recommendedPatch?.patchArtifacts || []).map(
      (artifact) => {
        if (artifact.language === 'GX Works2 IL') {
          return { ...artifact, content: instructionList };
        }
        if (artifact.language === 'CSV') {
          return { ...artifact, content: csv };
        }
        return artifact;
      }
    )
  };
}

function highRiskManualSteps(profile) {
  return [
    `${profile.label} 결과는 교육·검토·시뮬레이션에만 사용합니다.`,
    '실제 설비 프로젝트에 import하거나 PLC로 다운로드하지 않습니다.',
    '기계 안전 설계자와 PLC 담당자가 위험성 평가 및 안전 요구사항을 먼저 확정합니다.',
    '벤더 시뮬레이터와 별도 테스트 장비에서 정상·고장·정지 시나리오를 검증합니다.',
    '법규와 조직의 승인 절차를 통과하기 전에는 현장 설비에 반영하지 않습니다.'
  ];
}

export function createChangePlan(options) {
  const basePlan = createLegacyChangePlan(options);
  const requestText = safeString(options?.requestText, '', 4000);
  const highRiskMachine = detectHighRiskMachine(requestText);
  const blockedReason = basePlan?.recommendedPatch?.blockedReason || null;
  const delaySeconds = Number(basePlan.normalizedRequirement?.delaySeconds || 0);
  const cpuProfile = getCpuProfile(
    options?.analysis?.snapshot?.cpuProfileId || options?.analysis?.project?.cpuProfileId
  );
  const timerValidation =
    basePlan.vendor !== 'mitsubishi' || delaySeconds <= 0
      ? { status: 'not-applicable', seconds: null, reason: null }
      : calculateTimerDuration({
          timerAddress: 'T0',
          preset: 'K1',
          cpuProfile
        });
  const timerUnknown = timerValidation.status === 'unknown';
  const executionScope = blockedReason
    ? 'blocked'
    : highRiskMachine
      ? 'simulation-only'
      : timerUnknown
        ? 'review-only'
        : 'engineering-candidate';
  const circuitDraft = timerUnknown ? null : addCircuitAssumptions(basePlan.circuitDraft);
  const riskLevel = blockedReason
    ? 'blocked'
    : highRiskMachine
      ? 'high'
      : timerUnknown
        ? 'medium'
        : basePlan.riskLevel;
  const simulation = timerUnknown
    ? {
        result: 'not-run',
        harness: 'not-run',
        reason: timerValidation.reason,
        timerPresetSeconds: null,
        timeline: [],
        truthTable: []
      }
    : basePlan.simulation;
  const readiness = createReadiness({
    analysis: options?.analysis,
    sourceContent: options?.sourceContent,
    blockedReason,
    highRiskMachine,
    simulation,
    timerValidation
  });
  const warnings = [...(basePlan.warnings || [])];

  if (highRiskMachine) {
    warnings.unshift(
      `${highRiskMachine.label}는 인명 안전 또는 중대 설비 위험과 관련될 수 있어 실제 적용 파일을 생성하지 않습니다.`
    );
  }

  if (readiness.mode === 'new-circuit-draft') {
    warnings.push('기존 PLC 파일이 없어 주소 충돌, 태그 중복, 블록 영향은 확인되지 않았습니다.');
  }
  if (timerUnknown) {
    warnings.unshift(
      'CPU·명령·타이머 번호별 time base가 확인되지 않아 Mitsubishi 타이머 K값과 회로 후보를 생성하지 않았습니다.'
    );
  }

  const plan = {
    ...basePlan,
    circuitDraft,
    timerValidation,
    simulation,
    riskLevel,
    executionScope,
    highRiskMachine,
    readiness,
    approvalsRequired:
      riskLevel === 'high' || riskLevel === 'blocked'
        ? ['안전 담당자', 'PLC 담당자', '현장 책임자']
        : basePlan.approvalsRequired,
    warnings: [...new Set(warnings)],
    expectedBehavior: timerUnknown
      ? [
          `${basePlan.normalizedRequirement?.delaySeconds || 0}초 지연은 사용자의 요구사항이며 아직 PLC 타이머 값으로 환산되지 않았습니다.`,
          '검증된 CPU·타이머 프로필이 등록되기 전에는 시간값과 동작 통과를 단정하지 않습니다.',
          '기존 정지·비상정지·인터락 조건은 언제나 우선해야 합니다.'
        ]
      : basePlan.expectedBehavior,
    testCases: timerUnknown ? [] : basePlan.testCases,
    recommendedPatch: {
      ...basePlan.recommendedPatch,
      status: timerUnknown
        ? 'needs-verification'
        : executionScope === 'simulation-only'
          ? 'simulation-only'
          : basePlan.recommendedPatch.status,
      patchArtifacts: timerUnknown ? [] : basePlan.recommendedPatch.patchArtifacts,
      title:
        timerUnknown
          ? 'CPU·타이머 기준 확인 필요'
          : executionScope === 'simulation-only'
          ? '시뮬레이션 전용 회로 초안'
          : basePlan.recommendedPatch.title,
      summary:
        timerUnknown
          ? '검증된 time base가 없어 시간값을 포함한 명령 후보를 생성하지 않았습니다.'
          : executionScope === 'simulation-only'
          ? `${highRiskMachine.label} 요청은 실제 적용 후보 대신 교육·검토용 시뮬레이션 초안만 제공합니다.`
          : basePlan.recommendedPatch.summary,
      manualSteps:
        timerUnknown
          ? [
              '정확한 Mitsubishi CPU 모델을 선택합니다.',
              '사용할 타이머 번호와 명령의 time base를 공식 매뉴얼에서 확인합니다.',
              '검증된 프로필이 등록된 뒤 명령 후보와 테스트를 다시 생성합니다.'
            ]
          : executionScope === 'simulation-only'
          ? highRiskManualSteps(highRiskMachine)
          : basePlan.recommendedPatch.manualSteps
    },
    beforeAfterDiff:
      readiness.mode === 'new-circuit-draft'
        ? [
            {
              area: circuitDraft?.title || basePlan.beforeAfterDiff?.[0]?.area || '신규 회로',
              before: '기존 PLC 회로가 제공되지 않았습니다.',
              after: timerUnknown
                ? 'CPU·타이머 기준 확인 전에는 시간값을 포함한 회로를 생성하지 않습니다.'
                : '자연어 요구사항을 바탕으로 검토용 신규 회로 초안을 생성했습니다.'
            }
          ]
      : basePlan.beforeAfterDiff
  };

  const changeCandidateV2 = buildChangeCandidateV2({
    analysis: options?.analysis,
    plan,
    requestText,
    sourceContent: options?.sourceContent || '',
    highRiskMachine
  });
  plan.changeCandidateV2 = changeCandidateV2;
  plan.riskClass = changeCandidateV2.risk.class;
  if (!timerUnknown && changeCandidateV2.status !== 'blocked') {
    plan.testCases = createTemplateTestScenarios(changeCandidateV2);
  }

  if (changeCandidateV2.status === 'candidate') {
    plan.executionScope = changeCandidateV2.risk.scope;
  } else if (
    changeCandidateV2.status === 'needs-review' &&
    !timerUnknown &&
    !['blocked', 'simulation-only'].includes(plan.executionScope)
  ) {
    plan.executionScope = 'review-only';
    if (changeCandidateV2.logicIr.networks.length === 0) {
      plan.circuitDraft = null;
    }
    plan.recommendedPatch = {
      ...plan.recommendedPatch,
      status: 'needs-verification',
      title: '근거와 충돌 확인 필요',
      summary:
        '필수 신호, 지원 Template, Writer 위치 또는 주소 충돌을 확인하기 전에는 명령 후보를 생성하지 않습니다.',
      patchArtifacts: []
    };
    if (plan.simulation?.result !== 'not-run') {
      plan.simulation = {
        result: 'not-run',
        harness: 'not-run',
        reason: changeCandidateV2.validation.reviewReasons.join(', '),
        timerPresetSeconds: null,
        timeline: [],
        truthTable: []
      };
    }
    plan.testCases = [];
    plan.readiness = {
      ...plan.readiness,
      level: 'needs-evidence',
      summary:
        '현재 Export 근거만으로 안전한 변경 후보를 만들 수 없어 검토 기록만 제공합니다.',
      checks: plan.readiness.checks.map((check) =>
        check.id === 'addresses'
          ? {
              ...check,
              status: changeCandidateV2.impactAnalysis.conflicts.some(
                (conflict) => conflict.severity === 'must-review'
              )
                ? 'conflict'
                : 'unknown',
              detail:
                changeCandidateV2.impactAnalysis.conflicts
                  .map((conflict) => conflict.detail)
                  .join(' ') || '필수 신호와 정확한 Writer 위치를 추가로 확인해야 합니다.'
            }
          : check
      )
    };
  }

  if (plan.vendor === 'mitsubishi') {
    const validationLoop = runValidationLoop({
      changeCandidate: changeCandidateV2,
      circuitDraft: plan.circuitDraft,
      testScenarios: plan.testCases,
      manualValidationRecords: options?.manualValidationRecords || [],
      maxIterations: 2
    });
    plan.validationLoop = validationLoop;
    plan.circuitDraft = validationLoop.circuitDraft;
    plan.testCases =
      validationLoop.simulation.scenarios.length > 0
        ? validationLoop.simulation.scenarios
        : plan.testCases;
    plan.simulation = {
      ...plan.simulation,
      harness: validationLoop.simulation.harness,
      result:
        changeCandidateV2.risk.class === 'R4'
          ? 'blocked'
          : validationLoop.simulation.result,
      reason:
        validationLoop.simulation.diagnostics
          .map((item) => item.message)
          .join(' ') || null,
      timeline:
        changeCandidateV2.risk.class === 'R4'
          ? []
          : validationLoop.trend.rows,
      validationSummary: validationLoop.summary
    };
    synchronizeRepairedPatchArtifacts(plan);
  }

  plan.candidateFiles = createCandidateFiles({
    plan,
    analysis: options?.analysis,
    vendor: plan.vendor,
    sourceContent: options?.sourceContent || '',
    sourceFilename: options?.sourceFilename || ''
  });

  return plan;
}

export { VENDOR_PROFILES };
