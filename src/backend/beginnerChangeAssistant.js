import { createHash } from 'node:crypto';
import {
  createChangePlan as createLegacyChangePlan,
  VENDOR_PROFILES
} from './plcChangeAssistant.js';

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
  const base = safeString(value, fallback, 240)
    .split(/[\\/]/)
    .pop()
    .replace(/\.[^.]+$/, '')
    .replace(/[^A-Za-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '');

  return base || fallback;
}

function detectHighRiskMachine(requestText) {
  const normalized = safeString(requestText, '', 4000).toLowerCase().replace(/\s+/g, ' ');
  return (
    HIGH_RISK_MACHINE_PROFILES.find((profile) =>
      profile.keywords.some((keyword) => normalized.includes(keyword.toLowerCase()))
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

function createReadiness({ analysis, sourceContent, blockedReason, highRiskMachine, simulation }) {
  const project = analysis?.project || {};
  const hasSource = safeString(sourceContent).length > 0 && project?.source?.fileType !== 'natural-language-draft';
  const hasEvidence = hasProjectEvidence(project);
  const level = blockedReason ? 'blocked' : highRiskMachine ? 'simulation-only' : hasSource ? 'engineer-review' : 'draft-only';

  return {
    mode: hasSource ? 'existing-project-review' : 'new-circuit-draft',
    level,
    canWriteToPlc: false,
    summary: blockedReason
      ? '안전 조건 때문에 회로 후보 생성을 중단했습니다.'
      : highRiskMachine
        ? `${highRiskMachine.label} 요청은 인명 안전과 관련될 수 있어 시뮬레이션 전용 초안만 제공합니다.`
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
  } else {
    const start = byRole('기동') || byRole('감지') || 'X0';
    const stop = byRole('정지') || byRole('인터락') || 'X1';
    assumptions = [
      `${start}=ON은 시작 또는 감지 조건으로 가정합니다.`,
      `${stop}=ON은 정지 또는 인터락 요청으로 가정합니다.`,
      'GX Works2 타이머 K값은 0.1초 타임베이스 후보이며 실제 CPU 설정을 확인해야 합니다.'
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
      circuitDraft: plan.circuitDraft,
      warnings: plan.warnings
    },
    null,
    2
  );
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

  if (plan.executionScope === 'simulation-only') {
    files.push({
      id: makeId('file', baseName, vendor, 'simulation'),
      filename: `${baseName}.simulation-draft.txt`,
      label: '시뮬레이션 전용 회로 설명',
      mimeType: 'text/plain; charset=utf-8',
      content: formatCircuitDraft(plan.circuitDraft, { simulationOnly: true })
    });
  } else {
    const primaryPatch =
      vendor === 'siemens'
        ? findArtifact(plan, ['SCL'])
        : findArtifact(plan, ['CSV', 'GX Works2 IL', 'GX Works listing']);

    if (hasSource) {
      const modifiedContent = createModifiedCandidate({ plan, vendor, sourceContent });
      const modifiedExtension = vendor === 'siemens' ? 'candidate.xml' : 'candidate.lst';
      files.push(
        {
          id: makeId('file', baseName, vendor, 'modified'),
          filename: `${baseName}.${modifiedExtension}`,
          label: '수정 후보 프로그램',
          mimeType: 'text/plain; charset=utf-8',
          content: modifiedContent
        },
        {
          id: makeId('file', baseName, vendor, 'diff'),
          filename: `${baseName}.candidate.diff`,
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
        filename: `${baseName}.${vendor === 'siemens' ? 'candidate.scl' : 'candidate.csv'}`,
        label: vendor === 'siemens' ? 'SCL 패치 후보' : 'GX Works2 CSV 후보',
        mimeType: 'text/plain; charset=utf-8',
        content: primaryPatch.content
      });
    }

    if (vendor === 'mitsubishi' && plan.circuitDraft) {
      files.push({
        id: makeId('file', baseName, vendor, 'gxworks2'),
        filename: `${baseName}.gxworks2.lst`,
        label: 'GX Works2 명령 리스트',
        mimeType: 'text/plain; charset=utf-8',
        content: formatCircuitDraft(plan.circuitDraft)
      });
    }
  }

  files.push({
    id: makeId('file', baseName, vendor, 'json'),
    filename: `${baseName}.change-plan.json`,
    label: '변경 계획 JSON',
    mimeType: 'application/json; charset=utf-8',
    content: createPlanJson(plan)
  });

  return files;
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
  const executionScope = blockedReason ? 'blocked' : highRiskMachine ? 'simulation-only' : 'engineering-candidate';
  const circuitDraft = addCircuitAssumptions(basePlan.circuitDraft);
  const riskLevel = blockedReason ? 'blocked' : highRiskMachine ? 'high' : basePlan.riskLevel;
  const readiness = createReadiness({
    analysis: options?.analysis,
    sourceContent: options?.sourceContent,
    blockedReason,
    highRiskMachine,
    simulation: basePlan.simulation
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

  const plan = {
    ...basePlan,
    circuitDraft,
    riskLevel,
    executionScope,
    highRiskMachine,
    readiness,
    approvalsRequired:
      riskLevel === 'high' || riskLevel === 'blocked'
        ? ['안전 담당자', 'PLC 담당자', '현장 책임자']
        : basePlan.approvalsRequired,
    warnings: [...new Set(warnings)],
    recommendedPatch: {
      ...basePlan.recommendedPatch,
      status: executionScope === 'simulation-only' ? 'simulation-only' : basePlan.recommendedPatch.status,
      title:
        executionScope === 'simulation-only'
          ? '시뮬레이션 전용 회로 초안'
          : basePlan.recommendedPatch.title,
      summary:
        executionScope === 'simulation-only'
          ? `${highRiskMachine.label} 요청은 실제 적용 후보 대신 교육·검토용 시뮬레이션 초안만 제공합니다.`
          : basePlan.recommendedPatch.summary,
      manualSteps:
        executionScope === 'simulation-only'
          ? highRiskManualSteps(highRiskMachine)
          : basePlan.recommendedPatch.manualSteps
    },
    beforeAfterDiff:
      readiness.mode === 'new-circuit-draft'
        ? [
            {
              area: circuitDraft?.title || basePlan.beforeAfterDiff?.[0]?.area || '신규 회로',
              before: '기존 PLC 회로가 제공되지 않았습니다.',
              after: '자연어 요구사항을 바탕으로 검토용 신규 회로 초안을 생성했습니다.'
            }
          ]
        : basePlan.beforeAfterDiff
  };

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
